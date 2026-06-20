// Conversation cockpit page (V6) — the PRIMARY mobile surface. Instead of mirroring the terminal grid,
// it renders the Claude session as a native, scrollable CHAT from the engine's TYPED data
// (getSessionMessages → text/thinking/tool_use/tool_result blocks; promptState → the pending
// AskUserQuestion; agentState → a live status chip). Scroll is native, text reflows. The raw terminal
// is one tap away (the ⌨ button → /app/term). Sending a message types it into the Claude PTY over the
// same gated /term-ws INPUT path the terminal uses (terminal scope; no per-pane arming in V6).
//
// All session content is rendered with textContent / safe DOM nodes — never innerHTML — so a tool
// argument or message can't inject markup. Self-contained served HTML (no bundler, no imports).

export const CONVERSATION_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content" />
<title>GlaudeCode</title>
<style>
  :root{--bg:#0d1117;--panel:#11161d;--panel2:#161c26;--line:#1f2630;--line2:#30363d;--text:#c9d1d9;
    --muted:#8b949e;--dim:#6e7681;--accent:#1f6feb;--accent2:#79c0ff;--green:#3fb950;--amber:#d29922;--user:#1b3a6b}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html{height:100%}
  /* Flex column so the chat fills the space BETWEEN the bar and composer (no overlap), and 100dvh so
     the mobile keyboard shrinks the viewport and the composer rides above it instead of being covered. */
  body{margin:0;height:100vh;height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);overscroll-behavior:none;
    font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
  #bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--line)}
  #bar a{color:var(--accent2);text-decoration:none;font-size:18px}
  #title{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%}
  /* BL-6: when the rendered session != the pane you type into, show it (never silent). Tap = switch. */
  #splitchip{display:none;font-size:11px;color:var(--amber);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34%;border:1px solid #5a4a1a;border-radius:6px;padding:1px 6px}
  #splitchip.on{display:inline-block}
  #status{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  #status .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
  #status.run .dot{background:var(--amber)} #status.run{color:var(--amber)}
  #status.idle .dot{background:var(--green)} #status.idle{color:var(--green)}
  .ib{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--text);padding:5px 9px;font-size:13px;cursor:pointer}
  #chat{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;padding:14px 12px 8px;display:flex;flex-direction:column;gap:11px}
  .msg{max-width:88%;word-wrap:break-word}
  .user{align-self:flex-end;background:var(--user);border:1px solid #244a86;border-radius:14px 14px 4px 14px;padding:9px 12px;white-space:pre-wrap}
  .ai{align-self:flex-start;white-space:pre-wrap}
  .ai .who{color:var(--accent2);font-size:11px;font-weight:600;margin-bottom:2px}
  .think{align-self:flex-start;color:var(--dim);font-size:13px;font-style:italic}
  .tool{align-self:flex-start;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:8px 11px;font:13px ui-monospace,Menlo,monospace;color:var(--muted);display:flex;gap:8px;align-items:center}
  .tool .nm{color:var(--text)} .tool.err{border-color:#5e2b2b;color:#ff9a92}
  /* answer / approval card pinned above the composer */
  #answer{display:none;border-top:1px solid var(--line);background:var(--panel);padding:10px 12px;max-height:46vh;overflow-y:auto}
  #answer .q{font-size:13px;margin-bottom:8px;color:var(--text)}
  #answer .opt{display:block;width:100%;text-align:left;background:var(--panel2);border:1px solid var(--line2);
    border-radius:9px;padding:11px 12px;margin-bottom:7px;color:var(--text);font-size:14px;cursor:pointer}
  #answer .opt small{display:block;color:var(--muted);font-size:11px;margin-top:2px}
  #answer .opt.on{border-color:var(--accent);background:#16263a}
  /* composer */
  #composer{flex:0 0 auto;background:var(--panel);border-top:1px solid var(--line)}
  /* Collapse the shortcut row to reclaim vertical space (persisted). */
  #kbtoggle{display:block;width:100%;background:none;border:0;border-bottom:1px solid var(--line2);color:var(--dim);font-size:11px;letter-spacing:.3px;padding:3px 0;cursor:pointer}
  #composer.kbc #keys{display:none}
  #keys{display:flex;gap:6px;overflow-x:auto;padding:7px 10px 0}
  #keys button{flex:0 0 auto;background:var(--panel2);border:1px solid var(--line2);border-radius:7px;color:var(--text);padding:6px 11px;font:13px ui-monospace,Menlo,monospace;cursor:pointer}
  #crow{display:flex;align-items:flex-end;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom))}
  #crow textarea{flex:1;background:var(--bg);border:1px solid var(--line2);border-radius:14px;color:var(--text);
    padding:11px 12px;font:16px ui-sans-serif,system-ui,sans-serif;resize:none;min-height:22px;max-height:96px}
  .cbtn{background:var(--panel2);border:1px solid var(--line2);border-radius:11px;color:var(--text);width:42px;height:42px;font-size:17px;cursor:pointer}
  .cbtn:disabled{opacity:.5} #send{background:var(--accent);border-color:var(--accent);color:#fff}
  #scopenote{display:none;position:fixed;left:0;right:0;bottom:0;padding:12px 14px;background:#16263a;color:var(--accent2);border-top:1px solid #1f6feb;font-size:13px}
  #file{display:none}
  /* gesture puck (V6) — tap=Enter · flick=arrows · press-hold=radial · move-then-pause=re-park */
  #puck{position:fixed;width:60px;height:60px;border-radius:50%;z-index:60;touch-action:none;display:none;
    align-items:center;justify-content:center;color:#fff;font-size:21px;border:2px solid #4f8bf5;cursor:grab;
    opacity:.72;transition:opacity .15s,transform .1s;
    background:radial-gradient(circle at 35% 30%,#3a7bf0,#1f6feb 60%,#1a52b8);
    box-shadow:0 6px 22px rgba(31,111,235,.55),inset 0 1px 2px rgba(255,255,255,.35)}
  #puck.holding{transform:scale(.94);cursor:grabbing;opacity:1} #puck.carry{transform:scale(1.07);opacity:1;box-shadow:0 8px 28px rgba(31,111,235,.75)}
  .wedge{position:fixed;width:50px;height:50px;border-radius:50%;z-index:59;display:flex;align-items:center;justify-content:center;
    background:var(--panel);border:1px solid var(--line2);color:var(--text);font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.45);
    transition:transform .08s,background .08s;pointer-events:none}
  .wedge.mono{font-family:ui-monospace,Menlo,monospace} .wedge.hot{background:var(--accent);border-color:var(--accent);color:#fff;transform:scale(1.18)}
  #puckout{position:fixed;left:50%;top:52px;transform:translateX(-50%);z-index:61;background:#0c1117ee;border:1px solid var(--accent);
    border-radius:999px;padding:7px 16px;font-size:14px;color:#fff;opacity:0;transition:opacity .12s;pointer-events:none;white-space:nowrap}
  #puckout.show{opacity:1}
  /* nav drawer (V6 option B) — Sessions / Search / Prompts / Memory; opens from the ☰ button only */
  #menu{background:none;border:0;color:var(--accent2);font-size:20px;cursor:pointer;padding:2px 4px;line-height:1}
  #scrim{position:fixed;inset:0;background:rgba(3,5,8,.55);opacity:0;pointer-events:none;transition:opacity .18s;z-index:70}
  #scrim.open{opacity:1;pointer-events:auto}
  #drawer{position:fixed;top:0;bottom:0;left:0;width:82%;max-width:340px;background:var(--panel);border-right:1px solid var(--line2);
    transform:translateX(-104%);transition:transform .2s;z-index:71;display:flex;flex-direction:column;box-shadow:6px 0 24px rgba(0,0,0,.5)}
  #drawer.open{transform:translateX(0)}
  #drawer .dh{padding:14px 14px 10px;font-weight:700;font-size:15px;border-bottom:1px solid var(--line)}
  #dtabs{display:flex;border-bottom:1px solid var(--line)}
  #dtabs button{flex:1;background:none;border:0;border-bottom:2px solid transparent;color:var(--dim);font:12px ui-sans-serif,system-ui,sans-serif;
    padding:9px 0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
  #dtabs button .gi{font-size:17px;line-height:1} #dtabs button.on{color:var(--accent2);border-bottom-color:var(--accent)}
  #dcontent{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 12px}
  #dfoot{padding:10px 14px;border-top:1px solid var(--line);color:var(--dim);font-size:11px}
  #dcontent .drow{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);color:var(--text);
    padding:11px 4px;font:14px ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-decoration:none}
  #dcontent .drow.cur{color:var(--accent2)} #dcontent .drow .sub{display:block;color:var(--dim);font-size:11px;margin-top:2px;word-break:break-word}
  #dsearch{margin-bottom:8px} #dsearch input{width:100%;background:var(--bg);border:1px solid var(--line2);border-radius:9px;color:var(--text);padding:9px 11px;font:14px ui-sans-serif,system-ui,sans-serif}
  #dcontent .hint{color:var(--dim);font-size:12px;padding:6px 2px}
  #dcontent pre{white-space:pre-wrap;word-break:break-word;font:12px ui-monospace,Menlo,monospace;color:var(--muted);margin:0}
  .roview{display:flex;align-items:center;gap:8px;margin:2px 0 8px} .roview button{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--text);font-size:13px;padding:5px 9px;cursor:pointer}
  .roTag{background:#16263a;color:var(--accent2);border-radius:6px;padding:1px 7px;font-size:10px}
  /* diagnostics — tap the status chip to expand; a blank/broken screen explains itself */
  #status{cursor:pointer}
  /* In-flow (flex item) banners — they push the chat down when shown instead of overlapping the bar. */
  #dbg{display:none;flex:0 0 auto;background:#0b0f14f2;border-bottom:1px solid var(--line2);
    padding:9px 12px;font:11px/1.5 ui-monospace,Menlo,monospace;color:var(--muted);max-height:55vh;overflow:auto;white-space:pre-wrap;word-break:break-word}
  #dbg.show{display:block}
  /* D4: a distinct, persistent banner when the engine is unreachable — not a silent freeze */
  #engineban{display:none;flex:0 0 auto;background:#3a1212;color:#ff7b72;
    font-size:12px;padding:7px 12px;text-align:center;border-bottom:1px solid #5e2b2b;cursor:pointer}
  #engineban.show{display:block}
  #chat .notice{margin:auto;max-width:300px;text-align:center;color:var(--muted);padding:24px 14px}
  #chat .notice .nt{color:var(--text);font-size:15px;font-weight:600;margin-bottom:8px}
  #chat .notice .nd{font-size:13px;margin-bottom:6px;line-height:1.5}
  #chat .notice.err .nt{color:#ff9a92}
  #chat .notice .ntbtn{display:inline-block;margin-top:10px;background:var(--accent);color:#fff;border-radius:9px;padding:9px 15px;text-decoration:none;font-size:14px}
