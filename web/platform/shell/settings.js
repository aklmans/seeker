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
import { PROFILE, persistProfileField } from './profile.js'; // ★批8:profile 转 module,PROFILE/persistProfileField 改 import(profile.js 不上 window 桥、隐私最小暴露);本文件仍是唯一改 PROFILE 入口(data-pf 输入、Agent 不可达)。
import { $, $$, el } from './dom.js';
import { tt } from './i18n.js';
import { IC } from './icons.js';
import { openModal } from './modal.js';
import { currentPage, frontis, go, renderTopActions, rerenderPages, signFoot } from './nav.js';
import { isDesktop } from './shell-keys.js';
import { clearAllDataFlow, saveSettings, setState, settingsPersistOn } from './shell-state.js';
import { errText, toast } from './toast.js'; // ★P1-c:toastUndo 随记忆管理搬迁至 memory-docs.js,此处已无消费者
let settingsState={tab:'basic'};
const MODEL={mode:'byo', protocol:'anthropic', baseUrl:'https://api.anthropic.com', apiKey:'', model:'claude-3-5-haiku', models:[], temp:0.5,
  stt:'browser', sttUrl:'', sttKey:'', sttModel:'', tts:'browser', ttsUrl:'', ttsKey:'', ttsVoice:''};
const SET_TABS_SHELL=[['basic',['基本设置','Basics']],['profile',['个人信息','Profile']],['model',['模型配置','Model']],['data',['数据管理','Data']],['about',['关于','About']]];

/* ===== 隐私 · 历史与记忆掌控(#4 用户掌控)—— 设置页入口,不经对话改;清除走 guardrail。 ===== */
/** ★仅限**文本内容位**(转 &<>,不转 ")。当前唯一消费者 openHistoryManager 把会话文本渲染进 <div> 文本位 —— 安全。
 *  ⚠ 若将来把它挪进**属性位**(如 data-x="${_mgrEsc(v)}"),漏 `"` 即成注入缺口 → 届时必须换平台唯一 cEsc(&<>")。
 *  会话文本 r.text 可含 AI 派生的外部内容:文本位惰性,属性位不是。(评审第56轮 [建议]3) */
function _mgrEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _mgrTime(ts){ try{ return new Date(+ts||0).toLocaleString(); }catch(_e){ return ''; } }
async function openHistoryManager(){
  const rt=window.SeekerRT, G=window.SeekerGuardrail;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— PRIVACY</p><h2 style="margin-top:5px;">${tt('会话历史','Chat history')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body" id="histBody" style="min-height:120px;">${tt('加载中…','Loading…')}</div>
    <div class="modal-foot"><button class="btn" id="histClear">${tt('清除全部会话历史','Clear all history')}</button><button class="btn btn-accent" data-close>${tt('完成','Done')}</button></div>`, true);
  const render=async()=>{
    let rows=[]; try{ rows=await rt.db.list('messages'); }catch(_e){}
    rows.sort((a,b)=>(a.ts||0)-(b.ts||0));
    const body=m.querySelector('#histBody'); if(!body) return;
    if(!rows.length) body.innerHTML=`<p style="color:var(--ink-3);padding:18px 0;text-align:center;">${tt('暂无会话历史。','No chat history yet.')}</p>`;
    else body.innerHTML=`<p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;">${tt('共 ','Total ')}${rows.length}${tt(' 条 · 仅存本地',' · local only')}</p>`+rows.map(r=>{
      const who=r.role==='user'?tt('我','Me'):(r.surface==='agent'?'Agent':'Copilot');
      const cls=r.role==='user'?'var(--accent)':'var(--ink-3)';
      return `<div style="padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:${cls};margin-bottom:3px;">${who} · ${_mgrTime(r.ts)}</div><div style="font-size:13px;color:var(--ink-2);line-height:1.55;white-space:pre-wrap;">${_mgrEsc(r.text)}</div></div>`;
    }).join('');
    const cb=m.querySelector('#histClear'); if(cb) cb.style.display=rows.length?'':'none';
  };
  await render();
  const cb=m.querySelector('#histClear');
  if(cb) cb.onclick=async()=>{
    if(!G||!G.confirmDestructive) return;
    let snaps=[];
    await G.confirmDestructive({
      title:tt('清除全部会话历史?','Clear all chat history?'),
      detail:tt('将删除本地所有会话消息(Copilot 与 Agent)。可在几秒内撤销。','Deletes all local chat messages (Copilot & Agent). Undoable for a few seconds.'),
      confirmLabel:tt('清除','Clear'), undoText:tt('已清除会话历史','Chat history cleared'),
      onConfirm:async()=>{ snaps=[]; let rows=[]; try{rows=await rt.db.list('messages');}catch(_e){} for(const r of rows){ try{ const s=await rt.db.remove('messages', r.id); if(s) snaps.push(s); }catch(_e){} } await render(); },
      onUndo:async()=>{ for(const s of snaps){ try{ await rt.db.upsert('messages', s); }catch(_e){} } await render(); },
    });
  };
}

