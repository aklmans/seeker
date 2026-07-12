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
import { normSkill, skillRunnable, skillNeedsReview } from './skill-model.js'; // ★Skills S2:运行 Skill = 归一后 prompt 走 agentSend(标准用户消息路径);I1:导入未审阅双点拒
import { listSkills } from './skill-store.js'; // ★Skills S2b:命令面板读同步缓存(skill-store 不 import 本文件 ⇒ 无环)

// ★AI-Native 收敛(Cut 1b):Copilot 浮窗删。copClose/copScroll 保留为收敛后语义 —— jobseek 的 copMatch/copInterview/copPlan/copResume/copNewJob/copNewAction/copMarket/copResumeUpload 8 处仍调 copClose、copDoneAct 调 copScroll,保这两个薄导出免改业务文件:
//   copClose = 无操作(无浮窗可关;各函数的导航/执行部分照常);copScroll = 滚动 Agent 视图(唯一活动 AI 面)。copEl/copOpen/copToggle/copAppend 已删(浮窗专属、零外部消费者)。
export function copClose(){}
export function copScroll(){ const m=$('#agentMsgs'); if(m) m.scrollTop=m.scrollHeight; }
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
// 委派处理器解析(P2 → 批11B cActions 契约化收官)。
// 原先「CACT_ALLOWED 名单 Set + window[name] 取函数」;现在 CACT_OWN(平台自有 copGo/agentCancel)∪ SeekerShell.cActions()(各 manifest 声明之并集,§1 不再硬编码 jobseek 名)。
// ★精确记账(第48轮[建议]):gadget(data-cact="eval")与原型名(data-cact="toString")旧代码 **CACT_ALLOWED.has(name) 本就已挡** —— Set.has 精确成员判定、不走原型链;
//   故本刀价值**不是**新关这两面,而是:
//   ① §1 契约化:jobseek 名从平台硬编码 Set → manifest 声明(本刀主目的);
//   ② 删掉 window[name] 派发原语 + 随之删 13 window 桥(纵深:不再保留一个"能被任意注入面复用的按名调全局函数"机制);
//   ③ ★DOM 具名访问遮蔽免疫(第41轮判据)= **删桥的必要前提**:window[name] 在桥删后会被同名 `id=` 元素顶替(window.copMatch 变元素、处理器静默失效),改查表才能安全删桥;
//   ④ null 原型的**必要性**:新机制改用**对象查表**,`{}` 会让 data-cact="toString" 命中 Object.prototype.toString(旧 Set.has 无此面)→ 故 CACT_OWN 与 cActions() 均 Object.create(null),把新机制引入的面堵回、net 不退化。
// ★★不变式(第44轮[应改]修,随契约搬到契约面 types.d.ts / registry.cActions):
//   **登记表里不得有任何处理器把 data-cargs 参数反射进 innerHTML / eval / Function / setTimeout(串)**——
//   `agentChat(html)` 正是不转义的 innerHTML sink(设计上收 HTML),登记即重开「二次 innerHTML」放大面(评审 PoC:data-cargs 里的 <img onerror> 真执行);
//   故 agentChat **不登记**;其唯一 cAB 调用点(固定串)走无参包装 agentBackupContinue(同 agentCancel 先例)。
//   ⚠ 新增登记项前自检:该处理器的任一参数是否会流进上述 sink?是 → 改无参包装或先转义。
const CACT_OWN=Object.assign(Object.create(null),{copGo, agentCancel});   // 平台自有(hoisted 函数声明);应用的经契约取
function cactHandler(name){
  if(typeof name!=='string' || !name) return undefined;
  const own=CACT_OWN[name]; if(typeof own==='function') return own;
  const fn=window.SeekerShell.cActions()[name];   // 每次点击重取 → 应用开关/排序即时生效
  return typeof fn==='function' ? fn : undefined;
}
// 事件委派(P1):[data-cact]→已登记处理器(...JSON args)、[data-csugg]→agentSend(值)。名过登记表、args/值按值传 → onclick 注入类从根消除。
document.addEventListener('click', (e)=>{
  const t=e.target; if(!t || !t.closest) return;
  const ab=t.closest('[data-cact]');
  if(ab){ const fn=cactHandler(ab.getAttribute('data-cact')); if(fn){ let args=[]; try{ args=JSON.parse(ab.getAttribute('data-cargs')||'[]'); }catch(_e){} fn(...args); } return; }
  const sg=t.closest('[data-csugg]');
  if(sg) agentSend(sg.getAttribute('data-csugg'));   // ★Cut 1b:建议 chips 收敛到 agentSend(Copilot 浮窗删)
});

