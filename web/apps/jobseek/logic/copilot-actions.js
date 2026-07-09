// @ts-nocheck —— 抽壳序3-b 择取:jobseek 的 Copilot 业务响应;引用 chrome(copClose/copAppend/agentChat 序3)+jobseek(renderMatch/JOBS 等);类型化留 3.y;逻辑零改动。
/** jobseek · Copilot 业务响应 aiSuggs/copMatch群/agentDeleteJob/findX/copReply(第9轮裁定序3:chrome 批中 jobseek 专属部分择取到 apps)。
 *  从 COPILOT 段的 chrome(copGo/agentChat/agentCancel/copSend,留 index.html)间择出;copSend(chrome)运行时调 copReply(本文件)
 *  —— 过渡态跨全局,契约化(copSend 经 SeekerShell 调应用回复)留新轮。classic 全局;依赖见 ../monolith-globals.d.ts。 */
// 开场建议随数据态(评审 P0-6):零数据 → 引导上手(原"我和字节匹配吗"对新用户是死链);有数据 → 真实可用查询。EN 避撇号(cSuggs 内联 onclick)。
import { skillByName } from '../data-helpers.js';
import { ACTIONS, JOBS, TOP_GAPS, SKILLS } from '../data.js';
import { TREND, YOU_VALUE, genPlanFromGap, openNewAction, planFor, topGapsOf } from './intake-action.js';
import { openNewJob } from './intake-job.js';
import { openResumeUpload } from './resume-modals.js';
import { aiResumeForJob, goInterview, openMarketValue } from './job-actions.js';
import { matchState, renderMatch, runMatch } from './match.js';
import { renderActions } from '../pages/actions.js';
import { renderAnalysis } from '../pages/analysis.js';
import { renderJobs } from '../pages/jobs.js';
import { renderOverview } from '../pages/overview.js';
import { agentChat, agentSend, cAB, cAct, cCard, cEsc, cSuggs, copClose, copGo, copScroll } from '../../../platform/shell/copilot-chrome.js';
import { jobsPersistOn } from '../../../platform/shell/data-store.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { go } from '../../../platform/shell/nav.js';
import { PAGES } from '../../../platform/shell/shell-state.js';
import { toast, toastUndo } from '../../../platform/shell/toast.js';
export function aiSuggs(){
  return JOBS.length
    ? [tt('我最该投哪个岗位?','Which job fits me best?'), tt('我最大的能力缺口是什么?','What is my biggest skill gap?'), tt('帮我改简历','Help me tune my resume'), tt('我现在最该做什么?','What should I do next?')]
    : [tt('这个工具能帮我做什么?','What can this tool do for me?'), tt('我该从哪一步开始?','Where should I start?'), tt('你能读到我的哪些数据?','What data can you read?')];
}
// ★3.y 尾:AI 面板开场白(经 manifest.greeting 契约供平台 agentGreet/copInit;原硬编码在平台 copilot-chrome/i18n 表、jobseek 味清账归此)。
export function jobseekGreeting(mode){
  return mode==='agent'
    ? tt('嗨,我是你的求职 Agent。直接说需求,我来判断该做什么并执行 —— 匹配岗位、改简历、出面试题、排计划、查缺口都行,结果会显示在右侧画布。也可以点下面的技能快捷开始。',"Hi, I'm your job-hunt Agent. Just tell me what you need and I'll figure out what to do — match jobs, tailor your resume, run interview prep, plan training, find gaps — results show on the right canvas. Or tap a skill below.")
    : tt('嗨,我是你的求职 Copilot。用一句话就能指挥整个工作台 —— 匹配岗位、改简历、出面试题、排计划、查缺口都行。试试:',"Hi, I'm your job-hunt Copilot. Command the whole workbench in one line — match jobs, tune resumes, generate interview questions, plan training, find gaps. Try:");
}

