// @ts-nocheck —— 3.y 类型化:本文件转 ES module、改 import 消费 modal.js(证 import 方向)。
//   其余依赖($/el/tt/IC/cEsc/RESUME/aiRun/go)过渡仍 classic 全局,故暂留 @ts-nocheck;待其转 module 后接 import + @ts-check。
/** jobseek · 简历弹窗。openModal 经 import(3.y 首个消费者迁移);closeModal 只出现在内联 onclick 串→仍走 window 兼容桥。 */
import { openModal } from '../../../platform/shell/modal.js'; // ← 3.y:modal.js 已 ESM 化,首个消费者改 import(证 import 方向、纯函数 dual-publish 安全)
/* ---------- RESUME modals ---------- */
function openResumeModal(){
  const html=`<div class="modal-head"><div><p class="eyebrow">— RESUME</p><h2 style="margin-top:5px;">${tt('我的简历','My resume')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="resume-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;">
        <div><div style="font-size:15px;font-weight:600;color:var(--ink);">${cEsc(RESUME.filename)}</div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3);margin-top:5px;">${tt('上传于 '+RESUME.uploaded+' · 已解析','Uploaded '+RESUME.uploaded+' · parsed')}</div></div>
        <span class="acbadge ac-compound">${tt('已建档','Built')}</span></div>
        <p style="font-size:13px;color:var(--ink-2);margin:14px 0 0;line-height:1.7;">${cEsc(RESUME.summary)}</p>
        <div style="display:flex;gap:28px;margin-top:16px;">${[[tt('识别能力','Skills'),RESUME.derivedSkills],[tt('项目证据','Evidence'),RESUME.derivedEvidence],[tt('工作年限','Years'),RESUME.years]].map(x=>`<div><p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--ink-3);margin:0;">${x[0]}</p><p style="font-family:var(--font-serif);font-size:22px;color:var(--ink);margin:4px 0 0;font-weight:500;">${x[1]}</p></div>`).join('')}</div>
      </div>
      <p style="font-size:12.5px;color:var(--ink-3);margin:16px 0 0;line-height:1.7;">${tt('简历是整个产品的输入源 —— 上传一次,AI 自动建好你的能力档案、匹配所有岗位、生成改写与计划。你不用手填 23 项技能。','The resume is the product\'s input source — upload once and AI builds your assets, matches every job, and generates rewrites & plans. No manually entering 23 skills.')}</p>
    </div>
    <div class="modal-foot"><button class="btn" id="reupload">${tt('重新上传','Re-upload')}</button><button class="btn btn-accent" onclick="closeModal()">${tt('完成','Done')}</button></div>`;
  const m=openModal(html);
  $('#reupload',m).onclick=openResumeUpload;
}
function openResumeUpload(){
  const html=`<div class="modal-head"><div><p class="eyebrow">— UPLOAD</p><h2 style="margin-top:5px;">${tt('上传简历,AI 自动建档','Upload resume, AI auto-builds')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body"><div id="upZone"><div class="dropzone" id="dz"><p class="di" style="margin:0;font-size:14px;">${tt('点击或拖拽简历到此','Click or drag your resume here')}<br><span style="font-size:12px;">${tt('支持 PDF / Word / 纯文本','PDF / Word / plain text')}</span></p></div>
      <p style="font-size:12px;color:var(--ink-3);margin:14px 0 0;line-height:1.7;">${tt('无需手动录入技能。AI 会从简历里识别你的能力、年限与项目证据,自动建好档案。','No manual entry. AI reads your skills, years, and project evidence from the resume and builds your profile automatically.')}</p></div></div>`;
  const m=openModal(html);
  const dz=$('#dz',m);
  const startParse=()=>{
    const z=$('#upZone',m);
    z.innerHTML=`<div class="ai-panel"><div class="ai-bar"><span class="dot"></span><span class="lbl"><b>AI</b> ${tt('解析简历中','Parsing resume')}</span></div><div id="upHost"></div></div>`;
    aiRun(z.querySelector('#upHost'),
      [tt('提取文本与结构','Extracting text & structure'),tt('识别技能关键词与熟练度','Identifying skills & proficiency'),tt('抽取项目经历与量化结果','Extracting projects & metrics'),tt('匹配到能力档案分类(专业 / 通用 / 元能力)','Mapping to asset categories')],
      ()=>`<div style="padding:20px 18px 22px;"><p style="font-size:14px;color:var(--ink);margin:0 0 12px;font-weight:500;">${tt('解析完成 ✓','Parsing complete ✓')}</p>
        <div style="display:flex;gap:30px;">${[[tt('识别能力','Skills'),23],[tt('项目证据','Evidence'),15],[tt('工作年限','Years'),8]].map(x=>`<div><p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.16em;color:var(--ink-3);margin:0;">${x[0]}</p><p style="font-family:var(--font-serif);font-size:24px;color:var(--accent);margin:4px 0 0;font-weight:500;">${x[1]}</p></div>`).join('')}</div>
        <p style="font-size:12.5px;color:var(--ink-3);margin:16px 0 0;line-height:1.7;">${tt('已自动写入「职业资产」。你现在可以直接去智能匹配任何岗位 —— 全程零手动录入。','Written into Career Assets. You can now match any job directly — zero manual entry.')}</p>
        <button class="btn btn-accent" style="margin-top:16px;" onclick="closeModal();go('match')">${tt('去智能匹配','Go to Smart Match')} →</button></div>`,
      {label:tt('解析简历中…','Parsing resume…')});
  };
  if(dz){
    dz.onclick=startParse;
    // 拖放:与「点击」一致触发解析(履行"点击或拖拽"文案;文档级守卫已防文件误导航)。
    const hasFiles=e=>!!(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes('Files'));
    ['dragenter','dragover'].forEach(evn=>dz.addEventListener(evn, e=>{ if(!hasFiles(e)) return; e.preventDefault(); dz.classList.add('dz-over'); }));
    dz.addEventListener('dragleave', e=>{ if(!dz.contains(e.relatedTarget)) dz.classList.remove('dz-over'); });
    dz.addEventListener('drop', e=>{ if(!hasFiles(e)) return; e.preventDefault(); dz.classList.remove('dz-over'); startParse(); });
  }
}
/* 过渡 window 兼容桥(约束⑤延续):inline onclick(copilot-actions cBtn)/页按钮按全局名调 openResumeModal/openResumeUpload → 零回归;逐个改 import 后摘。纯函数、零模块态 → dual-publish 安全。 */
window.openResumeModal=openResumeModal; window.openResumeUpload=openResumeUpload;
