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
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);overscroll-behavior:none;
    font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
  #bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--line)}
  #bar a{color:var(--accent2);text-decoration:none;font-size:18px}
  #title{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%}
  #status{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
  #status .dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
  #status.run .dot{background:var(--amber)} #status.run{color:var(--amber)}
  #status.idle .dot{background:var(--green)} #status.idle{color:var(--green)}
  .ib{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;color:var(--text);padding:5px 9px;font-size:13px;cursor:pointer}
  #chat{position:absolute;top:39px;left:0;right:0;bottom:0;overflow-y:auto;overscroll-behavior:contain;
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
  /* composer */
  #composer{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line)}
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
    background:radial-gradient(circle at 35% 30%,#3a7bf0,#1f6feb 60%,#1a52b8);
    box-shadow:0 6px 22px rgba(31,111,235,.55),inset 0 1px 2px rgba(255,255,255,.35)}
  #puck.holding{transform:scale(.94);cursor:grabbing} #puck.carry{transform:scale(1.07);box-shadow:0 8px 28px rgba(31,111,235,.75)}
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
</style>
</head>
<body>
  <div id="bar">
    <button id="menu" title="Menu">☰</button>
    <span id="title" class="muted">…</span>
    <span id="status"><span class="dot"></span><span class="t">…</span></span>
    <a id="toterm" class="ib" title="Raw terminal" href="#">⌨</a>
  </div>
  <div id="chat"></div>
  <input id="file" type="file" />
  <div id="composer">
    <div id="answer"></div>
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
  var DIR="", ws=null, lastQ=null, lastSig="", repairing=false;
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
    ws.onopen=function(){ ws.send(JSON.stringify({type:"auth",token:TOKEN,paneId:paneId})); };
    ws.onclose=function(ev){ if(ev.code===4003){ repair(); return; } setTimeout(connect,2000); };
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
  function renderChat(msgs){
    var sig=msgs.map(function(m){return m.id+":"+m.blocks.length;}).join(",");
    if(sig===lastSig) return; // unchanged — don't rebuild (keeps scroll/selection)
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
    if(atBottom) chat.scrollTop=chat.scrollHeight;
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
    q.options.forEach(function(o,i){
      var btn=document.createElement("button"); btn.className="opt"; btn.textContent=o.label;
      if(o.description){ var d=el("",o.description); d.style.cssText="display:block;color:var(--muted);font-size:11px;margin-top:2px"; btn.appendChild(d); }
      btn.onclick=function(){
        var seq=""; for(var k=0;k<i;k++) seq+="\\x1b[B"; // down-arrow × index, then Enter (V6 hardening: live index later)
        sendText(seq+"\\r"); box.style.display="none"; lastQ=null;
      };
      box.appendChild(btn);
    });
  }

  function poll(){
    rpc("getSessionMessages",{id:paneId,dir:DIR}).then(renderChat).catch(function(){});
    rpc("agentState",{id:paneId,dir:DIR}).then(setStatus).catch(function(){});
    rpc("promptState",{id:paneId,dir:DIR}).then(renderAnswer).catch(function(){});
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
      st={x0:e.clientX,y0:e.clientY,ox:pos.x,oy:pos.y,cx:pos.x+SZ/2,cy:pos.y+SZ/2,mode:"idle",hot:null};
      st.hold=setTimeout(function(){ if(st&&st.mode==="idle"){ st.mode="radial"; buildRadial(st.cx,st.cy); if(navigator.vibrate)navigator.vibrate(8); } },HOLD_MS);
    });
    window.addEventListener("pointermove",function(e){
      if(!st)return; var dx=e.clientX-st.x0, dy=e.clientY-st.y0;
      if(st.mode==="idle" && Math.hypot(dx,dy)>MOVE){ clearTimeout(st.hold); st.mode="flick"; armDwell(); }
      else if(st.mode==="flick"){ armDwell(); }
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
  })();

  function gateUI(){
    if(canType) return;
    document.getElementById("composer").style.display="none";
    var n=document.getElementById("scopenote"); n.style.display="block";
    n.textContent="View-only — re-pair with Terminal access on the Mac to drive this session.";
  }

  rpc("defaultDir").then(function(d){ DIR=(d&&d.dir)||""; poll(); }).catch(function(){});
  gateUI(); if(canType) connect();
  setInterval(poll,2000);
})();
</script>
</body>
</html>`;
