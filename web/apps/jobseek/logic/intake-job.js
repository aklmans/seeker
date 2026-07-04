// @ts-nocheck —— 原样搬自未经 tsc 的单体,保持零回归;逻辑模块化阶段(3.y)再逐步类型化。
/** jobseek · 岗位智能录入(平台化阶段3 逐页搬迁)。classic 全局语义不变;依赖见 ../monolith-globals.d.ts。 */
/* ---------- NEW JOB MODAL ---------- */
// 真·JD 技能抽取(评审 P1-8):扫 JD 文本匹配已知技能词(用户 SKILLS 名 + 技术词表),反映真实 JD,非写死。
const TECH_VOCAB=['Go','Java','Python','Rust','C++','C#','JavaScript','TypeScript','Node','React','Vue','Spring','MySQL','PostgreSQL','MongoDB','Redis','Kafka','RabbitMQ','Elasticsearch','gRPC','RPC','GraphQL','RESTful','微服务','分布式系统','分布式','高并发','性能优化','系统设计','服务治理','容量规划','DDD','缓存','消息队列','K8s','Kubernetes','Docker','云原生','中间件','稳定性','高可用','可用性','监控','CI/CD','算法','数据结构','Linux','网络','多线程','并发','存储','数据库','大数据','Hadoop','Spark','Flink'];
function extractJdSkills(text){
  if(!text || !text.trim()) return [];
  const vocab=Array.from(new Set([...SKILLS.map(s=>s.name), ...TECH_VOCAB]));
  const found=vocab.filter(v=>v && text.includes(v));
  // 去子串重复(有"分布式系统"则去"分布式")+ 去重 + 上限
  const out=found.filter(v=>!found.some(o=>o!==v && o.includes(v)));
  return Array.from(new Set(out)).slice(0,12);
}
// AI 智能录入(块2):把整段招聘内容框定成"提取结构化岗位、只返回 seeker:job-create 块"。AI 不止摘抄,还归纳 summary/seniority/workMode/highlights/kind。
function frameJobExtract(blob, fromImage){
  const head = fromImage
    ? '你是岗位信息整理助手。请仔细阅读**这张图片**(招聘截图 / 岗位海报 / JD 文档页),从中识别并提取一个结构化岗位。'
    : '你是岗位信息整理助手。从下面的招聘内容里提取一个结构化岗位。';
  const schema = '**只**输出一个 ```seeker:job-create 代码块,'
    +'JSON 含字段:co(公司)、role(岗位名)、city(城市)、pay(薪资)、years(年限要求)、edu(学历)、need(必需技能数组)、'
    +'plus(加分技能数组)、jd(整理后的 JD 正文)、summary(一句话:这是什么岗 / 亮点)、seniority(初级/中级/高级/专家)、'
    +'workMode(远程/混合/驻场/未知)、highlights(2-3 条核心职责或亮点的数组)、kind(一线大厂/独角兽/外企/创业/其他)。'
    +'缺失字段留空字符串或空数组,可据内容合理归纳推断。不要调用任何工具,不要输出代码块以外的任何文字。';
  return head + schema + (fromImage ? '' : '\n\n招聘内容:\n"""\n'+blob+'\n"""');
}
function aiMetaHtml(mt){
  if(!mt || (!mt.summary && !mt.seniority && !mt.workMode && !mt.kind && !(mt.highlights&&mt.highlights.length))) return '';
  const e=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const tags=[mt.seniority,mt.workMode,mt.kind].filter(Boolean).map(t=>`<span class="chip">${e(t)}</span>`).join(' ');
  const hl=(mt.highlights||[]).map(h=>`<li>${e(h)}</li>`).join('');
  return `<div style="border:0.5px solid var(--border);padding:12px 14px;background:var(--bg-subtle);margin-top:12px;">
    <p class="mono" style="font-size:10px;letter-spacing:.12em;color:var(--ink-3);margin:0;">${tt('AI 归纳','AI SUMMARY')}</p>
    ${mt.summary?`<p style="font-size:13.5px;color:var(--ink);margin:7px 0 0;line-height:1.6;">${e(mt.summary)}</p>`:''}
    ${tags?`<div style="display:flex;gap:5px;flex-wrap:wrap;margin:8px 0 0;">${tags}</div>`:''}
    ${hl?`<ul style="margin:8px 0 0;padding-left:16px;font-size:12.5px;color:var(--ink-2);line-height:1.7;">${hl}</ul>`:''}</div>`;
}
function openNewJob(editId){
  const editing = (editId!=null) ? JOBS.find(j=>String(j.id)===String(editId)) : null;  // 编辑模式:预填 + 更新(否则新建)
  let aiMeta = editing ? {summary:editing.summary||'',seniority:editing.seniority||'',workMode:editing.workMode||'',highlights:Array.isArray(editing.highlights)?editing.highlights.slice():[],kind:editing.kind||''} : {summary:'',seniority:'',workMode:'',highlights:[],kind:''};
  const av=s=>String(s==null?'':s).replace(/"/g,'&quot;').replace(/</g,'&lt;');           // 属性值转义(预填)
  let scores = editing ? {interest:+editing.interest||5,growth:+editing.growth||5,match:+editing.match||5,chance:+editing.chance||5} : {interest:8,growth:6,match:7,chance:5};
  let extracted = (editing && Array.isArray(editing.need)) ? editing.need.slice() : [];   // JD 抽取的技能 → 存进 job.need;编辑时预填现有 need
  const scoreInput=(key,name,q)=>`<div class="scoreinput" data-score="${key}"><div class="si-head"><span class="si-name">${name}<span class="si-q">${q}</span></span><span class="si-val" data-sv="${key}">${scores[key]} / 10</span></div><div class="dotsrow" data-dots="${key}">${[...Array(10)].map((_,i)=>`<span class="${i<scores[key]?'on':''}" data-i="${i+1}"></span>`).join('')}</div></div>`;
  const html=`
    <div class="modal-head"><div><p class="eyebrow">— ${editing?'EDIT':'NEW'}</p><h2 style="margin-top:5px;">${editing?tt('编辑岗位','Edit job'):tt('录入新岗位','Add a new job')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div class="msec" id="aiDrop"><p class="seclabel">— ${tt('AI 智能录入','AI SMART ENTRY')}</p>
        <p style="font-size:12.5px;color:var(--ink-3);margin:6px 0 10px;line-height:1.6;">${tt('粘贴 JD / 招聘网页正文,选文件,或<b>直接把图片 · PDF · 文本拖进来</b>,让 AI 自动整理成下面的表单 —— 你只需核对、改两笔再保存。','Paste a JD / job-page content, pick a file, or <b>drag an image · PDF · text file in here</b>; AI fills the form below — review, tweak, save.')}</p>
        <textarea class="textarea" id="aiBlob" placeholder="${tt('粘贴 JD 或整页内容…(或选文件 / 直接扔招聘截图)','Paste a JD or full page content… (or pick a file / drop a screenshot)')}" style="min-height:84px;font-family:inherit;"></textarea>
        ${(window.SeekerRT&&window.SeekerRT.platform!=='web')?`<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
          <input class="input" id="aiUrl" placeholder="${tt('或粘贴 JD 网址,抓取正文(只抓文本·内网地址会被拒)','Or paste a JD URL to fetch its text (text only · internal addresses blocked)')}" style="flex:1;">
          <button class="btn" id="aiFetchBtn">${tt('抓取','Fetch')}</button>
        </div>`:''}
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">
          <button class="btn btn-accent" id="aiExtract">${tt('让 AI 整理 →','Let AI organize →')}</button>
          <button class="btn" id="aiFileBtn">${tt('选文件 .txt/.md/.pdf','Pick .txt/.md/.pdf')}</button>
          <button class="btn" id="aiImgBtn">${tt('扔图片 / 截图','Image / screenshot')}</button>
          <input type="file" id="aiFile" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" style="display:none">
          <input type="file" id="aiImg" accept="image/*" style="display:none">
          <span class="mono" id="aiStatus" style="font-size:11px;color:var(--ink-mute);"></span>
        </div>
        <div id="aiMeta">${editing?aiMetaHtml(aiMeta):''}</div>
      </div>
      ${editing?'':`<button class="btn-text" id="njManualToggle" style="margin:2px 0 12px;color:var(--ink-mute);">${tt('或手动填写全部字段 ▾','Or fill in all fields manually ▾')}</button>`}
      <div id="njManual"${editing?'':' style="display:none;"'}>
      <div class="msec"><p class="seclabel">— BASIC INFO</p>
        <div class="field-row"><div class="field"><label>${tt('公司','Company')}</label><input class="input" id="njCo" placeholder="${tt('如 · 字节跳动','e.g. ByteDance')}" value="${editing?av(editing.co):''}"></div><div class="field"><label>${tt('岗位','Role')}</label><input class="input" id="njRole" placeholder="${tt('如 · 后端高级工程师','e.g. Senior Backend Engineer')}" value="${editing?av(editing.role):''}"></div></div>
        <div class="field-row"><div class="field"><label>${tt('城市','City')}</label><select class="select" id="njCity">${['北京','上海','深圳','杭州','广州'].map(c=>`<option ${editing&&editing.city===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label>${tt('来源','Source')}</label><select class="select" id="njSource">${[['BOSS直聘','BOSS Zhipin'],['官网','Official site'],['社群','Community / group'],['内推','Referral'],['猎头','Headhunter'],['其他','Other']].map(o=>`<option value="${o[0]}" ${editing&&editing.src===o[0]?'selected':''}>${tt(o[0],o[1])}</option>`).join('')}</select></div></div>
        <div class="field-row"><div class="field"><label>${tt('薪资范围','Salary')}</label><input class="input" id="njPay" placeholder="${tt('如 · 40-65万','e.g. 40-65w')}" value="${editing?av(editing.pay):''}"></div><div class="field"><label>${tt('年限要求','Years')}</label><input class="input" id="njYears" placeholder="${tt('如 · 5+','e.g. 5+')}" value="${editing?av(editing.years):''}"></div></div>
      </div>
      <div class="msec"><p class="seclabel">— FULL JD</p><div class="field" style="margin-top:10px;"><textarea class="textarea" id="jdInput" placeholder="${tt('把 JD 完整粘贴在这里…','Paste the full JD here…')}">${editing?String(editing.jd||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'):''}</textarea></div>
        <button class="btn" id="analyzeBtn">${tt('重新解析','Re-parse')}</button><span class="mono" style="font-size:11px;color:var(--ink-mute);margin-left:8px;">${tt('粘贴 JD 自动抽取技能','Paste JD to auto-extract skills')}</span><div id="analyzeResult" style="margin-top:14px;"></div></div>
      <div class="msec" style="border-bottom:none;"><p class="seclabel">— SCORING</p><div style="margin-top:8px;">
        ${scoreInput('interest',tt('兴趣','Interest'),tt('这个岗位让我激动吗?','Does this job excite me?'))}
        ${scoreInput('growth',tt('成长','Growth'),tt('能让我变强吗?','Will it make me stronger?'))}
        ${scoreInput('match',tt('匹配','Match'),tt('我现在的能力对得上吗?','Do my skills fit now?'))}
        ${scoreInput('chance',tt('机会','Odds'),tt('我能拿下吗?','Can I land it?'))}
      </div></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="toast('已保存草稿')">${tt('保存草稿','Save draft')}</button><button class="btn btn-accent" id="saveJob">${tt('完成录入','Save job')}</button></div>`;
  const m=openModal(html, true);
  $$('[data-dots]',m).forEach(row=>{
    const key=row.dataset.dots;
    $$('span',row).forEach(dot=>{
      dot.onclick=()=>{const v=+dot.dataset.i;scores[key]=v;$$('span',row).forEach(d=>d.classList.toggle('on',+d.dataset.i<=v));$(`[data-sv="${key}"]`,m).textContent=v+' / 10';};
    });
  });
  // 渐进式表单(新建态):手动区默认折叠;点「或手动填写」或 AI 填好后展开(编辑态本就展开)。
  const njMan=$('#njManual',m), njTog=$('#njManualToggle',m);
  const revealManual=()=>{ if(njMan) njMan.style.display=''; if(njTog) njTog.style.display='none'; };
  if(njTog) njTog.onclick=revealManual;
  const jdEl=$('#jdInput',m), resEl=$('#analyzeResult',m);
  const paint=()=>{ if(!resEl) return;                  // 渲染当前 extracted(不重新抽取;编辑时展示现有 need 不丢)
    resEl.innerHTML = extracted.length
      ? `<div style="border:0.5px solid var(--border);padding:14px;background:var(--bg-subtle);">
          <p style="font-size:12px;color:var(--ink-3);margin:0 0 6px;">${tt('抽取的技能 · 作为该岗位要求','Extracted skills · this job\'s requirements')} (${extracted.length})</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${extracted.map(s=>`<span class="chip">${String(s).replace(/</g,'&lt;')}</span>`).join('')}</div></div>`
      : ((jdEl&&jdEl.value.trim()) ? `<p class="mono" style="font-size:12px;color:var(--ink-mute);">${tt('未识别到明确技能,可录入后手动补充。','No clear skills detected — add them after saving.')}</p>` : '');
  };
  const runParse=()=>{ extracted=extractJdSkills(jdEl?jdEl.value:''); paint(); }; // 重新抽取(扫 JD 文本)
  if(editing && extracted.length) paint();               // 编辑:先展示现有 need(用户改 JD 再触发重抽取)
  let _pt=null;
  if(jdEl) jdEl.oninput=()=>{ clearTimeout(_pt); _pt=setTimeout(runParse, 400); }; // 粘贴 / 输入即自动解析(防抖,去多余点击)
  const ab=$('#analyzeBtn',m); if(ab) ab.onclick=runParse;                          // 按钮 = 重新解析
  // AI 智能录入(块2 文本/文件 + 块3 图片):内容 → rt.ai.extract(无工具/历史/系统提示)→ 填下方表单 + 归纳;
  // 用户核对后保存(AI 只填,保存扳机始终在用户;AI 不静默落库)。
  const fillFromExtract=(d)=>{
    const set=(sel,v)=>{ const el=$(sel,m); if(el && v!=null && String(v)!=='') el.value=String(v); };
    set('#njCo', d.co); set('#njRole', d.role); set('#njPay', d.pay); set('#njYears', d.years);
    const cs=$('#njCity',m); if(cs && d.city){ const opt=[...cs.options].find(o=>o.value===d.city||o.textContent===d.city); if(opt) cs.value=opt.value; }
    set('#jdInput', d.jd);
    if(Array.isArray(d.need)) extracted=d.need.slice();
    paint();
    aiMeta={ summary:d.summary||'', seniority:d.seniority||'', workMode:d.workMode||'', highlights:Array.isArray(d.highlights)?d.highlights:[], kind:d.kind||'' };
    const mt=$('#aiMeta',m); if(mt) mt.innerHTML=aiMetaHtml(aiMeta);
    revealManual(); // AI 填好 → 自动展开手动区供核对
  };
  const doExtract=async(prompt, imageDataUrl)=>{
    const sEl=$('#aiStatus',m);
    if(!aiChatAvailable()){ if(sEl) sEl.textContent=''; toast(tt('需先在「数据设置」配置 AI 模型','Configure an AI model in Settings first')); return; }
    if(sEl) sEl.textContent=tt('AI 整理中…','AI is organizing…');
    try{
      const text=await window.SeekerRT.ai.extract({ prompt, imageDataUrl: imageDataUrl||null });
      const b=extractSeekerBlock(text||'', 'job-create');
      if(b.data){ fillFromExtract(b.data); if(sEl) sEl.textContent=tt('已整理,请核对下方表单 ↓','Done — review the form below ↓'); }
      else if(sEl) sEl.textContent=tt('未能解析,请手动填写或重试','Could not parse — fill manually or retry');
    }catch(e){ if(sEl) sEl.textContent=String((e&&e.message)||e); }
  };
  const aiExtractBtn=$('#aiExtract',m);
  if(aiExtractBtn) aiExtractBtn.onclick=async()=>{
    const blob=(($('#aiBlob',m)||{}).value||'').trim();
    if(!blob){ toast(tt('先粘贴 JD / 内容,或选图片','Paste a JD / content, or pick an image')); return; }
    const old=aiExtractBtn.textContent; aiExtractBtn.disabled=true; aiExtractBtn.textContent=tt('整理中…','Organizing…');
    await doExtract(frameJobExtract(blob), null);
    aiExtractBtn.disabled=false; aiExtractBtn.textContent=old;
  };
  // 受控抓取:URL → rt.web.fetch(平台核出口 + SSRF 护栏)→ 填录入框供人审 → 走现有抽取。
  const aiFetchBtn=$('#aiFetchBtn',m), aiUrlI=$('#aiUrl',m);
  if(aiFetchBtn) aiFetchBtn.onclick=async()=>{
    const url=((aiUrlI&&aiUrlI.value)||'').trim(); const sEl=$('#aiStatus',m);
    if(!url){ toast(tt('请填 JD 网址','Enter a JD URL')); return; }
    aiFetchBtn.disabled=true; if(sEl) sEl.textContent=tt('抓取中…','Fetching…');
    try{
      const text=await window.SeekerRT.web.fetch(url);
      const blobI=$('#aiBlob',m); if(blobI) blobI.value=text;
      if(sEl) sEl.textContent=tt('已抓取,核对后点「让 AI 整理」↓','Fetched — review, then “Let AI organize” ↓');
    }catch(e){ if(sEl) sEl.textContent=''; toast(String((e&&e.message)||e)); }
    finally{ aiFetchBtn.disabled=false; }
  };
  // 共享文件摄入(文件选择器 + 拖放共用):图片→多模态抽取;PDF→平台提取文字填框;文本→读入框。
  const ingestFile=(f)=>{
    if(!f) return; const ta=$('#aiBlob',m), sEl=$('#aiStatus',m);
    const name=(f.name||'').toLowerCase();
    const isImg=(f.type||'').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/.test(name);
    const isPdf=f.type==='application/pdf' || /\.pdf$/.test(name);
    const isText=(f.type||'').startsWith('text/') || /\.(txt|md|markdown|csv|json)$/.test(name);
    if(isImg){
      if(sEl) sEl.textContent=tt('读取图片…','Reading image…');
      const rd=new FileReader(); rd.onload=async()=>{ await doExtract(frameJobExtract('', true), String(rd.result||'')); }; rd.readAsDataURL(f);
    } else if(isPdf){
      // 块3b:PDF → 平台层提取文字 → 填粘贴框(用户核对后点「整理」;扫描件取不到字会报错引导用截图)。
      if(sEl) sEl.textContent=tt('提取 PDF 文字…','Extracting PDF text…');
      const rd=new FileReader(); rd.onload=async()=>{ try{ const text=await window.SeekerRT.docs.pdfText(String(rd.result||'')); if(ta) ta.value=text; if(sEl) sEl.textContent=tt('已提取文字 → 点「让 AI 整理」(或先编辑)','Text extracted → click "Let AI organize" (or edit first)'); }catch(e){ if(sEl) sEl.textContent=String((e&&e.message)||e); } }; rd.readAsDataURL(f);
    } else if(isText){
      const rd=new FileReader(); rd.onload=()=>{ if(ta) ta.value=String(rd.result||''); if(sEl) sEl.textContent=tt('已读入 → 点「让 AI 整理」','Loaded → click "Let AI organize"'); }; rd.readAsText(f);
    } else if(sEl){ sEl.textContent=tt('不支持的文件类型(用图片 / PDF / 文本)','Unsupported file (use image / PDF / text)'); }
  };
  const aiFileBtn=$('#aiFileBtn',m), aiFile=$('#aiFile',m);
  if(aiFileBtn&&aiFile){ aiFileBtn.onclick=()=>aiFile.click(); aiFile.onchange=()=>{ ingestFile(aiFile.files&&aiFile.files[0]); aiFile.value=''; }; }
  const aiImgBtn=$('#aiImgBtn',m), aiImg=$('#aiImg',m);
  if(aiImgBtn&&aiImg){ aiImgBtn.onclick=()=>aiImg.click(); aiImg.onchange=()=>{ ingestFile(aiImg.files&&aiImg.files[0]); aiImg.value=''; }; }
  // 拖放:把图片/PDF/文本直接拖进 AI 录入区(与选择器并存)。仅当拖的是文件时拦默认 → 文本拖入文本框仍走浏览器默认。
  const aiDrop=$('#aiDrop',m);
  if(aiDrop){
    const hasFiles=e=>!!(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes('Files'));
    ['dragenter','dragover'].forEach(ev=>aiDrop.addEventListener(ev, e=>{ if(!hasFiles(e)) return; e.preventDefault(); aiDrop.classList.add('ai-dragover'); }));
    aiDrop.addEventListener('dragleave', e=>{ if(!aiDrop.contains(e.relatedTarget)) aiDrop.classList.remove('ai-dragover'); });
    aiDrop.addEventListener('drop', e=>{ if(!hasFiles(e)) return; e.preventDefault(); aiDrop.classList.remove('ai-dragover'); const f=e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) ingestFile(f); });
  }
  $('#saveJob',m).onclick=()=>{
    const co=(($('#njCo',m)||{}).value||'').trim();
    const role=(($('#njRole',m)||{}).value||'').trim();
    if(!co||!role){ toast(tt('请填写公司与岗位','Company and role required')); return; }
    const fields={ co, role,
      city:(($('#njCity',m)||{}).value)||'',
      src:(($('#njSource',m)||{}).value)||'',         // 修真 bug:字段名 src(此前 'source',与详情页 j.src 不一致→来源不显示)
      pay:(($('#njPay',m)||{}).value||'').trim(),
      years:(($('#njYears',m)||{}).value||'').trim(),
      jd:(($('#jdInput',m)||{}).value||'').trim(),
      interest:scores.interest, growth:scores.growth, match:scores.match, chance:scores.chance,
      need:extracted.slice(),                         // need 存 JD 抽取(此前写死 []→用户岗位匹配/分析全空)
      summary:aiMeta.summary||'', seniority:aiMeta.seniority||'', workMode:aiMeta.workMode||'', highlights:Array.isArray(aiMeta.highlights)?aiMeta.highlights:[], kind:aiMeta.kind||(editing&&editing.kind)||''  // AI 归纳字段
    };
    if(editing){ Object.assign(editing, fields); persistJob(editing); }  // 编辑:就地更新 + 持久化(不新建)
    else{ const job=Object.assign({ id:nextJobId(), status:'todo', kind:'', edu:'', plus:[] }, fields); JOBS.unshift(job); persistJob(job); } // 新建(status='todo' 合法键;补 edu 防详情 undefined)
    [renderJobs,renderOverview,renderAnalysis,renderInterview].forEach(f=>{try{f();}catch(_e){}});
    closeModal();
    toast(editing?tt('岗位已更新','Job updated'):tt('岗位已录入','Job added'));
  };
}
