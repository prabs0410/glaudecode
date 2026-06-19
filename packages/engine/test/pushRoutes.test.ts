// /push-subscribe + /push-key routes (BL-5 scaffolding). DELIVERY (the signed web-push send) is
// HTTPS-gated and not built; these guard the SUBSCRIBE surface: scope (steer+), validation, persistence,
// and that the VAPID public key is exposed but the private key never leaves the engine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEngineServer, type EngineServer } from "../src/server";

describe("Web Push subscribe routes", () => {
  let server: EngineServer;
  let base: string;
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "gc-pushroute-"));
    server = startEngineServer({ token: "push-token", configHome: home });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => {
    server.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const mkToken = (scope: "view" | "steer" | "terminal") =>
    server.pairing.redeem(server.pairing.createPairCode(scope).code, "dev")!.token;
  const goodSub = { endpoint: "https://push.example/abc", keys: { p256dh: "BPxx", auth: "aXx" } };
  const subscribe = (token: string | null, body: unknown = goodSub) =>
    fetch(`${base}/push-subscribe`, {
      method: "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("a VAPID keypair is generated, persisted, and the PUBLIC key is a 65-byte EC point", () => {
    const pub = Buffer.from(server.vapidPublicKey, "base64url");
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    // a second server over the SAME configHome returns the IDENTICAL public key (persisted)
    const again = startEngineServer({ token: "t2", configHome: home });
    expect(again.vapidPublicKey).toBe(server.vapidPublicKey);
    again.stop();
  });

  test("GET /push-key returns the public key to a paired device, 401 without a token", async () => {
    expect((await fetch(`${base}/push-key`)).status).toBe(401);
    const r = await fetch(`${base}/push-key`, { headers: { authorization: `Bearer ${mkToken("view")}` } });
    expect(r.status).toBe(200);
    expect((await r.json()).publicKey).toBe(server.vapidPublicKey);
  });

  test("no token → 401; a VIEW token → 403 (steer+ required)", async () => {
    expect((await subscribe(null)).status).toBe(401);
    expect((await subscribe(mkToken("view"))).status).toBe(403);
  });

  test("a STEER token subscribes → 200, and the subscription is persisted", async () => {
    const before = server.pushSubscriptions.count();
    const r = await subscribe(mkToken("steer"));
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    expect(server.pushSubscriptions.count()).toBe(before + 1);
  });

  test("a malformed subscription body → 400 (no http endpoint / missing keys)", async () => {
    expect((await subscribe(mkToken("steer"), { endpoint: "http://insecure/x", keys: { p256dh: "k", auth: "a" } })).status).toBe(400);
    expect((await subscribe(mkToken("terminal"), { endpoint: "https://x", keys: {} })).status).toBe(400);
  });
});
