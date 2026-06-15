import { describe, expect, test } from "bun:test";
import { COCKPIT_HTML } from "../src/cockpit";

// H1 (audit-2026-06-15): the cockpit must NEVER source the paired (RCE-scope) token from the URL
// query string — that leaks a bearer-equivalent credential into history, the Tailscale Serve
// TLS-proxy access logs, and the Referer of every sub-resource. The token lives in sessionStorage
// only; the pair CODE may ride in the URL fragment (scrubbed after read), never the query.
describe("cockpit token sourcing (audit H1)", () => {
  test("token is read from sessionStorage, never the query string", () => {
    expect(COCKPIT_HTML).toContain('sessionStorage.getItem("ck.token")');
    // no `?token=` style read anywhere in the served page
    expect(COCKPIT_HTML).not.toContain("location.search");
    expect(COCKPIT_HTML).not.toMatch(/URLSearchParams\([^)]*\)\.get\(["']token["']\)/);
  });

  test("the fragment scrub drops query+hash to location.pathname (no token can survive in the URL)", () => {
    // the #code= handoff must rewrite to pathname only — not pathname + search
    expect(COCKPIT_HTML).toContain('history.replaceState(null, "", location.pathname)');
    expect(COCKPIT_HTML).not.toContain("location.pathname + location.search");
  });
});