/* ---- ★Cut 1b:copSend 删 —— Copilot 浮窗发送核心已收敛,所有发送走 agentSend(序3-d-1,红线转义在 agentSend 内逐字保留);cSuggs 委派与 copInit 原两个调用点已改/删。 ---- */

export function agentAppend(role,html){const d=el(`<div class="cop-msg ${role}">${html}</div>`);$('#agentMsgs').appendChild(d);const c=$('#agentMsgs');c.scrollTop=c.scrollHeight;return d;}
// scopeTools(★Skills F1):Skill.tools 三态 → streamReply 收窄 app-tool 工具表(减权;undefined=全、雏形/打字零回归)。见 runSkill。
export function agentSend(text, aiText, scopeTools){
  const inp=$('#agentInput'); text=(text||inp.value||'').trim(); if(!text)return;
  inp.value=''; inp.style.height='auto';
  agentAppend('user', text.replace(/</g,'&lt;')); persistMsg('agent','user',text);
  const think=agentAppend('ai','<div class="cop-think"><span class="ai-dots"><i></i><i></i><i></i></span>思考中…</div>');
  const toAI = aiText || window.SeekerShell.frameQuery(text); // 壳框定链(启用应用的 framer;jobseek 注入现 frameQuery):显示短文案、发给 AI 框定版
  if(aiChatAvailable()){ streamReply(think, toAI, 'Agent', agentScroll, scopeTools); }
  else setTimeout(()=>{think.remove(); agentAppend('ai','<span class="who">Agent</span>'+window.SeekerShell.appReply(text));}, 680+Math.random()*420);
}

/* ★Skills S2:运行一枚 Skill —— 归一后 prompt 走 agentSend(标准用户消息路径 → streamReply → ai_chat)。
   ★★红线由**同一代码路径**结构性继承(非另造):skill.prompt 与用户打字走完全相同的 agentSend
   (内含 `<` 转义显示 + frameQuery 框定)→ ai_chat 的 D3 闸 / profile 结构不可达 / 破坏性走 guardrail /
   设置不可经对话改 全部照常。**Skill 不给新权力 = 把用户本就能打的那句指令一键重放。**
   ★信任=可信侧(本地用户自撰指令,同用户在输入框打字),**不走 untrusted 框定**。
   ★skillRunnable 守卫:无指令正文(草稿态)不运行(fail-safe,skill-model 单测覆盖)。 */
export function runSkill(skill){
  const s=normSkill(skill);
  if(!skillRunnable(s)) return;          // 无指令正文 → 不运行(草稿态)
  // ★I1 fail-closed 双点拒之一:导入未审阅 → 不运行(untrusted-until-reviewed;第三方指令须经审阅门背书)。
  //   UI 全路由到审阅门(管理面「审阅」按钮;palette 不列未审阅)⇒ 此守卫是结构性兜底、防未来新调用点旁路。
  if(skillNeedsReview(s)) return;
  agentCollapse();                        // 收起页面画布 → 全屏对话,聚焦到 Agent 看它运行
  // ★Skills F1(工具 scoping):穿 s.tools(normSkill 保三态)→ agentSend → streamReply 收窄 app-tool 工具表。
  //   减权不增权(⊆ 可读集);未声明(undefined)= 全工具(同用户打字重放,雏形零回归)。
  agentSend(s.prompt, undefined, s.tools);
}

/* ★Skills S2b:命令面板契约 platformSkills() —— 平台级 Skills 命令项(CommandSpec[])。
   ★不并 appCommands(第79轮拍板③):平台级 vs 应用级两条独立契约;cmdFilterList 各自收集、附加合并显示。
   仅**可运行**的 Skill(有指令正文)入面板;点击 run → runSkill(走 agentSend 标准路径、红线结构性继承)。
   读 skill-store 同步缓存(命令面板同步;缓存由 boot 水合 + CRUD 更新保持新鲜)。 */
