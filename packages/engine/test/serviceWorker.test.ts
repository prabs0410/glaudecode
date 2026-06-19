import { describe, expect, test } from "bun:test";
import { SW_JS } from "../src/cockpit";
import { startEngineServer } from "../src/server";

// The push service worker (V8 Phase 1.3). It's served as standalone JS so it can claim the /app scope;
// guard that it PARSES (a stray syntax error would silently break push registration on the phone) and
// that the route serves it correctly. Actual registration + delivery is HTTPS/device-gated.
describe("service worker", () => {
  test("SW_JS parses and wires the push + notificationclick handlers", () => {
    // PARSE only (the SW globals `self`/`clients` aren't defined here; the function is never called).
    expect(() => new Function(SW_JS)).not.toThrow();
    expect(SW_JS).toContain('addEventListener("push"');
    expect(SW_JS).toContain('addEventListener("notificationclick"');
    expect(SW_JS).toContain("showNotification");
    expect(SW_JS).not.toContain("</script>"); // must never close the embedding page's script
  });

  test("GET /app/sw.js serves it as javascript, scoped to /app", async () => {
    const s = startEngineServer({ token: "sw-token" });
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/app/sw.js`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("javascript");
      expect(r.headers.get("service-worker-allowed")).toBe("/app");
      expect(await r.text()).toContain("notificationclick");
    } finally {
      s.stop();
    }
  });

  test("the cockpit registers the SW only in a secure context", () => {
    const { COCKPIT_HTML } = require("../src/cockpit");
    expect(COCKPIT_HTML).toContain('location.protocol === "https:"');
    expect(COCKPIT_HTML).toContain('navigator.serviceWorker.register("/app/sw.js"');
  });
});
