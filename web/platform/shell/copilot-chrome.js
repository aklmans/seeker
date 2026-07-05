// @ts-nocheck —— 抽壳序3-a 过渡:Copilot 面板机制,引用 $/el(序1)+ copSend(序3-b 前向);类型化留 3.y;逻辑零改动。
/** 平台 · Copilot 面板机制 copEl/copOpen/copClose/copToggle/copScroll/copAppend + UI 模板 cCard/cAct/cBtn/cSuggs。
 *  依赖 $/el;cSuggs onclick 调 copSend(序3-b)、cBtn onclick 字符串(运行时);jobseek 专属响应(aiSuggs/copMatch/copReply)留 index.html/apps。
 *  挂全局 + 载序前置(在序1/序2 后;消费者运行时调)→ 零回归(约束⑤)。 */
function copEl(){return $('#copPanel');}
function copOpen(){copEl().classList.add('open'); setTimeout(()=>$('#copInput').focus(),260);}
function copClose(){copEl().classList.remove('open');}
function copToggle(){copEl().classList.contains('open')?copClose():copOpen();}
function copScroll(){const m=$('#copMsgs'); m.scrollTop=m.scrollHeight;}
function copAppend(role, html){const d=el(`<div class="cop-msg ${role}">${html}</div>`); $('#copMsgs').appendChild(d); copScroll(); return d;}
const cCard=(t,m)=>`<div class="cop-card"><div class="cct">${t}</div>${m?`<div class="ccm">${m}</div>`:''}</div>`;
const cAct=(arr)=>arr.length?`<div class="cop-actions">${arr.join('')}</div>`:'';
const cBtn=(l,oc,acc)=>`<button class="btn ${acc?'btn-accent':''}" onclick="${oc}">${l}</button>`;
const cSuggs=(arr)=>`<div class="cop-sugg">${arr.map(s=>`<button onclick="copSend('${s}')">${s}</button>`).join('')}</div>`;

/* ---- 抽壳序3-d-1:Copilot/Agent 发送核心(红线:用户输入进 DOM 前 text.replace(/</g,&lt;) 转义逐字保留;frameQuery→streamReply|appReply 链) ---- */
function copSend(text, aiText){
  const inp=$('#copInput');
  text=(text||inp.value||'').trim(); if(!text)return;
  if(appMode==='agent'){ copClose(); agentSend(text, aiText); return; } // agent 模式:关浮窗,回复进 agent 视图(否则面板看着没反应)
  inp.value=''; inp.style.height='auto';
  if(!copEl().classList.contains('open')) copOpen();
  copAppend('user', text.replace(/</g,'&lt;')); persistMsg('cop','user',text);
  const think=copAppend('ai','<div class="cop-think"><span class="ai-dots"><i></i><i></i><i></i></span>思考中…</div>');
  const toAI = aiText || window.SeekerShell.frameQuery(text); // 壳框定链(启用应用的 framer;jobseek 注入现 frameQuery):显示短文案、发给 AI 框定版
  if(aiChatAvailable()){ streamReply(think, toAI, 'Copilot', copScroll); }
  else setTimeout(()=>{ think.remove(); copAppend('ai','<span class="who">Copilot</span>'+window.SeekerShell.appReply(text)); }, 680+Math.random()*460);
}

function agentAppend(role,html){const d=el(`<div class="cop-msg ${role}">${html}</div>`);$('#agentMsgs').appendChild(d);const c=$('#agentMsgs');c.scrollTop=c.scrollHeight;return d;}
function agentSend(text, aiText){
  const inp=$('#agentInput'); text=(text||inp.value||'').trim(); if(!text)return;
  inp.value=''; inp.style.height='auto';
  agentAppend('user', text.replace(/</g,'&lt;')); persistMsg('agent','user',text);
  const think=agentAppend('ai','<div class="cop-think"><span class="ai-dots"><i></i><i></i><i></i></span>思考中…</div>');
  const toAI = aiText || window.SeekerShell.frameQuery(text); // 壳框定链(启用应用的 framer;jobseek 注入现 frameQuery):显示短文案、发给 AI 框定版
  if(aiChatAvailable()){ streamReply(think, toAI, 'Agent', agentScroll); }
  else setTimeout(()=>{think.remove(); agentAppend('ai','<span class="who">Agent</span>'+window.SeekerShell.appReply(text));}, 680+Math.random()*420);
}