export function platformSkills(){
  // ★I1 fail-closed 双点拒之二:导入未审阅**完全不列**(第92轮预裁④:palette 只列可运行;审阅走能力中心管理面)。
  return listSkills().filter((s)=>skillRunnable(s)&&!skillNeedsReview(s)).map(s=>({
    cmd: '⚡',                                                      // Skill 标记(区别于 /命令);label 用用户自撰名
    label: [s.name||tt('未命名技能','Untitled skill'), s.name||tt('未命名技能','Untitled skill')],
    desc: s.description ? [s.description, s.description] : ['运行技能', 'Run skill'],
    run: ()=>runSkill(s),
  }));
}

/* ---- ★Cut 1b:copInit 删 —— Copilot 浮窗(copLaunch/copClose/copSend/copInput)+ 其开场白已随浮窗删除;Agent 窗口的接线在 agentInit、招呼语在 agentGreet(经 greeting('agent') 契约)。greeting('copilot')/copGreet 现无消费者(留作契约完整性 · 后续 P0 可清)。 ---- */

/* ---- 辅助 chrome —— copGo(导航)/ agentChat(追加到 Agent 视图)/ agentCancel/ aiChatAvailable/ agentScroll。 ---- */
export function copGo(id){go(id);}   // ★Cut 1b:原 copClose()+go;浮窗删后 = 纯导航(agent 模式下 go→agentShowCanvas 切 split 展示页面)
export function agentChat(html){ agentAppend('ai','<span class="who">Agent</span>'+html); }   // ★Cut 1b:appMode 恒 agent → 恒 agentAppend(去 copAppend 分支)
export function agentCancel(){ agentChat('好的,已取消,什么都没动。'); }
export function aiChatAvailable(){ return typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT; }
export function agentScroll(){ const c=$('#agentMsgs'); if(c) c.scrollTop=c.scrollHeight; }

/* ---- 抽壳序3-d-6:Agent 模式群 —— appMode/appReady 状态 + renderModeSwitch/setAppMode/agentShowCanvas/agentCollapse/agentGreet。
   依赖 $/$$/T(序1)+ 本文件 copClose/agentAppend(序3-a/3-d-1)+ document.body/localStorage(运行时);appMode 与其消费者 copSend/agentChat 同文件。
   ★agentGreet 经 SeekerShell.greeting('agent') 契约取应用招呼语(3.y 尾清账);T('agentGreet')=中性平台回退串(不名应用功能)。
   initShell(壳启动非 chrome)留 index.html——归属另判(评审后续关注)。 ---- */
let appMode='agent';                                  // ★AI-Native 收敛(Cut 1a):Agent 是唯一框、appMode 恒 'agent'(编辑器模式删)。仍经 getAppMode() 读;setAppMode/renderModeSwitch 已成死导出、待 1b 清
let appReady=false;                                   // 模块私有;★不上桥(外部写@index INIT appReady=true)——外部写经 setAppReady()
export function getAppMode(){ return appMode; }       // ★getter:appMode 内部写(setAppMode)/外部读(index keys)→ live 读、无快照分裂
export function setAppReady(v){ appReady=v; }         // ★setter:appReady 外部写(index INIT)/内部读(agentShowCanvas)→ 单一写入口(reassigned+外部写者子模式)
/* ★Cut 1b:renderModeSwitch + setAppMode 删 —— 编辑器/Agent 并列模式已删(1a)、二者零消费者(modeSwitch DOM 删、Mod+\ 删、agentInit boot 直设 dataset)。appMode 恒 'agent'(let 从不重赋 → 实为常量;getAppMode 仍读)。 */
export function agentShowCanvas(){ if(appReady && appMode==='agent') document.body.dataset.agent='split'; }
export function agentCollapse(){ document.body.dataset.agent='centered'; }
export function agentGreet(){
  // §1 文案归属(3.y 尾 greeting 契约):经 SeekerShell.greeting('agent') 取应用招呼语,未命中回退中性平台串 T('agentGreet')。
  agentAppend('ai','<span class="who">Agent</span>'+(window.SeekerShell.greeting('agent')||T('agentGreet')));
}

