// Mobile cockpit (Epic G §3.3/§4 — "view + steer"). A self-contained, dependency-free page
// the engine serves at /app. It pairs with a scoped token and lets you, from a phone browser
// over the user's own transport (Tailscale/tunnel), see sessions + live state and — the
// killer feature — ANSWER approval requests. Live approvals arrive over the WebSocket; the
// session list polls. A full React client sharing packages/ui is a tracked enhancement.

// The service worker (V8 Phase 1.3) — a push RECEIVER served standalone at /app/sw.js so it can claim
// the /app scope. It only handles `push` (show the notification) + `notificationclick` (open the right
// session); offline-shell caching is intentionally omitted in v1. The payload is metadata-only (the
// engine never sends transcript text). Registration is gated on a secure context (HTTPS / localhost).
export const SW_JS = `self.addEventListener("push", function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) {}
  var title = d.title || "GlaudeCode";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    tag: d.tag || d.kind || "glaudecode",
    data: { paneId: d.paneId, sessionId: d.sessionId },
    icon: "/app/icon-192.png",
    badge: "/app/icon-192.png"
  }));
});
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var pane = event.notification.data && event.notification.data.paneId;
  var target = "/app/chat" + (pane ? "?pane=" + encodeURIComponent(pane) : "");
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (wins) {
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if (w.url.indexOf("/app") >= 0 && "focus" in w) { if (w.navigate) w.navigate(target); return w.focus(); }
    }
    return clients.openWindow(target);
  }));
});
`;

