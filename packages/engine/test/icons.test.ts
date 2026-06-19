import { describe, expect, test } from "bun:test";
import { startEngineServer } from "../src/server";
import { MANIFEST_JSON } from "../src/cockpit";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("PWA / notification icons (V8 Phase 1.5)", () => {
  test("GET /app/icon-*.png serve valid PNGs of the right dimensions", async () => {
    const s = startEngineServer({ token: "icon" });
    try {
      const cases: Array<[string, number]> = [
        ["icon-192.png", 192],
        ["icon-512.png", 512],
        ["icon-512-maskable.png", 512],
      ];
      for (const [name, w] of cases) {
        const r = await fetch(`http://127.0.0.1:${s.port}/app/${name}`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toBe("image/png");
        const buf = Buffer.from(await r.arrayBuffer());
        expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true); // PNG signature
        expect(buf.readUInt32BE(16)).toBe(w); // IHDR width (offset 16)
        expect(buf.readUInt32BE(20)).toBe(w); // IHDR height (offset 20)
      }
    } finally {
      s.stop();
    }
  });

  test("a missing icon name degrades to 503, never crashes", async () => {
    const s = startEngineServer({ token: "icon" });
    try {
      expect((await fetch(`http://127.0.0.1:${s.port}/app/icon-nope.png`)).status).toBe(503);
    } finally {
      s.stop();
    }
  });

  test("the manifest references the PNG icons (any + maskable), not the old SVG data URI", () => {
    const m = JSON.parse(MANIFEST_JSON);
    const srcs = m.icons.map((i: { src: string }) => i.src);
    expect(srcs).toContain("/app/icon-192.png");
    expect(srcs).toContain("/app/icon-512-maskable.png");
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    expect(MANIFEST_JSON).not.toContain("data:image/svg");
  });
});