</style>
</head>
<body>
  <div id="bar">
    <button id="menu" title="Menu">☰</button>
    <span id="title" class="muted">…</span>
    <span id="splitchip" title="You're typing into a different pane than the session shown — tap to switch"></span>
    <span id="status"><span class="dot"></span><span class="t">…</span></span>
    <button id="bell" class="ib" title="Enable phone alerts" style="display:none">🔔</button>
    <a id="toterm" class="ib" title="Raw terminal" href="#">⌨</a>
  </div>
  <div id="dbg"></div>
  <div id="engineban">⚠ Can't reach your Mac — the engine looks unreachable. Tap to retry.</div>
  <div id="chat"></div>
  <input id="file" type="file" />
  <div id="composer">
    <div id="answer"></div>
    <button id="kbtoggle" title="Hide / show the shortcut bar">⌄ shortcuts</button>
    <div id="keys">
      <button data-k="/">/</button><button data-k="@">@</button><button data-k="#">#</button><button data-k="!">!</button>
      <button data-seq="esc">Esc</button><button data-seq="cr">⏎</button><button data-seq="ctrlc">^C</button>
      <button data-seq="up">↑</button><button data-seq="down">↓</button>
    </div>
    <div id="crow">
      <button class="cbtn" id="upload" title="Upload a document / photo">📎</button>
      <button class="cbtn" id="paste" title="Paste text">📋</button>
      <textarea id="tin" rows="1" placeholder="Message Claude — or 🎤 dictate" autocomplete="off" autocapitalize="sentences"></textarea>
      <button class="cbtn" id="send" title="Send">➤</button>
    </div>
  </div>
  <div id="scopenote"></div>
  <div id="puck">⌘</div>
  <div id="puckout"></div>
  <div id="scrim"></div>
  <aside id="drawer">
    <div class="dh">☰ GlaudeCode</div>
    <div id="dtabs">
      <button data-s="sessions"><span class="gi">▦</span>Sessions</button>
      <button data-s="search"><span class="gi">🔍</span>Search</button>
      <button data-s="prompts"><span class="gi">⌘</span>Prompts</button>
      <button data-s="memory"><span class="gi">🧠</span>Memory</button>
      <button data-s="debug"><span class="gi">🩺</span>Debug</button>
    </div>
    <div id="dcontent"></div>
    <div id="dfoot">Diffs &amp; cost stay on the Mac · revoke a device on the Mac</div>
  </aside>
