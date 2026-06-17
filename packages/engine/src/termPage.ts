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
<!-- interactive-widget=resizes-content (V6 P1.3): Android Chrome shrinks the layout viewport for the
     soft keyboard, so kbHeight() naturally → 0 there (no double-count with the translateY lift). iOS
     ignores it and keeps the VisualViewport path below. -->
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content" />
<title>GlaudeCode Terminal</title>
<link rel="stylesheet" href="/app/xterm.css" />
<style>
  html, body { margin: 0; height: 100%; background: #0d1117; color: #c9d1d9;
    font: 14px ui-sans-serif, system-ui, sans-serif;
    overscroll-behavior: none; } /* kill pull-to-refresh + bounce-navigation on mobile (V6 P1.1) */
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
  /* In-page session switcher (V6 P1.6): tap ⇄ to pick a pane; dots show live state + "needs you". */
  #switcher { position: absolute; top: 38px; left: 0; right: 0; max-height: 60vh; overflow-y: auto;
    background: #11161d; border-bottom: 1px solid #1f2630; display: none; z-index: 5; }
  .srow { display: flex; align-items: center; gap: 8px; padding: 11px 14px; cursor: pointer;
    border-bottom: 1px solid #1f2630; color: #c9d1d9; }
  .srow:active { background: #1f2630; }
  .srow.cur { color: #79c0ff; }
  .sdot { width: 9px; height: 9px; border-radius: 50%; background: #6e7681; flex: 0 0 auto; }
  .sdot.busy { background: #d29922; }
  .sdot.idle { background: #3fb950; }
  .sneed { margin-left: auto; font-size: 11px; color: #d29922; }
  /* xterm's own .xterm-viewport is the single scroll surface — #term just clips. touch-action:pan-y
     lets a vertical drag scroll the buffer; overscroll-behavior:contain stops the gesture reaching the
     document (no pull-to-refresh). overflow-x:hidden so wide output wraps instead of side-scrolling (V6 P1.1). */
  #term { position: absolute; top: 38px; left: 0; right: 0; bottom: 0; padding: 6px;
    overflow: hidden; overscroll-behavior: contain; touch-action: pan-y; }
  .xterm-viewport { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  /* Input bar (terminal scope only) */
  #inputbar { position: fixed; left: 0; right: 0; bottom: 0; background: #11161d;
    border-top: 1px solid #1f2630; padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    display: none; }
  #inputbar.notarmed { opacity: 0.6; }
  /* Shown only to a view/steer device (can't type) — explains how to get terminal access. */
  #scopenote { position: fixed; left: 0; right: 0; bottom: 0; display: none; padding: 10px 14px;
    background: #16263a; color: #79c0ff; border-top: 1px solid #1f6feb; font-size: 13px; line-height: 1.4; }
  /* When not armed, the action buttons (key bar, chips, snippets, smart answers) are disabled so they
     don't silently no-op — only the mode tabs stay clickable (audit L16). */
  #inputbar.notarmed #keys button, #inputbar.notarmed #rawbtn,
  #inputbar.notarmed #smart-chips button, #inputbar.notarmed #smart-snippets button,
  #inputbar.notarmed #smart-q button, #inputbar.notarmed #k-size { opacity: 0.4; pointer-events: none; }
  #modetabs { display: flex; gap: 4px; margin-bottom: 6px; }
  .modetab { background: transparent; color: #8b949e; border: none; border-bottom: 2px solid transparent;
    padding: 4px 10px; font-size: 13px; cursor: pointer; }
  .modetab.active { color: #c9d1d9; border-bottom-color: #1f6feb; }
  .ipanel { margin-bottom: 6px; }
  #panel-smart { display: flex; flex-direction: column; gap: 8px; max-height: 40vh; overflow-y: auto; }
  #smart-q, #smart-chips, #smart-snippets { display: flex; flex-wrap: wrap; gap: 6px; }
  #smart-q { flex-direction: column; }
  .qtext { color: #c9d1d9; font-size: 13px; }
  .smartbtn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
    padding: 8px 12px; font-size: 13px; cursor: pointer; text-align: left; }
  .smartbtn:active { background: #30363d; }
  #smart-q .smartbtn { width: 100%; }
  .smartbtn .opt-desc { color: #8b949e; font-size: 11px; display: block; margin-top: 2px; }
  #keys { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
  /* Claude-Code quick-insert chips (/ @ # !) — insert a symbol into the compose box (V6 P1.5). */
  #qchips { display: flex; gap: 6px; margin-bottom: 6px; }
  #qchips button { flex: 0 0 auto; background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 6px 14px; font: 15px ui-monospace, Menlo, monospace; cursor: pointer; }
  #keys button, #rawbtn { flex: 0 0 auto; background: #21262d; color: #c9d1d9; border: 1px solid #30363d;
    border-radius: 6px; padding: 8px 12px; font-size: 14px; cursor: pointer; }
  #rawbtn.on, #k-ctrl.on, #k-size.on { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  #textrow { display: flex; gap: 6px; align-items: flex-end; }
  #tin { flex: 1; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
    padding: 10px; font: 16px ui-monospace, Menlo, monospace; resize: none; line-height: 1.3;
    min-height: 20px; max-height: 96px; overflow-y: auto; } /* 16px: below it iOS auto-zooms on focus (V6 P1.4) */
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
  <div id="bar"><span id="dot"></span><a href="/app">‹ Sessions</a><span id="title" class="muted"></span><a id="switch" href="#" title="Next terminal">⇄</a><span id="pill" class="pill"></span></div>
  <div id="term"></div>
  <div id="switcher"></div>
  <div id="inputbar">
    <div id="modetabs">
      <button id="tab-msg" class="modetab active">Message</button>
      <button id="tab-smart" class="modetab">Smart</button>
    </div>
    <div id="panel-msg" class="ipanel">
      <div id="qchips"><button data-ins="/">/</button><button data-ins="@">@</button><button data-ins="#">#</button><button data-ins="!">!</button></div>
      <div id="textrow">
        <textarea id="tin" rows="1" placeholder="message — Enter to send, Shift+Enter for a newline" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
        <button id="insert" title="Type into the pane without pressing Enter">Insert</button>
        <button id="send">Send</button>
      </div>
    </div>
    <div id="panel-smart" class="ipanel" style="display:none">
      <div id="smart-q"></div>
      <div id="smart-chips"></div>
      <div id="smart-snippets"></div>
    </div>
    <!-- Persistent key bar (Mode B): the design mandates it always be reachable to answer a TUI prompt,
         so it stays visible under both tabs rather than hiding behind a third tab. -->
    <div id="keys">
      <button id="k-esc">Esc</button>
      <button id="k-tab">Tab</button>
      <button id="k-stab" title="Shift+Tab — cycle Claude Code mode">⇧Tab</button>
      <button id="k-ctrlc">^C</button>
      <button id="k-ctrl" title="Sticky Ctrl: tap, then a key (e.g. Ctrl then C)">Ctrl</button>
      <button id="k-up">↑</button>
      <button id="k-down">↓</button>
      <button id="k-left">←</button>
      <button id="k-right">→</button>
      <button id="k-enter">⏎</button>
      <button id="k-pgup" title="Scroll up">⇞</button>
      <button id="k-pgdn" title="Scroll down">⇟</button>
      <button id="k-fdec" title="Smaller text">A−</button>
      <button id="k-finc" title="Bigger text">A+</button>
      <button id="k-size" title="Re-fit the terminal to this phone">⤢ fit</button>
      <button id="rawbtn" title="Send every keystroke live (tap the terminal to type)">⌨ raw</button>
    </div>
    <div id="hint" class="muted"></div>
  </div>
  <div id="scopenote"></div>
<script src="/app/xterm.js"></script>
<script src="/app/addon-fit.js"></script>
<script>
(function () {
  var TOKEN = sessionStorage.getItem("ck.token") || "";
  var SCOPE = sessionStorage.getItem("ck.scope") || "view";
  var paneId = new URLSearchParams(location.search).get("pane") || "";
  if (!TOKEN) { location.href = "/app"; return; }
  document.getElementById("title").textContent = paneId ? paneId.slice(0, 8) : "no pane";
  if (!paneId) return;

  var canTypeScope = SCOPE === "terminal";
  var armed = false, rawOn = false, ctrlArmed = false, paused = false, ws = null;
  var reconnectTimer = null; // single pending reconnect, so a background/foreground race can't dupe sockets
  var connOk = true, repairing = false; // connOk: last listPanes succeeded (so "not armed" is real)

  var fontSize = parseInt(localStorage.getItem("ck.fontsize"), 10) || 15; // readable default; A-/A+ persists (V6 P1.4)
  var term = new Terminal({
    fontSize: fontSize, scrollback: 5000, disableStdin: true, cursorBlink: false,
    theme: { background: "#0d1117", foreground: "#c9d1d9" },
  });
  term.open(document.getElementById("term"));
  // Fit-to-width (V6 P1.2): size the xterm grid to the phone viewport so output isn't cropped.
  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

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

  // Mirror of engine \`termInput.ctrlByte\` (tested in @glaudecode/engine): a printable char → its
  // control byte. Sticky Ctrl is armed from the key bar; the next key composes, then it releases.
  function ctrlByte(ch) {
    if (!ch || ch.length !== 1) return "";
    var code = ch.toUpperCase().charCodeAt(0);
    if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
    if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code & 0x1f);
    return "";
  }
  function setCtrl(on) { ctrlArmed = on; var b = document.getElementById("k-ctrl"); if (b) b.classList.toggle("on", on); }

  // Raw keystrokes from xterm (only forwarded while raw mode is on); honor sticky Ctrl.
  term.onData(function (d) {
    if (!rawOn) return;
    if (ctrlArmed && d.length === 1) { var c = ctrlByte(d); sendText(c || d); setCtrl(false); return; }
    if (ctrlArmed) setCtrl(false);
    sendText(d);
  });

  function repair() {
    // Token revoked/expired (routine at the 1h terminal-scope TTL) — go re-pair rather than silently
    // reading armed=false and showing a WRONG "not armed" message. Guard against concurrent failing
    // calls storming the redirect.
    if (repairing) return;
    repairing = true;
    sessionStorage.removeItem("ck.token");
    sessionStorage.removeItem("ck.scope");
    location.href = "/app";
  }
  // Mirrors cockpit.ts rpc(): checks r.ok and RETURNS body.result (not the envelope). A 401/403 means
  // the token died — re-pair instead of letting callers silently fall back to empty/false (audit M9).
  function rpc(method, params) {
    return fetch("/rpc", {
      method: "POST",
      headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ method: method, params: params || {} }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (r.status === 401 || r.status === 403) { repair(); throw new Error("unauthorized"); }
        if (!r.ok) throw new Error((body && body.error) || ("rpc " + method + " " + r.status));
        return body.result;
      });
    });
  }
  // Mode C — the cockpit knows it's Claude Code: poll \`promptState\` and render the live
  // AskUserQuestion as tappable buttons (selecting option i = down-arrow × i, then Enter). For a
  // Claude pane paneId === sessionId, so promptState({id: paneId, dir: DIR}) resolves it; a worktree
  // session in a different cwd won't match (a known follow-up). permissionMode is omitted (undefined).
  var DIR = "", lastQ = null;
  function pollPromptState() {
    if (!canTypeScope || !DIR) return;
    rpc("promptState", { id: paneId, dir: DIR }).then(function (s) {
      renderSmartQ(s || { askUserQuestion: null });
    }).catch(function () {});
  }
  function renderSmartQ(s) {
    var el = document.getElementById("smart-q");
    var q = s.askUserQuestion;
    var key = q ? q.question + "|" + q.options.map(function (o) { return o.label; }).join("|") : null;
    if (key === lastQ) return; // unchanged — don't rebuild (so a tap isn't lost mid-poll)
    lastQ = key;
    el.innerHTML = "";
    if (!q || !q.options.length) return;
    var qd = document.createElement("div"); qd.className = "qtext"; qd.textContent = q.question;
    el.appendChild(qd);
    // A multiSelect prompt is answered by TOGGLING options (Space) and submitting once (Enter) — the
    // old code sent down×i + bare Enter for every option, silently confirming the WRONG/empty
    // selection (audit M11). We track the TUI's highlighted row (assumed to start at 0, same as the
    // single-select path) and move relative to it; a separate Confirm button submits. Best-effort.
    var cursor = 0;
    function mkOpt(o) {
      var btn = document.createElement("button"); btn.className = "smartbtn";
      btn.textContent = o.label; // textContent — never innerHTML — so option text can't inject markup
      if (o.description) {
        var d = document.createElement("span"); d.className = "opt-desc"; d.textContent = o.description;
        btn.appendChild(d);
      }
      return btn;
    }
    if (q.multiSelect) {
      q.options.forEach(function (o, i) {
        var btn = mkOpt(o);
        btn.onclick = function () {
          var delta = i - cursor, step = delta >= 0 ? "\\x1b[B" : "\\x1b[A", seq = "";
          for (var k = 0; k < Math.abs(delta); k++) seq += step;
          sendText(seq + " "); // move to row i, then Space toggles it (no submit)
          cursor = i;
          btn.classList.toggle("on"); // reflect the toggle locally
        };
        el.appendChild(btn);
      });
      var confirm = document.createElement("button"); confirm.className = "smartbtn"; confirm.textContent = "✓ Confirm selection";
      confirm.onclick = function () { sendText("\\r"); el.innerHTML = ""; lastQ = null; };
      el.appendChild(confirm);
    } else {
      q.options.forEach(function (o, i) {
        var btn = mkOpt(o);
        btn.onclick = function () {
          var seq = ""; for (var k = 0; k < i; k++) seq += "\\x1b[B"; // down-arrow × index
          sendText(seq + "\\r"); // single-select: navigate + submit
          el.innerHTML = ""; lastQ = null; // clear after answering
        };
        el.appendChild(btn);
      });
    }
  }
  rpc("defaultDir").then(function (d) { DIR = (d && d.dir) || ""; pollPromptState(); }).catch(function () {});

  function setPill(text, cls) {
    var el = document.getElementById("pill");
    el.textContent = text;
    el.className = "pill" + (cls ? " " + cls : "");
  }

  // Keyboard height (px) from the VisualViewport API, 0 when no keyboard / API absent.
  function kbHeight() {
    var vv = window.visualViewport;
    return vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  }
  // Keep the terminal viewport clear of the (variable-height) input bar AND the soft keyboard —
  // measured, not hardcoded, so a grown textarea / tab switch / the keyboard never overlap scrollback.
  function layout() {
    var ib = document.getElementById("inputbar");
    document.getElementById("term").style.bottom = (canTypeScope ? ib.offsetHeight + kbHeight() : 0) + "px";
  }

  // Fit the xterm grid to the phone viewport (V6 P1.2). When this device DRIVES size (terminal scope +
  // armed — resize authority is refined in 1.7), reflow the Mac PTY to the fitted size so its output
  // matches the phone width (clean, no crop). Otherwise it's render-only and follows the Mac's SIZE.
  function doFit() {
    try { fitAddon.fit(); } catch (e) { return; } // cell metrics not ready yet — a later call refits
    if (canTypeScope && armed && ws && ws.readyState === 1) {
      var f = new Uint8Array(5); f[0] = 4; // RESIZE
      var dv = new DataView(f.buffer);
      dv.setUint16(1, term.cols & 0xffff, false); dv.setUint16(3, term.rows & 0xffff, false);
      try { ws.send(f); } catch (e) {}
    }
  }
  window.addEventListener("resize", doFit);
  window.addEventListener("orientationchange", function () { setTimeout(doFit, 150); });

  function updateInputUI() {
    var bar = document.getElementById("inputbar");
    var note = document.getElementById("scopenote");
    if (!canTypeScope) {
      // This device is paired view/steer — it can't type. Tell the user HOW to get terminal access
      // instead of leaving a dead "view-only" page.
      bar.style.display = "none";
      setPill("view-only", "");
      if (note) {
        note.textContent = "View-only — this device is paired as " + SCOPE + ". To type, re-pair with Terminal access on the Mac (Pair a device → Device access → Terminal), then arm the pane (tap 📱 on its tab).";
        note.style.display = "block";
      }
      return;
    }
    if (note) note.style.display = "none";
    // Must be an explicit value, NOT "" — the #inputbar CSS default is display:none, so clearing the
    // inline style reverts to hidden. This is why the input bar never appeared (Phase-4 QA bug).
    bar.style.display = "block";
    bar.className = armed ? "" : "notarmed";
    layout();
    document.getElementById("tin").disabled = !armed;
    document.getElementById("insert").disabled = !armed;
    document.getElementById("send").disabled = !armed;
    document.getElementById("rawbtn").disabled = !armed;
    document.getElementById("hint").textContent = armed ? "" : (connOk ? "Not armed — tap 📱 on this pane's tab in GlaudeCode to allow input." : "Reconnecting…");
    setPill(armed ? "armed" : "not armed", armed ? "on" : "off");
    if (!armed) {
      // Reset transient input modes on disarm so they don't silently persist (audit L16).
      if (rawOn) { rawOn = false; term.options.disableStdin = true; document.getElementById("rawbtn").classList.remove("on"); }
      if (ctrlArmed) setCtrl(false); // drop sticky Ctrl
    }
  }

  function refreshArmed() {
    if (!canTypeScope) { updateInputUI(); return; }
    rpc("listPanes").then(function (list) {
      list = list || [];
      var me = null;
      for (var i = 0; i < list.length; i++) if (list[i].paneId === paneId) me = list[i];
      var was = armed;
      armed = !!(me && me.armed);
      connOk = true; // listPanes succeeded → a "not armed" hint now reflects the real pane state
      updateInputUI();
      if (armed && !was) doFit(); // just armed → reflow the Mac PTY to the phone's fitted size
    }).catch(function () { connOk = false; updateInputUI(); }); // a 401/403 already triggered repair()
  }

  // Mirror of engine \`termInput.wrapForPaste\` (tested in @glaudecode/engine): multi-line text is
  // bracketed-pasted so the PTY treats it as one paste, never auto-submitting each line.
  function wrapForPaste(t) { var c = t, p; do { p = c; c = c.replace(/\\x1b\\[20[01]~/g, ""); } while (c !== p); return c.indexOf("\\n") >= 0 ? "\\x1b[200~" + c + "\\x1b[201~" : c; }

  // Wire the input controls (terminal scope only).
  if (canTypeScope) {
    var tin = document.getElementById("tin");
    function autoGrow() { tin.style.height = "auto"; tin.style.height = Math.min(tin.scrollHeight, 96) + "px"; layout(); }
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

    function tapKey(seq) { sendText(seq); if (rawOn) term.focus(); setCtrl(false); }
    document.getElementById("k-esc").onclick = function () { tapKey("\\x1b"); };
    document.getElementById("k-tab").onclick = function () { tapKey("\\t"); };
    document.getElementById("k-stab").onclick = function () { tapKey("\\x1b[Z"); };
    document.getElementById("k-ctrlc").onclick = function () { tapKey("\\x03"); };
    document.getElementById("k-enter").onclick = function () { tapKey("\\r"); };
    document.getElementById("k-ctrl").onclick = function () { setCtrl(!ctrlArmed); };
    // Arrows: a Ctrl-modified variant (word-nav) when sticky Ctrl is armed, else the plain arrow.
    var ARROWS = { "k-up": ["\\x1b[A", "\\x1b[1;5A"], "k-down": ["\\x1b[B", "\\x1b[1;5B"],
      "k-left": ["\\x1b[D", "\\x1b[1;5D"], "k-right": ["\\x1b[C", "\\x1b[1;5C"] };
    Object.keys(ARROWS).forEach(function (id) {
      document.getElementById(id).onclick = function () { tapKey(ctrlArmed ? ARROWS[id][1] : ARROWS[id][0]); };
    });
    document.getElementById("rawbtn").onclick = function () {
      rawOn = !rawOn;
      term.options.disableStdin = !rawOn;
      this.classList.toggle("on", rawOn);
      if (rawOn) term.focus();
    };

    // Fit is automatic on open/resize/keyboard via doFit() (V6 P1.2); this button just forces a re-fit.
    document.getElementById("k-size").onclick = function () { doFit(); };

    // Font size A-/A+ (V6 P1.4): adjust the terminal glyph size, persist it, and re-fit (fewer/more cols).
    function setFont(d) {
      fontSize = Math.max(9, Math.min(28, fontSize + d));
      term.options.fontSize = fontSize;
      try { localStorage.setItem("ck.fontsize", String(fontSize)); } catch (e) {}
      doFit();
    }
    document.getElementById("k-fdec").onclick = function () { setFont(-1); };
    document.getElementById("k-finc").onclick = function () { setFont(1); };

    // Scrollback (V6 P1.5): scroll xterm's local buffer (no input sent), since precise history nav by
    // touch is fiddly. (touch-drag scrolling also works now — P1.1.)
    document.getElementById("k-pgup").onclick = function () { try { term.scrollPages(-1); } catch (e) {} };
    document.getElementById("k-pgdn").onclick = function () { try { term.scrollPages(1); } catch (e) {} };

    // Claude-Code quick-insert chips (/ @ # !) — insert the symbol into the compose box so you don't
    // fight the soft keyboard for it (voice-first: dictate the rest). NOT sent until you Send. (V6 P1.5)
    function insertChar(ch) {
      var s = tin.selectionStart, e = tin.selectionEnd;
      if (s == null) { s = e = tin.value.length; }
      tin.value = tin.value.slice(0, s) + ch + tin.value.slice(e);
      tin.selectionStart = tin.selectionEnd = s + ch.length;
      autoGrow(); tin.focus();
    }
    Array.prototype.forEach.call(document.querySelectorAll("#qchips button"), function (b) {
      b.onclick = function () { insertChar(b.getAttribute("data-ins")); };
    });

    // Message / Smart tab switch (the persistent key bar stays under both). Last tab is remembered.
    var activeTab = sessionStorage.getItem("ck.tab") || "msg";
    function setTab(t) {
      activeTab = t; sessionStorage.setItem("ck.tab", t);
      document.getElementById("panel-msg").style.display = t === "msg" ? "" : "none";
      document.getElementById("panel-smart").style.display = t === "smart" ? "flex" : "none";
      document.getElementById("tab-msg").classList.toggle("active", t === "msg");
      document.getElementById("tab-smart").classList.toggle("active", t === "smart");
      layout();
    }
    document.getElementById("tab-msg").onclick = function () { setTab("msg"); };
    document.getElementById("tab-smart").onclick = function () { setTab("smart"); };
    setTab(activeTab);

    // Pin the input bar above the soft keyboard (VisualViewport API); feature-detect, else the
    // fixed-bottom fallback stays. translateY lifts the fixed-bottom bar by the keyboard height.
    var vv = window.visualViewport;
    if (vv) {
      var pin = function () {
        document.getElementById("inputbar").style.transform = "translateY(-" + kbHeight() + "px)";
        layout();
        doFit(); // re-fit when the keyboard changes the visible area
      };
      vv.addEventListener("resize", pin);
      vv.addEventListener("scroll", pin);
      pin();
    }
    // Key-bar / tab taps must NOT blur the textarea (that would dismiss the keyboard mid-compose).
    ["keys", "modetabs", "qchips"].forEach(function (id) {
      document.getElementById(id).addEventListener("pointerdown", function (e) {
        if (e.target && e.target.tagName === "BUTTON") e.preventDefault();
      });
    });

    // Mode C chips — common one-tap inputs.
    [["yes", "yes\\r"], ["continue", "continue\\r"], ["Esc", "\\x1b"]].forEach(function (c) {
      var b = document.createElement("button"); b.className = "smartbtn"; b.textContent = c[0];
      b.onclick = function () { sendText(c[1]); };
      document.getElementById("smart-chips").appendChild(b);
    });
    // Mode C snippets — one tap inserts a saved prompt (no auto-Enter, so you review then send).
    rpc("listPrompts").then(function (list) {
      list = list || [];
      var el = document.getElementById("smart-snippets");
      list.slice(0, 12).forEach(function (p) {
        var btn = document.createElement("button"); btn.className = "smartbtn"; btn.textContent = "/" + (p.id || "snippet");
        btn.onclick = function () {
          rpc("readPrompt", { id: p.id }).then(function (pr) {
            sendText(wrapForPaste((pr && pr.body) || "")); // Insert (no auto-CR)
          }).catch(function () {});
        };
        el.appendChild(btn);
      });
    }).catch(function () {});

    setInterval(function () { refreshArmed(); pollPromptState(); }, 3000);
  }
  updateInputUI();
  doFit(); // initial fit once the page + term element are laid out (V6 P1.2)

  function connect() {
    // Fresh attach: the engine builds a NEW per-socket subscriber (sent/acked from 0) and replays the
    // ring, so the phone's cumulative ACK counters must restart in lockstep — else flow control
    // desyncs. Clear xterm too, so a stale frame from a prior connection isn't mistaken for live
    // output; the replay repaints the current screen. (mirror fixes #2/#4)
    received = 0; acked = 0;
    if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { term.reset(); } catch (e) {}
    // Retire any previous socket so its late onclose/onmessage can't mutate shared state or schedule
    // a duplicate reconnect (the background↔foreground double-socket race).
    if (ws) { try { ws.onopen = ws.onclose = ws.onmessage = null; ws.close(); } catch (e) {} }
    var sock = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/term-ws");
    ws = sock;
    sock.binaryType = "arraybuffer";
    sock.onopen = function () {
      if (ws !== sock) return; // superseded by a newer socket — ignore
      sock.send(JSON.stringify({ type: "auth", token: TOKEN, paneId: paneId }));
      document.getElementById("dot").className = "ok";
      refreshArmed();
    };
    sock.onclose = function (ev) {
      if (ws !== sock) return; // stale socket — its events must not touch the live UI
      document.getElementById("dot").className = "";
      // 4003 = token revoked/expired → re-pair, don't reconnect-loop a dead token (audit L3).
      if (ev.code === 4003) { repair(); return; }
      if (ev.code === 4002) {
        // Pane not (yet) known to the engine. A respawn race re-registers it within ~2s, but a pane
        // genuinely closed on the Mac would loop forever on a dead id — so check it still exists and
        // retry it; otherwise jump to a live pane (or back to the list) instead of a blank loop.
        rpc("listPanes").then(function (list) {
          list = list || [];
          var here = false, first = "";
          for (var i = 0; i < list.length; i++) { if (!first) first = list[i].paneId; if (list[i].paneId === paneId) here = true; }
          if (here) { if (!paused) reconnectTimer = setTimeout(connect, 1500); }
          else if (first) { location.href = "/app/term?pane=" + encodeURIComponent(first); }
          else { location.href = "/app"; }
        }).catch(function () { if (!paused) reconnectTimer = setTimeout(connect, 2000); });
        return;
      }
      if (!paused) reconnectTimer = setTimeout(connect, 2000); // don't auto-reconnect while backgrounded
    };
    sock.onmessage = function (ev) {
      if (ws !== sock) return; // stale socket — ignore
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
        // Render-only devices follow the Mac's size; a device that DRIVES size (terminal + armed) fits
        // locally and reflows the Mac via doFit(), so it ignores the Mac's echo here (V6 P1.2/1.7).
        if (!(canTypeScope && armed) && cols && rows) { try { term.resize(cols, rows); } catch (e) {} }
      }
    };
  }
  // Explicit attach/detach: drop the socket while backgrounded (stop consuming the stream), and
  // reconnect on return — the engine ring buffer replays the current screen (Phase 1).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      paused = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } // don't reconnect while hidden
      if (ws) try { ws.close(); } catch (e) {}
    } else if (paused) { paused = false; connect(); }
  });
  // Session switcher (V6 P1.6): tap ⇄ → a picker of all live panes with a live state dot (idle/busy)
  // and a "needs you" flag (a pending AskUserQuestion), so you jump straight to the one that wants you
  // instead of blind-cycling. Reuses listPanes + agentState + promptState (the sessions page's joins).
  function renderSwitcher(box) {
    rpc("listPanes").then(function (list) {
      list = list || [];
      box.innerHTML = "";
      list.forEach(function (p) {
        var row = document.createElement("div"); row.className = "srow" + (p.paneId === paneId ? " cur" : "");
        var dot = document.createElement("span"); dot.className = "sdot"; row.appendChild(dot);
        var label = document.createElement("span"); label.textContent = p.title || p.paneId.slice(0, 8); row.appendChild(label);
        row.onclick = function () {
          if (p.paneId === paneId) { box.style.display = "none"; return; }
          location.href = "/app/term?pane=" + encodeURIComponent(p.paneId);
        };
        box.appendChild(row);
        if (DIR) {
          rpc("agentState", { id: p.paneId, dir: DIR }).then(function (s) {
            var st = s && s.status;
            dot.className = "sdot" + (st === "idle" ? " idle" : (st ? " busy" : ""));
          }).catch(function () {});
          rpc("promptState", { id: p.paneId, dir: DIR }).then(function (s) {
            if (s && s.isWaiting) { var nn = document.createElement("span"); nn.className = "sneed"; nn.textContent = "needs you"; row.appendChild(nn); }
          }).catch(function () {});
        }
      });
      box.style.display = "block";
    }).catch(function () {});
  }
  document.getElementById("switch").onclick = function (e) {
    e.preventDefault();
    var box = document.getElementById("switcher");
    if (box.style.display === "block") { box.style.display = "none"; return; }
    renderSwitcher(box);
  };

  connect();
})();
</script>
</body>
</html>`;
