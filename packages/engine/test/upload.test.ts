// V6 file upload: a paired terminal-scope phone POSTs a file; the engine writes it under a
// SERVER-chosen .glaudecode-uploads/ dir (the client can't pick a path) and returns the path. Tests
// cover the pure filename-safety logic + the route gating (scope, size, traversal, audit).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEngineServer, type EngineServer } from "../src/server";
import { safeUploadName, uniqueUploadName, readStreamCapped, UPLOAD_SUBDIR } from "../src/upload";

/** A ReadableStream that emits the given chunks then closes — to drive readStreamCapped directly. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      else c.close();
    },
  });
}

describe("readStreamCapped (streaming byte counter — no full-buffer before the cap, #36)", () => {
  test("under the cap → the concatenated bytes", async () => {
    const out = await readStreamCapped(streamOf([Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])]), 64);
    expect(out).not.toBeNull();
    expect([...out!]).toEqual([1, 2, 3, 4, 5]);
  });

  test("exactly at the cap → accepted (the trigger is strictly over)", async () => {
    const out = await readStreamCapped(streamOf([new Uint8Array(64)]), 64);
    expect(out?.length).toBe(64);
  });

  test("over the cap ACROSS chunks → null, and it stops early (doesn't read the tail)", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(40)); // 40, 80(>64 → abort), … — an unbounded chunked body
      },
    });
    const out = await readStreamCapped(stream, 64);
    expect(out).toBeNull();
    expect(pulled).toBeLessThanOrEqual(2); // bailed at the 2nd chunk, never drained the (infinite) stream
  });

  test("a single chunk larger than the cap → null", async () => {
    expect(await readStreamCapped(streamOf([new Uint8Array(65)]), 64)).toBeNull();
  });

  test("a null/absent body → an empty buffer (the route 400s that)", async () => {
    expect((await readStreamCapped(null, 64))?.length).toBe(0);
    expect((await readStreamCapped(undefined, 64))?.length).toBe(0);
  });
});

describe("safeUploadName (no traversal, ever)", () => {
  test("strips any path components down to the basename", () => {
    expect(safeUploadName("foo/bar/baz.png")).toBe("baz.png");
    expect(safeUploadName("/etc/shadow")).toBe("shadow");
    expect(safeUploadName("../../etc/passwd")).toBe("passwd");
    expect(safeUploadName("a\\b\\c.txt")).toBe("c.txt");
  });
  test("refuses leading dots (no hidden / .gitignore clobber / dot-dot)", () => {
    expect(safeUploadName(".gitignore")).toBe("gitignore");
    expect(safeUploadName("..")).toBe("upload");
    expect(safeUploadName(".")).toBe("upload");
    expect(safeUploadName("...x")).toBe("x");
  });
  test("keeps a conservative charset + the extension, bounds length, has a fallback", () => {
    expect(safeUploadName("my file (1).pdf")).toBe("my_file_1_.pdf");
    expect(safeUploadName("a.tar.gz")).toBe("a.tar.gz");
    expect(safeUploadName("")).toBe("upload");
    expect(safeUploadName("résumé.döc").endsWith(".d_c")).toBe(true);
    expect(safeUploadName("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("uniqueUploadName (no clobber)", () => {
  test("returns the name when free; suffixes -1, -2 … before the extension when taken", () => {
    expect(uniqueUploadName("a.png", () => false)).toBe("a.png");
    const taken = new Set(["a.png", "a-1.png"]);
    expect(uniqueUploadName("a.png", (n) => taken.has(n))).toBe("a-2.png");
    const noExt = new Set(["notes"]);
    expect(uniqueUploadName("notes", (n) => noExt.has(n))).toBe("notes-1");
  });
});

describe("/upload route", () => {
  let server: EngineServer;
  let base: string;
  let root: string;
  let uploads: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "gc-upload-"));
    uploads = join(root, UPLOAD_SUBDIR);
    server = startEngineServer({ token: "up-token", uploadDir: root, maxUploadBytes: 64, configHome: root });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const termToken = () => server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!.token;
  const upload = (token: string | null, name: string, body: BodyInit, extra: Record<string, string> = {}) =>
    fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-filename": encodeURIComponent(name),
        ...extra,
      },
      body,
    });

  test("a terminal token uploads a file → 200, lands inside the uploads dir, contents match", async () => {
    const res = await upload(termToken(), "notes.txt", "hello upload");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("notes.txt");
    expect(body.path).toBe(join(uploads, "notes.txt"));
    expect(existsSync(body.path)).toBe(true);
    expect(readFileSync(body.path, "utf8")).toBe("hello upload");
    // a .gitignore is dropped so uploads never get committed
    expect(readFileSync(join(uploads, ".gitignore"), "utf8")).toContain("*");
  });

  test("a traversal filename can only ever land inside the uploads dir (sanitised basename)", async () => {
    const res = await upload(termToken(), "../../escape.sh", "x");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("escape.sh");
    expect(body.path).toBe(join(uploads, "escape.sh")); // NOT root/escape.sh or anywhere above
  });

  test("a second file with the same name doesn't clobber the first (-1 suffix)", async () => {
    const t = termToken();
    const a = await (await upload(t, "dup.txt", "first")).json();
    const b = await (await upload(t, "dup.txt", "second")).json();
    expect(a.name).toBe("dup.txt");
    expect(b.name).toBe("dup-1.txt");
    expect(readFileSync(a.path, "utf8")).toBe("first");
    expect(readFileSync(b.path, "utf8")).toBe("second");
  });

  test("a view or steer token is refused with 403 (terminal scope only)", async () => {
    const viewTok = server.pairing.redeem(server.pairing.createPairCode("view").code, "v")!.token;
    const steerTok = server.pairing.redeem(server.pairing.createPairCode("steer").code, "s")!.token;
    expect((await upload(viewTok, "x.txt", "data")).status).toBe(403);
    expect((await upload(steerTok, "x.txt", "data")).status).toBe(403);
  });

  test("no token → 401", async () => {
    expect((await upload(null, "x.txt", "data")).status).toBe(401);
  });

  test("an oversized upload is rejected with 413 (cap injected small for the test)", async () => {
    const big = new Uint8Array(65); // server cap is 64 bytes
    const res = await upload(termToken(), "big.bin", big);
    expect(res.status).toBe(413);
  });

  test("a CHUNKED over-cap body (no honest content-length) is still rejected 413, not OOM'd (#36)", async () => {
    // Stream 3×40 = 120 bytes as a chunked body — the declared-size fast-path can't catch it, so the
    // streaming counter must. Nothing is written to disk.
    const res = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${termToken()}`, "x-filename": "huge.bin" },
      body: streamOf([new Uint8Array(40), new Uint8Array(40), new Uint8Array(40)]),
      // @ts-expect-error duplex is required by the fetch spec for a stream body (supported by Bun)
      duplex: "half",
    });
    expect(res.status).toBe(413);
    expect(existsSync(join(uploads, "huge.bin"))).toBe(false);
  });

  test("an empty upload → 400", async () => {
    expect((await upload(termToken(), "empty.txt", "")).status).toBe(400);
  });
});