export function copMatch(jobId){copClose();matchState.jobId=jobId;matchState.done=false;go('match');renderMatch();setTimeout(runMatch,260);}
export function copInterview(jobId){copClose();goInterview(jobId);}
export function copPlan(skill,jobLabel){genPlanFromGap(skill,jobLabel||'');renderActions();renderOverview();copClose();toast('已生成「'+cEsc(skill)+'」训练计划');go('actions');} // skill 可为 gap/技能名(JD 抽取=§4-4 Untrusted);toast 经 el(innerHTML)→ 须 cEsc,否则 cAB 只是把注入点从 onclick 移到此 toast
export function copResume(jobId){copClose();aiResumeForJob(jobId);}
export function copNewJob(){copClose();openNewJob();}
export function copNewAction(){copClose();openNewAction();}
export function copMarket(){copClose();openMarketValue();}
export function copResumeUpload(){copClose();openResumeUpload();}  // ★批11A:原 cBtn 复合串 'copClose();openResumeUpload()' 的包装(cAB 白名单按名调)
/* ★第44轮[应改]修:agentChat 是不转义 innerHTML sink,若入 CACT_ALLOWED 则委派把 data-cargs 反射进 innerHTML = 重开白名单注释点名要防的「二次 innerHTML」放大面(评审 PoC 实证)。
   本调用点本就只传固定串 → 仿 agentCancel 加无参包装,agentChat 从白名单移除;内部调用者(agentCancel/agentDeleteJob)走词法/import 调 agentChat 不受影响。 */
export function agentBackupContinue(){ agentChat('(演示)清空已拦截 —— 真实版本会在此二次确认并支持撤销。'); }
export function copDoneAct(id){const a=ACTIONS.find(x=>x.id===id);if(a){const prev={state:a.state,progress:a.progress};a.state='done';a.progress=100;renderActions();renderOverview();toastUndo('已标记完成 ✓',()=>{a.state=prev.state;a.progress=prev.progress;renderActions();renderOverview();});}copScroll();}

export function agentDeleteJob(id){
  const idx=JOBS.findIndex(j=>j.id===id); if(idx<0){agentChat('没找到这个岗位。');return;}
  const job=JOBS[idx]; JOBS.splice(idx,1);
  const persist=jobsPersistOn();
  if(persist) window.SeekerRT.db.remove('jobs', String(id)).catch(e=>console.error('[data] remove job', e));
  renderJobs(); renderOverview(); renderAnalysis(); renderMatch();
  const jesc=(/** @type {any} */ s)=>String(s==null?'':s).replace(/</g,'&lt;'); // job.co/job.role = JD 抽取外部内容(§4-4 Untrusted),进 DOM 前转义
  agentChat('已删除「'+jesc(job.co)+' · '+jesc(job.role.split('·')[0].trim())+'」。改主意了可以点撤销。'); // 第23轮[应改]同根修(agentChat 亦经 el/innerHTML,复审冒烟坐实此第二 sink)
  toastUndo('已删除「'+jesc(job.co)+'」',()=>{ // 第23轮[应改]:job.co 可为 JD 抽取的外部内容(Untrusted),toast 经 el(innerHTML) 渲染须转义
    JOBS.splice(idx,0,job);
    if(persist) window.SeekerRT.db.upsert('jobs', job).catch(e=>console.error('[data] restore job', e));
    renderJobs();renderOverview();renderAnalysis();renderMatch();
  });
}

function findJob(t){return JOBS.find(j=>t.includes(j.co))||JOBS.find(j=>t.includes(j.co.slice(0,2)));}
function findSkill(t){return [...SKILLS].sort((a,b)=>b.name.length-a.name.length).find(s=>t.includes(s.name));}
function findAction(t){return ACTIONS.find(a=>{const k=a.title.replace(/[·\s]/g,'');return [...k].some(()=>false)|| a.title.split(/[·\s]/).some(w=>w.length>1&&t.includes(w))|| (a.cap&&t.includes(a.cap));});}