/* ---- 抽壳序3-d-3:Copilot 面板初始化 copInit —— 依赖 $/IC(序1)+ 本文件 copToggle/copClose/copSend/copAppend/cSuggs;开场建议经 SeekerShell.appSuggs 契约(序3-d-2),不再直调 jobseek aiSuggs。⚠开场白文案仍 jobseek 味 = 过渡债(同 agentGreet 的 T('agentGreet')/i18n 表),待后续契约化清 ---- */
function copInit(){
  $('#copLaunch').onclick=copToggle;
  $('#copClose').innerHTML=IC.x; $('#copClose').onclick=copClose;
  $('#copSend').innerHTML=IC.arrow; $('#copSend').onclick=()=>copSend();
  const inp=$('#copInput');
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();copSend();} });
  inp.addEventListener('input',()=>{ inp.style.height='auto'; inp.style.height=Math.min(120,inp.scrollHeight)+'px'; });
  /* Mod+K 与 Esc→关闭 Copilot 已收编进 SeekerKeys(见 initKeys),此处不再单独监听 */
  copAppend('ai','<span class="who">Copilot</span>'+tt('嗨,我是你的求职 Copilot。用一句话就能指挥整个工作台 —— 匹配岗位、改简历、出面试题、排计划、查缺口都行。试试:','Hi, I\'m your job-hunt Copilot. Command the whole workbench in one line — match jobs, tune resumes, generate interview questions, plan training, find gaps. Try:')+cSuggs(window.SeekerShell.appSuggs()));
}

/* ---- 抽壳序3-d-4:Copilot/Agent 辅助 chrome —— copGo(关面板+导航)/ agentChat(追加到当前活动面板)/ agentCancel(取消回执)/ aiChatAvailable(真实流式能力判定)/ agentScroll。依赖 $/copClose/go/appMode/agentAppend/copAppend/isDesktop/SeekerRT(运行时全局);jobseek 经 onclick 字符串运行时调 copGo/agentCancel(过渡态) ---- */
function copGo(id){copClose();go(id);}
function agentChat(html){ (appMode==='agent'?agentAppend:copAppend)('ai','<span class="who">Agent</span>'+html); }
function agentCancel(){ agentChat('好的,已取消,什么都没动。'); }
function aiChatAvailable(){ return typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT; }
function agentScroll(){ const c=$('#agentMsgs'); if(c) c.scrollTop=c.scrollHeight; }

/* ---- 抽壳序3-d-6:Agent 模式群 —— appMode/appReady 状态 + renderModeSwitch/setAppMode/agentShowCanvas/agentCollapse/agentGreet。
   依赖 $/$$/T(序1)+ 本文件 copClose/agentAppend(序3-a/3-d-1)+ document.body/localStorage(运行时);appMode 与其消费者 copSend/agentChat 同文件。
   ⚠ agentGreet 用 T('agentGreet')=平台 i18n 的 jobseek 味开场白(文案归属待清账,同 copInit,3.y manifest.greeting 清)。
   initShell(壳启动非 chrome)留 index.html——归属另判(评审后续关注)。 ---- */
let appMode='editor';
let appReady=false;
function renderModeSwitch(){
  const ms=$('#modeSwitch'); if(!ms)return;
  ms.innerHTML=`<button class="${appMode==='agent'?'on':''}" data-am="agent">Agent</button><button class="${appMode==='editor'?'on':''}" data-am="editor">${T('editor')}</button>`;
  $$('#modeSwitch button').forEach(b=>b.onclick=()=>setAppMode(b.dataset.am));
}
function setAppMode(m){
  const prev=appMode; appMode=m; document.body.dataset.appmode=m;
  if(m==='agent'){ try{ copClose(); }catch(_e){} } // 进 agent 模式关掉浮窗(launcher 已隐藏,统一为 agent 视图唯一 AI 面)
  if(m==='agent'&&prev!=='agent') document.body.dataset.agent='centered';
  renderModeSwitch();
  try{localStorage.setItem('jh-mode',m);}catch(e){}
  if(m==='agent' && !$('#agentMsgs').children.length) agentGreet();
}
function agentShowCanvas(){ if(appReady && appMode==='agent') document.body.dataset.agent='split'; }
function agentCollapse(){ document.body.dataset.agent='centered'; }
function agentGreet(){
  agentAppend('ai','<span class="who">Agent</span>'+T('agentGreet'));
}

/* ---- 抽壳序3-d-9:Agent /命令面板机制(通用) —— cmdActive/cmdFiltered 状态 + cmdIsOpen/cmdFilterList/cmdRender/cmdOpen/cmdClose/cmdRun。
   命令数据经 SeekerShell.appCommands()(序3-d-7 契约,平台零 jobseek 命令 knowledge);依赖 $/$$/tt(序1)+ #cmdPop/#agentInput;agentInit(序3-d-10)运行时接线。 ---- */
