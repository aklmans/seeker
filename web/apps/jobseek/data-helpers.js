// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 数据派生 helper(平台化阶段3-g 择取搬迁 · 第8轮裁定 C「归属驱动零改动移动」)。
    纯 jobseek 数据聚合:skillByName/fmtScore + 真实聚合(jobsByStatus/distinctNeedSkills/distBy/pipelineReal/topGapsReal/keywordsReal);
    从壳 DOM 基元($/$$/el 上)与壳 PAGES(下)之间择出。引用数据(data.js)+ tt(壳 i18n · 运行时)。
    ⚠ 运行时依赖壳基元 tt —— 抽壳后 tt 归 platform/shell,此依赖将变契约调用。classic 全局语义不变;依赖见 ./monolith-globals.d.ts。 */
export const skillByName=(n)=>SKILLS.find(s=>s.name===n);
const fmtScore=(v)=>`${v.toFixed(1)}<small>/10</small>`;

/* === 真实聚合(替代写死的演示数组,让总览/分析页反映真实 JOBS/SKILLS)=== */
function jobsByStatus(){ const m={}; Object.keys(STATUS).forEach(k=>m[k]=0); JOBS.forEach(j=>{ if(m[j.status]!=null) m[j.status]++; }); return m; }
export function distinctNeedSkills(){ return new Set(JOBS.flatMap(j=>j.need||[])).size; }
export function distBy(field){ const m=new Map(); JOBS.forEach(j=>{ const v=(j[field]||'—'); m.set(v,(m.get(v)||0)+1); }); return [...m.entries()].sort((a,b)=>b[1]-a[1]); }
export function pipelineReal(){ const by=jobsByStatus();
  return [['fav',tt('收藏','Saved'),'var(--status-info)'],['todo',tt('待投','To apply'),'var(--border-strong)'],['sent',tt('已投','Applied'),'var(--accent)'],['interview',tt('面试','Interview'),'var(--accent)'],['reject',tt('拒绝','Rejected'),'var(--ink-mute)'],['skip',tt('放弃','Skipped'),'var(--ink-mute)']]
    .map(([k,label,color])=>({label,n:by[k]||0,color})); }
export function topGapsReal(n){ // 跨岗缺口:被需求技能 → 需求岗位数 + 用户当前水平(skillByName.lvl);按需求数排序取前 n。
  const counts=new Map(); JOBS.forEach(j=>(j.need||[]).forEach(s=>counts.set(s,(counts.get(s)||0)+1)));
  return [...counts.entries()].map(([name,jobs])=>{ const sk=skillByName(name); const lvl=sk?(sk.lvl||0):0;
      return {name,jobs,lvl,have:lvl>=3?tt('已具备','have'):(lvl>=1?tt('仅基础','basic'):tt('未具备','none'))}; })
    .filter(r=>r.lvl<3).sort((a,b)=>b.jobs-a.jobs||a.lvl-b.lvl).slice(0,n)
    .map((r,i)=>({rank:String(i+1).padStart(2,'0'),name:r.name,jobs:r.jobs,have:r.have,
      pct:Math.round(r.lvl/3*100),pri:r.jobs>=Math.max(2,Math.ceil(JOBS.length*0.4))?tt('高','high'):tt('中','mid')})); }
/* JD 高频软词:在真实 JD 文本里数 curated 软词表(中文无分词器,故用词表 + 真计数;反映你真实的 JD)。 */
const SOFT_WORDS=['稳定性','高并发','性能优化','线上故障','Owner','推动','可用性','0-1','落地','容量规划','复盘','演进','治理','可扩展','高可用','排查','重构','优化','主导','负责','架构','体系','质量','规模','增长'];
export function keywordsReal(){ const text=JOBS.map(j=>j.jd||'').join('\n');
  return SOFT_WORDS.map(w=>[w,text.split(w).length-1]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,13); }

/* 过渡 window 兼容桥:pages/cards/intake-action 等按全局名调;改 import 后摘。fmtScore/jobsByStatus/SOFT_WORDS 内部私有不上桥。 */
window.skillByName=skillByName; window.distBy=distBy; window.distinctNeedSkills=distinctNeedSkills; window.keywordsReal=keywordsReal; window.pipelineReal=pipelineReal; window.topGapsReal=topGapsReal;
