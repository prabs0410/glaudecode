// Cockpit terminal page — the phone-side consumer of the mirror. A self-contained HTML page that
// loads the engine-vendored xterm.js (no CDN), attaches to /term-ws with the paired token + paneId,
// and renders the live pane. Decodes the termProtocol frames (0x00 OUTPUT, 0x01 SIZE) and sends
// 0x02 ACK so the engine's flow control can pace us.
//
// V5 Phase 2 adds INPUT (0x03): when this device's token is "terminal" scope AND the pane is armed
// on the desktop, a bottom input bar appears — a text box (type a line, Enter to send), a key bar
// (Esc/Tab/^C/arrows), and a raw-keystroke toggle (xterm stdin → live keys). The phone NEVER decides
// authorization: the engine re-checks terminal scope + arming, and the Rust core re-checks arming at
// the PTY. The `armed` flag here only drives the UI; it's polled from listPanes.

export const TERM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>GlaudeCode Terminal</title>
<link rel="stylesheet" href="/app/xterm.css" />
<style>
  html, body { margin: 0; height: 100%; background: #0d1117; color: #c9d1d9;
    font: 14px ui-sans-serif, system-ui, sans-serif; }
  #bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; height: 21px;
    background: #11161d; border-bottom: 1px solid #1f2630; }
  #bar a { color: #79c0ff; text-decoration: none; }
  #dot { width: 8px; height: 8px; border-radius: 50%; background: #6e7681; display: inline-block; }
  #dot.ok { background: #3fb950; }
  .muted { color: #6e7681; font-size: 12px; }
  .pill { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #21262d; color: #8b949e; }
  .pill.on { background: #12331f; color: #3fb950; }
  .pill.off { background: #3a2d12; color: #d29922; }
  #term { position: absolute; top: 38px; left: 0; right: 0; bottom: 0; padding: 6px; overflow: auto; }
  /* Input bar (terminal scope only) */
  #inputbar { position: fixed; left: 0; right: 0; bottom: 0; background: #11161d;
    border-top: 1px solid #1f2630; padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    display: none; }
  #inputbar.notarmed { opacity: 0.6; }
  #keys { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
  #keys button, #rawbtn { flex: 0 0 auto; background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
  #rawbtn.on { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  #textrow { display: flex; gap: 6px; align-items: flex-end; }
  #tin { flex: 1; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
    padding: 10px; font: 14px ui-monospace, Menlo, monospace; resize: none; line-height: 1.3;
    min-height: 20px; max-height: 96px; overflow-y: auto; }
  #tin:disabled { opacity: 0.5; }
  #insert { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
    padding: 0 12px; height: 42px; font-size: 13px; cursor: pointer; }
  #send { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 0 16px;
    height: 42px; font-size: 14px; cursor: pointer; }
  #insert:disabled, #send:disabled { opacity: 0.5; }
  #hint { margin-top: 4px; min-height: 14px; }
</style>
</head>
<body>
  <div id="bar"><span id="dot"></span><a href="/app">‹ Sessions</a><span id="title" class="muted"></span><span id="pill" class="pill"></span></div>
  <div id="term"></div>
  <div id="inputbar">
    <div id="keys">
      <button id="k-esc">Esc</button>
      <button id="k-tab">Tab</button>
      <button id="k-ctrlc">^C</button>
      <button id="k-up">↑</button>
      <button id="k-down">↓</button>
      <button id="k-left">←</button>
      <button id="k-right">→</button>
      <button id="rawbtn" title="Send every keystroke live (tap the terminal to type)">⌨ raw</button>
    </div>
    <div id="textrow">
      <textarea id="tin" rows="1" placeholder="message — Enter to send, Shift+Enter for a newline" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      <button id="insert" title="Type into the pane without pressing Enter">Insert</button>
      <button id="send">Send</button>
    </div>
    <div id="hint" class="muted"></div>
  </div>
<script src="/app/xterm.js"></script>
<script>
(function () {
  var TOKEN = sessionStorage.getItem("ck.token") || "";
  var SCOPE = sessionStorage.getItem("ck.scope") || "view";
  var paneId = new URLSearchParams(location.search).get("pane") || "";
  if (!TOKEN) { location.href = "/app"; return; }
  document.getElementById("title").textContent = paneId ? paneId.slice(0, 8) : "no pane";
  if (!paneId) return;

  var canTypeScope = SCOPE === "terminal";
  var armed = false, rawOn = false, ws = null;

  var term = new Terminal({
    fontSize: 13, scrollback: 5000, disableStdin: true, cursorBlink: false,
    theme: { background: "#0d1117", foreground: "#c9d1d9" },
  });
  term.open(document.getElementById("term"));

  // Flow control: ACK the cumulative OUTPUT payload bytes we've consumed, debounced.
  var received = 0, acked = 0, ackTimer = null;
  function scheduleAck() {
    if (ackTimer) return;
    ackTimer = setTimeout(function () {
      ackTimer = null;
      if (received === acked || !ws || ws.readyState !== 1) return;
      acked = received;
      var f = new Uint8Array(5);
      f[0] = 2; new DataView(f.buffer).setUint32(1, acked >>> 0, false);
      try { ws.send(f); } catch (e) {}
    }, 250);
  }

  // ---- INPUT (V5 Phase 2). Authorization is enforced server-side; armed here is UI-only. ----
  function sendInput(bytes) {
    if (!ws || ws.readyState !== 1 || !canTypeScope || !armed) return;
    var f = new Uint8Array(1 + bytes.length);
    f[0] = 3; f.set(bytes, 1);
    try { ws.send(f); } catch (e) {}
  }
  function sendText(s) { sendInput(new TextEncoder().encode(s)); }
  // Raw keystrokes from xterm (only forwarded while raw mode is on).
  term.onData(function (d) { if (rawOn) sendText(d); });

  function rpc(method, params) {
    return fetch("/rpc", {
      method: "POST",
      headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ method: method, params: params || {} }),
    }).then(function (r) { return r.json(); });
  }

  function setPill(text, cls) {
    var el = document.getElementById("pill");
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
  }

  function updateInputUI() {
    var bar = document.getElementById("inputbar");
    if (!canTypeScope) { bar.style.display = "none"; setPill("view-only", ""); return; }
    bar.style.display = "";
    bar.className = armed ? "" : "notarmed";
    document.getElementById("term").style.bottom = "118px";
    document.getElementById("tin").disabled = !armed;
    document.getElementById("insert").disabled = !armed;
    document.getElementById("send").disabled = !armed;
    document.getElementById("rawbtn").disabled = !armed;
    document.getElementById("hint").textContent = armed ? "" : "Not armed — tap 📱 on this pane's tab in GlaudeCode to allow input.";
    setPill(armed ? "armed" : "not armed", armed ? "on" : "off");
    if (!armed && rawOn) { rawOn = false; term.options.disableStdin = true; document.getElementById("rawbtn").classList.remove("on"); }
  }

  function refreshArmed() {
    if (!canTypeScope) { updateInputUI(); return; }
    rpc("listPanes").then(function (b) {
      var list = (b && b.result) || [];
      var me = null;
      for (var i = 0; i < list.length; i++) if (list[i].paneId === paneId) me = list[i];
      armed = !!(me && me.armed);
      updateInputUI();
    }).catch(function () {});
  }

  // Mirror of engine \`termInput.wrapForPaste\` (tested in @glaudecode/engine): multi-line text is
  // bracketed-pasted so the PTY treats it as one paste, never auto-submitting each line.
  function wrapForPaste(t) { return t.indexOf("\\n") >= 0 ? "\\x1b[200~" + t + "\\x1b[201~" : t; }

  // Wire the input controls (terminal scope only).
  if (canTypeScope) {
    var tin = document.getElementById("tin");
    function autoGrow() { tin.style.height = "auto"; tin.style.height = Math.min(tin.scrollHeight, 96) + "px"; }
    tin.addEventListener("input", autoGrow);
    // send(true)  = Send: bracketed-pasted text + Enter (run it).
    // send(false) = Insert: type into the pane WITHOUT Enter (compose, then use the key bar).
    function send(withEnter) {
      var v = tin.value;
      if (!v) return;
      tin.value = ""; autoGrow();
      sendText(wrapForPaste(v) + (withEnter ? "\\r" : ""));
      tin.focus();
    }
    document.getElementById("send").onclick = function () { send(true); };
    document.getElementById("insert").onclick = function () { send(false); };
    tin.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(true); } // Shift+Enter = newline
    });

    var KEYS = { "k-esc": "\\x1b", "k-tab": "\\t", "k-ctrlc": "\\x03",
      "k-up": "\\x1b[A", "k-down": "\\x1b[B", "k-left": "\\x1b[D", "k-right": "\\x1b[C" };
    Object.keys(KEYS).forEach(function (id) {
      document.getElementById(id).onclick = function () { sendText(KEYS[id]); if (rawOn) term.focus(); };
    });
    document.getElementById("rawbtn").onclick = function () {
      rawOn = !rawOn;
      term.options.disableStdin = !rawOn;
      this.classList.toggle("on", rawOn);
      if (rawOn) term.focus();
    };
    setInterval(refreshArmed, 3000);
  }
  updateInputUI();

  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/term-ws");
    ws.binaryType = "arraybuffer";
    ws.onopen = function () {
      ws.send(JSON.stringify({ type: "auth", token: TOKEN, paneId: paneId }));
      document.getElementById("dot").className = "ok";
      refreshArmed();
    };
    ws.onclose = function () {
      document.getElementById("dot").className = "";
      setTimeout(connect, 2000);
    };
    ws.onmessage = function (ev) {
      var b = new Uint8Array(ev.data);
      if (!b.length) return;
      var op = b[0];
      if (op === 0) { // OUTPUT
        var data = b.subarray(1);
        received += data.length;
        term.write(data);
        scheduleAck();
      } else if (op === 1 && b.length >= 5) { // SIZE
        var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        var cols = dv.getUint16(1, false), rows = dv.getUint16(3, false);
        if (cols && rows) { try { term.resize(cols, rows); } catch (e) {} }
      }
    };
  }
  connect();
})();
</script>
</body>
</html>`;
