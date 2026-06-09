// Mobile cockpit (Epic G §3.3/§4 — "view + steer"). A self-contained, dependency-free page
// the engine serves at /app. It pairs with a scoped token and lets you, from a phone browser
// over the user's own transport (Tailscale/tunnel), see sessions + live state and — the
// killer feature — ANSWER approval requests. Live approvals arrive over the WebSocket; the
// session list polls. A full React client sharing packages/ui is a tracked enhancement.

export const MANIFEST_JSON = JSON.stringify({
  name: "GlaudeCode Cockpit",
  short_name: "Cockpit",
  start_url: "/app",
  display: "standalone",
  background_color: "#0d1117",
  theme_color: "#0d1117",
});

export const COCKPIT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
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
let TOKEN = new URLSearchParams(location.search).get("token") || sessionStorage.getItem("ck.token") || "";
let DIR = null;

async function rpc(method, params) {
  const res = await fetch("/rpc", { method: "POST", headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" }, body: JSON.stringify({ method, params: params || {} }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ("rpc " + method + " " + res.status));
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
      start();
    } catch (e) {
      gate("could not reach the engine");
    }
  };
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function summarize(input) { const i = input || {}; return i.command || i.file_path || i.notebook_path || JSON.stringify(i).slice(0, 160); }

let approvals = [];
let sessions = [];

function render() {
  $("logout").style.display = "";
  const apHtml = approvals.length
    ? approvals.map((a) =>
        '<div class="card ' + (a.dangerous ? "danger" : "") + '"><div><span class="tool">' + esc(a.tool) + "</span>" +
        (a.dangerous ? '<span class="badge">dangerous</span>' : "") + "</div>" +
        '<div class="mono">' + esc(summarize(a.input)) + "</div>" +
        '<div class="muted">' + esc(a.reason || "") + "</div>" +
        '<div class="row"><button data-act="allow" data-id="' + esc(a.id) + '">Allow</button>' +
        '<button class="deny" data-act="deny" data-id="' + esc(a.id) + '">Deny</button></div></div>'
      ).join("")
    : '<div class="empty">No pending approvals.</div>';
  const sHtml = sessions.length
    ? sessions.map((s) =>
        '<div class="sess"><span class="state ' + esc(s._state || "") + '"></span><div><div>' +
        esc(s.title || s.firstPrompt || s.id.slice(0, 8)) + '</div><div class="muted">' + esc(s.gitBranch || "") + "</div></div></div>"
      ).join("")
    : '<div class="empty">No sessions.</div>';
  $("app").innerHTML = "<h2>Approvals</h2>" + apHtml + "<h2>Sessions</h2>" + sHtml;
}

async function decide(id, decision) {
  approvals = approvals.filter((a) => a.id !== id);
  render();
  try { await rpc("resolveApproval", { id, decision }); } catch (e) {}
}
// Event delegation — no inline handlers, no string interpolation of data into markup.
$("app").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (btn) decide(btn.getAttribute("data-id"), btn.getAttribute("data-act"));
});

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
  const ws = new WebSocket(proto + "://" + location.host + "/ws?token=" + encodeURIComponent(TOKEN));
  ws.onopen = () => { $("conn").className = "dot ok"; };
  ws.onclose = () => { $("conn").className = "dot"; setTimeout(connectWs, 2000); };
  ws.onmessage = (ev) => {
    try { const f = JSON.parse(ev.data); if (f.type === "approvals") { approvals = f.payload || []; render(); } } catch (e) {}
  };
}

async function start() {
  try {
    DIR = (await rpc("defaultDir")).dir;
    approvals = await rpc("pendingApprovals");
    render();
    connectWs();
    refreshSessions();
    setInterval(refreshSessions, 5000);
  } catch (e) {
    sessionStorage.removeItem("ck.token");
    gate();
  }
}

$("logout").onclick = () => { sessionStorage.removeItem("ck.token"); location.href = "/app"; };
if (TOKEN) start(); else gate();
</script>
</body>
</html>`;
