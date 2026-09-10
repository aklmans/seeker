// @ts-nocheck —— 抽壳序5-c-3 过渡:设置页框架(壳部分)。非纯剪切——拆分 + 契约消费,逐处偏离已标注;逻辑对等验证见 commit message。
/** 平台 · 设置页框架:tab 栏 + 壳 tab(basic/profile/model/data/about)+ 契约消费(goals/weights 等 app tab、
 *  profile/data tab 尾部 extend)。依赖 SeekerShell.appSettings()(序5-c-1 契约,序5-c-2 首个消费者 jobseek)。
 *  ★双红线延续:profile tab 的 PROFILE 字段部分经 import { PROFILE, persistProfileField } from './profile.js'(批8;profile.js 不上 window 桥、隐私最小暴露),
 *  本文件只拼版式、不碰 rt.profile;设置不可经对话改(本文件是唯一改设置入口,Agent 不可达)。
 *  过渡期跨壳全局引用(同 setState 先例 + currentPage 访问器[原裸 current],非 app 专属、未来 3.y 可再收):
 *  setState/settingsPersistOn/saveSettings/hydrateSettings/WEIGHTS(index.html,归属定另刀)、
 *  clearAllDataFlow(index.html,内部混 jobseek setDemoMode + CLEARABLE_COLLS,归属定另刀)。
 *  ⚠ 非纯剪切偏离(逐条披露):
 *   ① sections.profile/data 的 jobseek 内容(masterSectionHTML()/RESUME.filename 行)→ 改经 appSettings().extend 拼接;
 *   ② sections.goals/weights → 改经 appSettings().tabs 遍历生成(内容来自 jobseek settings-jobseek.js,逐字节未变,只是拼接方式变);
 *   ③ SET_TABS 裁剪平台 5 tab + app tabs 按契约插入同一视觉位置(basic,profile,model,[app tabs],data,about)——最终 7 tab 同序,非同一数组字面量;
 *   ④ data-tc(训练计入能力成长)wiring 的 renderSkills() → rerenderPages()(通用重渲,平台已有机制,避免平台具名调 jobseek 渲染器)。 */
import { PROFILE, persistProfileField, hydrateProfile } from './profile.js';
import { $, $$, el } from './dom.js';
import { normalizeBackupPolicy, persistBackupPolicy } from '../runtime/backup-policy.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { renderModelSettings } from './model-settings.js';
import { themeMode, setThemeMode, saveAppearance, applyAppearance } from './appearance.js';
import { renderDataSummary } from './data-settings.js';
import { renderCreationStyleSettings } from '../creations/personal-styles.js';
import { openHistoryManager } from './history-settings.js';
import { cEsc, renderProjectSwitch, switchProject } from './copilot-chrome.js';
import { setCurrentProjectId } from './project-state.js';
import { openModal } from './modal.js';
import { currentPage, frontis, go, renderTopActions, setLang, signFoot } from './nav.js';
import { isDesktop } from './shell-keys.js';
import { clearAllDataFlow, hydrateSettings, saveSettings, setState, settingsPersistOn } from './shell-state.js';
import { errText, toast } from './toast.js'; // ★P1-c:toastUndo 随记忆管理搬迁至 memory-docs.js,此处已无消费者
let settingsState={tab:'basic'};
export function openModelSettings(){settingsState.tab='model';renderSettings();go('settings');}
let backupPolicyHydrated=false, backupPolicyLoading=false, backupLastAt=null;
const SET_TABS_SHELL=[['basic',['基本设置','Basics']],['profile',['个人信息','Profile']],['model',['模型配置','Model']],['data',['数据管理','Data']],['about',['关于','About']]];

