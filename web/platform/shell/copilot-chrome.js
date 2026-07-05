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