export function renderSettings(){
  setState.theme=document.documentElement.dataset.theme;
  const seg=(opts,sel,attr)=>`<div class="seg">${opts.map(o=>`<button class="${o[0]===sel?'on':''}" data-${attr}="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  const row=(k,v)=>`<div class="set-row"><span class="sk">${k}</span><div>${v}</div></div>`;
  const sections={};
  const appSpecs=window.SeekerShell.appSettings();
  const extendHTML=tabId=>appSpecs.flatMap(s=>(s.extend&&s.extend[tabId])?[s.extend[tabId].render()]:[]).join('');
  sections.basic=`<p class="seclabel">— BASIC</p><h2 class="sectitle">${tt('外观与偏好','Appearance & preferences')}<span class="dot">.</span></h2><div style="margin-top:14px;max-width:560px;">
    ${row(tt('主题模式','Theme'),seg([['light',tt('浅色','Light')],['dark',tt('深色','Dark')],['system',tt('跟随系统','System')]],setState.theme,'theme'))}
    ${row(tt('正文字号','Font size'),seg([['13','13'],['14','14'],['15','15'],['16','16']],setState.fontsize,'fs'))}
    ${row(tt('界面语言','Language'),seg([['zh','中文'],['en','English']],setState.lang,'lang'))}
    ${row(tt('界面密度','Density'),seg([['compact',tt('紧凑','Compact')],['standard',tt('标准','Standard')],['cozy',tt('宽松','Cozy')]],setState.density,'density'))}
    ${row(tt('减少动效','Reduce motion'),seg([['on',tt('开','On')],['off',tt('关','Off')]],setState.motion,'motion'))}
    ${row(tt('训练计入能力成长','Training counts toward growth'),'<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'+seg([['on',tt('开','On')],['off',tt('关','Off')]],setState.trainCounts?'on':'off','tc')+'<span style="font-size:12px;color:var(--ink-3);">'+tt('刻意练习与面试陪练作为「职业资产」成长参考','Deliberate practice & interview prep count toward career-asset growth')+'</span></div>')}
  </div>`;
  sections.profile=`<p class="seclabel">— PROFILE · PRIVATE</p><h2 class="sectitle">${tt('个人信息','Personal info')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 14px;max-width:640px;line-height:1.7;">${tt('这些信息仅保存在本地,<b>AI 不会读取或修改</b>。简历的「基本信息」模块自动从这里加载 —— 改这里,简历同步更新。','Stored locally only — <b>AI never reads or edits it</b>. The resume\'s Basic Info block auto-loads from here; edit here and the resume syncs.')}</p>
    <div style="max-width:520px;">
      ${[['name',tt('姓名','Name')],['intent',tt('求职意向','Target role')],['city',tt('城市','City')],['phone',tt('电话','Phone')],['email',tt('邮箱','Email')],['exp',tt('工作经验','Experience')],['site',tt('个人主页(可选)','Website (optional)')],['github',tt('GitHub(可选)','GitHub (optional)')],['portfolio',tt('作品集(可选)','Portfolio (optional)')],['linkedin',tt('LinkedIn(可选)','LinkedIn (optional)')]].map(f=>`<div class="set-row"><span class="sk">${f[1]}</span><input class="input" data-pf="${f[0]}" value="${(PROFILE[f[0]]||'').replace(/"/g,'&quot;')}"></div>`).join('')}
    </div>
    <div class="lock-note" style="margin-top:14px;max-width:640px;"><span class="li">🔒</span><span>${tt('隐私优先:以上联系方式字段不参与任何 AI 处理。AI 生成简历时只重写专业内容(概要 / 技能 / 经历),绝不触碰你的联系方式与身份信息。','Privacy first: the contact fields above never go through AI. When generating resumes, AI only rewrites professional content (summary / skills / experience) — never your contact or identity info.')}</span></div>
    ${extendHTML('profile')}`;
  const proto=[['openai','OpenAI 兼容'],['anthropic','Anthropic'],['gemini','Gemini'],['ollama','Ollama 本地'],['other','其他']];
  const sttEng=[['browser','浏览器(免费)'],['whisper','Whisper 自托管'],['deepgram','Deepgram'],['groq','Groq'],['other','其他']];
  const ttsEng=[['browser','浏览器(免费)'],['kokoro','Kokoro/Piper 自托管'],['deepgram','Deepgram Aura'],['eleven','ElevenLabs'],['other','其他']];
  const sttSelf=MODEL.stt!=='browser', ttsSelf=MODEL.tts!=='browser';
  const byo=`<div style="max-width:580px;">
    <p class="seclabel" style="margin-bottom:10px;">— LLM</p>
    ${row(tt('接口协议','Protocol'),`<select class="select" id="mdProto">${proto.map(p=>`<option value="${p[0]}" ${p[0]===MODEL.protocol?'selected':''}>${p[1]}</option>`).join('')}</select>`)}
    ${row('Base URL',`<input class="input" id="mdBase" placeholder="https://api.anthropic.com" value="${(MODEL.baseUrl||'').replace(/"/g,'&quot;')}">`)}
    ${row('API Key',`<div style="display:flex;gap:8px;"><input class="input" id="mdKey" type="password" placeholder="sk-…" value="${(MODEL.apiKey||'').replace(/"/g,'&quot;')}"><button class="btn" id="mdKeyShow">${tt('显示','Show')}</button></div>`)}
    ${row(tt('模型(可存多个,点选当前)','Models (save many, click to use)'),`<div style="display:flex;flex-direction:column;gap:8px;">
      <div id="mdModelList" class="md-models"></div>
      <div style="display:flex;gap:8px;"><input class="input" id="mdModelAdd" placeholder="${tt('添加模型名,如 gpt-4o','Add a model, e.g. gpt-4o')}"><button class="btn" id="mdModelAddBtn">${tt('添加','Add')}</button></div></div>`)}
    ${row(tt('嵌入模型','Embed model'),`<input class="input" id="mdEmbed" placeholder="text-embedding-3-small" value="${(MODEL.embedModel||'').replace(/"/g,'&quot;')}">`)}
    ${row(tt('User-Agent · 高级','User-Agent · advanced'),`<input class="input" id="mdUA" placeholder="claude-cli/1.0.0 (external, cli)" value="${(MODEL.userAgent||'').replace(/"/g,'&quot;')}">`)}
    <p style="font-size:11.5px;color:var(--ink-3);margin:2px 0 8px;line-height:1.6;">${tt('某些供应商(如 Kimi For Coding)按 User-Agent 限定「编程 agent」;留空用默认。改后下次调用即生效,无需重启。','Some providers (e.g. Kimi For Coding) gate by User-Agent to coding agents; leave blank for the default. Takes effect on the next call — no restart.')}</p>
    ${row(tt('连接','Connection'),`<button class="btn btn-accent" id="mdTest">${tt('测试连接','Test connection')}</button>`)}
    <p class="seclabel" style="margin:24px 0 10px;">— SPEECH · STT</p>
    ${row(tt('STT 引擎','STT engine'),`<select class="select" id="mdStt">${sttEng.map(e=>`<option value="${e[0]}" ${e[0]===MODEL.stt?'selected':''}>${e[1]}</option>`).join('')}</select>`)}
    ${sttSelf?row(tt('STT 地址 / Key','STT URL / Key'),`<div style="display:flex;gap:8px;"><input class="input" id="mdSttUrl" placeholder="base_url" value="${(MODEL.sttUrl||'').replace(/"/g,'&quot;')}"><input class="input" id="mdSttKey" type="password" placeholder="api_key" value="${(MODEL.sttKey||'').replace(/"/g,'&quot;')}" style="max-width:150px;"></div>`):`<p style="font-size:12px;color:var(--ink-mute);padding:2px 0 6px;">${tt('浏览器内置语音识别 · 免费 · 本地','Built-in browser STT · free · local')}</p>`}
    <p class="seclabel" style="margin:20px 0 10px;">— SPEECH · TTS</p>
    ${row(tt('TTS 引擎','TTS engine'),`<select class="select" id="mdTts">${ttsEng.map(e=>`<option value="${e[0]}" ${e[0]===MODEL.tts?'selected':''}>${e[1]}</option>`).join('')}</select>`)}
    ${ttsSelf?row(tt('TTS 地址 / Key','TTS URL / Key'),`<div style="display:flex;gap:8px;"><input class="input" id="mdTtsUrl" placeholder="base_url" value="${(MODEL.ttsUrl||'').replace(/"/g,'&quot;')}"><input class="input" id="mdTtsKey" type="password" placeholder="api_key" value="${(MODEL.ttsKey||'').replace(/"/g,'&quot;')}" style="max-width:150px;"></div>`)+row(tt('音色','Voice'),`<input class="input" id="mdTtsVoice" placeholder="voice id" value="${(MODEL.ttsVoice||'').replace(/"/g,'&quot;')}">`):`<p style="font-size:12px;color:var(--ink-mute);padding:2px 0 6px;">${tt('浏览器内置语音合成 · 免费 · 本地','Built-in browser TTS · free · local')}</p>`}
    <div class="lock-note" style="margin-top:18px;"><span class="li">🔒</span><span>${tt('你填的 Base URL / API Key 仅保存在本地浏览器,不上传我们的服务器。音频按所选引擎处理:选「浏览器/自托管」则<b>音频不离开本机</b>,只把文字发给大模型;「个人信息」隐私字段始终不参与 AI。','Your Base URL / API Key stay in this browser, never uploaded to our servers. Audio is handled by the chosen engine: with browser/self-hosted, <b>audio never leaves your machine</b> — only text goes to the LLM; private profile fields never touch AI.')}</span></div>
  </div>`;
  const managed=`<div class="next-hero" style="max-width:580px;"><div class="nh-in">
    <p style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.2em;color:var(--accent);margin:0 0 9px;">— MANAGED</p>
    <h3 style="font-size:18px;color:var(--ink);margin:0;font-weight:600;">${tt('免配置,开箱即用','Zero config, ready to use')}</h3>
    <p style="font-size:13px;color:var(--ink-2);margin:9px 0 0;line-height:1.7;">${tt('订阅后由我们托管整条链路(STT + Claude + TTS),无需自备 Key、不用管 base_url 与协议。含语音面试通话、智能匹配、简历生成的全部 AI 能力。','We host the whole pipeline (STT + Claude + TTS) — no API keys, no base_url or protocol fuss. Includes voice interview calls, smart matching, and resume generation.')}</p>
    <div style="display:flex;gap:22px;margin:16px 0 0;flex-wrap:wrap;">
      ${[['¥39',tt('/ 月 · 基础','/ mo · Basic')],['¥99',tt('/ 月 · 专业 · 含语音通话','/ mo · Pro · voice calls')]].map(x=>`<div><span style="font-family:var(--font-serif);font-size:24px;color:var(--ink);font-weight:500;">${x[0]}</span><span style="font-size:12px;color:var(--ink-3);margin-left:6px;">${x[1]}</span></div>`).join('')}
    </div>
    <button class="btn btn-accent" style="margin-top:16px;" data-mocktoast="订阅页面 (mock)">${tt('了解订阅','Learn more')} →</button>
  </div></div>`;
  sections.model=`<p class="seclabel">— MODEL</p><h2 class="sectitle">${tt('AI 接入方式','AI access')}<span class="dot">.</span></h2>
    <p style="font-size:12px;color:var(--ink-3);margin:6px 0 14px;max-width:640px;line-height:1.7;">${tt('两种方式任选:<b>自带模型</b>(填你自己的 base_url / api_key / model / 协议,最省钱、最可控)或 <b>订阅托管</b>(我们包办整条链路,免配置)。','Two ways: <b>bring your own model</b> (your base_url / api_key / model / protocol — cheapest, most control) or <b>managed subscription</b> (we handle the whole pipeline, zero config).')}</p>
    <div style="margin-bottom:18px;">${seg([['byo',tt('自带模型 BYO','Bring your own')],['managed',tt('订阅托管','Managed')]],MODEL.mode,'mmode')}</div>
    ${MODEL.mode==='byo'?byo:managed}`;
  const appTabs=appSpecs.flatMap(s=>s.tabs||[]);
  appTabs.forEach(t=>{ sections[t.id]=t.render(); });
  sections.data=`<p class="seclabel">— DATA</p><h2 class="sectitle">${tt('数据与备份','Data & backup')}<span class="dot">.</span></h2><div style="margin-top:14px;max-width:600px;">
    ${extendHTML('data')}
    ${row(tt('导出数据','Export data'),`<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn" id="dataExport">${tt('导出 JSON','Export JSON')}</button><button class="btn" id="dataExportRedacted">${tt('脱敏导出','Export (redacted)')}</button></div>`)}
    ${row(tt('导入数据','Import data'),`<button class="btn" id="dataImport">${tt('导入文件','Import file')}</button><input type="file" id="dataImportFile" accept=".json,application/json" style="display:none">`)}
    ${row(tt('自动备份','Auto backup'),seg([['on',tt('开','On')],['off',tt('关','Off')]],setState.autobackup,'ab'))}
    ${row(tt('本地存储用量','Local storage'),`<div style="display:flex;align-items:center;gap:14px;max-width:380px;"><div class="btrack" style="flex:1;height:8px;background:var(--border);position:relative;"><i style="position:absolute;left:0;top:0;bottom:0;width:12%;background:var(--ink-mute);"></i></div><span class="mono" style="font-size:12px;color:var(--ink-3);white-space:nowrap;">1.2 / 10 MB</span></div>`)}
    ${row(tt('上次备份','Last backup'),`<span class="mono" style="font-size:13px;color:var(--ink-2);">2026.05.18 14:30</span>`)}
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
      <div class="mono" style="font-size:12px;color:var(--ink-3);margin:4px 0;">v 0.1.0 · 2026 · ${tt('本地优先','Local-first')}</div>
      <div style="color:var(--ink-3);max-width:600px;">${tt('本地优先的个人 AI Agent 平台 —— 壳 + 可开关的小应用(首个应用:求职工作台)。所有数据存于本地,密钥只进系统钥匙串,隐私信息永不参与 AI 处理。','A local-first personal AI agent platform — a shell plus toggleable mini-apps (first app: the job-hunt workbench). All data stays on your machine, keys live only in the system keychain, and private info never goes through AI.')}</div>
      <div style="display:flex;gap:14px;margin-top:14px;"><button class="btn" data-mocktoast="已是最新版本">${tt('检查更新','Check updates')}</button><button class="btn" data-mocktoast="感谢反馈 (mock)">${tt('反馈问题','Send feedback')}</button></div>
    </div>`;
  const tabDefs=[SET_TABS_SHELL[0],SET_TABS_SHELL[1],SET_TABS_SHELL[2]]
    .concat(appTabs.map(t=>[t.id,[t.label.zh,t.label.en]]))
    .concat([SET_TABS_SHELL[3],SET_TABS_SHELL[4]]);
  const tabbar=`<div class="tabs" style="overflow-x:auto;flex-wrap:nowrap;margin-bottom:8px;">${tabDefs.map(t=>`<button class="tab ${settingsState.tab===t[0]?'on':''}" data-stab="${t[0]}" style="white-space:nowrap;">${setState.lang==='en'?t[1][1]:t[1][0]}</button>`).join('')}</div>`;
  $('#page-settings').innerHTML=frontis('SETTINGS',tt('数据设置','Settings'))+tabbar+`<div class="sec" style="border-bottom:none;padding-top:18px;">${sections[settingsState.tab]}</div>`+signFoot();
  $$('#page-settings [data-stab]').forEach(b=>b.onclick=()=>{settingsState.tab=b.dataset.stab;renderSettings();});
  $$('#page-settings [data-pf]').forEach(inp=>{ inp.oninput=()=>{PROFILE[inp.dataset.pf]=inp.value;}; inp.onchange=()=>persistProfileField(inp.dataset.pf, inp.value); }); // 改完(失焦)落盘到隔离的 profile 仓库
  $$('#page-settings [data-theme]').forEach(b=>b.onclick=()=>{const v=b.dataset.theme;if(v==='system'){toast('已设为跟随系统 (mock)');}else{document.documentElement.dataset.theme=v;try{localStorage.setItem('jh-theme',v);}catch(e){}renderTopActions(currentPage());$('#themeBtn2').innerHTML=v==='dark'?IC.sun:IC.moon;}renderSettings();});
  $$('#page-settings [data-fs]').forEach(b=>b.onclick=()=>{setState.fontsize=b.dataset.fs;saveSettings();renderSettings();toast('正文字号 '+b.dataset.fs+'px');});
  $$('#page-settings [data-lang]').forEach(b=>b.onclick=()=>{setState.lang=b.dataset.lang;try{localStorage.setItem('jh-lang',b.dataset.lang);}catch(e){}renderSettings();toast(b.dataset.lang==='en'?'English (demo)':'已切换为中文');});
  $$('#page-settings [data-density]').forEach(b=>b.onclick=()=>{setState.density=b.dataset.density;saveSettings();renderSettings();toast('界面密度:'+({compact:'紧凑',standard:'标准',cozy:'宽松'}[b.dataset.density]));});
  $$('#page-settings [data-motion]').forEach(b=>b.onclick=()=>{setState.motion=b.dataset.motion;saveSettings();renderSettings();});
  $$('#page-settings [data-ab]').forEach(b=>b.onclick=()=>{setState.autobackup=b.dataset.ab;saveSettings();renderSettings();toast('自动备份已'+(b.dataset.ab==='on'?'开启':'关闭'));});
  $$('#page-settings [data-tc]').forEach(b=>b.onclick=()=>{setState.trainCounts=(b.dataset.tc==='on');saveSettings();rerenderPages();renderSettings();toast(setState.trainCounts?'已开启:训练计入能力成长':'已关闭训练计入');}); // ③renderSkills()→rerenderPages()(通用重渲,平台不具名调 jobseek 渲染器)
  $$('#page-settings [data-mmode]').forEach(b=>b.onclick=()=>{MODEL.mode=b.dataset.mmode;renderSettings();});
  const mp=$('#mdProto'); if(mp) mp.onchange=()=>{MODEL.protocol=mp.value;MODEL.baseUrl=({openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com',gemini:'https://generativelanguage.googleapis.com',ollama:'http://localhost:11434/v1',other:''})[mp.value];MODEL.model=({openai:'gpt-4o-mini',anthropic:'claude-3-5-haiku',gemini:'gemini-1.5-flash',ollama:'qwen2.5',other:''})[mp.value];renderSettings();};
  const mb=$('#mdBase'); if(mb) mb.oninput=()=>{MODEL.baseUrl=mb.value;};
  const mk=$('#mdKey'); if(mk) mk.oninput=()=>{MODEL.apiKey=mk.value;};
  const mks=$('#mdKeyShow'); if(mks) mks.onclick=()=>{const f=$('#mdKey');if(!f)return;f.type=f.type==='password'?'text':'password';mks.textContent=f.type==='password'?'显示':'隐藏';};
  const mAdd=$('#mdModelAdd'), mAddB=$('#mdModelAddBtn');
  if(mAddB) mAddB.onclick=()=>{ addModelUI(mAdd?mAdd.value:''); if(mAdd) mAdd.value=''; };
  if(mAdd) mAdd.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addModelUI(mAdd.value); mAdd.value=''; } });
  renderModelList(); // web/桌面通用渲染;桌面 wireModelConfigDesktop 再用后端真实列表覆盖重渲
  const me=$('#mdEmbed'); if(me) me.oninput=()=>{MODEL.embedModel=me.value;};
  const mtest=$('#mdTest'); if(mtest) mtest.onclick=()=>{toast(MODEL.apiKey?'连接成功 ✓ (mock)':'请先填写 API Key');};
  const ms=$('#mdStt'); if(ms) ms.onchange=()=>{MODEL.stt=ms.value;renderSettings();};
  const msu=$('#mdSttUrl'); if(msu) msu.oninput=()=>{MODEL.sttUrl=msu.value;};
  const msk=$('#mdSttKey'); if(msk) msk.oninput=()=>{MODEL.sttKey=msk.value;};
  const mtt=$('#mdTts'); if(mtt) mtt.onchange=()=>{MODEL.tts=mtt.value;renderSettings();};
  const mtu=$('#mdTtsUrl'); if(mtu) mtu.oninput=()=>{MODEL.ttsUrl=mtu.value;};
  const mtk=$('#mdTtsKey'); if(mtk) mtk.oninput=()=>{MODEL.ttsKey=mtk.value;};
  const mtv=$('#mdTtsVoice'); if(mtv) mtv.oninput=()=>{MODEL.ttsVoice=mtv.value;};
  wireModelConfigDesktop();
  wireDataIO();
  // ★批11A:原内联 onclick 改程序绑定 —— mock toast ×3(about/订阅)。
  // ★批11B 末件:演示空状态行(showEmptyState=jobseek 符号)已迁入 jobseek data extend 自绑 → 平台不再裸读 apps 符号、§1 债清零。
  $$('#page-settings [data-mocktoast]').forEach(b=>{ b.onclick=()=>toast(b.dataset.mocktoast); });
  // ②契约驱动 tab/extend 接线:全调(同原逻辑"$$ 选择器对非当前 tab 内容 no-op"的无条件风格),不做条件判断。
  appTabs.forEach(t=>{ if(typeof t.wire==='function') t.wire(); });
  appSpecs.forEach(s=>{ if(s.extend) Object.keys(s.extend).forEach(k=>{ const e=s.extend[k]; if(e&&typeof e.wire==='function') e.wire(); }); });
}

/* D3:导出 / 脱敏导出 / 导入(桌面真接平台核;web 沿用 mock)。导入用 <input type=file> 读文件,零新插件。 */
function wireDataIO(){
  const exp=$('#dataExport'), expR=$('#dataExportRedacted'), imp=$('#dataImport'), impFile=$('#dataImportFile');
  if(!exp) return;
  const mh=$('#mgrHistory'); if(mh) mh.onclick=openHistoryManager;   // 历史与记忆掌控(#4),web/桌面皆可
  const mm=$('#mgrMemory'); if(mm) mm.onclick=()=>go('capability');   // ★P1-c:记忆管理已搬迁至能力中心,此处只留指路
  const md=$('#mgrDocs'); if(md) md.onclick=()=>go('capability');     // ★P1-c:知识库管理同上(RAG #2)
  const mcpB=$('#mgrMcp'); if(mcpB) mcpB.onclick=()=>go('capability');  // ★P1-b:连接器管理已搬迁至能力中心(一等公民),此处只留指路
  const cad=$('#clearAllData'); if(cad) cad.onclick=clearAllDataFlow;  // 真·清空所有数据(guardrail+备份+种子守卫;index.html 过渡全局)
  const on = (typeof isDesktop==='function' && isDesktop() && !!window.SeekerRT);
  if(!on){
    exp.onclick=()=>toast('已导出 jobhunt-data.json (mock)');
    if(expR) expR.onclick=()=>toast('脱敏导出 (mock)');
    if(imp) imp.onclick=()=>toast('请选择文件 (mock)');
    return;
  }
  const rt=window.SeekerRT;
  exp.onclick=()=>rt.db.export(false).then(p=>toast(tt('已导出到 ','Exported to ')+p)).catch(e=>toast(errText(e)));
  if(expR) expR.onclick=()=>rt.db.export(true).then(p=>toast(tt('已脱敏导出(不含隐私)到 ','Redacted export to ')+p)).catch(e=>toast(errText(e)));
  if(imp&&impFile){
    imp.onclick=()=>impFile.click();
    impFile.onchange=()=>{
      const f=impFile.files&&impFile.files[0]; if(!f){return;}
      const reader=new FileReader();
      reader.onload=()=>{
        rt.db.import(String(reader.result||'')).then(counts=>{
          const total=Object.values(counts||{}).reduce((a,b)=>a+(+b||0),0);
          toast(tt('已导入 ','Imported ')+total+tt(' 条(导入前已自动快照)',' records (snapshot taken first)'));
          window.SeekerShell.notifyDataImported();   // §1 契约化(批11B 末件):原硬编码 hydrateJobs()(jobseek 符号)→ 广播,各应用按新库重水合
        }).catch(e=>toast(tt('导入失败:','Import failed: ')+errText(e)));
        impFile.value='';
      };
      reader.readAsText(f);
    };
  }
}

/* 一协议多模型:渲染已存模型 chips(当前高亮 ✓、点选切换、× 删除)+ 添加。
   桌面经 rt.ai.{setConfig/selectModel/removeModel} 落 provider.json;web 改 MODEL 内存(mock)。 */
function renderModelList(){
  const wrap=$('#mdModelList'); if(!wrap) return;
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const models=(MODEL.models&&MODEL.models.length)?MODEL.models:(MODEL.model?[MODEL.model]:[]);
  wrap.innerHTML = models.length
    ? models.map(m=>`<span class="md-model ${m===MODEL.model?'on':''}" data-mdl="${esc(m)}">${esc(m)}${m===MODEL.model?' ✓':''}<button class="md-x" data-mdlx="${esc(m)}" title="${tt('删除','Delete')}">×</button></span>`).join('')
    : `<span style="font-size:12px;color:var(--ink-mute);">${tt('还没有保存的模型 —— 在下方添加','No saved models — add one below')}</span>`;
  [...wrap.querySelectorAll('[data-mdl]')].forEach(ch=>ch.onclick=(e)=>{ if(e.target.closest('[data-mdlx]')) return; selectModelUI(ch.dataset.mdl); });
  [...wrap.querySelectorAll('[data-mdlx]')].forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); removeModelUI(b.dataset.mdlx); });
}
function selectModelUI(m){ if(!m) return; const was=MODEL.model; MODEL.model=m; if(settingsPersistOn()) window.SeekerRT.ai.selectModel(m).catch(e=>toast(errText(e))); renderModelList(); if(m!==was) toast(tt('已切换到 ','Now using ')+m); }
function removeModelUI(m){ MODEL.models=(MODEL.models||[]).filter(x=>x!==m); if(MODEL.model===m) MODEL.model=MODEL.models[0]||''; if(settingsPersistOn()) window.SeekerRT.ai.removeModel(m).catch(()=>{}); renderModelList(); toast(tt('已删除模型 ','Removed ')+m); }
function addModelUI(m){ m=(m||'').trim(); if(!m) return; if(!(MODEL.models||[]).includes(m)) MODEL.models=(MODEL.models||[]).concat(m); MODEL.model=m;
  if(settingsPersistOn()) window.SeekerRT.ai.setConfig({model:m}).then(()=>toast(tt('已添加并启用 ','Added & using ')+m)).catch(e=>toast(errText(e)));
  else toast(tt('已添加并启用 ','Added & using ')+m);
  renderModelList(); }
/* S1:桌面端把设置页 LLM 配置接真实平台核 —— key→系统钥匙串,baseUrl/model(多)→provider.json。
   网页/未就绪时不接管,沿用 mock(MODEL 对象)。 */
async function wireModelConfigDesktop(){
  if(typeof isDesktop!=='function' || !isDesktop() || !window.SeekerRT) return;
  const base=$('#mdBase'); if(!base) return;            // 仅 BYO · LLM 页有这些输入
  const key=$('#mdKey'), embed=$('#mdEmbed'), test=$('#mdTest'), ua=$('#mdUA');
  const rt=window.SeekerRT, KEYACC='provider.openai.key';
  const cfgPh=()=>tt('已配置 · 留空则保持不变','Configured · leave blank to keep');
  try{
    const c=await rt.ai.getConfig();
    base.value=c.baseUrl||''; if(embed) embed.value=c.embedModel||''; if(ua) ua.value=c.userAgent||'';
    MODEL.models=Array.isArray(c.models)?c.models:[]; MODEL.model=c.model||''; renderModelList(); // 用后端真实已存模型列表覆盖重渲
    if(key){ key.value=''; key.placeholder = c.keyStatus==='configured' ? cfgPh() : 'sk-…'; }
  }catch(_e){ /* 未就绪 */ }
  base.onblur=()=>{ rt.ai.setConfig({baseUrl:base.value.trim()})
    .then(()=>toast(tt('已保存 Base URL','Base URL saved')))
    .catch(e=>toast(errText(e))); };
  if(embed) embed.onblur=()=>{ rt.ai.setConfig({embedModel:embed.value.trim()})
    .then(()=>toast(tt('已保存嵌入模型(长期记忆 / 检索用)','Embed model saved'))).catch(()=>{}); };
  if(ua) ua.onblur=()=>{ rt.ai.setConfig({userAgent:ua.value.trim()})
    .then(()=>toast(tt('已保存 User-Agent','User-Agent saved'))).catch(e=>toast(errText(e))); };
  if(key) key.onblur=()=>{ const v=key.value.trim(); if(!v) return;
    rt.secret.set(KEYACC, v).then(()=>{
      key.value=''; try{ if(typeof MODEL!=='undefined') MODEL.apiKey=''; }catch(_e){}
      key.placeholder=cfgPh();
      toast(tt('API Key 已存入系统钥匙串','API Key saved to system keychain'));
    }).catch(e=>toast(errText(e))); };
  if(test) test.onclick=()=>{ const old=test.textContent; test.disabled=true; test.textContent=tt('测试中…','Testing…');
    rt.ai.complete({userText:'ping'})
      .then(()=>toast(tt('连接成功 ✓','Connected ✓')))
      .catch(e=>toast(tt('连接失败:','Failed: ')+errText(e)))
      .finally(()=>{ test.disabled=false; test.textContent=old; }); };
}
/* 过渡 window 桥:renderSettings 经 SeekerShell.setShell 的 render 箭头 + profile/persistence/settings-jobseek/index.html 消费(全 runtime);改 import 后摘。
   其余(MODEL/settingsState/SET_TABS_SHELL 状态 + 各 manager/model-UI/wireDataIO 函数)零外部消费 → module-private。
   ★批8 已落:profile 转 module,本文件读 PROFILE + persistProfileField 经顶部 import(profile.js 不上 window 桥、隐私最小暴露)。 */
