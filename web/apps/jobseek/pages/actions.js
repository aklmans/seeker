// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/**
 * jobseek · 行动清单页(多应用平台 阶段3 · 逐页搬迁第一刀)。
 * 从 index.html 单体内联块**原样搬出**(classic 全局语义不变,行为零回归);
 * 依赖仍在单体的符号见 ../../monolith-globals.d.ts(搬迁账本)。
 * 加载序:在主脚本(定义 ACTIONS/壳基元)之后、manifest/BOOT 之前。
 */
/* ---------- ACTIONS ---------- */
import { ACTIONS, PRI } from '../data.js';
import { renderOverview } from './overview.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { persistColl } from '../../../platform/shell/data-store.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { IC } from '../../../platform/shell/icons.js';
import { openModal } from '../../../platform/shell/modal.js';
import { frontis, signFoot, syncNavCounts } from '../../../platform/shell/nav.js';
import { toast } from '../../../platform/shell/toast.js';
let actTab='全部';
function sessMins(a){return (a.sessions||[]).reduce((x,s)=>x+s.mins,0);}
export function renderActions(){
  syncNavCounts();
  const counts={全部:ACTIONS.length, 进行中:ACTIONS.filter(a=>a.state==='doing').length, 待开始:ACTIONS.filter(a=>a.state==='todo').length, 已完成:ACTIONS.filter(a=>a.state==='done').length};
  const tabs=[['全部',tt('全部','All')],['进行中',tt('进行中','In progress')],['待开始',tt('待开始','Not started')],['已完成',tt('已完成','Done')]];
  const tabbar=`<div class="tabs">${tabs.map(t=>`<button class="tab ${actTab===t[0]?'on':''}" data-at="${t[0]}">${t[1]} (${counts[t[0]]||0})</button>`).join('')}</div>`;
  const allMins=ACTIONS.reduce((x,a)=>x+sessMins(a),0);
  const allSess=ACTIONS.reduce((x,a)=>x+(a.sessions||[]).length,0);
  const summary=`<div style="display:flex;gap:34px;padding:18px 0 2px;flex-wrap:wrap;">
    ${[[ (allMins/60).toFixed(1),tt('小时已投入','hours invested')],[allSess,tt('次训练记录','training logs')],[counts.进行中,tt('项进行中','in progress')]].map(x=>`<div><span style="font-family:var(--font-serif);font-size:26px;color:var(--ink);font-weight:500;">${x[0]}</span><span style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.1em;color:var(--ink-3);margin-left:8px;">${x[1]}</span></div>`).join('')}
  </div><p style="font-size:12px;color:var(--ink-3);margin:2px 0 0;">${tt('刻意练习 = 明确目标 + 拆解里程碑 + 记录每次训练 + 复盘。点开任意行动查看训练详情。','Deliberate practice = clear goal + milestones + logging each session + reflection. Open any action for training detail.')}</p>`;
  const stMap={doing:'进行中',todo:'待开始',done:'已完成'};
  let list=ACTIONS.filter(a=>actTab==='全部'||stMap[a.state]===actTab);
  const stOrder={doing:0,todo:1,done:2}; const prOrder={high:0,mid:1,low:2};
  list=[...list].sort((a,b)=>stOrder[a.state]-stOrder[b.state]||prOrder[a.pri]-prOrder[b.pri]);
  const cards=list.map(a=>{
    const cbox=a.state==='done'?'done':(a.state==='doing'?'half':'');
    const pri=PRI[a.pri];
    const meta=[];
    meta.push(a.state==='done'?tt('已完成','Done'):(a.state==='doing'?tt('进行中','In progress'):tt('待开始','Not started')));
    if(a.cap) meta.push(`${tt('练','Train')} <b style="color:var(--ink-2);font-weight:500;">${cEsc(a.cap)}</b>`);
    if(a.fromJobs) meta.push(tt('来自 '+a.fromJobs+' 个岗位','from '+a.fromJobs+' jobs'));
    if(a.due) meta.push(tt('截止 '+cEsc(a.due),'due '+cEsc(a.due)));
    if(a.est&&a.state!=='done') meta.push(tt('预估 '+cEsc(a.est),'est. '+cEsc(a.est)));
    const next=(a.milestones||[]).find(m=>!m.done);
    const doneMs=(a.milestones||[]).filter(m=>m.done).length, totMs=(a.milestones||[]).length;
    const mins=sessMins(a), sessN=(a.sessions||[]).length;
    return `<div class="act-card ${a.state==='done'?'is-done':''}" data-act="${a.id}">
      <span class="cbox lg ${cbox}" data-toggle="${a.id}">${IC.check}</span>
      <div class="act-body">
        <div class="act-top">
          <div><div class="act-title">${cEsc(a.title)}</div>${a.note?`<div style="font-size:12.5px;color:var(--ink-3);margin-top:4px;">${cEsc(a.note)}</div>`:''}</div>
          <span class="pl ${pri.cls}" style="font-family:var(--font-mono);font-size:11px;white-space:nowrap;">${tt('优先级 '+pri.label,'Priority '+pri.label)}</span>
        </div>
        <div class="act-meta">${meta.join('<span style="color:var(--ink-mute);">·</span>')}</div>
        <div class="act-prog"><div class="bar"><i style="width:${a.progress||0}%"></i></div><span class="pv">${a.progress||0}%</span></div>
        <div class="act-stats">
          <span class="act-stat"><b>${(mins/60).toFixed(1)}</b>${tt('小时训练','h trained')}</span>
          <span class="act-stat"><b>${sessN}</b>${tt('次记录','logs')}</span>
          <span class="act-stat"><b>${doneMs}/${totMs}</b>${tt('里程碑','milestones')}</span>
        </div>
        ${next?`<div class="act-next">${tt('下一步','Next')} · <b>${cEsc(next.t)}</b></div>`:(a.state==='done'?`<div class="act-next" style="color:var(--status-done);">${tt('全部里程碑已完成','All milestones done')}</div>`:'')}
        <button class="btn act-open" data-detail="${a.id}">${tt('打开训练详情','Open training detail')}</button>
      </div>
    </div>`;
  }).join('');
  const body=`<div class="sec" style="border-bottom:none;padding-top:18px;">${cards||`<p style="color:var(--ink-3);padding:30px 0;text-align:center;">${ACTIONS.length?tt('这个分类暂无行动','No actions in this category'):tt('还没有行动 — 点「+ 添加行动」,或在智能匹配里让 AI 从能力缺口生成计划','No actions yet — add one, or let AI plan from your skill gaps in Smart Match')}</p>`}</div>`;
  $('#page-actions').innerHTML=frontis('ACTIONS',tt('行动清单','Action list'))+summary+tabbar+body+signFoot();
  $$('#page-actions [data-at]').forEach(b=>b.onclick=()=>{actTab=b.dataset.at;renderActions();});
  $$('#page-actions [data-toggle]').forEach(cb=>cb.onclick=(e)=>{e.stopPropagation();toggleAction(+cb.dataset.toggle);});
  $$('#page-actions [data-detail]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();openActionDetail(+b.dataset.detail);});
}
function recalcProgress(a){
  if(a.milestones&&a.milestones.length){
    a.progress=Math.round(a.milestones.filter(m=>m.done).length/a.milestones.length*100);
  }
}
function toggleAction(id){
  const a=ACTIONS.find(x=>x.id===id);
  a.state = a.state==='todo'?'doing':(a.state==='doing'?'done':'todo');
  recalcProgress(a);
  if(a.state==='done'){a.progress=100; a.due=a.due||'2026.06.02';}
  renderActions();
  const card=$(`#page-actions [data-act="${id}"]`);
  if(card){card.classList.add('flash'); setTimeout(()=>card.classList.remove('flash'),650);}
  toast('行动状态已更新');
  renderOverview();
  persistColl('actions', ACTIONS);
}
function openActionDetail(id){
  const a=ACTIONS.find(x=>x.id===id);
  const stLabel=a.state==='done'?'已完成':(a.state==='doing'?'进行中':'待开始');
  const totalMins=sessMins(a);
  const ms=(a.milestones||[]).map((m,i)=>`<div class="ms-row ${m.done?'done':''}" data-ms="${i}"><span class="cbox ${m.done?'done':''}">${IC.check}</span><span class="t">${cEsc(m.t)}</span></div>`).join('');
  const sessions=(a.sessions&&a.sessions.length)?`<div class="slog">${a.sessions.slice().reverse().map(s=>`<div class="sitem"><div class="sh"><span class="sd">${cEsc(s.date)}</span><span class="sm">${s.mins} 分钟</span></div><div class="sn">${cEsc(s.note)}</div></div>`).join('')}</div>`:`<p style="color:var(--ink-3);font-size:13px;padding:8px 0;">还没有训练记录 — 完成第一次练习后点「记录一次训练」。</p>`;
  const html=`
    <div class="modal-head"><div><p class="eyebrow">— ACTION</p><h2 style="margin-top:5px;">${cEsc(a.title)}</h2>
      <div class="sub"><span>${stLabel}</span><span>·</span><span class="pl ${PRI[a.pri].cls}">优先级 ${PRI[a.pri].label}</span>${a.cap?`<span>·</span><span>练 ${cEsc(a.cap)}</span>`:''}${a.due?`<span>·</span><span>截止 ${cEsc(a.due)}</span>`:''}</div></div>
      <button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="msec"><p class="seclabel">— GOAL</p><h3 class="sectitle" style="font-size:16px;margin-bottom:8px;">训练目标<span class="dot">.</span></h3><p style="font-size:14px;color:var(--ink-2);line-height:1.75;margin:0;">${cEsc(a.goal||'—')}</p></div>
      <div class="msec"><p class="seclabel">— PROGRESS</p><h3 class="sectitle" style="font-size:16px;margin-bottom:12px;">进度与里程碑<span class="dot">.</span></h3>
        <div class="act-prog" style="margin:0 0 14px;"><div class="bar" style="max-width:none;"><i style="width:${a.progress||0}%"></i></div><span class="pv">${a.progress||0}%</span></div>
        ${ms||'<p style="color:var(--ink-3);font-size:13px;">暂无里程碑</p>'}<p style="font-size:11.5px;color:var(--ink-mute);margin:10px 0 0;">勾选里程碑会自动更新进度</p></div>
      <div class="msec"><p class="seclabel">— PRACTICE LOG</p><h3 class="sectitle" style="font-size:16px;margin-bottom:6px;">训练记录 · 累计 ${(totalMins/60).toFixed(1)} 小时 / ${(a.sessions||[]).length} 次<span class="dot">.</span></h3>
        ${sessions}
        <button class="btn btn-accent" id="addSess" style="margin-top:14px;">+ 记录一次训练</button><div id="sessFormHost"></div></div>
      <div class="msec" style="border-bottom:none;"><p class="seclabel">— REFLECTION</p><h3 class="sectitle" style="font-size:16px;margin-bottom:10px;">复盘<span class="dot">.</span></h3>
        <textarea class="textarea" style="min-height:88px;font-family:var(--font-sans);font-size:13.5px;line-height:1.7;" placeholder="这次练习最大的收获是什么?下一步聚焦哪里?">${cEsc(a.reflection||'')}</textarea></div>
    </div>`;
  const m=openModal(html, true);
  $$('[data-ms]',m).forEach(r=>r.onclick=()=>{
    const i=+r.dataset.ms; a.milestones[i].done=!a.milestones[i].done;
    recalcProgress(a);
    a.state = a.progress===100?'done':(a.progress>0?'doing':a.state);
    openActionDetail(id); renderActions(); renderOverview(); persistColl('actions', ACTIONS);
  });
  $('#addSess',m).onclick=()=>{
    const host=$('#sessFormHost',m);
    host.innerHTML=`<div class="sess-form">
      <div class="field-row"><div class="field"><label>日期</label><input class="input" id="sfDate" value="2026.06.02"></div><div class="field"><label>时长 (分钟)</label><input class="input" id="sfMin" type="number" value="60"></div></div>
      <div class="field"><label>这次练了什么 · 收获</label><textarea class="textarea" id="sfNote" style="min-height:66px;font-family:var(--font-sans);" placeholder="如 · 跑通 KV 存储 benchmark,理解了写放大"></textarea></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;"><button class="btn" id="sfCancel">取消</button><button class="btn btn-accent" id="sfSave">保存记录</button></div></div>`;
    $('#addSess',m).style.display='none';
    $('#sfCancel',host).onclick=()=>{host.innerHTML='';$('#addSess',m).style.display='';};
    $('#sfSave',host).onclick=()=>{
      const date=$('#sfDate',host).value||'2026.06.02';
      const mins=Math.max(1,+($('#sfMin',host).value)||30);
      const note=$('#sfNote',host).value.trim()||'(未填写收获)';
      a.sessions=a.sessions||[]; a.sessions.push({date,mins,note});
      if(a.state==='todo') a.state='doing';
      toast('已记录 '+mins+' 分钟训练 · 继续保持');
      openActionDetail(id); renderActions(); renderOverview(); persistColl('actions', ACTIONS);
    };
  };
}

/* 过渡 window 兼容桥:manifest 箭头 render:()=>renderActions() + 运行时消费者(cards/persistence/其他页/index.html)按全局名调;改 import 后摘。状态符号(文件本地)不上桥。 */
