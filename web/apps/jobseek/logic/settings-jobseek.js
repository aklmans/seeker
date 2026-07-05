// @ts-nocheck —— 抽壳序5-c-2 择取:jobseek 设置页贡献(goals/weights tab + profile/data tab 追加内容)。逻辑零改动。
/** jobseek · 设置页贡献,经 manifest.settings 契约(序5-c-1)供壳 renderSettings(平台)消费:
 *  - goalsSectionHTML/wireGoalsSection:「求职目标」tab(目标岗位数/投递期/薪资/城市)。
 *  - weightsSectionHTML/wireWeightsSection:「评分权重」tab(WEIGHTS 拖拽 + 重置)。
 *  - wireMasterSection:追加进壳 profile tab 尾部的主简历资料(masterSectionHTML 已在 intake-action.js)编辑器接线。
 *  - dataResumeRowHTML:追加进壳 data tab 尾部的"我的简历"行(RESUME.filename + 管理简历入口)。
 *  依赖:setState/WEIGHTS/RESUME/MASTER(jobseek data.js/intake-action.js)、tt/toast/$/$$(平台)、
 *  saveSettings/renderSettings(壳,index.html/platform 过渡全局)、persistMaster/openResumeModal(jobseek)。 */

function goalsSectionHTML(){
  const row=(k,v)=>`<div class="set-row"><span class="sk">${k}</span><div>${v}</div></div>`;
  return `<p class="seclabel">— GOALS</p><h2 class="sectitle">${tt('求职目标','Job-hunt goals')}<span class="dot">.</span></h2><div style="margin-top:14px;max-width:560px;">
    ${row(tt('目标岗位数','Target job count'),`<div style="display:flex;align-items:center;gap:16px;max-width:380px;"><input type="range" class="range" min="10" max="30" value="${setState.goal}" id="goalRange"><span class="mono" id="goalVal" style="color:var(--accent);font-size:14px;">${setState.goal}</span></div>`)}
    ${row(tt('目标投递期','Target window'),`<input class="input" id="setPeriod" value="${setState.period}" style="max-width:240px;">`)}
    ${row(tt('期望薪资范围','Expected salary'),`<input class="input" id="setSalary" value="${setState.salary}" style="max-width:240px;">`)}
    ${row(tt('期望城市','Preferred cities'),`<div style="display:flex;gap:6px;flex-wrap:wrap;"><span class="chip" style="border-color:var(--accent);color:var(--accent);">北京 ★</span><span class="chip">上海</span><span class="chip">深圳</span><span class="chip">杭州</span><span class="chip" style="border-style:dashed;color:var(--ink-mute);">${tt('+ 添加','+ Add')}</span></div>`)}
  </div>`;
}
function wireGoalsSection(){
  const gr=$('#goalRange'); if(gr) gr.oninput=()=>{setState.goal=+gr.value;$('#goalVal').textContent=gr.value;saveSettings();};
  const sp=$('#setPeriod'); if(sp) sp.oninput=()=>{setState.period=sp.value;saveSettings();};
  const sl=$('#setSalary'); if(sl) sl.oninput=()=>{setState.salary=sl.value;saveSettings();};
}

function weightsSectionHTML(){
  const maxW=Math.max(...WEIGHTS.map(w=>w[1])), totW=WEIGHTS.reduce((a,w)=>a+w[1],0);
  return `<p class="seclabel">— WEIGHTS</p><h2 class="sectitle">${tt('综合优先级权重','Priority weights')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 16px;">${tt('用于计算岗位综合优先级排序。拖动调整,合计','Used to rank jobs by overall priority. Drag to adjust; total')} <b id="wTot" style="color:${totW===100?'var(--status-done)':'var(--ink-2)'};">${totW}%</b>。</p>
    <div style="max-width:480px;">${WEIGHTS.map((w,i)=>`<div class="weight-row"><span class="wl">${tt(w[0],['Interest','Growth','Match','Odds'][i])}</span><input type="range" class="range" min="0" max="60" value="${w[1]}" data-wt="${i}"><span class="mono" data-wv="${i}" style="font-size:12px;color:var(--accent);text-align:right;">${w[1]}%</span></div>`).join('')}</div>
    <button class="btn" style="margin-top:16px;" id="wReset">${tt('重置为默认','Reset to default')}</button>`;
}
function wireWeightsSection(){
  $$('#page-settings [data-wt]').forEach(s=>s.oninput=()=>{const i=+s.dataset.wt;WEIGHTS[i][1]=+s.value;const lab=$(`[data-wv="${i}"]`);if(lab)lab.textContent=s.value+'%';const tot=WEIGHTS.reduce((a,w)=>a+w[1],0);const tl=$('#wTot');if(tl){tl.textContent=tot+'%';tl.style.color=tot===100?'var(--status-done)':'var(--ink-2)';}saveSettings();});
  const wr=$('#wReset'); if(wr) wr.onclick=()=>{[40,30,20,10].forEach((v,i)=>WEIGHTS[i][1]=v);saveSettings();renderSettings();toast('已重置为默认权重');};
}

/* 主简历资料(MASTER)编辑器接线:条目字段 / 要点 / 增删 / 星标 / 加分项文本 —— 改即存(走 resumes 哨兵,AI 可读专业层,不含联系方式)。 */
function wireMasterSection(){
  $$('#page-settings [data-mef]').forEach(inp=>{ inp.onchange=()=>{ const a=inp.dataset.mef.split('|'),k=a[0],i=+a[1],f=a[2]; if(MASTER[k]&&MASTER[k][i]){ MASTER[k][i][f]=inp.value; persistMaster(); } }; });
  $$('#page-settings [data-mebul]').forEach(ta=>{ ta.onchange=()=>{ const a=ta.dataset.mebul.split('|'),k=a[0],i=+a[1]; if(MASTER[k]&&MASTER[k][i]){ MASTER[k][i].bullets=ta.value.split('\n').map(s=>s.trim()).filter(Boolean); persistMaster(); } }; });
  $$('#page-settings [data-madd]').forEach(b=>b.onclick=()=>{ const k=b.dataset.madd; if(!Array.isArray(MASTER[k])) MASTER[k]=[]; MASTER[k].push(k==='projects'?{name:'',date:'',link:'',bullets:[],star:false}:{org:'',title:'',date:'',loc:'',bullets:[]}); persistMaster(); renderSettings(); });
  $$('#page-settings [data-mdel]').forEach(b=>b.onclick=()=>{ const a=b.dataset.mdel.split('|'),k=a[0],i=+a[1]; if(MASTER[k]){ MASTER[k].splice(i,1); persistMaster(); renderSettings(); } });
  $$('#page-settings [data-mpstar]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.mpstar; if(MASTER.projects&&MASTER.projects[i]){ MASTER.projects[i].star=!MASTER.projects[i].star; persistMaster(); renderSettings(); } });
  $$('#page-settings [data-mx]').forEach(ta=>{ ta.onchange=()=>{ MASTER[ta.dataset.mx]=ta.value; persistMaster(); }; });
}

/* 追加进壳 data tab 尾部的"我的简历"行(RESUME 是 jobseek 全局,故不留在平台 renderSettings 里)。 */
function dataResumeRowHTML(){
  const row=(k,v)=>`<div class="set-row"><span class="sk">${k}</span><div>${v}</div></div>`;
  return row(tt('我的简历','My resume'),`<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;"><span class="mono" style="font-size:12px;color:var(--ink-2);">${RESUME.filename}</span><button class="btn" onclick="openResumeModal()">${tt('管理简历','Manage resume')}</button></div>`);
}
