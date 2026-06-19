import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPushKinds, type PhaseSnapshot } from "../src/pushTrigger";
import { startEngineServer, type EngineServer } from "../src/server";
import type { SendFn } from "../src/push";

const flush = () => new Promise((r) => setTimeout(r, 30));

/** A REAL P-256 subscription key pair — the sender actually encrypts to it, so a fake stub would throw. */
function realKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
}

describe("detectPushKinds (pure edge detector — fires on transitions only)", () => {
  const snap = (waiting: boolean, idle: boolean, errorCount = 0): PhaseSnapshot => ({ waiting, idle, errorCount });
  test("first sighting (no prev) emits nothing — never buzz for pre-existing state", () => {
    expect(detectPushKinds(undefined, snap(true, true, 3))).toEqual([]);
  });
  test("question fires on not-waiting → waiting, not while it stays waiting", () => {
    expect(detectPushKinds(snap(false, false), snap(true, false))).toEqual(["question"]);
    expect(detectPushKinds(snap(true, false), snap(true, false))).toEqual([]);
  });
  test("finished fires on running → idle, not while it stays idle", () => {
    expect(detectPushKinds(snap(false, false), snap(false, true))).toEqual(["finished"]);
    expect(detectPushKinds(snap(false, true), snap(false, true))).toEqual([]);
  });
  test("error fires when a new error tool_result appears", () => {
    expect(detectPushKinds(snap(false, false, 0), snap(false, false, 1))).toEqual(["error"]);
    expect(detectPushKinds(snap(false, false, 1), snap(false, false, 1))).toEqual([]);
  });
  test("multiple edges in one tick all fire", () => {
    expect(detectPushKinds(snap(false, false, 0), snap(true, true, 1)).sort()).toEqual(["error", "finished", "question"]);
  });
});

describe("approval push trigger (server integration, injected send)", () => {
  let server: EngineServer;
  let base: string;
  let home: string;
  const sends: string[] = [];
  const pushSend: SendFn = async (url) => {
    sends.push(url);
    return { status: 201 };
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "gc-pushtrig-"));
    server = startEngineServer({ token: "trig-token", configHome: home, pushSend });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => {
    server.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const steerToken = () => server.pairing.redeem(server.pairing.createPairCode("steer").code, "phone")!.token;
  const subscribe = (token: string, n: number) =>
    fetch(`${base}/push-subscribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ endpoint: `https://push.example/${n}`, keys: realKeys() }),
    });
  const ask = (sessionId: string) =>
    void server.approvals.submit({ sessionId, tool: "Bash", input: { command: "git push" }, repoDir: "/r" });

  test("an approval with NO subscription fires no push", async () => {
    ask("s0");
    await flush();
    expect(sends.length).toBe(0);
  });

  test("after a device subscribes, a NEW approval fires exactly one push", async () => {
    expect((await subscribe(steerToken(), 1)).status).toBe(200);
    sends.length = 0;
    ask("s1");
    await flush();
    expect(sends.length).toBe(1);
    expect(sends[0]).toBe("https://push.example/1");
  });

  test("a second approval for the same session within the debounce window does NOT re-push", async () => {
    sends.length = 0;
    ask("s1");
    ask("s1");
    await flush();
    expect(sends.length).toBe(0); // s1:approval was just pushed above — still within 60s dedupe
  });

  test("a different session pushes (dedupe is per session+kind)", async () => {
    sends.length = 0;
    ask("s2");
    await flush();
    expect(sends.length).toBe(1);
  });
});
