// @ts-nocheck —— 3.y 步3 中层:Copilot/Agent 面板机制 classic 全局 → ES module(export)+ 过渡 window 桥。逻辑逐字节。
/** 平台 · Copilot 面板机制 copEl/copOpen/copClose/copToggle/copScroll/copAppend + UI 模板 cCard/cAct/cBtn/cSuggs。
 *  依赖 $/el;cSuggs onclick 调 copSend(序3-b)、cBtn onclick 字符串(运行时);jobseek 专属响应(aiSuggs/copMatch/copReply)留 index.html/apps。
 *  挂全局 + 载序前置(在序1/序2 后;消费者运行时调)→ 零回归(约束⑤)。
 *  ★批10c(第42轮[应改]订正):streamReply 改 import(ai-engine 转 module、其桥不设);本文件 tag 实测 @874 晚于 ai-engine@869 → 此 import 边无提升;载序判据见 ai-engine.js 头注释(查提前区间,非比 tag 先后)。 */
import { streamReply } from './ai-engine.js';
import { aiHTML } from './ai-render.js';
import { collPersistOn, persistMsg } from './data-store.js';
import { $, $$, el } from './dom.js';
import { T, tt } from './i18n.js';
import { IC } from './icons.js';
import { go } from './nav.js';
import { isDesktop } from './shell-keys.js';

export function copEl(){return $('#copPanel');}
export function copOpen(){copEl().classList.add('open'); setTimeout(()=>$('#copInput').focus(),260);}
export function copClose(){copEl().classList.remove('open');}
export function copToggle(){copEl().classList.contains('open')?copClose():copOpen();}
export function copScroll(){const m=$('#copMsgs'); m.scrollTop=m.scrollHeight;}
export function copAppend(role, html){const d=el(`<div class="cop-msg ${role}">${html}</div>`); $('#copMsgs').appendChild(d); copScroll(); return d;}
// ★★§4-4 转义纪律(P1 审计刀):Copilot/Agent 面板经 el(innerHTML) 渲染、CSP unsafe-inline 无兜底 → 转义是唯一防线。
// cEsc:HTML 文本 + 属性上下文转义(外部/业务数据 job.co/sk.name 等[JD 抽取=Untrusted]进 DOM 前一律过)。
export const cEsc=(s)=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// cCard/cAct 是纯模板(内容拼装);调用方须先 cEsc 外部数据(见 copReply)。
export const cCard=(t,m)=>`<div class="cop-card"><div class="cct">${t}</div>${m?`<div class="ccm">${m}</div>`:''}</div>`;
export const cAct=(arr)=>arr.length?`<div class="cop-actions">${arr.join('')}</div>`:'';
/* ★批11A:cBtn(内联 onclick JS 串模板)已删——18 处调用全部迁 cAB(白名单委派、外部数据永不拼进 JS 串);此后新增按钮一律 cAB。 */
// cAB(action-button · P1 结构性修):fn=window 上函数名(静态、开发者控制),args=参数数组(可含外部数据)→ JSON 存 data-cargs、
// 点击时经委派**按值传参**调用,外部数据**永不拼进 JS/HTML 串** → 从根消除 onclick 注入类(优于脆弱引号转义)。label 经 cEsc。
export const cAB=(l,fn,args,acc)=>`<button class="btn ${acc?'btn-accent':''}" data-cact="${cEsc(fn)}" data-cargs="${cEsc(JSON.stringify(args||[]))}">${cEsc(l)}</button>`;
export const cSuggs=(arr)=>`<div class="cop-sugg">${arr.map(s=>`<button data-csugg="${cEsc(s)}">${cEsc(s)}</button>`).join('')}</div>`;
// 委派白名单(P2 · 关放大器):data-cact 只允许派发**已登记的 cAB 处理器名**。委派 window[name](...) 本身是 gadget ——
// 任一未修 HTML 注入面若能落 <button data-cact="…">,不设防时可派发任意 window 函数,把 HTML 注入升级为 JS 执行 / 二次 innerHTML
// (★注意 copAppend/agentAppend 本身即 innerHTML sink、eval/Function 等更甚 → 前缀判定不够,必须精确白名单)。此表堵住升级面。
// ⚠ 新增 cAB 处理器时须在此登记(与 copReply 的 cAB('…',fn,…) 一一对应)。
// ★批11A:cBtn→cAB 迁移新增名(agentCancel/copGo=chrome 自有;copNewJob/copNewAction/copMarket/copResumeUpload/agentBackupContinue=jobseek,§1 名单债随批11B cActions 契约化清)。
// ★★第44轮[应改]修 · 不变式:**白名单里不得有任何处理器把 data-cargs 参数反射进 innerHTML**——`agentChat(html)` 正是不转义的 innerHTML sink(设计上收 HTML),
//   入白名单则委派按值把 data-cargs 传进 sink = 重开上方注释点名要防的「二次 innerHTML」放大面(评审 PoC:data-cargs 里的 <img onerror> 真执行)。
//   故 agentChat **不入白名单**;其唯一 cAB 调用点(固定串)改走无参包装 agentBackupContinue(同 agentCancel 先例)。
//   ⚠ 新增白名单项前自检:该处理器的任一参数是否会流进 innerHTML / eval / Function / setTimeout(串)?是 → 改无参包装或先转义。
const CACT_ALLOWED=new Set(['agentDeleteJob','copDoneAct','copInterview','copMatch','copPlan','copResume','agentCancel','agentBackupContinue','copGo','copNewJob','copNewAction','copMarket','copResumeUpload']);
// 事件委派(P1):[data-cact]→window[fn](...JSON args)、[data-csugg]→copSend(值)。fn 过白名单、args/值按值传 → onclick/copSend 注入类从根消除。
document.addEventListener('click', (e)=>{
  const t=e.target; if(!t || !t.closest) return;
  const ab=t.closest('[data-cact]');
  if(ab){ const name=ab.getAttribute('data-cact'); if(CACT_ALLOWED.has(name)){ let args=[]; try{ args=JSON.parse(ab.getAttribute('data-cargs')||'[]'); }catch(_e){} const fn=window[name]; if(typeof fn==='function') fn(...args); } return; }
  const sg=t.closest('[data-csugg]');
  if(sg) copSend(sg.getAttribute('data-csugg'));
});

