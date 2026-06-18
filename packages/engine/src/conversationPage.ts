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
</style>
</head>
<body>
  <div id="bar">
    <a href="/app" title="Sessions">‹</a>
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
  // paste (text now; clipboard image needs HTTPS — added later)
  document.getElementById("paste").onclick=function(){
    if(!navigator.clipboard||!navigator.clipboard.readText){ tin.focus(); return; }
    navigator.clipboard.readText().then(function(t){ if(!t)return;
      var s=tin.value; tin.value=s+t; grow(); tin.focus(); }).catch(function(){ tin.focus(); });
  };
  // upload — handed to the engine, which saves it under the project and references it to Claude (wired next)
  document.getElementById("upload").onclick=function(){ document.getElementById("file").click(); };

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
