// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 行动录入(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../monolith-globals.d.ts。 */
/* ---------- NEW ACTION MODAL ---------- */
import { skillByName } from '../data-helpers.js';
import { normIvFeedback } from './iv-feedback.js';
import { ACTIONS, JOBS, SKILLS } from '../data.js';
import { computeMarketValue } from '../tools/market-value-compute.js'; // ★市场价值:UI 与 app-tool 共用同一自包含函数(job-pay×匹配)⇒ 结构上不发散(评审 [应改]:app-tool 曾 174万)
import { renderActions } from '../pages/actions.js';
import { renderOverview } from '../pages/overview.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { collPersistOn, persistColl } from '../../../platform/shell/data-store.js';
import { $ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { closeModal, openModal } from '../../../platform/shell/modal.js';
import { toast } from '../../../platform/shell/toast.js';
export function openNewAction(){
  const html=`
    <div class="modal-head"><div><p class="eyebrow">— NEW</p><h2 style="margin-top:5px;">${tt('添加行动','New action')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="field"><label>${tt('标题','Title')}</label><input class="input" id="naTitle" placeholder="${tt('如 · 完成 Rust 实战项目','e.g. Finish a Rust project')}"></div>
      <div class="field-row"><div class="field"><label>${tt('优先级','Priority')}</label><select class="select" id="naPri"><option value="high">${tt('高','High')}</option><option value="mid" selected>${tt('中','Mid')}</option><option value="low">${tt('低','Low')}</option></select></div><div class="field"><label>${tt('截止日期','Due')}</label><input class="input" id="naDue" placeholder="2026.06.30"></div></div>
      <div class="field-row"><div class="field"><label>${tt('关联技能','Skill')}</label><select class="select" id="naSkill"><option value="">${tt('不关联','None')}</option>${SKILLS.map(s=>`<option>${cEsc(s.name)}</option>`).join('')}</select></div><div class="field"><label>${tt('关联岗位','Job')}</label><select class="select" id="naJob"><option value="">${tt('不关联','None')}</option>${JOBS.map(j=>`<option>${cEsc(j.co)} · ${cEsc(j.role)}</option>`).join('')}</select></div></div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${tt('取消','Cancel')}</button><button class="btn btn-accent" id="naAdd">${tt('添加','Add')}</button></div>`;
  const m=openModal(html);
  $('#naAdd',m).onclick=()=>{
    const title=(($('#naTitle',m)||{}).value||'').trim();
    if(!title){ toast(tt('请填写标题','Enter a title')); return; }
    const skill=($('#naSkill',m)||{}).value||'';
    const id=Math.max(0,...ACTIONS.map(a=>+a.id||0))+1; // 空数组也安全(0 起)
    ACTIONS.push({ id, title, state:'todo', pri:($('#naPri',m)||{}).value||'mid', fromJobs:0,
      due:(($('#naDue',m)||{}).value||'').trim(), skill, cap:skill, jobs:($('#naJob',m)||{}).value||'', est:'', note:'',
      progress:0, goal:'', milestones:[], sessions:[], reflection:'' });
    persistColl('actions', ACTIONS);                  // 真落库(桌面 rt.db,web IndexedDB)
    [renderActions,renderOverview].forEach(f=>{try{f();}catch(_e){}});
    closeModal();
    toast(tt('行动已添加','Action added'));
  };
}

/* ============ AI ENGINE + P0/P1/P2 FEATURES ============ */
export const RESUME={filename:'我的简历_后端工程师.pdf', uploaded:'2026.05.18', parsed:true, years:8, derivedSkills:23, derivedEvidence:15, summary:'8 年后端 · Go / MySQL / Redis 为主 · 美团核心配送背景'};
export const TREND=[
  {skill:'Rust', pct:42, dir:'up', note:'AI 基建 / 系统编程拉动,半年需求近翻倍'},
  {skill:'分布式系统', pct:24, dir:'up', note:'稳定性岗位扩张'},
  {skill:'K8s', pct:18, dir:'up', note:'云原生持续渗透'},
  {skill:'系统设计', pct:15, dir:'up', note:'高级岗硬门槛'},
  {skill:'Go', pct:9, dir:'up', note:'后端增量首选语言'},
  {skill:'高并发', pct:6, dir:'up', note:''},
  {skill:'微服务', pct:2, dir:'flat', note:'趋于稳定,成基础项'},
  {skill:'Java', pct:7, dir:'down', note:'增量岗位向 Go 迁移,存量仍大'},
  {skill:'PHP', pct:26, dir:'down', note:'以存量维护为主'}
];
export const SALARY=[
  {role:'后端 · 高级 (P6/P7)', lo:35, hi:55, med:45},
  {role:'后端 · 专家 (P7/P8)', lo:50, hi:75, med:62},
  {role:'架构师 / 基础设施', lo:60, hi:90, med:75}
];
/** ★市场价值(退役静态 `YOU_VALUE=48` mock):**直接复用 app-tool 的自包含 `computeMarketValue`**
 *  (目标岗位真实薪资 × 匹配加权 = 41-62万,含跨岗位聚合 gaps)⇒ **UI 与模型侧 app-tool 结构上共用一份、永不发散**
 *  (评审 [应改]:app-tool 曾用 base20+Σlvl×1.6 formula 对 35 技能算 174万荒谬)。返回 {low,high,mid,jobs,gaps}。
 *  每次 fresh compute(SKILLS/JOBS 运行时可变)。收敛点:openMarketValue/value-card/copilot/analysis + app-tool 五面统一。 */
export function marketValue(){
  return computeMarketValue(null, { jobs: JOBS, skills: SKILLS });
}
const PLAN_LIB={
  'Rust':{weeks:6, ms:['吃透所有权 / 生命周期','掌握 async / tokio 异步模型','实现核心 KV 存储引擎','压测与性能调优','补 K8s 部署 + README'], res:['《Rust 程序设计语言》官方书','tokio 官方教程','《Rust Atomics and Locks》']},
  'K8s':{weeks:3, ms:['kind 本地集群跑通','写 Deployment / Service / Ingress','配探针与滚动发布','接入基础监控'], res:['Kubernetes 官方文档','《Kubernetes in Action》','kind 快速上手指南']},
  '分布式系统':{weeks:4, ms:['梳理一致性相关经历','梳理容错 / 降级经历','梳理水平扩展经历','写成 STAR 话术'], res:['MIT 6.824 课程','《Designing Data-Intensive Applications》','Raft 论文精读']},
  '系统设计':{weeks:3, ms:['复盘 5 道经典题','练习容量估算','画架构 + 讲权衡','模拟面试 2 轮'], res:['《System Design Interview》','ByteByteGo','Grokking the System Design']},
  'gRPC':{weeks:1, ms:['写 proto 并生成代码','实现双向流','拦截器 / 超时重试'], res:['gRPC 官方文档','Protocol Buffers 指南']},
  'DDD':{weeks:3, ms:['吃透限界上下文','对一个业务做战术建模','落地一次聚合根重构'], res:['《领域驱动设计》','《实现领域驱动设计》']}
};
export function planFor(skill){return PLAN_LIB[skill]||{weeks:2, ms:['梳理现状与目标差距','找 1 个练手项目','沉淀为可展示证据'], res:['官方文档','社区最佳实践']};}
export function topGapsOf(job){return job.need.filter(n=>{const s=skillByName(n);return !s||s.lvl<3;});}
// ★M3(a):genRewrites(硬编码假 QPS 改写预览)已退役 —— match 页「简历这样改」改为诚实指向已真化的
//   resumeGenerate(AI 按岗位重写概要、事实字段用真实数据)。删前 grep 确认 0 消费者(仅 match.js 曾 import)。
/* ===== Interview question bank + records ===== */
export const IV_CATS=[['design','系统设计'],['perf','高并发·性能'],['dist','分布式·一致性'],['project','项目深挖'],['behavior','行为面试']];
export const IV_CATLABEL=Object.fromEntries(IV_CATS);
export let IV_BANK=[
  {id:1, cat:'design', text:'设计一个支撑千万级日订单的即时配送调度系统:从需求澄清、容量估算到核心架构与未来演进,讲讲你的整体方案。', tags:['系统设计','高并发'], src:'内置'},
  {id:2, cat:'design', text:'设计一个短链服务,支撑每天 1 亿次生成、10 亿次跳转,谈谈存储选型与缓存策略。', tags:['系统设计','Redis'], src:'内置'},
  {id:3, cat:'design', text:'如何设计一个高可用的分布式 ID 生成器?对比几种方案的取舍。', tags:['系统设计','分布式系统'], src:'内置'},
  {id:4, cat:'perf', text:'某热点 key 导致缓存击穿,线上 QPS 瞬间涨 3 倍,你如何快速止血并根治?', tags:['高并发','Redis'], src:'内置'},
  {id:5, cat:'perf', text:'一个接口 P99 从 80ms 突然涨到 500ms,给出你的系统化排查思路。', tags:['性能优化','监控告警'], src:'内置'},
  {id:6, cat:'perf', text:'如何对一个 Go 服务做性能压测与调优?你关注哪些指标?', tags:['性能优化','Go'], src:'内置'},
  {id:7, cat:'dist', text:'分布式场景下如何保证最终一致性?举一个你真实做过的权衡取舍。', tags:['分布式系统'], src:'内置'},
  {id:8, cat:'dist', text:'谈谈你对 CAP 与 BASE 的理解,在你的项目里是怎么落地的?', tags:['分布式系统','系统设计'], src:'内置'},
  {id:9, cat:'dist', text:'如何实现一个可靠的分布式锁?Redis 方案有哪些坑?', tags:['Redis','分布式系统'], src:'内置'},
  {id:10, cat:'project', text:'介绍一个你最有成就感的项目:你的角色、最大的技术挑战、量化结果。', tags:['项目深挖'], src:'内置'},
  {id:11, cat:'project', text:'讲一次你主导的稳定性改进,说清背景、动作和量化收益(MTTR / 可用性)。', tags:['服务治理','稳定性'], src:'内置'},
  {id:12, cat:'project', text:'你做过的系统里,哪个技术决策事后看是错的?你怎么纠正的?', tags:['系统设计'], src:'内置'},
  {id:13, cat:'behavior', text:'讲一次你和产品/上下游激烈分歧的经历,你是怎么推动达成一致的?', tags:['跨团队协作'], src:'内置'},
  {id:14, cat:'behavior', text:'你如何在高压、信息不全的情况下做技术决策?举个例子。', tags:['抗压与情绪韧性'], src:'内置'}
];
export let IV_RECORDS=[
  {id:3, type:'single', qText:'某热点 key 导致缓存击穿,线上 QPS 瞬间涨 3 倍,你如何快速止血并根治?', cat:'perf', date:'2026.05.26', job:'美团', tags:['高并发','Redis'], answer:'先加互斥锁 + 本地缓存止血,再做热点探测与多级缓存根治…', scores:{structure:8.5,depth:8.0,quant:7.5,overall:8.0}, good:['止血与根治分层,优先级清晰','给了具体限流水位'], improve:['可补充降级开关的灰度策略']},
  {id:2, type:'single', qText:'介绍一个你最有成就感的项目:你的角色、最大的技术挑战、量化结果。', cat:'project', date:'2026.05.21', job:'美团', tags:['项目深挖'], answer:'主导配送调度重构,把 P99 从 200ms 降到 80ms…', scores:{structure:7.5,depth:7.0,quant:7.0,overall:7.2}, good:['有量化结果,可信度高'], improve:['挑战的"难"讲得还不够具体']},
  {id:1, type:'single', qText:'分布式场景下如何保证最终一致性?举一个你真实做过的权衡取舍。', cat:'dist', date:'2026.05.18', job:'蚂蚁集团', tags:['分布式系统'], answer:'用消息队列做异步补偿,先保证可用性,通过对账兜底最终一致…', scores:{structure:7.0,depth:6.5,quant:5.5,overall:6.3}, good:['结构清晰,先讲方案再讲兜底'], improve:['对账频率与延迟没有量化','可以补一句失败重试上限']}
];
function aiGenQuestions(job){
  const sk=job.need; const dir=job.role.split('·').pop().trim();
  const base=[
    {cat:'design', text:`请设计一个支撑${job.co}量级的「${dir}」系统,从需求澄清到架构与演进给出方案。`, tags:sk.slice(0,2)},
    {cat:(sk.includes('高并发')||sk.includes('Redis'))?'perf':'dist', text:(sk.includes('分布式系统')?'结合该岗位,谈谈你如何在分布式系统中权衡一致性与可用性。':'结合该岗位的高并发要求,谈一次你做过的性能优化,讲清量化收益。'), tags:sk.slice(0,2)},
    {cat:'project', text:`针对 ${job.co} 这个方向,讲一个你最能打动面试官的项目,突出与该岗位的契合点。`, tags:['项目深挖']}
  ];
  return base.map((b,i)=>({id:Date.now()+i, cat:b.cat, text:b.text, tags:b.tags, src:'AI'}));
}
export function ivScore(answer){
  const len=(answer||'').length;
  const base=len>120?7.5:(len>40?6.5:5.5);
  const r=()=>Math.min(9.5, Math.max(5, base+(Math.random()*2-0.8)));
  const structure=Math.round(r()*10)/10, depth=Math.round(r()*10)/10, quant=Math.round((len>80?r():r()-1)*10)/10;
  const goodPool=['结构清晰:先澄清/结论,再分层展开','抓住了核心瓶颈,优先级判断准确','主动给了容量估算,体现工程量感','用了真实数据支撑论点,可信度高'];
  const impPool=['权衡部分可更深:为什么选 A 不选 B,代价是什么','缺一个量化兜底:降级阈值 / 限流水位 / 恢复时长','可主动谈一句演进路线,展示长期视角','边界条件再补:极端流量 / 故障域 / 数据倾斜','表达可更精炼,先结论后展开'];
  const pick=(arr,n)=>arr.slice().sort(()=>Math.random()-0.5).slice(0,n);
  // ★ivScore schema 刀:产出 **wire 形**(扁平)→ normIvFeedback 归一为承重 canonical 形(各维钳/overall 重算/文字有界)。
  //   真化后 AI 产出走同一归一化,承重消费者(整轮平均/总评/成长曲线/持久化)零改动。
  return normIvFeedback({structure, depth, quant:Math.max(5,quant), good:pick(goodPool,2), improve:pick(impPool,3)});
}
/* ===== Company interview style + tailored resume ===== */
const IV_STYLE={
  '字节跳动':{tags:['系统设计','算法','项目深挖'], note:'重系统设计与编码,基于简历深挖项目,常配算法手撕。'},
  '蚂蚁集团':{tags:['分布式','金融稳定性','场景题'], note:'重分布式理论与金融级稳定性,偏场景化层层追问。'},
  '美团':{tags:['高并发','项目深挖','落地'], note:'务实,围绕简历项目深挖,看重高并发与可量化的落地结果。'},
  '阿里巴巴':{tags:['系统设计','技术深度','价值观'], note:'重技术深度与系统设计,含价值观(闻味道)面。'},
  '腾讯':{tags:['计算机基础','项目细节','稳健'], note:'重计算机基础与项目细节,风格稳健。'},
  '拼多多':{tags:['算法','高强度','结果导向'], note:'强度高、节奏快,重算法与结果。'},
  '百度':{tags:['基础','算法','系统'], note:'重算法与计算机基础,偏工程系统。'},
  '快手':{tags:['项目深挖','高并发','实时'], note:'围绕简历经历,关注高并发与实时系统。'},
  '小红书':{tags:['项目深挖','业务理解','DDD'], note:'重业务建模与项目深度,偏 DDD 思路。'},
  '滴滴':{tags:['系统设计','稳定性','规模'], note:'重大规模系统设计与稳定性。'},
  '网易':{tags:['计算机基础','性能','项目'], note:'重基础与性能优化,围绕项目提问。'},
  '微软':{tags:['计算机基础','行为面','英语'], note:'重计算机基础与行为面(STAR),部分环节英文。'}
};
export function styleFor(co){return IV_STYLE[co]||{tags:['简历 + JD','项目深挖'], note:'以你的简历与 JD 为主,围绕真实经历提问。'};}
export let RESUME_TAILORED={};
/* PROFILE(个人隐私信息)已抽壳 → platform/shell/profile.js(序5-b · 第19轮裁定:壳级用户身份归平台;仍 AI 不读取/不修改) */
export const MOD_ICON={basic:'👤',summary:'✦',skills:'◆',work:'▣',projects:'▤',edu:'▦',strengths:'✸',certs:'❖',languages:'⊞',honors:'✪',portfolio:'▥',research:'◈',other:'▢'};
// 主简历资料(专业层,AI 可读):教育/工作/项目/特长/证书/语言/荣誉的单一真实来源 —— 「数据设置·个人信息」填一次,
// 生成任意针对性简历自动带入,且**填了才显示**。红线:绝不含联系方式(姓名/电话/邮箱在 PROFILE 隐私层、AI 不读);
// 本对象走 resumes 集合持久化(与简历模块同层,AI 可帮你改这些专业内容、贴合 JD)。
export let MASTER={edu:[],work:[],projects:[],strengths:'',certs:'',languages:'',honors:''};
export function shorten(t,n){t=(''+t).replace(/<\/?b>/g,'');return t.length>(n||40)?t.slice(0,n||40)+'…':t;}
export function genTailoredResume(job){
  const have=job.need.filter(n=>{const s=skillByName(n);return s&&s.lvl>=3;});
  // 教育/工作/项目从「主简历资料」MASTER 带入真实数据(深拷贝,各份简历独立可改);**填了才显示**(on=有内容)。
  const cl=a=>JSON.parse(JSON.stringify(Array.isArray(a)?a:[]));
  const work=cl(MASTER.work), projects=cl(MASTER.projects), edu=cl(MASTER.edu);
  const hasTxt=s=>!!String(s==null?'':s).trim();
  return {template:'minimal', modules:[
    {key:'basic', label:'基本信息', on:true, type:'locked'},
    {key:'summary', label:'个人简介', on:true, type:'text', content:`${RESUME.years} 年后端工程师,深耕 ${have.slice(0,3).join(' / ')||'分布式系统'} 与高并发稳定性建设。主导过日均千万级请求的核心系统,擅长从全局定位瓶颈并推动落地。目标方向「${job.co} · ${job.role.split('·')[0].trim()}」高度契合。`},
    {key:'skills', label:'专业能力', on:true, type:'skills', content:[...new Set([...have, ...job.need])].slice(0,9)},
    {key:'work', label:'工作经历', on:work.length>0, type:'entries', items:work},
    {key:'projects', label:'项目经历', on:projects.length>0, type:'projects', items:projects},
    {key:'edu', label:'教育经历', on:edu.length>0, type:'entries', items:edu},
    {key:'strengths', label:'特长 / 擅长领域', on:hasTxt(MASTER.strengths), type:'text', content:MASTER.strengths||''},
    {key:'certs', label:'证书 / 认证', on:hasTxt(MASTER.certs), type:'text', content:MASTER.certs||''},
    {key:'languages', label:'语言能力', on:hasTxt(MASTER.languages), type:'text', content:MASTER.languages||''},
    {key:'honors', label:'荣誉奖项', on:hasTxt(MASTER.honors), type:'text', content:MASTER.honors||''},
    {key:'portfolio', label:'个人作品', on:false, type:'text', content:''},
    {key:'research', label:'研究经历', on:false, type:'text', content:''},
    {key:'other', label:'其他经历', on:false, type:'text', content:''}
  ]};
}
// 主简历资料持久化(走 resumes 集合的哨兵记录 r__master__,AI 可读专业层;不含联系方式)。
export function persistMaster(){
  if(!collPersistOn()) return;
  window.SeekerRT.db.upsert('resumes', { id:'r__master__', jobId:'__master__', master:true,
    edu:MASTER.edu, work:MASTER.work, projects:MASTER.projects,
    strengths:MASTER.strengths, certs:MASTER.certs, languages:MASTER.languages, honors:MASTER.honors })
    .catch(e=>console.error('[data] persist master', e));
}
// 设置页「主简历资料」编辑器 HTML(复用简历编辑器的 .rb-* 样式;改即存)。
function masterEntriesHTML(key){
  const F={ edu:[['org',tt('学校 / 机构','School / org')],['title',tt('专业 · 学位','Major · degree')],['date',tt('时间 · 如 2012 — 2016','Dates')],['loc',tt('城市(可选)','City (optional)')]],
            work:[['org',tt('公司','Company')],['title',tt('职位','Title')],['date',tt('时间 · 如 2020 — 2024','Dates')],['loc',tt('城市(可选)','City (optional)')]] }[key];
  const e=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const items=Array.isArray(MASTER[key])?MASTER[key]:[];
  const rows=items.map((it,i)=>`<div class="rb-entry">
    <div class="rb-erow"><input class="rb-in" data-mef="${key}|${i}|${F[0][0]}" placeholder="${F[0][1]}" value="${e(it[F[0][0]])}"><input class="rb-in" data-mef="${key}|${i}|${F[2][0]}" placeholder="${F[2][1]}" value="${e(it[F[2][0]])}"></div>
    <div class="rb-erow"><input class="rb-in" data-mef="${key}|${i}|${F[1][0]}" placeholder="${F[1][1]}" value="${e(it[F[1][0]])}"><input class="rb-in" data-mef="${key}|${i}|${F[3][0]}" placeholder="${F[3][1]}" value="${e(it[F[3][0]])}"></div>
    <textarea class="rb-ta" data-mebul="${key}|${i}" rows="3" placeholder="${tt('要点 · 每行一条…','Bullets · one per line…')}">${e((it.bullets||[]).join('\n'))}</textarea>
    <div style="text-align:right;margin-top:4px;"><button class="btn" data-mdel="${key}|${i}" style="font-size:11px;padding:3px 9px;">${tt('删除这条','Remove')}</button></div>
  </div>`).join('');
  return rows + `<button class="btn" data-madd="${key}" style="margin-top:4px;">+ ${tt('添加一条','Add one')}</button>`;
}
function masterProjectsHTML(){
  const e=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const items=Array.isArray(MASTER.projects)?MASTER.projects:[];
  const rows=items.map((p,i)=>`<div class="rb-entry ${p.star?'star':''}">
    <div class="rb-erow"><input class="rb-in" data-mef="projects|${i}|name" placeholder="${tt('项目名称','Project name')}" value="${e(p.name)}"><input class="rb-in" data-mef="projects|${i}|date" placeholder="${tt('时间','Date')}" value="${e(p.date)}"></div>
    <div class="rb-erow"><input class="rb-in" data-mef="projects|${i}|link" placeholder="${tt('链接(可选,如 GitHub)','Link (optional)')}" value="${e(p.link)}"></div>
    <textarea class="rb-ta" data-mebul="projects|${i}" rows="2" placeholder="${tt('项目要点 · 每行一条…','Project bullets · one per line…')}">${e((p.bullets||[]).join('\n'))}</textarea>
    <div style="display:flex;gap:10px;align-items:center;margin-top:6px;"><button class="rb-ic ${p.star?'on':''}" data-mpstar="${i}" title="${tt('标记擅长 · 面试重点','Mark strength')}">★</button><span style="flex:1;"></span><button class="btn" data-mdel="projects|${i}" style="font-size:11px;padding:3px 9px;">${tt('删除这条','Remove')}</button></div>
  </div>`).join('');
  return rows + `<button class="btn" data-madd="projects" style="margin-top:4px;">+ ${tt('添加一条','Add one')}</button>`;
}
function masterExtrasHTML(){
  const e=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const sub=t=>`<p style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:.14em;color:var(--ink-3);margin:20px 0 8px;text-transform:uppercase;">${t}</p>`;
  const ta=(k,ph)=>`<textarea class="rb-ta" data-mx="${k}" rows="2" placeholder="${ph}" style="width:100%;">${e(MASTER[k])}</textarea>`;
  return sub(tt('特长 / 擅长领域','Strengths / focus'))+ta('strengths',tt('如:分布式系统设计、性能调优、技术选型…','e.g. distributed systems, perf tuning, tech selection…'))
    + sub(tt('证书 / 认证','Certifications'))+ta('certs',tt('如:AWS 解决方案架构师、PMP…(每行一条)','e.g. AWS SA, PMP… (one per line)'))
    + sub(tt('语言能力','Languages'))+ta('languages',tt('如:英语(CET-6 / 流利)、日语(N2)…','e.g. English (fluent), Japanese (N2)…'))
    + sub(tt('荣誉奖项','Honors / awards'))+ta('honors',tt('如:ACM 区域赛金奖、年度技术之星…','e.g. ACM regional gold, tech star of the year…'));
}
export function masterSectionHTML(){
  const sub=t=>`<p style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:.14em;color:var(--ink-3);margin:22px 0 8px;text-transform:uppercase;">${t}</p>`;
  return `<div style="margin-top:34px;border-top:0.5px solid var(--border);padding-top:24px;max-width:680px;">
    <p class="seclabel">— RESUME DATA · AI-READABLE</p>
    <h2 class="sectitle" style="font-size:20px;">${tt('主简历资料','Master resume data')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 2px;line-height:1.7;">${tt('填一次,生成任意针对性简历时自动带入 —— <b>填了才显示</b>。这些是专业内容,AI 可据目标 JD 帮你打磨;但 AI <b>永远读不到上面的联系方式</b>。','Fill once; auto-used in every tailored resume — <b>shown only if filled</b>. AI may tailor this professional content to a target JD, but <b>never reads the contact info above</b>.')}</p>
    ${sub(tt('教育经历','Education'))}${masterEntriesHTML('edu')}
    ${sub(tt('工作经历','Work experience'))}${masterEntriesHTML('work')}
    ${sub(tt('项目经历','Projects'))}${masterProjectsHTML()}
    ${masterExtrasHTML()}
  </div>`;
}
export function resMod(r,key){return r.modules?r.modules.find(m=>m.key===key):null;}
export function resSummary(r){const m=resMod(r,'summary');return m?m.content:'';}
export function resSkills(r){const m=resMod(r,'skills');return m&&m.content?m.content:[];}
export function resProjects(r){const m=resMod(r,'projects');return m&&m.items?m.items:[];}
export function genQuestionsFor(job, max){
  const r=RESUME_TAILORED[job.id]; const st=styleFor(job.co); const out=[];
  if(r){
    const projs=resProjects(r);
    const starred=projs.filter(p=>p.star)[0]||projs[0];
    if(starred) out.push({id:Date.now()+1, cat:'project', text:`你简历里的项目「${starred.name}」${starred.bullets&&starred.bullets[0]?'(「'+shorten(starred.bullets[0],30)+'」)':''},请展开讲讲背景、关键技术决策与量化结果。`, tags:['项目深挖'], src:'AI'});
    out.push({id:Date.now()+2, cat:'design', text:`结合你的经历,设计一个支撑 ${job.co}「${job.role.split('·').pop().trim()}」量级的系统,讲清架构、瓶颈与演进。`, tags:job.need.slice(0,2), src:'AI'});
  }else{
    out.push({id:Date.now()+1, cat:'design', text:`请设计一个支撑 ${job.co} 量级的「${job.role.split('·').pop().trim()}」系统,从需求澄清到架构与演进。`, tags:job.need.slice(0,2), src:'AI'});
  }
  const gap=topGapsOf(job)[0];
  if(gap) out.push({id:Date.now()+3, cat:(gap==='分布式系统'?'dist':'perf'), text:`这个岗位看重 ${gap},而你这块经验偏少。你会如何快速补齐,并在工作中真正用起来?`, tags:[gap], src:'AI'});
  if(st.tags.includes('算法')) out.push({id:Date.now()+4, cat:'perf', text:'手撕题:设计一个线程安全、高性能的限流器(令牌桶),并分析其时间/空间复杂度。', tags:['高并发'], src:'AI'});
  if(st.tags.includes('行为面')||st.tags.includes('价值观')) out.push({id:Date.now()+5, cat:'behavior', text:'用 STAR 结构讲一次你在信息不全、高压下做出艰难技术取舍的经历。', tags:['抗压与情绪韧性'], src:'AI'});
  return out.slice(0, max||3);
}

export function genPlanFromGap(skill, jobLabel){
  const p=planFor(skill);
  const id=Math.max(...ACTIONS.map(a=>a.id))+1;
  ACTIONS.push({id, title:`训练计划 · 补齐 ${skill}`, state:'todo', pri:'high', fromJobs:0, due:'', skill, cap:skill, jobs:jobLabel||'', est:p.weeks+' 周', note:'AI 生成 · 首选资源:'+p.res[0],
    progress:0, goal:`用约 ${p.weeks} 周补齐「${skill}」,完成 ${p.ms.length} 个里程碑并沉淀为一段可展示的项目证据。`,
    milestones:p.ms.map(t=>({t,done:false})), sessions:[], reflection:''});
  persistColl('actions', ACTIONS);
  return id;
}

/* AI mock engine: progressive steps → result */
export function aiRun(host, steps, resultFn, opts){
  opts=opts||{};
  host.innerHTML=`<div class="ai-loading"><span class="ai-dots"><i></i><i></i><i></i></span><span>${opts.label||'AI 分析中…'}</span></div><div id="ai-steps" style="padding:0 16px 16px;"></div>`;
  const sh=host.querySelector('#ai-steps'); let i=0;
  const tick=()=>{
    if(i<steps.length){ sh.insertAdjacentHTML('beforeend',`<div class="ai-step"><span class="tick">✓</span>${steps[i]}</div>`); i++; setTimeout(tick, 360+Math.random()*220); }
    else { setTimeout(()=>{ host.innerHTML=(typeof resultFn==='function'?resultFn():resultFn); if(opts.after)opts.after(host); }, 320); }
  };
  setTimeout(tick, 420);
}

/* 过渡 window 兼容桥:cards/resumes/interview/match/copilot-actions/settings-jobseek/pages/nav 按全局名调;改 import 后摘。
   状态符号 IV_BANK/IV_RECORDS/MASTER/RESUME_TAILORED 皆 mutated-property(引用永久稳定、hydration in-place)→ dual-publish 同引用即安全、免访问器。
   ★红线(逐字保留,在函数体内):MASTER/RESUME_TAILORED = AI 可读专业简历层、绝不含联系方式(姓名/电话/邮箱在 PROFILE 隐私层);persistMaster 只写 resumes 哨兵 r__master__、永不写 profile。
   私有不上桥:IV_STYLE/PLAN_LIB(状态)、aiGenQuestions/masterEntriesHTML/masterProjectsHTML/masterExtrasHTML(内部)。 */
/* ★批11B(pageActions 契约):openNewAction 桥已摘 —— nav 顶栏动作改经 SeekerShell.pageActions 契约取;消费者已 import(actions/copilot-actions/manifest)。 */