/* ---- 抽壳序3-d-1:Copilot/Agent 发送核心(红线:用户输入进 DOM 前 text.replace(/</g,&lt;) 转义逐字保留;frameQuery→streamReply|appReply 链) ---- */
export function copSend(text, aiText){
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

export function agentAppend(role,html){const d=el(`<div class="cop-msg ${role}">${html}</div>`);$('#agentMsgs').appendChild(d);const c=$('#agentMsgs');c.scrollTop=c.scrollHeight;return d;}
export function agentSend(text, aiText){
  const inp=$('#agentInput'); text=(text||inp.value||'').trim(); if(!text)return;
  inp.value=''; inp.style.height='auto';
  agentAppend('user', text.replace(/</g,'&lt;')); persistMsg('agent','user',text);
  const think=agentAppend('ai','<div class="cop-think"><span class="ai-dots"><i></i><i></i><i></i></span>思考中…</div>');
  const toAI = aiText || window.SeekerShell.frameQuery(text); // 壳框定链(启用应用的 framer;jobseek 注入现 frameQuery):显示短文案、发给 AI 框定版
  if(aiChatAvailable()){ streamReply(think, toAI, 'Agent', agentScroll); }
  else setTimeout(()=>{think.remove(); agentAppend('ai','<span class="who">Agent</span>'+window.SeekerShell.appReply(text));}, 680+Math.random()*420);
}

/* ---- 抽壳序3-d-3:Copilot 面板初始化 copInit —— 依赖 $/IC(序1)+ 本文件 copToggle/copClose/copSend/copAppend/cSuggs;开场建议经 SeekerShell.appSuggs 契约(序3-d-2),不再直调 jobseek aiSuggs。⚠开场白文案仍 jobseek 味 = 过渡债(同 agentGreet 的 T('agentGreet')/i18n 表),待后续契约化清 ---- */
export function copInit(){
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
export function copGo(id){copClose();go(id);}
export function agentChat(html){ (appMode==='agent'?agentAppend:copAppend)('ai','<span class="who">Agent</span>'+html); }
export function agentCancel(){ agentChat('好的,已取消,什么都没动。'); }
export function aiChatAvailable(){ return typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT; }
export function agentScroll(){ const c=$('#agentMsgs'); if(c) c.scrollTop=c.scrollHeight; }

/* ---- 抽壳序3-d-6:Agent 模式群 —— appMode/appReady 状态 + renderModeSwitch/setAppMode/agentShowCanvas/agentCollapse/agentGreet。
   依赖 $/$$/T(序1)+ 本文件 copClose/agentAppend(序3-a/3-d-1)+ document.body/localStorage(运行时);appMode 与其消费者 copSend/agentChat 同文件。
   ⚠ agentGreet 用 T('agentGreet')=平台 i18n 的 jobseek 味开场白(文案归属待清账,同 copInit,3.y manifest.greeting 清)。
   initShell(壳启动非 chrome)留 index.html——归属另判(评审后续关注)。 ---- */
let appMode='editor';                                 // 模块私有;★不上桥(reassigned@setAppMode)——外部读经 getAppMode()
let appReady=false;                                   // 模块私有;★不上桥(外部写@index INIT appReady=true)——外部写经 setAppReady()
export function getAppMode(){ return appMode; }       // ★getter:appMode 内部写(setAppMode)/外部读(index keys)→ live 读、无快照分裂
export function setAppReady(v){ appReady=v; }         // ★setter:appReady 外部写(index INIT)/内部读(agentShowCanvas)→ 单一写入口(reassigned+外部写者子模式)
export function renderModeSwitch(){
  const ms=$('#modeSwitch'); if(!ms)return;
  ms.innerHTML=`<button class="${appMode==='agent'?'on':''}" data-am="agent">Agent</button><button class="${appMode==='editor'?'on':''}" data-am="editor">${T('editor')}</button>`;
  $$('#modeSwitch button').forEach(b=>b.onclick=()=>setAppMode(b.dataset.am));
}
export function setAppMode(m){
  const prev=appMode; appMode=m; document.body.dataset.appmode=m;
  if(m==='agent'){ try{ copClose(); }catch(_e){} } // 进 agent 模式关掉浮窗(launcher 已隐藏,统一为 agent 视图唯一 AI 面)
  if(m==='agent'&&prev!=='agent') document.body.dataset.agent='centered';
  renderModeSwitch();
  try{localStorage.setItem('jh-mode',m);}catch(e){}
  if(m==='agent' && !$('#agentMsgs').children.length) agentGreet();
}
export function agentShowCanvas(){ if(appReady && appMode==='agent') document.body.dataset.agent='split'; }
export function agentCollapse(){ document.body.dataset.agent='centered'; }
export function agentGreet(){
  agentAppend('ai','<span class="who">Agent</span>'+T('agentGreet'));
}

/* ---- 抽壳序3-d-9:Agent /命令面板机制(通用) —— cmdActive/cmdFiltered 状态 + cmdIsOpen/cmdFilterList/cmdRender/cmdOpen/cmdClose/cmdRun。
   命令数据经 SeekerShell.appCommands()(序3-d-7 契约,平台零 jobseek 命令 knowledge);依赖 $/$$/tt(序1)+ #cmdPop/#agentInput;agentInit(序3-d-10)运行时接线。 ---- */
let cmdActive=0, cmdFiltered=[];
export function cmdIsOpen(){const p=$('#cmdPop');return p&&p.classList.contains('open');}
export function cmdFilterList(q){q=(q||'').toLowerCase().trim();const A=window.SeekerShell.appCommands();if(!q)return A.slice();return A.filter(c=>c.cmd.toLowerCase().includes(q)||c.label.some(x=>x.toLowerCase().includes(q))||c.desc.some(x=>x.toLowerCase().includes(q)));}
export function cmdRender(){
  const pop=$('#cmdPop');
  pop.innerHTML=`<div class="cmd-hint">${tt('命令 · ↑↓ 选择 · Enter 执行 · Esc 关闭','Commands · ↑↓ select · Enter run · Esc close')}</div>`+cmdFiltered.map((c,i)=>`<div class="cmd-row ${i===cmdActive?'active':''}" data-ci="${i}"><span class="cc">${c.cmd}</span><span class="cl">${tt(c.label[0],c.label[1])}</span><span class="cd">${tt(c.desc[0],c.desc[1])}</span></div>`).join('');
  $$('#cmdPop [data-ci]').forEach(r=>r.onmousedown=(e)=>{e.preventDefault();cmdRun(+r.dataset.ci);});
}
export function cmdOpen(q){cmdFiltered=cmdFilterList(q);cmdActive=0;if(cmdFiltered.length){cmdRender();$('#cmdPop').classList.add('open');}else cmdClose();}
export function cmdClose(){const p=$('#cmdPop');if(p)p.classList.remove('open');}
export function cmdRun(i){const c=cmdFiltered[i];if(!c)return;$('#agentInput').value='';$('#agentInput').style.height='auto';cmdClose();c.run();}

/* ---- 抽壳序3-d-10:Agent 输入 + 命令面板接线 agentInit —— 依赖 $/IC(序1)+ 本文件 agentSend/cmd*(序3-d-1/9)/agentCollapse/setAppMode(序3-d-6);
   Agent 技能 chips 经 SeekerShell.renderAppChips() 契约触发(序3-d-11,第16轮强制待契约化账已清——平台不硬编码 app 渲染器符号名)。INIT@agentInit() 运行时调。 ---- */
export function agentInit(){
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
export function updateAgentChrome(){
  const s=$('#agentChat .ah-s'); if(s)s.textContent=T('agentSub');
  const ct=$('#agentCanvasToggle'); if(ct)ct.textContent=T('collapseCanvas');
  const ip=$('#agentInput'); if(ip)ip.placeholder=T('agentPh');
  window.SeekerShell.renderAppChips();   // 命令 chips 双语,随语言重渲(含 ac-label)经 renderAppChips 契约(序3-d-11;第16轮强制待契约化账已清——平台不再硬编码 renderAgentCmds)
}
// Copilot chrome 随语言切换(评审 P0-5:浮钮/头/placeholder 此前静态 HTML、切 EN 仍中文)。
export function updateCopChrome(){
  const cl=$('#copLaunch'); if(cl) cl.innerHTML='<span class="ld"></span>'+tt('问问 AI · ⌘K','Ask AI · ⌘K');
  const hs=$('#copPanel .hs'); if(hs) hs.textContent=tt('· 用一句话指挥整个工作台','· Command the whole workbench in one line');
  const ci=$('#copInput'); if(ci) ci.placeholder=tt('试试:我现在最该做什么?','Try: what should I do next?');
}

/* ---- 抽壳序3-d-13:对话历史恢复 hydrateMessages —— messages 是壳自持集合(D1),纯平台依赖:
   collPersistOn(序4-b)/rt.db/SeekerShell.cards() 契约/aiHTML(序1-f)/copAppend·agentAppend(序3-a/3-d-1)。
   ★红线保留:持久用户文本经 esc 转义再进 DOM、AI 文本经 aiHTML、持久卡经 CARDS[kind].persist&show 重渲(用实时数据)。
   jobseek hydrateBizColls(index.html)经 seeker-rt-ready 运行时调本函数。 ---- */
export async function hydrateMessages(){
  if(!collPersistOn()) return;
  try{
    const rows = await window.SeekerRT.db.list('messages');
    if(!rows.length) return; // 无历史:保留 copInit 招呼语 / 让 agentGreet 照常
    rows.sort((a,b)=>(a.ts||0)-(b.ts||0));
    const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const CARDS = window.SeekerShell.cards(); // 壳组合:启用应用贡献的卡注册表
    const draw = (rows, append, who) => { rows.forEach(r => {
      const bubble = append(r.role==='user'?'user':'ai',
        r.role==='user' ? esc(r.text) : ('<span class="who">'+who+'</span>'+aiHTML(r.text))); // AI 历史也渲染 Markdown
      if(r.role!=='user' && Array.isArray(r.cards)){ // 重渲持久化卡(用实时数据,卡保持新鲜;数据缺失则优雅跳过)
        for(const c of r.cards){ const def=c&&CARDS[c.kind]; if(def && def.persist && def.show){ try{ def.show(bubble, c.data||{}, who); }catch(_e){} } }
      }
    }); };
    const cop = rows.filter(r=>r.surface==='cop'), agent = rows.filter(r=>r.surface==='agent');
    // 有历史则清掉招呼语再渲染(#agentMsgs 有子节点后 setAppMode 不会再 agentGreet)
    if(cop.length){ const c=$('#copMsgs'); if(c){ c.innerHTML=''; draw(cop, copAppend, 'Copilot'); } }
    if(agent.length){ const c=$('#agentMsgs'); if(c){ c.innerHTML=''; draw(agent, agentAppend, 'Agent'); } }
  }catch(e){ console.error('[data] hydrate messages', e); }
}
/* 过渡 window 兼容桥:classic/module 消费者(index.html INIT/keys/onclick、nav setLang、apps copReply/cards 等)按全局名调不变;逐个改 import 后摘。
   ★有状态不上桥:appMode(reassigned→getAppMode 读)、appReady(外部写→setAppReady)、cmdActive/cmdFiltered/CACT_ALLOWED(内部私有)。
   cEsc/cCard/cAct/cBtn/cAB/cSuggs = apps copReply 卡模板消费的导出(§4-4 转义纪律随迁)。 */
/* ★批10d 账本终态:本行为白名单桥——(d) window-解析强制(内联 onclick·cBtn 串·CACT window[name]·aiErrHTML 的 go)或 §1 平台裸读(契约化批11);其余桥已全摘、消费者已 import。 */
window.copGo=copGo; window.agentCancel=agentCancel; 