export const MANIFEST_JSON = JSON.stringify({
  name: "GlaudeCode Cockpit",
  short_name: "Cockpit",
  id: "/app",
  start_url: "/app",
  scope: "/app",
  display: "standalone",
  background_color: "#0d1117",
  theme_color: "#0d1117",
  icons: [
    { src: "/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/app/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

export const COCKPIT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="#0d1117" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Cockpit" />
<link rel="manifest" href="/app/manifest.json" />
<title>GlaudeCode Cockpit</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; color: #c9d1d9; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  header { position: sticky; top: 0; display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: #0b0f14; border-bottom: 1px solid #1f2630; }
  header h1 { font-size: 15px; margin: 0; flex: 1; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #f85149; }
  .dot.ok { background: #3fb950; }
  main { padding: 12px 14px 40px; max-width: 680px; margin: 0 auto; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6e7681; margin: 18px 0 8px; }
  .gate { display: flex; flex-direction: column; gap: 10px; padding-top: 24px; }
  input { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 15px; padding: 12px; width: 100%; }
  button { background: #1f6feb; border: none; border-radius: 8px; color: #fff; font: inherit; font-weight: 600; padding: 12px 14px; cursor: pointer; }
  button.ghost { background: #21262d; }
  button.deny { background: #b62324; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
  .card.danger { border-left: 3px solid #f85149; }
  .tool { font-weight: 700; }
  .badge { background: #3d1a1a; color: #f85149; border-radius: 8px; padding: 0 7px; font-size: 11px; margin-left: 6px; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #e3b341; word-break: break-word; margin: 6px 0; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  .row button { flex: 1; }
  .sess { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid #1f2630; }
  .sess .state { width: 9px; height: 9px; border-radius: 50%; background: #6e7681; flex: 0 0 auto; }
  .sess .state.thinking, .sess .state.running-tool { background: #d29922; }
  .sess .state.idle { background: #3fb950; }
  .muted { color: #6e7681; }
  .empty { color: #6e7681; padding: 8px 0; }
</style>
</head>
<body>
<header><span id="conn" class="dot"></span><h1>GlaudeCode Cockpit</h1><button id="logout" class="ghost" style="display:none">Sign out</button></header>
<main id="app"></main>
<script>
const $ = (id) => document.getElementById(id);
let TOKEN = sessionStorage.getItem("ck.token") || "";
let DIR = null;

async function rpc(method, params) {
  const res = await fetch("/rpc", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({ method, params: params || {} }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || ("rpc " + method + " " + res.status));
    err.status = res.status; // so callers can tell a dead token (401/403) from a transient error (L3)
    throw err;
  }
  return body.result;
}

function gate(msg) {
  $("logout").style.display = "none";
  $("app").innerHTML =
    '<div class="gate"><h2>Pair this device</h2>' +
    '<p class="muted">In GlaudeCode, run "Pair a device" to get a short code. A steer-scope code can answer approvals.</p>' +
    (msg ? '<p style="color:#f85149">' + esc(msg) + "</p>" : "") +
    '<input id="code" placeholder="pairing code" autocomplete="off" autocapitalize="characters" />' +
    '<button id="go">Pair</button></div>';
  $("go").onclick = async () => {
    const code = $("code").value.trim();
    if (!code) return;
    try {
      const res = await fetch("/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: navigator.userAgent.slice(0, 40) }) });
      const body = await res.json();
      if (!res.ok) return gate(body.error || "pairing failed");
      TOKEN = body.token;
      sessionStorage.setItem("ck.token", TOKEN);
      sessionStorage.setItem("ck.scope", body.scope || "view"); // term page gates input on this
      start();
    } catch (e) {
      gate("could not reach the engine");
    }
  };
  // QR / "Connect my phone" handoff: a #code=… fragment auto-fills + submits. The code rides in the
  // FRAGMENT (never the query string), so it isn't logged/Referer-leaked; we strip it after reading.
  // We rewrite to the bare pathname (dropping any query too) — the RCE-scope token must NEVER be
  // sourced from or left in the query string (it would leak into history, the Tailscale Serve
  // TLS-proxy logs, and Referer). The token lives in sessionStorage only.
  const m = /[#&]code=([^&]+)/.exec(location.hash);
  if (m) {
    history.replaceState(null, "", location.pathname);
    $("code").value = decodeURIComponent(m[1]).toUpperCase();
    $("go").click();
  }
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function summarize(input) {
  const i = input || {};
  if (i.command || i.file_path || i.notebook_path) return i.command || i.file_path || i.notebook_path;
  // A circular / exotic input must NOT throw out of render() and blank the whole cockpit (audit L10).
  try { return JSON.stringify(i).slice(0, 160); } catch (e) { return "[unviewable input]"; }
}

let approvals = [];
let sessions = [];
let panes = [];
const deciding = {}; // approval id -> true while its resolve is in flight (M10)
let actionError = null; // last failed Allow/Deny, shown as a banner until the next attempt (M10)

function render() {
  $("logout").style.display = "";
  // Only steer+ devices may resolve approvals; a view device sees a REDACTED card (no input/reason)
  // and NO Allow/Deny buttons (which would only 403). Read scope fresh so a same-load re-pair applies.
  const canAct = (sessionStorage.getItem("ck.scope") || "view") !== "view";
  const apHtml = approvals.length
    ? approvals.map((a) =>
        '<div class="card ' + (a.dangerous ? "danger" : "") + '">' +
        '<div><span class="tool">' + esc(a.tool) + "</span>" +
        (a.dangerous ? '<span class="badge">dangerous</span>' : "") + "</div>" +
        '<div class="mono">' + esc(a.redacted ? "(input hidden — view-only device)" : summarize(a.input)) + "</div>" +
        (a.redacted ? "" : '<div class="muted">' + esc(a.reason || "") + "</div>") +
        (canAct
          ? (deciding[a.id]
              ? '<div class="row"><button disabled>…</button></div>' // in flight — no double-submit
              : '<div class="row"><button data-act="allow" data-id="' + esc(a.id) + '">Allow</button>' +
                '<button class="deny" data-act="deny" data-id="' + esc(a.id) + '">Deny</button></div>')
          : "") +
        "</div>"
      ).join("")
    : '<div class="empty">No pending approvals.</div>';
  const sHtml = sessions.length
    ? sessions.map((s) =>
        '<div class="sess"><span class="state ' + esc(s._state || "") + '"></span><div><div>' +
        esc(s.title || s.firstPrompt || s.id.slice(0, 8)) + '</div><div class="muted">' + esc(s.gitBranch || "") + "</div></div></div>"
      ).join("")
    : '<div class="empty">No sessions.</div>';
  // Live terminals you can mirror (V5 Phase 1) — plain anchors to the view-only terminal page; the
  // paneId is URL-encoded + HTML-escaped, no inline handlers (keeps the no-injection posture).
  const tHtml = panes.length
    ? panes.map((p) => {
        // For a Claude pane paneId === sessionId, so a pending approval/question is for this pane.
        const waiting = p._waiting || approvals.some((a) => a.sessionId === p.paneId);
        const badge = waiting ? '<span class="badge">needs you</span>' : "";
        // V6: a session opens the conversation view (/app/chat); the raw terminal is the ⌨ fallback inside it.
        return '<a class="sess termlink" href="/app/chat?pane=' + encodeURIComponent(p.paneId) + '">' +
          '<span class="state ' + esc(p._state || "ok") + '"></span><div><div>' + esc(p.title || p.paneId.slice(0, 8)) + badge +
          '</div><div class="muted">' + esc(p.cols + "x" + p.rows) + "</div></div></a>";
      }).join("")
    : '<div class="empty">No live terminals — open a pane in GlaudeCode.</div>';
  const errHtml = actionError
    ? '<div style="background:#3a1212;color:#ff7b72;padding:8px 10px;border-radius:8px;margin-bottom:10px">' + esc(actionError) + "</div>"
    : "";
  $("app").innerHTML =
    errHtml + "<h2>Approvals</h2>" + apHtml + "<h2>Terminals</h2>" + tHtml + "<h2>Sessions</h2>" + sHtml;
}

async function decide(id, decision) {
  // Don't optimistically remove the card or swallow failures (audit M10): mark it in-flight (buttons
  // disabled), and remove it ONLY on a confirmed resolve. A throw or {ok:false} restores the card and
  // shows an error — a failed Allow/Deny on a flaky link must never look like success.
  if (deciding[id]) return;
  deciding[id] = true;
  actionError = null;
  render();
  try {
    const r = await rpc("resolveApproval", { id, decision });
    if (r && r.ok === false) throw new Error("not resolved — it may have already been decided");
    approvals = approvals.filter((a) => a.id !== id);
  } catch (e) {
    actionError = "Couldn't " + decision + " that request: " + (e && e.message ? e.message : "please retry");
  } finally {
    delete deciding[id];
    render();
  }
}
// Event delegation — no inline handlers, no string interpolation of data into markup.
$("app").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (btn) decide(btn.getAttribute("data-id"), btn.getAttribute("data-act"));
});

async function refreshPanes() {
  try {
    panes = await rpc("listPanes");
    // Join each pane to its session for a live state dot + a "needs you" badge (capped concurrency).
    if (DIR) {
      await Promise.all(panes.slice(0, 12).map(async (p) => {
        try { p._state = (await rpc("agentState", { id: p.paneId, dir: DIR })).status; } catch (e) {}
        try { p._waiting = (await rpc("promptState", { id: p.paneId, dir: DIR })).isWaiting; } catch (e) {}
      }));
    }
    render();
  } catch (e) {}
}

async function refreshSessions() {
  if (!DIR) return;
  try {
    sessions = await rpc("listSessions", { dir: DIR });
    await Promise.all(sessions.slice(0, 12).map(async (s) => {
      try { s._state = (await rpc("agentState", { id: s.id, dir: DIR })).status; } catch (e) {}
    }));
    render();
  } catch (e) {}
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // Token goes in the FIRST message, never the URL (it would leak via history/Referer/logs).
  const ws = new WebSocket(proto + "://" + location.host + "/ws");
  ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", token: TOKEN })); $("conn").className = "dot ok"; };
  ws.onclose = (ev) => {
    $("conn").className = "dot";
    // 4003 = token revoked/expired: re-pair instead of reconnect-looping with a dead token (L3).
    if (ev.code === 4003) { sessionStorage.removeItem("ck.token"); return gate("session ended — pair again"); }
    setTimeout(connectWs, 2000);
  };
  ws.onmessage = (ev) => {
    try { const f = JSON.parse(ev.data); if (f.type === "approvals") { approvals = f.payload || []; render(); } } catch (e) {}
  };
}

async function start() {
  try {
    // Register the push service worker (V8) — only in a secure context (HTTPS via Tailscale Serve, or
    // localhost). A bare-tailnet HTTP origin can't register one; push simply stays unavailable there.
    if (location.protocol === "https:" && "serviceWorker" in navigator) navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(function () {});
    DIR = (await rpc("defaultDir")).dir;
    approvals = await rpc("pendingApprovals");
    render();
    connectWs();
    refreshSessions();
    refreshPanes();
    setInterval(refreshSessions, 5000);
    setInterval(refreshPanes, 4000);
  } catch (e) {
    // Only drop the token + re-pair on a REAL auth failure; a transient error (engine restarting /
    // offline) keeps the token and retries, so a blip doesn't force an unnecessary re-pair (L3).
    if (e && (e.status === 401 || e.status === 403)) {
      sessionStorage.removeItem("ck.token");
      return gate("session ended — pair again");
    }
    setTimeout(start, 2000);
  }
}

$("logout").onclick = () => { sessionStorage.removeItem("ck.token"); location.href = "/app"; };
if (TOKEN) start(); else gate();
</script>
</body>
</html>`;