export function copReply(t){
  const has=(...ws)=>ws.some(w=>t.includes(w));
  const j=findJob(t), sk=findSkill(t);
  // 0. destructive → preview + confirm (anti-anxiety guardrail)
  if(has('删除','删掉','移除','去掉')&&j&&has('岗位','公司','它','这个','删'))
    return `确认删除岗位 <b>${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}</b>?它会从列表移除 —— 这一步可撤销,不会真正丢失。`+cAct([cAB('确认删除','agentDeleteJob',[j.id],true), cAB('取消','agentCancel',[])]);
  if(has('清空','清除所有','重置全部','删光','全部删'))
    return `你要清空<b>所有数据</b>(岗位 / 简历 / 记录)?这是个大动作。建议先在「数据设置 → DATA」导出备份再操作。`+cAct([cAB('我已备份,继续','agentBackupContinue',[]), cAB('取消','agentCancel',[])]);
  // 0b. settings changes are NOT allowed via chat (privacy/security) — only open
  const tlow=t.toLowerCase();
  if(has('改','设为','调成','修改','调整','设成','换成','配置成')&&(has('设置','主题','字号','模型配置','隐私','权重','偏好','界面语言','密度','钥匙','密钥','接口','协议','base')||tlow.includes('api')||tlow.includes('key')||tlow.includes('token')||tlow.includes('url')))
    return '出于隐私与安全,设置不能通过对话修改 —— 这类信息(尤其 API Key、隐私字段)只在「数据设置」里手动改。我可以帮你打开那个页面。'+cAct([cAB('打开数据设置','copGo',['settings'],true)]);
  // 1. resume upload / build
  if(has('上传简历','建档','解析简历')) return '好,简历是整个产品的输入源。'+cAct([cAB('上传简历,AI 自动建档','copResumeUpload',[],true)]);
  // 2. resume rewrite
  if(has('简历')&&has('改','定制','优化','改写','重写')){
    if(j) return `我用 <b>${cEsc(j.co)}</b> 这个岗位的 JD 给你定制简历,把"做过什么"改成"拿到什么结果"。`+cAct([cAB('生成定制简历','copResume',[j.id],true)]);
    return '想针对哪个岗位改简历?告诉我公司名,比如"帮我改字节那个岗位的简历"。'+cAct([cAB('打开智能匹配','copGo',['match'])]);
  }
  // 3. match
  if(has('匹配','合适','对得上','配得上','能投','行不行')&&j){
    const pct=Math.round(j.match*10); const gaps=topGapsOf(j); const strong=j.need.filter(n=>{const s=skillByName(n);return s&&s.lvl>=3;}).length;
    return `已分析你与 <b>${cEsc(j.co)} · ${cEsc(j.role.split('·')[0].trim())}</b> 的匹配:`+
      cCard(`综合匹配度 ${pct} / 100`, `已具备 ${strong} 项硬性要求,可补充 ${gaps.length} 项:${gaps.slice(0,4).map(cEsc).join(' / ')||'无明显缺口,可直接投'}。不是不够格,是差临门一脚。`)+
      cAct([cAB('查看完整匹配','copMatch',[j.id],true), cAB('生成训练计划','copPlan',[gaps[0]||'系统设计', j.co]), cAB('模拟面试','copInterview',[j.id])]);
  }
  // 4. interview
  if(has('面试','模拟','练题','陪练')){
    if(j) return `用 <b>${cEsc(j.co)}</b> 的 JD 关键词陪你练,出题 + 评分 + 反馈。`+cAct([cAB('开始模拟面试','copInterview',[j.id],true)]);
    return '选个岗位来练吧,我用它的真实 JD 出题。'+cAct([cAB('打开面试陪练','copGo',['interview'],true)]);
  }
  // 5. add job
  if(has('加','添加','录入','新增','收集')&&has('岗位','公司','职位')) return '好,录入新岗位 —— 粘贴 JD 后 AI 会自动抽取要求并算匹配度。'+cAct([cAB('录入岗位','copNewJob',[],true)]);
  // 6. training plan / 补技能
  if((has('训练计划','学习计划','怎么补','怎么练','补齐','计划')&&sk)||(has('补')&&sk)){
    const p=planFor(sk.name);
    return `给你排了「${cEsc(sk.name)}」的训练计划:约 ${p.weeks} 周、${p.ms.length} 个里程碑。推荐资源:${p.res.slice(0,2).map(cEsc).join(' · ')}。`+cAct([cAB('加入行动清单','copPlan',[sk.name,''],true)]);
  }
  // 7. add action
  if(has('加','添加','新建')&&has('行动','任务','待办')) return '好,添加一个行动 —— 建议带上目标和里程碑,方便刻意练习。'+cAct([cAB('添加行动','copNewAction',[],true)]);
  // 8. mark done
  if(has('完成','搞定','做完','标记')){
    const a=findAction(t);
    if(a) return `把「${cEsc(a.title)}」标记为已完成?`+cAct([cAB('确认完成','copDoneAct',[a.id],true), cAB('打开行动清单','copGo',['actions'])]);
  }
  // 9. questions — gaps
  if(has('缺口','短板','差什么','差哪','该补','弱项')){
    const rows=TOP_GAPS.map(g=>`${g.rank} ${cEsc(g.name)} · ${g.jobs} 个岗位需要`).join('<br>');
    return '你当前最高优先级的能力缺口:'+cCard('Top 3 缺口', rows)+cAct([cAB('一键补 Rust','copPlan',['Rust',''],true), cAB('看缺口矩阵','copGo',['analysis'])]);
  }
  // 10. what to do next
  if(has('该做','下一步','现在做','干什么','做什么','怎么开始')){
    const a=ACTIONS.filter(x=>x.state==='doing')[0]||ACTIONS.find(x=>x.state==='todo');
    return `下一步最该做的一件事:<b>${cEsc(a.title)}</b>。${cEsc(a.goal||'')}`+cAct([cAB('去完成','copGo',['actions'],true), cAB('智能匹配新岗位','copGo',['match'])]);
  }
  // 11. best match
  if(has('最匹配','最适合','最该投','匹配最高','最有戏','优先投')){
    const best=[...JOBS].sort((a,b)=>b.match-a.match)[0];
    return `按匹配度,<b>${cEsc(best.co)} · ${cEsc(best.role.split('·')[0].trim())}</b> 最该优先(匹配 ${best.match.toFixed(1)}/10)。`+cAct([cAB('查看完整匹配','copMatch',[best.id],true)]);
  }
  // 12. market value / salary
  if(has('值多少','市场价值','身价','薪资','工资','值钱','行情')) return `按你的能力档案和 12 份目标 JD 估算,你的市场价值约 <b>${YOU_VALUE} 万/年</b>,在「后端·高级」带中上沿。`+cAct([cAB('看完整市场价值报告','copMarket',[],true), cAB('看市场情报','copGo',['analysis'])]);
  // 13. trend
  if(has('趋势','在涨','在跌','热门','什么火','前景','值得学')){
    const up=TREND.filter(x=>x.dir==='up').slice(0,4).map(x=>`${x.skill} +${x.pct}%`).join(' · ');
    return `近 6 个月需求上行最快:${up}。Rust 稀缺且涨势最猛,差异化价值最高。`+cAct([cAB('看市场情报','copGo',['analysis'],true)]);
  }
  // 14. progress
  if(has('进度','做到哪','练了多少','投入多少','状态')){
    const mins=ACTIONS.reduce((x,a)=>x+(a.sessions||[]).reduce((y,s)=>y+s.mins,0),0);
    const doing=ACTIONS.filter(a=>a.state==='doing').length;
    return `你已累计训练 <b>${(mins/60).toFixed(1)} 小时</b>,${doing} 项进行中,12 个岗位在跟进。稳步推进中 —— 你没有落后。`+cAct([cAB('打开行动清单','copGo',['actions'],true)]);
  }
  // 15. navigation
  const navMap=[['总览','overview'],['智能匹配','match'],['匹配','match'],['简历','resumes'],['目标岗位','jobs'],['岗位','jobs'],['分析','analysis'],['市场','analysis'],['职业资产','skills'],['能力','skills'],['技能','skills'],['行动','actions'],['任务','actions'],['面试','interview'],['设置','settings']];
  if(has('打开','去','跳转','切换','看看','进入','查看','到')){
    for(const [k,id] of navMap){ if(t.includes(k)){ const p=PAGES.find(x=>x.id===id); return `好,带你去「${p.label}」。`+cAct([cAB('打开 '+p.label,'copGo',[id],true)]); } }
  }
  // 16. help
  if(has('能做什么','帮助','怎么用','你会','功能','能干嘛')) return '我可以用一句话帮你做这些:'+cSuggs(['我和腾讯那个岗位匹配吗?','帮我改美团那个岗位的简历','给我排一个 Rust 训练计划','我的市场价值值多少?','现在最该做什么?']);
  // 17. fallback
  return '我可以帮你匹配岗位、改简历、出面试题、排训练计划、查缺口和市场价值。试试这些:'+cSuggs(['我和字节那个岗位匹配吗?','我最大的能力缺口是什么?','帮我加一个岗位','我现在最该做什么?']);
}