/* ---- 抽壳序3-d-9:Agent /命令面板机制(通用) —— cmdActive/cmdFiltered 状态 + cmdIsOpen/cmdFilterList/cmdRender/cmdOpen/cmdClose/cmdRun。
   命令数据经 SeekerShell.appCommands()(序3-d-7 契约,平台零 jobseek 命令 knowledge);依赖 $/$$/tt(序1)+ #cmdPop/#agentInput;agentInit(序3-d-10)运行时接线。 ---- */
let cmdActive=0, cmdFiltered=[];
export function cmdIsOpen(){const p=$('#cmdPop');return p&&p.classList.contains('open');}
export function cmdFilterList(q){q=(q||'').toLowerCase().trim();const A=window.SeekerShell.appCommands().concat(platformSkills());if(!q)return A;return A.filter(c=>c.cmd.toLowerCase().includes(q)||c.label.some(x=>x.toLowerCase().includes(q))||c.desc.some(x=>x.toLowerCase().includes(q)));}
export function cmdRender(){
  const pop=$('#cmdPop');
  // ★§4-4:cmd/label/desc 经 el(innerHTML) 渲染 → cEsc(Skills 命令项的 name/desc 是用户数据;app 命令硬编码文案 cEsc 为 no-op、零回归)。
  pop.innerHTML=`<div class="cmd-hint">${tt('命令 · ↑↓ 选择 · Enter 执行 · Esc 关闭','Commands · ↑↓ select · Enter run · Esc close')}</div>`+cmdFiltered.map((c,i)=>`<div class="cmd-row ${i===cmdActive?'active':''}" data-ci="${i}"><span class="cc">${cEsc(c.cmd)}</span><span class="cl">${cEsc(tt(c.label[0],c.label[1]))}</span><span class="cd">${cEsc(tt(c.desc[0],c.desc[1]))}</span></div>`).join('');
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
  const bp=$('#acvBackToPage'); if(bp) bp.onclick=()=>{ document.body.dataset.canvas='page'; };   // ★AI-Native P0:画布「回到页面」→ 让位给 #content(show_widget 画布退)
  // ★AI-Native 收敛(Cut 1a):Agent 是唯一框,boot 直接进 agent + centered(删「编辑器」模式、不再读/写 jh-mode、不经 setAppMode)。
  // centered = 全屏对话;导航到页面/出 widget 时 go→agentShowCanvas 切 split(页面即右画布)。历史由 hydrateMessages 清招呼语后重渲。
  document.body.dataset.appmode='agent';
  document.body.dataset.agent='centered';
  if(!$('#agentMsgs').children.length) agentGreet();
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
    // ★Cut 1b:收敛后只恢复 agent 历史(Copilot 浮窗删、旧 'cop' 历史弃用=数据保留不删、不再读写)。有历史则清掉招呼语再渲染(#agentMsgs 有子节点即已由本函数或 agentGreet 处理)。
    const agent = rows.filter(r=>r.surface==='agent');
    if(agent.length){ const c=$('#agentMsgs'); if(c){ c.innerHTML=''; draw(agent, agentAppend, 'Agent'); } }
  }catch(e){ console.error('[data] hydrate messages', e); }
}
/* ★批11B(cActions 契约):copGo/agentCancel 桥已摘 —— 委派不再 window[name],改查 CACT_OWN(平台自有)∪ SeekerShell.cActions()(应用并集)。
   本文件 window 桥清零;copGo 的其余消费者(cards/copilot-actions)走 import,agentCancel 仅经 cAB 名到达。
   ★有状态不上桥:appMode(reassigned→getAppMode 读)、appReady(外部写→setAppReady)、cmdActive/cmdFiltered/CACT_OWN(内部私有)。
   cEsc/cCard/cAct/cAB/cSuggs = apps copReply 卡模板消费的导出(§4-4 转义纪律随迁)。 */