let cmdActive=0, cmdFiltered=[];
function cmdIsOpen(){const p=$('#cmdPop');return p&&p.classList.contains('open');}
function cmdFilterList(q){q=(q||'').toLowerCase().trim();const A=window.SeekerShell.appCommands();if(!q)return A.slice();return A.filter(c=>c.cmd.toLowerCase().includes(q)||c.label.some(x=>x.toLowerCase().includes(q))||c.desc.some(x=>x.toLowerCase().includes(q)));}
function cmdRender(){
  const pop=$('#cmdPop');
  pop.innerHTML=`<div class="cmd-hint">${tt('命令 · ↑↓ 选择 · Enter 执行 · Esc 关闭','Commands · ↑↓ select · Enter run · Esc close')}</div>`+cmdFiltered.map((c,i)=>`<div class="cmd-row ${i===cmdActive?'active':''}" data-ci="${i}"><span class="cc">${c.cmd}</span><span class="cl">${tt(c.label[0],c.label[1])}</span><span class="cd">${tt(c.desc[0],c.desc[1])}</span></div>`).join('');
  $$('#cmdPop [data-ci]').forEach(r=>r.onmousedown=(e)=>{e.preventDefault();cmdRun(+r.dataset.ci);});
}
function cmdOpen(q){cmdFiltered=cmdFilterList(q);cmdActive=0;if(cmdFiltered.length){cmdRender();$('#cmdPop').classList.add('open');}else cmdClose();}
function cmdClose(){const p=$('#cmdPop');if(p)p.classList.remove('open');}
function cmdRun(i){const c=cmdFiltered[i];if(!c)return;$('#agentInput').value='';$('#agentInput').style.height='auto';cmdClose();c.run();}

/* ---- 抽壳序3-d-10:Agent 输入 + 命令面板接线 agentInit —— 依赖 $/IC(序1)+ 本文件 agentSend/cmd*(序3-d-1/9)/agentCollapse/setAppMode(序3-d-6);
   Agent 技能 chips 经 SeekerShell.renderAppChips() 契约触发(序3-d-11,第16轮强制待契约化账已清——平台不硬编码 app 渲染器符号名)。INIT@agentInit() 运行时调。 ---- */
function agentInit(){
  $('#agentSend').innerHTML=IC.arrow; $('#agentSend').onclick=()=>agentSend();
  const inp=$('#agentInput');
  inp.addEventListener('keydown',e=>{
    if(cmdIsOpen()){
      if(e.key==='ArrowDown'){e.preventDefault();cmdActive=(cmdActive+1)%cmdFiltered.length;cmdRender();return;}
      if(e.key==='ArrowUp'){e.preventDefault();cmdActive=(cmdActive-1+cmdFiltered.length)%cmdFiltered.length;cmdRender();return;}
      if(e.key==='Enter'){e.preventDefault();cmdRun(cmdActive);return;}
      /* Esc 关命令浮层 → SeekerKeys Esc 逐层链 */
    }
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();agentSend();}
  });
  inp.addEventListener('input',()=>{inp.style.height='auto';inp.style.height=Math.min(120,inp.scrollHeight)+'px';const v=inp.value;if(v.charAt(0)==='/')cmdOpen(v.slice(1));else cmdClose();});
  inp.addEventListener('blur',()=>setTimeout(cmdClose,120));
  window.SeekerShell.renderAppChips();   // 命令 chips(双语,随语言重渲)经 renderAppChips 契约(序3-d-11;第16轮强制待契约化账已清——平台不再硬编码 renderAgentCmds 符号名)
  const ct=$('#agentCanvasToggle'); if(ct) ct.onclick=agentCollapse;
  let m='editor'; try{m=localStorage.getItem('jh-mode')||'editor';}catch(e){}
  setAppMode(m);
}

/* ---- 抽壳序3-d-12:Copilot/Agent chrome 语言切换重渲 updateAgentChrome/updateCopChrome —— nav.js setLang 运行时调;
   依赖 $/T/tt(序1)+ SeekerShell.renderAppChips 契约(序3-d-11);纯平台。 ---- */
function updateAgentChrome(){
  const s=$('#agentChat .ah-s'); if(s)s.textContent=T('agentSub');
  const ct=$('#agentCanvasToggle'); if(ct)ct.textContent=T('collapseCanvas');
  const ip=$('#agentInput'); if(ip)ip.placeholder=T('agentPh');
  window.SeekerShell.renderAppChips();   // 命令 chips 双语,随语言重渲(含 ac-label)经 renderAppChips 契约(序3-d-11;第16轮强制待契约化账已清——平台不再硬编码 renderAgentCmds)
}
// Copilot chrome 随语言切换(评审 P0-5:浮钮/头/placeholder 此前静态 HTML、切 EN 仍中文)。
function updateCopChrome(){
  const cl=$('#copLaunch'); if(cl) cl.innerHTML='<span class="ld"></span>'+tt('问问 AI · ⌘K','Ask AI · ⌘K');
  const hs=$('#copPanel .hs'); if(hs) hs.textContent=tt('· 用一句话指挥整个工作台','· Command the whole workbench in one line');
  const ci=$('#copInput'); if(ci) ci.placeholder=tt('试试:我现在最该做什么?','Try: what should I do next?');
}