<script>
(function(){
  var TOKEN=sessionStorage.getItem("ck.token")||"", SCOPE=sessionStorage.getItem("ck.scope")||"view";
  var paneId=new URLSearchParams(location.search).get("pane")||"";
  if(!TOKEN){ location.href="/app"; return; }
  if(!paneId){ document.getElementById("title").textContent="no session"; return; }
  document.getElementById("title").textContent=paneId.slice(0,12);
  document.getElementById("toterm").href="/app/term?pane="+encodeURIComponent(paneId);
  var canType=SCOPE==="terminal";
  var DIR="", sid=paneId, ws=null, lastQ=null, lastSig="", repairing=false, emptyPolls=0, pollFails=0;
  var chat=document.getElementById("chat"), tin=document.getElementById("tin");

  function rpc(method,params){
    return fetch("/rpc",{method:"POST",headers:{authorization:"Bearer "+TOKEN,"content-type":"application/json"},
      body:JSON.stringify({method:method,params:params||{}})}).then(function(r){
      return r.json().catch(function(){return {};}).then(function(b){
        if(r.status===401||r.status===403){ repair(); throw new Error("unauthorized"); }
        if(!r.ok) throw new Error((b&&b.error)||("rpc "+method));
        return b.result;
      });
    });
  }
  function repair(){ if(repairing)return; repairing=true; sessionStorage.removeItem("ck.token"); sessionStorage.removeItem("ck.scope"); location.href="/app"; }

  // ---- send input to the Claude PTY over the gated /term-ws (terminal scope) ----
  function connect(){
    ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/term-ws");
    ws.binaryType="arraybuffer";
    ws.onopen=function(){ dbg.errs.ws=null; ws.send(JSON.stringify({type:"auth",token:TOKEN,paneId:paneId})); refreshDbg(); };
    ws.onclose=function(ev){ if(ev.code===4003){ repair(); return; } dbg.errs.ws="closed (code "+ev.code+")"; refreshDbg(); setTimeout(connect,2000); };
    ws.onmessage=function(){}; // OUTPUT is ignored here — we render from the typed RPC, not the byte mirror
  }
  function sendText(s){
    if(!ws||ws.readyState!==1||!canType) return false;
    var b=new TextEncoder().encode(s), f=new Uint8Array(1+b.length); f[0]=3; f.set(b,1);
    try{ ws.send(f); return true; }catch(e){ return false; }
  }

  function el(cls,text){ var d=document.createElement("div"); d.className=cls; if(text!=null)d.textContent=text; return d; }
  function toolSummary(name,input){
    var i=input||{};
    if(name==="Bash") return i.command||"";
    if(name==="Edit"||name==="Write"||name==="MultiEdit"||name==="NotebookEdit") return i.file_path||i.path||"";
    if(name==="Read") return i.file_path||"";
    if(name==="Task") return i.description||"";
    return typeof i==="object"?(i.pattern||i.url||i.prompt||""):String(i);
  }
  // ---- diagnostics: tap the status chip to expand a HUD so a blank/broken screen explains itself
  // (no more silently-swallowed errors). Tracks live RPC/WS state + the last error from each source.
  var dbg={msgs:null,agent:null,prompt:null,resolved:"(resolving)",errs:{}}, dbgEl=document.getElementById("dbg");
  function emsg(e){ return (e&&e.message)||String(e); }
  function wsState(){ return !ws?"none":(ws.readyState===0?"connecting":ws.readyState===1?"open":ws.readyState===2?"closing":"closed"); }
  function refreshDbg(){ if(dbgEl.classList.contains("show")) renderDbg(); }
  function renderDbg(){
    var L=["pane:    "+paneId+"  (type target)", "session: "+sid+"  ("+(dbg.resolved||"?")+")",
      "dir:     "+(DIR||"(none)"), "scope:   "+SCOPE+(canType?"":"  (view-only)"),
      "ws:      "+wsState(), "msgs:    "+(dbg.msgs==null?"—":dbg.msgs), "agent:   "+(dbg.agent||"—"), "prompt:  "+(dbg.prompt||"—"),
      "host:    "+location.host];
    var errs=[]; ["msgs","agent","prompt","sessions","dir","ws","js"].forEach(function(k){ if(dbg.errs[k]) errs.push("  "+k+" -> "+dbg.errs[k]); });
    L.push("errors:"); L.push(errs.length?errs.join("\\n"):"  (none)");
    L.push(""); L.push("note: chat shows a Claude SESSION's messages. A plain shell pane has none — tap the keyboard icon for the terminal.");
    dbgEl.textContent=L.join("\\n");
  }
  function showEmpty(){
    var box=el("notice");
    box.appendChild(el("nt","No conversation found yet"));
    box.appendChild(el("nd","No Claude session detected in this project yet. Start claude in a shell (then reload), or open the raw terminal."));
    var a=document.createElement("a"); a.className="ntbtn"; a.href=document.getElementById("toterm").href; a.textContent="⌨ Open terminal"; box.appendChild(a);
    chat.appendChild(box);
  }
  function failChat(method,e){
    dbg.errs.msgs=method+": "+emsg(e); if(lastSig==="__err__"){ refreshDbg(); return; } lastSig="__err__";
    chat.textContent="";
    var box=el("notice err"); box.appendChild(el("nt","Couldn't load the conversation"));
    box.appendChild(el("nd",method+" -> "+emsg(e))); box.appendChild(el("nd","Tap the status chip (top-right) for diagnostics."));
    chat.appendChild(box); refreshDbg();
  }

  function renderChat(msgs){
    msgs=msgs||[]; dbg.msgs=msgs.length; dbg.errs.msgs=null;
    // BL-9: the session is resolved once at load — but you may open the chat BEFORE claude starts,
    // or swap sessions. So if it stays empty, periodically RE-INFER (every ~5 empty polls ≈ 10s); a
    // non-empty render resets the counter. Self-heals without a manual reload (the split chip + drawer
    // are the manual path).
    if(msgs.length) emptyPolls=0; else if((++emptyPolls)%5===0) inferSession();
    var sig=msgs.map(function(m){return m.id+":"+m.blocks.length;}).join(",")||"__empty__";
    if(sig===lastSig){ refreshDbg(); return; } // unchanged — don't rebuild (keeps scroll/selection)
    lastSig=sig;
    var atBottom = chat.scrollHeight-chat.scrollTop-chat.clientHeight < 60;
    chat.textContent="";
    msgs.forEach(function(m){
      if(m.role==="user"){
        var t=m.blocks.filter(function(b){return b.kind==="text";}).map(function(b){return b.text;}).join("\\n").trim();
        if(t) chat.appendChild(el("msg user",t));
        return;
      }
      var wrap=el("msg ai"); var any=false;
      var who=el("who","Claude");
      m.blocks.forEach(function(b){
        if(b.kind==="text" && b.text.trim()){ if(!any){wrap.appendChild(who);any=true;} wrap.appendChild(el("",b.text)); }
        else if(b.kind==="thinking" && b.text.trim()){ chat.appendChild(el("think","✦ "+b.text.trim().slice(0,200))); }
        else if(b.kind==="tool_use"){ var c=el("tool"); c.appendChild(el("nm",b.name)); var s=toolSummary(b.name,b.input); if(s)c.appendChild(el("","· "+s)); chat.appendChild(c); }
        else if(b.kind==="tool_result" && b.isError){ var e=el("tool err","✕ tool error"); chat.appendChild(e); }
      });
      if(any) chat.appendChild(wrap);
    });
    if(!chat.childNodes.length) showEmpty(); // shell pane / empty session — explain, don't show a void
    else if(atBottom) chat.scrollTop=chat.scrollHeight;
    refreshDbg();
  }

  function setStatus(s){
    var box=document.getElementById("status"); var st=s&&s.status;
    box.className = st==="idle"?"idle":(st?"run":"");
    box.querySelector(".t").textContent = st==="running-tool"?"working":(st==="thinking"?"thinking":(st==="idle"?"idle":(st||"…")));
  }

  // ---- pinned tap-to-answer (the live AskUserQuestion) ----
  function renderAnswer(s){
    var box=document.getElementById("answer"); var q=s&&s.askUserQuestion;
    var key=q?q.question+"|"+q.options.map(function(o){return o.label;}).join("|"):null;
    if(key===lastQ) return; lastQ=key;
    box.textContent="";
    if(!q||!q.options.length){ box.style.display="none"; return; }
    box.style.display="block";
    box.appendChild(el("q",q.question));
    // ABSOLUTE selection (BL-3 / mirror of moveToOptionKeys): pin the TUI cursor to the TOP first
    // (up × #options — the list clamps, so it's position-independent regardless of any pre-highlight),
    // THEN down × index. The old "down × index from assumed row 0" could silently submit the WRONG
    // option (Allow vs Deny). multiSelect is answered by toggling (Space) + a single Confirm (Enter).
    var n=q.options.length;
    function moveTo(i){ var s=""; for(var u=0;u<n;u++) s+="\\x1b[A"; for(var d=0;d<i;d++) s+="\\x1b[B"; return s; }
    function mkOpt(o){ var btn=document.createElement("button"); btn.className="opt"; btn.textContent=o.label;
      if(o.description){ var d=el("",o.description); d.style.cssText="display:block;color:var(--muted);font-size:11px;margin-top:2px"; btn.appendChild(d); } return btn; }
    if(q.multiSelect){
      q.options.forEach(function(o,i){ var btn=mkOpt(o); btn.onclick=function(){ sendText(moveTo(i)+" "); btn.classList.toggle("on"); }; box.appendChild(btn); });
      var conf=document.createElement("button"); conf.className="opt"; conf.textContent="✓ Confirm selection";
      conf.onclick=function(){ sendText("\\r"); box.style.display="none"; lastQ=null; }; box.appendChild(conf);
    } else {
      q.options.forEach(function(o,i){ var btn=mkOpt(o); btn.onclick=function(){ sendText(moveTo(i)+"\\r"); box.style.display="none"; lastQ=null; }; box.appendChild(btn); });
    }
  }

  // Resolve WHICH session to render. A "+Claude" pane has paneId===sessionId; but running claude
  // inside a shell does NOT — the pane id ("main") isn't the session id. So if the pane id has no
  // messages, infer the session from the project's most-recently-active one (mirrors the desktop's
  // "Detected Claude session in shell"). We RENDER sid but still TYPE into paneId. The HUD shows both.
  function tsOf(s){ var v=s&&s.lastModified; if(v==null)return 0; if(typeof v==="number")return v; var n=Date.parse(String(v)); return isNaN(n)?0:n; }
  function pickRecent(list){ var best=null,bt=-1; (list||[]).forEach(function(s){ var t=tsOf(s); if(t>bt){bt=t;best=s;} }); return best; }
  // BL-6: never let the read/type split be silent. When the rendered session (sid) differs from the
  // pane you type into (paneId) — the founder's normal "claude in a shell" case — show it in the bar;
  // tapping opens the drawer to switch session. (Full detail is also in the Debug HUD.)
  var splitEl=document.getElementById("splitchip");
  function updateSplitChip(){
    var t=document.getElementById("title");
    if(sid && sid!==paneId){ t.textContent="📄 "+sid.slice(0,8); splitEl.textContent="⌨ "+paneId.slice(0,10); splitEl.classList.add("on"); }
    else { t.textContent=(paneId||"").slice(0,12); splitEl.classList.remove("on"); }
  }
  if(splitEl) splitEl.onclick=function(){ var m=document.getElementById("menu"); if(m) m.click(); };
  function resolveAndPoll(){
    rpc("getSessionMessages",{id:paneId,dir:DIR}).then(function(m){
      if(m&&m.length){ sid=paneId; dbg.resolved="pane id"; dbg.errs.sessions=null; updateSplitChip(); refreshDbg(); poll(); }
      else inferSession();
    },function(){ inferSession(); });
  }
  function inferSession(){
    rpc("listSessions",{dir:DIR}).then(function(list){
      var best=pickRecent(list);
      sid=best?best.id:paneId; dbg.resolved=best?"inferred (recent in project)":"no session found"; dbg.errs.sessions=null; updateSplitChip(); refreshDbg(); poll();
    },function(e){ dbg.errs.sessions=emsg(e); sid=paneId; updateSplitChip(); refreshDbg(); poll(); });
  }

  function poll(){
    if(document.hidden) return; // D1: don't drain RPCs over the tailnet while backgrounded (battery/radio)
    // D2: ONE combined read (messages + agentState + promptState) instead of 3 separate transcript re-reads.
    rpc("sessionSnapshot",{id:sid,dir:DIR}).then(function(r){
      r=r||{};
      pollFails=0; var eb=document.getElementById("engineban"); if(eb) eb.classList.remove("show"); // D4: engine reachable again
      dbg.errs.msgs=null; renderChat(r.messages);
      var a=r.agentState; dbg.errs.agent=null; dbg.agent=a&&a.status; setStatus(a);
      var pr=r.promptState; dbg.errs.prompt=null; dbg.prompt=pr&&(pr.isWaiting?"waiting":"idle"); renderAnswer(pr);
      refreshDbg();
    },function(e){
      if((++pollFails)>=3){ var eb=document.getElementById("engineban"); if(eb) eb.classList.add("show"); } // D4: repeated failure = engine likely down
      failChat("sessionSnapshot",e); dbg.errs.agent=emsg(e); dbg.errs.prompt=emsg(e); refreshDbg();
    });
  }

  // ---- composer ----
  function grow(){ tin.style.height="auto"; tin.style.height=Math.min(tin.scrollHeight,96)+"px"; }
  tin.addEventListener("input",grow);
  function wrapPaste(t){ var c=t,p; do{p=c;c=c.replace(/\\x1b\\[20[01]~/g,"");}while(c!==p); return c.indexOf("\\n")>=0?"\\x1b[200~"+c+"\\x1b[201~":c; }
  function send(){
    var v=tin.value; if(!v.trim())return;
    if(sendText(wrapPaste(v)+"\\r")){ tin.value=""; grow(); tin.focus(); }
  }
  document.getElementById("send").onclick=send;
  tin.addEventListener("keydown",function(e){ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } });
  // Collapse/expand the shortcut row (persisted) — the bottom bar the user can fold away to reclaim space.
  var _comp=document.getElementById("composer"), _kbt=document.getElementById("kbtoggle");
  function _syncKbt(){ _kbt.textContent=(_comp.classList.contains("kbc")?"⌃":"⌄")+" shortcuts"; }
  if(localStorage.getItem("ck.kbc")==="1") _comp.classList.add("kbc");
  _syncKbt();
  _kbt.onclick=function(){ _comp.classList.toggle("kbc"); try{localStorage.setItem("ck.kbc",_comp.classList.contains("kbc")?"1":"0");}catch(e){} _syncKbt(); };
  // quick-insert + key chips
  Array.prototype.forEach.call(document.querySelectorAll("#keys button"),function(b){
    b.addEventListener("pointerdown",function(e){ e.preventDefault(); });
    b.onclick=function(){
      var k=b.getAttribute("data-k");
      if(k){ var s=tin.selectionStart==null?tin.value.length:tin.selectionStart, e2=tin.selectionEnd==null?s:tin.selectionEnd;
        tin.value=tin.value.slice(0,s)+k+tin.value.slice(e2); tin.selectionStart=tin.selectionEnd=s+k.length; grow(); tin.focus(); return; }
      var seq=b.getAttribute("data-seq");
      sendText(seq==="esc"?"\\x1b":seq==="cr"?"\\r":seq==="ctrlc"?"\\x03":seq==="up"?"\\x1b[A":seq==="down"?"\\x1b[B":"");
    };
  });
  // paste (text now; clipboard image needs HTTPS — added later). Shared by the 📋 button + the puck radial.
  function doPaste(){
    if(!navigator.clipboard||!navigator.clipboard.readText){ tin.focus(); return; }
    navigator.clipboard.readText().then(function(t){ if(!t)return;
      tin.value=tin.value+t; grow(); tin.focus(); }).catch(function(){ tin.focus(); });
  }
  document.getElementById("paste").onclick=doPaste;
  // upload — smart: a TEXT file (.md/.txt/code/json…) is read client-side and inlined into the composer
  // (you review it before sending); a BINARY (pdf/image/zip…) is POSTed to the engine, which saves it
  // under the project's .glaudecode-uploads/ and returns a path the composer @-references for Claude.
  // No auto-send either way — the inserted text/@path is the preview.
  var fileInput=document.getElementById("file"), uploadBtn=document.getElementById("upload");
  var TEXT_EXT=/\\.(md|markdown|txt|text|log|csv|tsv|json|ya?ml|toml|ini|env|xml|html?|css|scss|tsx?|jsx?|mjs|cjs|py|rb|rs|go|java|kt|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|swift|lua|r|pl|dart|vue|svelte|gitignore|dockerfile)$/i;
  function isText(f){ return (f.type && /^text\\//.test(f.type)) || /json|xml|yaml|javascript|x-sh/.test(f.type||"") || TEXT_EXT.test(f.name||""); }
  function insertAtCursor(text){ var s=tin.selectionStart==null?tin.value.length:tin.selectionStart, e=tin.selectionEnd==null?s:tin.selectionEnd;
    tin.value=tin.value.slice(0,s)+text+tin.value.slice(e); var p=s+text.length; tin.selectionStart=tin.selectionEnd=p; grow(); tin.focus(); }
  uploadBtn.onclick=function(){ fileInput.value=""; fileInput.click(); };
  fileInput.onchange=function(){
    var f=fileInput.files&&fileInput.files[0]; if(!f) return;
    if(isText(f)){
      var rd=new FileReader();
      rd.onload=function(){ insertAtCursor(String(rd.result||"")); };
      rd.onerror=function(){ uploadBtn.textContent="⚠"; setTimeout(function(){uploadBtn.textContent="📎";},1500); };
      rd.readAsText(f); return;
    }
    uploadBtn.textContent="…";
    fetch("/upload",{method:"POST",headers:{authorization:"Bearer "+TOKEN,"x-filename":encodeURIComponent(f.name||"upload")},body:f})
      .then(function(r){ if(r.status===401||r.status===403){ repair(); throw new Error("unauthorized"); }
        return r.json().then(function(b){ if(!r.ok) throw new Error((b&&b.error)||"upload failed"); return b; }); })
      .then(function(b){ insertAtCursor("@"+b.path+" "); uploadBtn.textContent="📎"; })
      .catch(function(){ uploadBtn.textContent="⚠"; setTimeout(function(){uploadBtn.textContent="📎";},1800); });
  };

  // ---- gesture puck: tap=Enter · flick=arrows · press-hold=radial · move-then-pause=re-park ----
  // Ported from docs/design/mockups/v6-puck-interactive.html. Disambiguation (decided the instant you
  // touch down): move>14px first = flick (cancels the hold) → an arrow key; hold still ~200ms = the
  // radial blooms; a flick that then PAUSES ~260ms switches to carry → re-park (so a quick flick can't
  // accidentally move the puck). Sends raw keys into the PTY via sendText (terminal scope only).
  (function(){
    if(!canType) return; // the puck drives the PTY — terminal scope only
    var puck=document.getElementById("puck"), out=document.getElementById("puckout");
    var SZ=60, HOLD_MS=200, MOVE=14, DWELL_MS=260, R=78;
    var saved=null; try{ saved=JSON.parse(localStorage.getItem("ck.puck")||"null"); }catch(e){}
    var pos=(saved&&typeof saved.x==="number")?saved:{x:innerWidth-78,y:innerHeight-150};
    function place(){ pos.x=Math.max(6,Math.min(innerWidth-SZ-6,pos.x)); pos.y=Math.max(46,Math.min(innerHeight-SZ-6,pos.y));
      puck.style.left=pos.x+"px"; puck.style.top=pos.y+"px"; }
    place(); puck.style.display="flex"; window.addEventListener("resize",place);
    var KEYS=[{k:"Esc",a:270,seq:"\\x1b"},{k:"Tab",a:330,seq:"\\t"},{k:"^C",a:30,seq:"\\x03"},
              {k:"📋",a:90,act:"paste"},{k:"⇧Tab",a:150,seq:"\\x1b[Z"},{k:"⌨",a:210,act:"kbd"}];
    var wedges=[];
    function buildRadial(cx,cy){ clearRadial(); KEYS.forEach(function(o){
      var rad=o.a*Math.PI/180, w=document.createElement("div");
      w.className="wedge"+(/[A-Za-z^]/.test(o.k)?" mono":""); w.textContent=o.k; w.dataset.k=o.k;
      w.style.left=(cx+R*Math.cos(rad)-25)+"px"; w.style.top=(cy+R*Math.sin(rad)-25)+"px";
      document.body.appendChild(w); wedges.push(w); }); }
    function clearRadial(){ wedges.forEach(function(w){w.remove();}); wedges=[]; }
    function hotWedge(cx,cy,px,py){ var dx=px-cx,dy=py-cy;
      wedges.forEach(function(w){w.classList.remove("hot");});
      if(Math.hypot(dx,dy)<34) return null; // near centre = cancel
      var ang=Math.atan2(dy,dx)*180/Math.PI; if(ang<0)ang+=360;
      var best=null,bd=999; KEYS.forEach(function(o){ var d=Math.abs(((ang-o.a+540)%360)-180); if(d<bd){bd=d;best=o;} });
      var el=wedges.find(function(w){return w.dataset.k===best.k;}); if(el)el.classList.add("hot");
      return best; }
    function toast(s){ out.textContent=s; out.classList.add("show"); clearTimeout(toast._t);
      toast._t=setTimeout(function(){out.classList.remove("show");},850); if(navigator.vibrate)navigator.vibrate(10); }
    function fireKey(o){ if(o.act==="paste"){ toast("📋 paste"); doPaste(); return; }
      if(o.act==="kbd"){ toast("⌨ keyboard"); tin.focus(); return; } toast(o.k); sendText(o.seq); }
    var st=null;
    function armDwell(){ clearTimeout(st.dwell); st.dwell=setTimeout(function(){
      if(st&&st.mode==="flick"){ st.mode="carry"; puck.classList.add("carry"); if(navigator.vibrate)navigator.vibrate(8); } },DWELL_MS); }
    puck.addEventListener("pointerdown",function(e){
      e.preventDefault(); try{puck.setPointerCapture(e.pointerId);}catch(err){}
      puck.classList.add("holding");
      st={x0:e.clientX,y0:e.clientY,ox:pos.x,oy:pos.y,cx:pos.x+SZ/2,cy:pos.y+SZ/2,mode:"idle",hot:null,t0:Date.now()};
      st.hold=setTimeout(function(){ if(st&&st.mode==="idle"){ st.mode="radial"; buildRadial(st.cx,st.cy); if(navigator.vibrate)navigator.vibrate(8); } },HOLD_MS);
    });
    window.addEventListener("pointermove",function(e){
      if(!st)return; var dx=e.clientX-st.x0, dy=e.clientY-st.y0;
      if(st.mode==="idle" && Math.hypot(dx,dy)>MOVE){ clearTimeout(st.hold); st.mode="flick"; armDwell(); }
      // A DELIBERATE drag (still moving 240ms+ after touch-down) = pick up & move — no "pause" needed.
      // A quick swipe (released before 240ms) stays a flick → arrow. This is what makes the puck draggable.
      else if(st.mode==="flick"){ if(Date.now()-st.t0>240){ clearTimeout(st.dwell); st.mode="carry"; puck.classList.add("carry"); if(navigator.vibrate)navigator.vibrate(8); pos.x=st.ox+dx; pos.y=st.oy+dy; place(); } else { armDwell(); } }
      else if(st.mode==="carry"){ pos.x=st.ox+dx; pos.y=st.oy+dy; place(); }
      else if(st.mode==="radial"){ st.hot=hotWedge(st.cx,st.cy,e.clientX,e.clientY); }
    });
    window.addEventListener("pointerup",function(e){
      if(!st)return; clearTimeout(st.hold); clearTimeout(st.dwell); puck.classList.remove("holding","carry");
      var dx=e.clientX-st.x0, dy=e.clientY-st.y0;
      if(st.mode==="idle"){ toast("⏎ Enter"); sendText("\\r"); }
      else if(st.mode==="flick"){
        if(Math.abs(dx)>Math.abs(dy)){ if(dx>0){toast("→");sendText("\\x1b[C");} else {toast("←");sendText("\\x1b[D");} }
        else { if(dy>0){toast("↓");sendText("\\x1b[B");} else {toast("↑");sendText("\\x1b[A");} } }
      else if(st.mode==="carry"){ place(); try{localStorage.setItem("ck.puck",JSON.stringify(pos));}catch(err){} }
      else if(st.mode==="radial"){ if(st.hot){ fireKey(st.hot); } else { toast("✕ cancel"); } clearRadial(); }
      st=null;
    });
  })();

  // ---- nav drawer (V6 option B): Sessions / Search / Prompts / Memory over read-only RPCs ----
  // The conversation is home; ☰ pulls everything in without leaving the session. Button-only (no
  // edge-swipe) so it never fights the puck's flick or the chat scroll. All DOM via textContent.
  (function(){
    var scrim=document.getElementById("scrim"), drawer=document.getElementById("drawer"),
        dcontent=document.getElementById("dcontent"), dtabs=document.getElementById("dtabs");
    function openD(o){ scrim.classList.toggle("open",o); drawer.classList.toggle("open",o); }
    document.getElementById("menu").onclick=function(){ openD(true); if(!dcontent.childNodes.length) select("sessions"); };
    scrim.onclick=function(){ openD(false); };
    function clear(){ dcontent.textContent=""; }
    function hint(t){ return el("hint",t); }
    function rowLink(href,title,sub,cur){ var a=document.createElement("a"); a.className="drow"+(cur?" cur":""); a.href=href;
      a.appendChild(el("",title)); if(sub) a.appendChild(el("sub",sub)); return a; }
    function rowBtn(title,sub,onclick){ var b=document.createElement("button"); b.className="drow";
      b.appendChild(el("",title)); if(sub) b.appendChild(el("sub",sub)); b.onclick=onclick; return b; }
    function insertIntoComposer(text){ var s=tin.selectionStart==null?tin.value.length:tin.selectionStart;
      tin.value=tin.value.slice(0,s)+text+tin.value.slice(s); grow(); tin.focus(); }

    function select(name){
      Array.prototype.forEach.call(dtabs.querySelectorAll("button"),function(b){ b.classList.toggle("on",b.getAttribute("data-s")===name); });
      clear(); dcontent.scrollTop=0;
      if(name==="sessions") renderSessions();
      else if(name==="search") renderSearch();
      else if(name==="prompts") renderPrompts();
      else if(name==="memory") renderMemory();
      else if(name==="debug") renderDebug();
    }
    dtabs.addEventListener("click",function(e){ var b=e.target.closest("button"); if(b) select(b.getAttribute("data-s")); });

    function renderSessions(){
      dcontent.appendChild(hint("Loading…"));
      rpc("listPanes").then(function(ps){ clear();
        if(!ps||!ps.length){ dcontent.appendChild(hint("No live terminals — open a pane in GlaudeCode.")); return; }
        ps.forEach(function(p){ dcontent.appendChild(rowLink("/app/chat?pane="+encodeURIComponent(p.paneId),
          p.title||p.paneId.slice(0,12), p.cols+"×"+p.rows, p.paneId===paneId)); });
      }).catch(function(){ clear(); dcontent.appendChild(hint("Couldn't load sessions.")); });
    }
    function renderSearch(){
      var box=el(""); box.id="dsearch"; var inp=document.createElement("input");
      inp.placeholder="Search sessions + messages… (Enter)"; inp.autocapitalize="none"; inp.autocomplete="off";
      box.appendChild(inp); dcontent.appendChild(box);
      var res=el(""); dcontent.appendChild(res);
      function run(){ var q=inp.value.trim(); res.textContent=""; if(!q) return; res.appendChild(hint("Searching…"));
        rpc("search",{query:q,dir:DIR}).then(function(hits){ res.textContent="";
          if(!hits||!hits.length){ res.appendChild(hint("No matches.")); return; }
          hits.forEach(function(h){ res.appendChild(rowLink("/app/chat?pane="+encodeURIComponent(h.sessionId), h.sessionId.slice(0,12), h.snippet||"", false)); });
        }).catch(function(){ res.textContent=""; res.appendChild(hint("Search failed.")); });
      }
      inp.addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); run(); } });
      setTimeout(function(){ inp.focus(); },50);
    }
    function renderPrompts(){
      dcontent.appendChild(hint("Loading…"));
      rpc("listPrompts").then(function(ps){ clear();
        if(!ps||!ps.length){ dcontent.appendChild(hint("No saved prompts.")); return; }
        dcontent.appendChild(hint("Tap to insert into the composer."));
        ps.forEach(function(p){ dcontent.appendChild(rowBtn(p.name||p.id,
          (p.variables&&p.variables.length)?("vars: "+p.variables.join(", ")):"", function(){
            rpc("readPrompt",{id:p.id}).then(function(r){ openD(false); insertIntoComposer((r&&r.body)||""); }).catch(function(){});
          })); });
      }).catch(function(){ clear(); dcontent.appendChild(hint("Couldn't load prompts.")); });
    }
    function renderMemory(){
      dcontent.appendChild(hint("Loading…"));
      rpc("listMemory",{dir:DIR}).then(function(ms){ clear();
        var head=el("roview"); head.appendChild(el("","Memory")); head.appendChild(el("roTag","read-only")); dcontent.appendChild(head);
        if(!ms||!ms.length){ dcontent.appendChild(hint("No memory files.")); return; }
        ms.forEach(function(m){ dcontent.appendChild(rowBtn(m.name, m.bytes+" B", function(){ viewMemory(m.path,m.name); })); });
      }).catch(function(){ clear(); dcontent.appendChild(hint("Couldn't load memory.")); });
    }
    function viewMemory(path,name){ clear();
      var bar=el("roview"); var back=document.createElement("button"); back.textContent="‹ Memory"; back.onclick=renderMemory;
      bar.appendChild(back); bar.appendChild(el("roTag","read-only")); dcontent.appendChild(bar);
      dcontent.appendChild(hint(name));
      rpc("readMemory",{dir:DIR,path:path}).then(function(r){ var pre=document.createElement("pre"); pre.textContent=(r&&r.content)||""; dcontent.appendChild(pre); })
        .catch(function(){ dcontent.appendChild(hint("Couldn't read file.")); });
    }
    function renderDebug(){
      dcontent.appendChild(hint("Loading…"));
      rpc("diagnosticsView",{limit:120}).then(function(d){ clear();
        var h=(d&&d.health)||{};
        var head=el("roview"); head.appendChild(el("","Diagnostics")); head.appendChild(el("roTag","live")); dcontent.appendChild(head);
        dcontent.appendChild(el("hint","engine "+(h.engineUp?"up":"down")+" · bridge "+(h.bridgeConnected?"ok":"—")+" · "+(h.panes!=null?h.panes:"?")+" panes · up "+(h.uptimeMs!=null?Math.round(h.uptimeMs/1000)+"s":"?")));
        if(h.lastError) dcontent.appendChild(el("hint","last error: "+((h.lastError.msg)||"")));
        var evs=(d&&d.events)||[];
        if(!evs.length){ dcontent.appendChild(hint("No events yet.")); return; }
        evs.slice().reverse().slice(0,80).forEach(function(e){
          var row=el("drow","["+e.kind+"] "+e.msg+(e.data&&typeof e.data.ms==="number"?(" "+e.data.ms+"ms"):""));
          if(e.level==="error") row.style.color="#ff9a92"; else if(e.level==="warn") row.style.color="#e3b341";
          dcontent.appendChild(row);
        });
      }).catch(function(e){ clear(); dcontent.appendChild(hint("Diagnostics needs Steer access (re-pair on the Mac) or the engine is unreachable. "+((e&&e.message)||""))); });
    }
  })();

  function gateUI(){
    if(canType) return;
    document.getElementById("composer").style.display="none";
    var n=document.getElementById("scopenote"); n.style.display="block";
    n.textContent="View-only — re-pair with Terminal access on the Mac to drive this session.";
  }

  document.getElementById("status").onclick=function(){ dbgEl.classList.toggle("show"); renderDbg(); };
  document.getElementById("engineban").onclick=function(){ pollFails=0; this.classList.remove("show"); poll(); }; // D4: tap to retry now
  // OBS-3: forward uncaught errors to the Mac so the lid-closed founder sees them in the engine log +
  // diagnostics stream — not just on this screen. Paired-token POST; best-effort, never throws.
  function postErr(level,kind,msg,where){ try{ fetch("/clientlog-remote",{method:"POST",headers:{authorization:"Bearer "+TOKEN,"content-type":"application/json"},
    body:JSON.stringify({level:level,kind:kind,msg:String(msg).slice(0,300),where:where||location.pathname})}).catch(function(){}); }catch(e){} }
  window.addEventListener("error",function(e){ var m=(e&&e.message)||"script error"; dbg.errs.js=m; refreshDbg(); postErr("error","error",m,(e&&e.filename)||location.pathname); });
  window.addEventListener("unhandledrejection",function(e){ var m=(e&&e.reason&&(e.reason.message||e.reason))||"unhandled rejection"; dbg.errs.js=String(m); refreshDbg(); postErr("error","unhandledrejection",String(m)); });
  // ---- Web Push opt-in (V8 Phase 1.4): register the service worker + let the user enable alerts on an
  // EXPLICIT tap (iOS only prompts on a user gesture). Secure context (HTTPS via Tailscale Serve, or
  // localhost) + steer+ scope only — the /push-subscribe route is steer+. Re-subscribe is idempotent. ----
  function urlB64ToU8(s){ var pad="=".repeat((4-s.length%4)%4); var b=(s+pad).replace(/-/g,"+").replace(/_/g,"/"); var raw=atob(b); var u=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i); return u; }
  function pushSupported(){ return location.protocol==="https:" && "serviceWorker" in navigator && "PushManager" in window && SCOPE!=="view"; }
  // Check r.ok on BOTH fetches so a 403 (scope) / 429 (rate-limit) / 5xx REJECTS instead of resolving
  // "successfully" with a non-ok Response — otherwise a failed subscribe would still flip the UI to
  // "Alerts on" (the silent false-positive). (review remediation)
  function subscribePush(){
    return navigator.serviceWorker.ready
      .then(function(reg){ return fetch("/push-key",{headers:{authorization:"Bearer "+TOKEN}}).then(function(r){ if(!r.ok) throw new Error("push-key "+r.status); return r.json(); })
        .then(function(k){ return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToU8(k.publicKey)}); }); })
      .then(function(sub){ return fetch("/push-subscribe",{method:"POST",headers:{authorization:"Bearer "+TOKEN,"content-type":"application/json"},body:JSON.stringify(sub)}).then(function(r){ if(!r.ok) throw new Error("push-subscribe "+r.status); return r; }); });
  }
  var bell=document.getElementById("bell");
  // A subscribe failure must be VISIBLE (never the "Alerts on" lie): flip the bell to a clear failed
  // state AND forward the error to the Mac's eventLog so the lid-closed founder sees it. (review remediation)
  function alertsOk(){ bell.title="Alerts on"; bell.textContent="🔔"; }
  function alertsFail(e){ bell.title="Alerts failed — tap to retry"; bell.textContent="🔕"; postErr("error","push-subscribe",(e&&e.message)||"subscribe failed"); }
  if(pushSupported()){
    navigator.serviceWorker.register("/app/sw.js",{scope:"/app/"}).catch(function(e){ postErr("warn","sw-register",(e&&e.message)||"sw register failed"); });
    if(Notification.permission!=="denied"){
      bell.style.display="";
      if(Notification.permission==="granted") subscribePush().then(alertsOk).catch(alertsFail); // title set ONLY on real success
    }
    bell.onclick=function(){
      if(Notification.permission==="granted"){ subscribePush().then(alertsOk).catch(alertsFail); return; }
      Notification.requestPermission().then(function(p){ if(p==="granted"){ subscribePush().then(alertsOk).catch(alertsFail); } else { bell.title="Alerts blocked in browser settings"; } });
    };
  }
  rpc("defaultDir").then(function(d){ DIR=(d&&d.dir)||""; dbg.errs.dir=null; resolveAndPoll(); }).catch(function(e){ dbg.errs.dir=emsg(e); refreshDbg(); resolveAndPoll(); });
  gateUI(); if(canType) connect();
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) poll(); }); // D1: catch up immediately when refocused
  setInterval(poll,2000);
})();
</script>
</body>
</html>`;
