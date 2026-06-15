// Cockpit terminal page (V5 Phase 1) — the phone-side consumer of the mirror. A self-contained
// HTML page that loads the engine-vendored xterm.js (no CDN), attaches to /term-ws with the paired
// token + paneId, and renders the live pane. VIEW-ONLY for this slice: disableStdin, no keystrokes
// sent (input arrives in Phase 4). Decodes the termProtocol frames (0x00 OUTPUT, 0x01 SIZE) and
// sends 0x02 ACK so the engine's flow control can pace us.

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
  #term { position: absolute; top: 38px; left: 0; right: 0; bottom: 0; padding: 6px; overflow: auto; }
</style>
</head>
<body>
  <div id="bar"><span id="dot"></span><a href="/app">‹ Sessions</a><span id="title" class="muted"></span></div>
  <div id="term"></div>
<script src="/app/xterm.js"></script>
<script>
(function () {
  var TOKEN = sessionStorage.getItem("ck.token") || "";
  var paneId = new URLSearchParams(location.search).get("pane") || "";
  if (!TOKEN) { location.href = "/app"; return; }
  document.getElementById("title").textContent = paneId ? paneId.slice(0, 8) : "no pane";
  if (!paneId) return;

  var term = new Terminal({
    fontSize: 13, scrollback: 5000, disableStdin: true, cursorBlink: false,
    theme: { background: "#0d1117", foreground: "#c9d1d9" },
  });
  term.open(document.getElementById("term"));

  // Flow control: ACK the cumulative OUTPUT payload bytes we've consumed, debounced.
  var received = 0, acked = 0, ackTimer = null, ws = null;
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

  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/term-ws");
    ws.binaryType = "arraybuffer";
    ws.onopen = function () {
      ws.send(JSON.stringify({ type: "auth", token: TOKEN, paneId: paneId }));
      document.getElementById("dot").className = "ok";
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