/* ---- 抽壳序3-d-8 择取:jobseek Agent 命令 chips(AGENT_CMDS /命令面板项已抽出单列 → ./agent-commands.js)。
   renderAgentCmds = 技能 chips(平台 agentInit/updateAgentChrome 经全局触发,渲染进 #agentCmds);依赖 tt/$/$$/agentSend(import)。 ---- */
// Agent 命令 chips(双语;随语言重渲 —— 见 updateAgentChrome 调用)。查询也双语,配合 frameQuery 的中英关键词框定。
export function renderAgentCmds(){
  const host=$('#agentCmds'); if(!host) return;
  const cmds=[
    [tt('智能匹配','Smart match'), tt('我最该投哪个岗位?','Which job should I apply to?')],
    [tt('改简历','Tune resume'), tt('帮我改简历,贴合我的目标岗位','Help me tailor my resume to my target job')],
    [tt('出面试题','Interview Q'), tt('用目标岗位的 JD 陪我练面试','Practice interview questions from my target job JD')],
    [tt('排训练计划','Training plan'), tt('给我排一个训练计划补齐缺口','Make me a training plan to close my gaps')],
    [tt('查能力缺口','Skill gaps'), tt('我最大的能力缺口是什么?','What is my biggest skill gap?')],
    [tt('市场价值','Market value'), tt('我的市场价值值多少?','What is my market value?')],
    [tt('下一步','Next step'), tt('我现在最该做什么?','What should I do next?')]
  ];
  host.innerHTML=`<span class="ac-label">${tt('技能 / 命令 · 也可输入 /','Skills / commands · or type /')}</span>`+cmds.map(c=>`<button class="ac-chip" data-cmd="${c[1].replace(/"/g,'&quot;')}">${c[0]}</button>`).join('');
  $$('#agentCmds [data-cmd]').forEach(b=>b.onclick=()=>agentSend(b.dataset.cmd));
}
/* ---- /command palette ---- */
/* ★3.y 尾(10d checklist①):AGENT_CMDS 抽出单列 → ./agent-commands.js(@ts-check,纯数据,字面量真受 CommandSpec[] 校验;
   本文件 @ts-nocheck 下 @type 只断言不校验、漂移会被吞)。manifest.appCommands 改从 agent-commands.js import。 */

/* ★批11B(cActions 契约):11 个 cAB 处理器桥已摘 —— 平台委派不再 window[name],改经 manifest.cActions 登记表按名查调。
   本文件 window 桥清零。aiSuggs/copReply/renderAgentCmds 经 manifest 契约(AGENT_CMDS 已抽出 agent-commands.js);copNewJob/copMatch 等亦被 agent-commands/cards.js import 直调。findJob/findSkill/findAction 私有。
   ★登记表不变式(§4-4):登记项的任一参数不得流进 innerHTML/eval/Function/setTimeout(串) —— agentChat 是不转义 innerHTML sink,**不登记**;其固定串调用点走无参包装 agentBackupContinue(第44轮)。
   ★红线逐字保留(在函数体):§4-4 转义 cEsc/jesc(job.co 等 JD 外部内容)+ 设置不可经对话改(copReply 拦截引导去设置页)。 */