export function renderSettings(){
  setState.theme=themeMode();
  const seg=(opts,sel,attr)=>`<div class="seg">${opts.map(o=>`<button class="${o[0]===sel?'on':''}" data-${attr}="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  const row=(k,v)=>`<div class="set-row"><span class="sk">${k}</span><div>${v}</div></div>`;
  const sections={};
  const appSpecs=window.SeekerShell.appSettings();
  const extendHTML=tabId=>appSpecs.flatMap(s=>(s.extend&&s.extend[tabId])?[s.extend[tabId].render()]:[]).join('');
  const desktopBackup=typeof isDesktop==='function'&&isDesktop();
  const backupControl=desktopBackup
    ? seg([['on',tt('开','On')],['off',tt('关','Off')]],setState.autobackup,'ab')
    : `<span style="font-size:12px;color:var(--ink-3);">${tt('仅桌面端支持','Desktop only')}</span>`;
  const backupLast=desktopBackup
    ? (!backupPolicyHydrated?tt('读取中…','Loading…'):(backupLastAt?new Date(backupLastAt).toLocaleString():tt('尚无自动备份','No automatic backup yet')))
    : tt('浏览器无法后台自动备份','Browsers cannot run background backups');
  sections.basic=`<p class="seclabel">— BASIC</p><h2 class="sectitle">${tt('外观与偏好','Appearance & preferences')}<span class="dot">.</span></h2><div style="margin-top:14px;max-width:560px;">
    ${row(tt('主题模式','Theme'),seg([['light',tt('浅色','Light')],['dark',tt('深色','Dark')],['system',tt('跟随系统','System')]],setState.theme,'theme'))}
    ${row(tt('正文字号','Font size'),seg([['13','13'],['14','14'],['15','15'],['16','16']],setState.fontsize,'fs'))}
    ${row(tt('界面语言','Language'),seg([['zh','中文'],['en','English']],setState.lang,'lang'))}
    ${row(tt('界面密度','Density'),seg([['compact',tt('紧凑','Compact')],['standard',tt('标准','Standard')],['cozy',tt('宽松','Cozy')]],setState.density,'density'))}
    ${row(tt('减少动效','Reduce motion'),seg([['on',tt('开','On')],['off',tt('关','Off')]],setState.motion,'motion'))}
  </div>`;
  sections.profile=`<p class="seclabel">— PROFILE · PRIVATE</p><h2 class="sectitle">${tt('个人信息','Personal info')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 14px;max-width:640px;line-height:1.7;">${tt('这些信息仅保存在本地，<b>AI 不会读取或修改</b>。填写是可选的，日常提问与工具无需提供联系方式。','Stored locally only — <b>AI never reads or edits it</b>. These fields are optional; everyday chat and tools do not require contact details.')}</p>
    <div style="max-width:520px;">
      ${[['name',tt('姓名','Name')],['city',tt('城市','City')],['phone',tt('电话','Phone')],['email',tt('邮箱','Email')],['site',tt('个人主页（可选）','Website (optional)')]].map(f=>`<div class="set-row"><span class="sk">${f[1]}</span><input class="input" data-pf="${f[0]}" value="${cEsc(PROFILE[f[0]]||'')}"></div>`).join('')}
    </div>
    <div class="lock-note" style="margin-top:14px;max-width:640px;"><span class="li">🔒</span><span>${tt('个人信息通过独立通道保存，不参与 AI 处理；完整备份会包含这些字段，请自行保管。','Personal info is saved through a separate channel and excluded from AI processing. Full backups contain these fields; keep your backup private.')}</span></div>
    ${extendHTML('profile')}`;
  sections.model='<div id="modelSettings"></div>';
  sections.creations=`<h2 class="sectitle">${tt('作品样式','Creation styles')}<span class="dot">.</span></h2><div id="creationStyleSettings"></div>`;
  sections.workspace=`<h2 class="sectitle">${tt('工作空间与应用','Workspaces & apps')}<span class="dot">.</span></h2><p>${tt('设置空间名称、助手指令、启动页面、首页内容，以及需要开启的应用。','Set workspace names, assistant instructions, launch page, Home content and enabled apps.')}</p><button class="btn btn-accent" data-go="workspaces">${tt('管理工作空间','Manage workspaces')}</button>`;
  const appTabs=appSpecs.flatMap(s=>s.tabs||[]);
  appTabs.forEach(t=>{ sections[t.id]=t.render(); });
  sections.data=`<p class="seclabel">— DATA</p><h2 class="sectitle">${tt('数据与备份','Data & backup')}<span class="dot">.</span></h2><div style="margin-top:14px;max-width:600px;">
    <div id="dataSummary"></div>
    <p style="color:var(--ink-3);line-height:1.8;">${tt('完整备份覆盖全部工作空间、对话、应用数据（含已关闭应用）、本地资料原文件、任务记录、个人信息与便携偏好，不含系统钥匙串密钥。任务生成的外部报告文件需另外保存。','Full backups cover all workspaces, conversations, app data (including disabled apps), imported source files, task records, personal info and portable preferences. System keychain secrets are excluded. Save generated report files separately.')}</p>
    ${extendHTML('data')}
    ${row(tt('备份全部空间','Back up all workspaces'),`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn" id="dataExport">${tt('完整备份 JSON','Full JSON backup')}</button><button class="btn" id="dataExportRedacted">${tt('精简导出','Reduced export')}</button></div>`)}
    <p style="color:var(--ink-3);">${tt('精简导出排除个人信息、记忆、知识库、原文件与任务明细，但仍可能含对话和笔记正文。分享前请检查内容。','Reduced exports exclude personal info, memories, knowledge documents, imported files and task details, but may still contain conversation and note text. Review the contents before sharing.')}</p>
    ${row(tt('导入数据','Import data'),`<button class="btn" id="dataImport">${tt('导入文件','Import file')}</button><input type="file" id="dataImportFile" accept=".json,application/json" style="display:none">`)}
    ${row(tt('自动备份','Auto backup'),backupControl)}
    ${row(tt('上次自动备份','Last automatic backup'),`<span class="mono" style="font-size:13px;color:var(--ink-2);">${backupLast}</span>`)}
    <!-- 「演示空状态 · 查看引导态」行(showEmptyState=jobseek 符号)已随批11B 末件迁入 jobseek 的 data extend(dataResumeRowHTML,extendHTML('data') 位),平台不再裸读 apps 符号。 -->
    <div style="margin:14px 0 2px;"><p class="seclabel">— ${tt('隐私 · 历史与记忆','Privacy · history & memory')}</p></div>
    ${row(tt('会话历史','Chat history'),`<button class="btn" id="mgrHistory">${tt('查看与清除','View & clear')}</button>`)}
    ${row(tt('长期记忆','Long-term memory'),`<button class="btn" id="mgrMemory">${tt('去能力中心管理','Manage in Capability Center')}</button>`)}
    ${row(tt('知识库 · 文档','Knowledge · docs'),`<button class="btn" id="mgrDocs">${tt('去能力中心管理','Manage in Capability Center')}</button>`)}
    <div class="lock-note" style="margin:6px 0 14px;max-width:640px;"><span class="li">🔒</span><span>${tt('会话历史与长期记忆都只存在本地。<b>AI 不会查询你的会话历史</b>(只在当轮对话内拿上下文);长期记忆里若有你主动写出的信息,可到<b>能力中心</b>查看或随时清除。<b>知识库文档</b>是你主动加入、供 AI 检索作答的语料(需配嵌入模型),其相关片段会用于回答 —— 同样只存本地、可在能力中心随时删除。你掌控自己的数据。','Chat history and long-term memory stay local only. <b>AI cannot query your chat history</b> (only in-conversation context); review or clear volunteered memory anytime in the <b>Capability Center</b>. <b>Knowledge docs</b> are material you add for the AI to retrieve from (needs an embed model); relevant chunks are used in answers — also local-only and deletable anytime in the Capability Center. You control your data.')}</span></div>
    <div style="margin:14px 0 2px;"><p class="seclabel">— ${tt('扩展 · 连接器','Extensions · Connectors')}</p></div>
    ${row(tt('MCP 服务器','MCP servers'),`<button class="btn" id="mgrMcp">${tt('去能力中心管理','Manage in Capability Center')}</button>`)}
    <div class="lock-note" style="margin:6px 0 14px;max-width:640px;"><span class="li">🧩</span><span>${tt('连接器(MCP)管理已移至<b>能力中心</b>,在那里统一查看与管理你接入的所有能力(增删启停 / 令牌 / 测试连接)。<b>本地服务器 = 在你电脑上运行一个程序;远程服务器 = 连接你填的 HTTP 端点</b>,请只加你信任的来源;鉴权令牌只存系统钥匙串、绝不外发;AI 每次调用其工具都会<b>先征得你同意</b>,返回内容被当作数据(不可信、防注入)。仅桌面端可用。','Connector (MCP) management has moved to the <b>Capability Center</b>, where every capability you connect is viewed and managed in one place (add / remove / enable, tokens, test connection). <b>A local server runs a program on your machine; a remote server connects to the HTTP endpoint you enter</b> — only add sources you trust. Auth tokens live only in the system keychain and never leave it; the AI <b>asks your permission every time</b> it calls a tool, and returned content is treated as untrusted data. Desktop only.')}</span></div>
    ${row(tt('清空所有数据','Clear all data'),`<button class="btn" id="clearAllData">${tt('清空','Clear')}</button>`)}
  </div>`;
  sections.about=`<p class="seclabel">— ABOUT</p><h2 class="sectitle">${tt('关于','About')}<span class="dot">.</span></h2>
    <div style="margin-top:14px;font-size:14px;color:var(--ink-2);line-height:1.9;">
      <div style="font-weight:600;color:var(--ink);">${tt('探索者 · Seeker','Seeker')}</div>
      <div class="mono" style="font-size:12px;color:var(--ink-3);margin:4px 0;">v 0.4.1 · 2026 · ${tt('本地优先','Local-first')}</div>
      <div style="color:var(--ink-3);max-width:600px;">${tt('本地优先的个人 AI 工作空间,整合对话、写作、本地资料、可编辑作品与任务 Agent。数据默认存于本地,密钥只进系统钥匙串,隐私信息永不参与 AI 处理。','A local-first personal AI workspace for conversations, writing, local materials, editable creations, and task agents. Data stays on your machine by default, keys live only in the system keychain, and private info never goes through AI.')}</div>
      <div style="display:flex;gap:14px;margin-top:14px;"><button class="btn" data-extlink="https://github.com/aklmans/seeker/releases">${tt('检查更新','Check updates')}</button><button class="btn" data-extlink="https://github.com/aklmans/seeker/issues">${tt('反馈问题','Send feedback')}</button></div>
    </div>`;
  const tabDefs=[SET_TABS_SHELL[0],['workspace',['工作空间','Workspaces']],['creations',['作品样式','Creation styles']],SET_TABS_SHELL[2],SET_TABS_SHELL[1]]
    .concat(appTabs.map(t=>[t.id,[t.label.zh,t.label.en]]))
    .concat([SET_TABS_SHELL[3],SET_TABS_SHELL[4]]);
  if(!sections[settingsState.tab])settingsState.tab='basic';
  const tabbar=`<div class="tabs" style="overflow-x:auto;flex-wrap:nowrap;margin-bottom:8px;">${tabDefs.map(t=>`<button class="tab ${settingsState.tab===t[0]?'on':''}" data-stab="${t[0]}" style="white-space:nowrap;">${setState.lang==='en'?t[1][1]:t[1][0]}</button>`).join('')}</div>`;
  $('#page-settings').innerHTML=frontis('SETTINGS',tt('设置','Settings'))+tabbar+`<div class="sec" style="border-bottom:none;padding-top:18px;">${sections[settingsState.tab]}</div>`+signFoot();
  $$('#page-settings [data-stab]').forEach(b=>b.onclick=()=>{settingsState.tab=b.dataset.stab;renderSettings();});
  $$('#page-settings [data-pf]').forEach(inp=>{inp.onchange=async()=>{inp.disabled=true;try{await persistProfileField(inp.dataset.pf,inp.value);}catch(e){toast(tt('个人信息未能保存：','Could not save personal info: ')+errText(e));}finally{inp.disabled=false;}};});
  $$('#page-settings [data-theme]').forEach(b=>b.onclick=()=>{try{setThemeMode(b.dataset.theme);$('#themeBtn2').innerHTML=document.documentElement.dataset.theme==='dark'?IC.sun:IC.moon;renderSettings();}catch(e){toast(errText(e));}});
  const saveLook=patch=>{try{saveAppearance(patch);hydrateSettings();renderSettings();}catch(e){toast(tt('外观未能保存：','Could not save appearance: ')+errText(e));}};
  $$('#page-settings [data-fs]').forEach(b=>b.onclick=()=>saveLook({fontsize:b.dataset.fs}));
  $$('#page-settings [data-lang]').forEach(b=>b.onclick=()=>{setLang(b.dataset.lang);toast(tt('已切换为中文','Switched to English'));});
  $$('#page-settings [data-density]').forEach(b=>b.onclick=()=>saveLook({density:b.dataset.density}));
  $$('#page-settings [data-motion]').forEach(b=>b.onclick=()=>saveLook({motion:b.dataset.motion}));
  wireBackupPolicy();
  void renderModelSettings($('#modelSettings'));
  wireDataIO();
  void renderDataSummary($('#dataSummary'));
  void renderCreationStyleSettings($('#creationStyleSettings'));
  // ★批11A:原内联 onclick 改程序绑定 —— mock toast ×3(about/订阅)。
  // ★批11B 末件:演示空状态行(showEmptyState=jobseek 符号)已迁入 jobseek data extend 自绑 → 平台不再裸读 apps 符号、§1 债清零。
  $$('#page-settings [data-mocktoast]').forEach(b=>{ b.onclick=()=>toast(b.dataset.mocktoast); });
  // 外链按钮(关于页 检查更新/反馈问题 → GitHub Releases/Issues):经 rt.web.open(桌面走 Rust open_external 带 scheme 闸;URL 硬编码平台自持,非用户/模型数据)。
  $$('#page-settings [data-extlink]').forEach(b=>{ b.onclick=()=>{ try{ /** @type {any} */ (window).SeekerRT.web.open(b.dataset.extlink); }catch(_e){ toast(tt('打开失败','Could not open')); } }; });
  // ②契约驱动 tab/extend 接线:全调(同原逻辑"$$ 选择器对非当前 tab 内容 no-op"的无条件风格),不做条件判断。
  appTabs.forEach(t=>{ if(typeof t.wire==='function') t.wire(); });
  appSpecs.forEach(s=>{ if(s.extend) Object.keys(s.extend).forEach(k=>{ const e=s.extend[k]; if(e&&typeof e.wire==='function') e.wire(); }); });
}

/* 自动备份策略:桌面 SQLite 是唯一真相源；localStorage 仅作首帧镜像。写失败必须回滚 UI。 */
function wireBackupPolicy(){
  if(typeof isDesktop!=='function'||!isDesktop()||!window.SeekerRT||!window.SeekerRT.db) return;
  const buttons=$$('#page-settings [data-ab]'), rt=window.SeekerRT;
  if(!backupPolicyHydrated){
    buttons.forEach(b=>{ b.disabled=true; });
    if(backupPolicyLoading) return;
    backupPolicyLoading=true;
    rt.db.getBackupPolicy().then(view=>{
      backupPolicyLoading=false; backupPolicyHydrated=true;
      if(!view||view.supported===false) throw new Error(tt('该端不支持自动备份','Automatic backup is unsupported here'));
      const state=normalizeBackupPolicy(view); setState.autobackup=state.value; backupLastAt=state.lastBackupAt;
      saveSettings(); renderSettings();
    }).catch(e=>{
      backupPolicyLoading=false; backupPolicyHydrated=true;
      buttons.forEach(b=>{ b.disabled=false; });
      console.error('[settings] backup policy', e);
    });
    return;
  }
  buttons.forEach(b=>b.onclick=async()=>{
    const prev=setState.autobackup, next=b.dataset.ab==='off'?'off':'on';
    if(next===prev) return;
    setState.autobackup=next; saveSettings(); renderSettings();
    const result=await persistBackupPolicy(prev,next,(enabled)=>rt.db.setBackupPolicy(enabled));
    if(result.ok){
      setState.autobackup=result.value; backupLastAt=result.lastBackupAt;
      saveSettings();
      toast(next==='on'?tt('自动备份已开启','Automatic backup enabled'):tt('自动备份已关闭','Automatic backup disabled'));
    }else{
      setState.autobackup=prev; saveSettings(); renderSettings();
      toast(tt('自动备份设置未保存:','Backup setting was not saved: ')+errText(result.error));
    }
  });
}

/* D3:导出 / 脱敏导出 / 导入按 rt.db 能力接线(桌面写文件、Web 下载 JSON)。导入用 <input type=file> 读文件,零新插件。 */
function wireDataIO(){
  const exp=$('#dataExport'), expR=$('#dataExportRedacted'), imp=$('#dataImport'), impFile=$('#dataImportFile');
  if(!exp) return;
  const mh=$('#mgrHistory'); if(mh) mh.onclick=openHistoryManager;   // 历史与记忆掌控(#4),web/桌面皆可
  const mm=$('#mgrMemory'); if(mm) mm.onclick=()=>go('capability');   // ★P1-c:记忆管理已搬迁至能力中心,此处只留指路
  const md=$('#mgrDocs'); if(md) md.onclick=()=>go('capability');     // ★P1-c:知识库管理同上(RAG #2)
  const mcpB=$('#mgrMcp'); if(mcpB) mcpB.onclick=()=>go('capability');  // ★P1-b:连接器管理已搬迁至能力中心(一等公民),此处只留指路
  const cad=$('#clearAllData'); if(cad) cad.onclick=clearAllDataFlow;  // 真·清空所有数据(guardrail+备份+种子守卫;index.html 过渡全局)
  const rt=window.SeekerRT;
  const on = !!(rt&&rt.db&&typeof rt.db.export==='function'&&typeof rt.db.import==='function');
  if(!on){
    exp.onclick=()=>toast(tt('该端暂不支持导出','Export is not supported here'));
    if(expR) expR.onclick=()=>toast(tt('该端暂不支持导出','Export is not supported here'));
    if(imp) imp.onclick=()=>toast(tt('该端暂不支持导入','Import is not supported here'));
    return;
  }
  exp.onclick=()=>rt.db.export(false).then(p=>toast(tt('已导出到 ','Exported to ')+p)).catch(e=>toast(errText(e)));
  if(expR) expR.onclick=()=>rt.db.export(true).then(p=>toast(tt('已精简导出，请检查内容后分享：','Reduced export saved. Review before sharing: ')+p)).catch(e=>toast(errText(e)));
  if(imp&&impFile){
    imp.onclick=()=>impFile.click();
    impFile.onchange=()=>{
      const f=impFile.files&&impFile.files[0]; if(!f){return;}
      const reader=new FileReader();
      reader.onload=()=>{
        rt.db.import(String(reader.result||'')).then(async counts=>{
          const total=Object.values(counts||{}).reduce((a,b)=>a+(+b||0),0);
          toast(tt('已导入 ','Imported ')+total+tt(' 条(导入前已自动快照)',' records (snapshot taken first)'));
          try{
            hydrateSettings(); backupPolicyHydrated=false; backupPolicyLoading=false;
            applyAppearance();await hydrateProfile();
            window.SeekerShell.notifyDataImported();
            setCurrentProjectId(localStorage.getItem('jh-project')||'');
            await renderProjectSwitch();await switchProject(localStorage.getItem('jh-project')||'');
            window.dispatchEvent(new CustomEvent('seeker-workspaces-changed'));
            window.dispatchEvent(new CustomEvent('seeker-workspace-preferences-changed'));
          }catch(e){toast(tt('数据已导入，界面未能刷新，请重新打开：','Data imported, but the view could not refresh. Reopen the app: ')+errText(e));}
          renderSettings(); // 重新读取导入包里的 SQLite 备份策略,不让 localStorage 镜像覆盖真相。
        }).catch(e=>toast(tt('导入失败:','Import failed: ')+errText(e)));
        impFile.value='';
      };
      reader.readAsText(f);
    };
  }
}
