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
import { errText, toast, toastUndo } from './toast.js';
let settingsState={tab:'basic'};
const MODEL={mode:'byo', protocol:'anthropic', baseUrl:'https://api.anthropic.com', apiKey:'', model:'claude-3-5-haiku', models:[], temp:0.5,
  stt:'browser', sttUrl:'', sttKey:'', sttModel:'', tts:'browser', ttsUrl:'', ttsKey:'', ttsVoice:''};
const SET_TABS_SHELL=[['basic',['基本设置','Basics']],['profile',['个人信息','Profile']],['model',['模型配置','Model']],['data',['数据管理','Data']],['about',['关于','About']]];

/* ===== 隐私 · 历史与记忆掌控(#4 用户掌控)—— 设置页入口,不经对话改;清除走 guardrail。 ===== */
function _mgrEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _mgrTime(ts){ try{ return new Date(+ts||0).toLocaleString(); }catch(_e){ return ''; } }
async function openHistoryManager(){
  const rt=window.SeekerRT, G=window.SeekerGuardrail;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— PRIVACY</p><h2 style="margin-top:5px;">${tt('会话历史','Chat history')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body" id="histBody" style="min-height:120px;">${tt('加载中…','Loading…')}</div>
    <div class="modal-foot"><button class="btn" id="histClear">${tt('清除全部会话历史','Clear all history')}</button><button class="btn btn-accent" onclick="closeModal()">${tt('完成','Done')}</button></div>`, true);
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
async function openMemoryManager(){
  const rt=window.SeekerRT, G=window.SeekerGuardrail;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— PRIVACY</p><h2 style="margin-top:5px;">${tt('长期记忆','Long-term memory')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body" id="memBody" style="min-height:120px;">${tt('加载中…','Loading…')}</div>
    <div class="modal-foot"><button class="btn" id="memClear">${tt('清除全部记忆','Clear all memory')}</button><button class="btn btn-accent" onclick="closeModal()">${tt('完成','Done')}</button></div>`, true);
  const render=async()=>{
    let rows=[]; try{ rows=await rt.memory.list(); }catch(_e){}
    const body=m.querySelector('#memBody'); if(!body) return;
    if(!rows.length) body.innerHTML=`<p style="color:var(--ink-3);padding:18px 0;text-align:center;">${tt('AI 还没有记住任何内容。','Nothing remembered yet.')}</p>`;
    else body.innerHTML=`<p style="font-size:12px;color:var(--ink-3);margin:0 0 12px;">${tt('AI 记住的内容 · 共 ','What AI remembers · ')}${rows.length}${tt(' 条 · 仅存本地',' · local only')}</p>`+rows.map(r=>`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;"><div style="font-size:13px;color:var(--ink-2);line-height:1.55;">${_mgrEsc(r.fact)}</div><div style="font-family:var(--font-mono);font-size:9.5px;color:var(--ink-mute);margin-top:3px;">${_mgrTime(r.ts)}</div></div><button class="btn" data-memdel="${_mgrEsc(r.id)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除','Delete')}</button></div>`).join('');
    [...m.querySelectorAll('[data-memdel]')].forEach(b=>b.onclick=async()=>{ try{ await rt.memory.remove(b.dataset.memdel); }catch(_e){} await render(); toastUndo(tt('已删除该记忆','Memory deleted'), async()=>{ try{ await rt.memory.undo(); }catch(_e){} await render(); }); });
    const cb=m.querySelector('#memClear'); if(cb) cb.style.display=rows.length?'':'none';
  };
  await render();
  const cb=m.querySelector('#memClear');
  if(cb) cb.onclick=async()=>{
    if(!G||!G.confirmDestructive) return;
    await G.confirmDestructive({
      title:tt('清除全部长期记忆?','Clear all long-term memory?'),
      detail:tt('将删除 AI 记住的全部内容。可在几秒内撤销。','Deletes everything AI remembers. Undoable for a few seconds.'),
      confirmLabel:tt('清除','Clear'),
      undoText:tt('已清除长期记忆','Memory cleared'),
      onConfirm:async()=>{ try{ await rt.memory.clear(); }catch(_e){} await render(); },
      onUndo:async()=>{ try{ await rt.memory.undo(); }catch(_e){} await render(); },
    });
  };
}
async function openDocsManager(){
  const rt=window.SeekerRT, G=window.SeekerGuardrail;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— KNOWLEDGE</p><h2 style="margin-top:5px;">${tt('知识库 · 文档','Knowledge · docs')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        <input class="input" id="docName" placeholder="${tt('文档名称(如 字节后端 JD)','Doc name (e.g. ByteDance JD)')}">
        <textarea class="input" id="docText" rows="4" placeholder="${tt('粘贴文档内容,或从下方选 .txt / .md 文件','Paste text, or pick a .txt/.md file below')}" style="resize:vertical;font-family:inherit;"></textarea>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-accent" id="docAddBtn">${tt('添加到知识库','Add to knowledge')}</button>
          <button class="btn" id="docFileBtn">${tt('选文件 .txt/.md','Pick .txt/.md')}</button>
          <input type="file" id="docFile" accept=".txt,.md,text/plain,text/markdown" style="display:none">
          <span class="mono" id="docHint" style="font-size:11px;color:var(--ink-mute);"></span>
        </div>
      </div>
      <div id="docList">${tt('加载中…','Loading…')}</div>
    </div>
    <div class="modal-foot"><button class="btn" id="docClear">${tt('清空全部','Clear all')}</button><button class="btn btn-accent" onclick="closeModal()">${tt('完成','Done')}</button></div>`, true);
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtTs=ts=>{try{return new Date(+ts||0).toLocaleString();}catch(_e){return '';}};
  const render=async()=>{
    let rows=[]; try{ rows=await rt.docs.list(); }catch(_e){}
    const body=m.querySelector('#docList'); if(!body) return;
    body.innerHTML = rows.length
      ? `<div class="mc-lbl" style="margin-bottom:8px;">${tt('已加入文档 · 共 ','Docs · ')}${rows.length}</div>`+rows.map(d=>`<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);"><div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--ink);font-weight:500;">${esc(d.name)}</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;">${d.chunks} ${tt('片段','chunks')} · ${fmtTs(d.ts)}</div></div><button class="btn" data-docdel="${esc(d.docId)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除','Delete')}</button></div>`).join('')
      : `<p style="color:var(--ink-3);padding:14px 0;text-align:center;">${tt('知识库为空 —— 加入 JD / 笔记 / 调研,AI 答题时会自动检索相关片段。','Empty — add JDs / notes / research; the AI auto-retrieves relevant chunks when answering.')}</p>`;
    [...m.querySelectorAll('[data-docdel]')].forEach(b=>b.onclick=()=>{
      if(!G||!G.confirmDestructive) return;
      const d=rows.find(x=>String(x.docId)===String(b.dataset.docdel));
      G.confirmDestructive({ title:tt('删除文档?','Delete doc?'), detail:(tt('将从知识库删除:','Remove from knowledge: '))+(d?d.name:''), confirmLabel:tt('删除','Delete'), undoText:tt('已删除文档','Doc deleted'),
        onConfirm:async()=>{ try{ await rt.docs.remove(b.dataset.docdel); }catch(_e){} await render(); },
        onUndo:async()=>{ try{ await rt.docs.undo(); }catch(_e){} await render(); } });
    });
    const cb=m.querySelector('#docClear'); if(cb) cb.style.display=rows.length?'':'none';
  };
  await render();
  const addBtn=m.querySelector('#docAddBtn'), nameI=m.querySelector('#docName'), textI=m.querySelector('#docText'), hint=m.querySelector('#docHint');
  if(addBtn) addBtn.onclick=async()=>{
    const text=((textI&&textI.value)||'').trim(); if(!text){ toast(tt('请先粘贴内容或选文件','Paste text or pick a file first')); return; }
    const name=((nameI&&nameI.value)||'').trim();
    addBtn.disabled=true; const old=addBtn.textContent; addBtn.textContent=tt('添加中…','Adding…');
    try{ const r=await rt.docs.add(name, text); toast(tt('已加入「','Added "')+((r&&r.name)||name||tt('未命名','Untitled'))+'」 · '+((r&&r.chunks)||0)+tt(' 片段',' chunks')); if(nameI)nameI.value=''; if(textI)textI.value=''; if(hint)hint.textContent=''; await render(); }
    catch(e){ toast(errText(e)); }
    finally{ addBtn.disabled=false; addBtn.textContent=old; }
  };
  const fileBtn=m.querySelector('#docFileBtn'), fileI=m.querySelector('#docFile');
  if(fileBtn&&fileI){ fileBtn.onclick=()=>fileI.click();
    fileI.onchange=()=>{ const f=fileI.files&&fileI.files[0]; if(!f) return; const reader=new FileReader();
      reader.onload=()=>{ if(textI) textI.value=String(reader.result||''); if(nameI&&!nameI.value) nameI.value=f.name.replace(/\.(txt|md)$/i,''); if(hint) hint.textContent=f.name; };
      reader.readAsText(f); fileI.value=''; }; }
  const clr=m.querySelector('#docClear');
  if(clr) clr.onclick=()=>{ if(!G||!G.confirmDestructive) return;
    G.confirmDestructive({ title:tt('清空全部文档?','Clear all docs?'), detail:tt('将删除知识库里的全部文档。可在几秒内撤销。','Removes every doc. Undoable for a few seconds.'), confirmLabel:tt('清空','Clear'), undoText:tt('已清空知识库','Knowledge cleared'),
      onConfirm:async()=>{ try{ await rt.docs.clear(); }catch(_e){} await render(); },
      onUndo:async()=>{ try{ await rt.docs.undo(); }catch(_e){} await render(); } }); };
}
// MCP 服务器管理(#2 C4):本地(stdio)/ 远程(http)增删启停 + 测试连接 + 令牌(进钥匙串)。
// 知情同意「本地会运行程序 / 远程会连端点」。删走 guardrail;令牌只进钥匙串,前端不持明文。
async function openMcpManager(){
  const rt=window.SeekerRT, G=window.SeekerGuardrail;
  const m=openModal(`<div class="modal-head"><div><p class="eyebrow">— EXTENSIONS</p><h2 style="margin-top:5px;">${tt('MCP 服务器','MCP servers')}</h2></div><button class="x">${IC.x}</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:6px;">
        <div style="display:flex;gap:10px;align-items:center;">
          <span class="mono" style="font-size:10px;color:var(--ink-3);letter-spacing:.06em;">${tt('类型','TYPE')}</span>
          <div style="display:inline-flex;border:0.5px solid var(--border);border-radius:6px;overflow:hidden;">
            <button class="mcp-mode" data-mode="stdio" style="border:0;background:transparent;padding:5px 16px;font-size:12px;cursor:pointer;">${tt('本地','Local')}</button>
            <button class="mcp-mode" data-mode="http" style="border:0;border-left:0.5px solid var(--border);background:transparent;padding:5px 16px;font-size:12px;cursor:pointer;">${tt('远程','Remote')}</button>
          </div>
        </div>
        <input class="input" id="mcpName" placeholder="${tt('名称(如 filesystem)','Name (e.g. filesystem)')}">
        <div id="mcpLocal" style="display:flex;flex-direction:column;gap:8px;">
          <input class="input" id="mcpCmd" placeholder="${tt('命令(如 npx 或 node)','Command (e.g. npx or node)')}">
          <input class="input" id="mcpArgs" placeholder="${tt('参数,空格分隔(如 -y @modelcontextprotocol/server-filesystem ./docs)','Args, space-separated')}">
        </div>
        <div id="mcpRemote" style="display:none;flex-direction:column;gap:8px;">
          <input class="input" id="mcpUrl" placeholder="${tt('端点 URL(如 https://example.com/mcp)','Endpoint URL (e.g. https://example.com/mcp)')}">
          <input class="input" id="mcpToken" type="password" autocomplete="off" placeholder="${tt('鉴权令牌(可选 · 只存系统钥匙串)','Auth token (optional · system keychain only)')}">
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-accent" id="mcpAddBtn">${tt('添加服务器','Add server')}</button>
          <button class="btn" id="mcpTestBtn">${tt('测试连接','Test connection')}</button>
          <span class="mono" id="mcpHint" style="font-size:11px;color:var(--ink-mute);"></span>
        </div>
      </div>
      <div class="lock-note" style="margin:2px 0 14px;"><span class="li">🧩</span><span>${tt('本地 = 在本机运行该程序;远程 = 连接你填的 HTTP 端点。只加你信任的来源;令牌只存系统钥匙串、绝不外发;AI 调用其工具时每次都会先问你,返回内容当作数据(不可信、防注入)。','Local runs the program on your machine; Remote connects to the HTTP endpoint you enter. Only add trusted sources; tokens live only in the system keychain and never leave it; the AI asks before each tool call and treats returned content as untrusted data.')}</span></div>
      <div id="mcpList">${tt('加载中…','Loading…')}</div>
    </div>
    <div class="modal-foot"><button class="btn btn-accent" onclick="closeModal()">${tt('完成','Done')}</button></div>`, true);
  const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const escA=s=>esc(s).replace(/"/g,'&quot;');
  const parseArgs=s=>String(s||'').trim().split(/\s+/).filter(Boolean);
  const val=id=>{const e=m.querySelector(id);return e?e.value.trim():'';};
  const hint=m.querySelector('#mcpHint');
  // 传输模式切换(选中态:暖橙文字 + 底线,不依赖 color-mix)。
  let mode='stdio';
  const setMode=mo=>{mode=mo;
    const lo=m.querySelector('#mcpLocal'), re=m.querySelector('#mcpRemote');
    if(lo)lo.style.display=mo==='stdio'?'flex':'none';
    if(re)re.style.display=mo==='http'?'flex':'none';
    [...m.querySelectorAll('.mcp-mode')].forEach(b=>{const on=b.dataset.mode===mo;
      b.style.color=on?'var(--accent)':'var(--ink-3)'; b.style.fontWeight=on?'600':'400';
      b.style.boxShadow=on?'inset 0 -2px 0 var(--accent)':'none';});
    if(hint)hint.textContent='';
  };
  [...m.querySelectorAll('.mcp-mode')].forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  setMode('stdio');
  const render=async()=>{
    let rows=[]; try{ rows=await rt.mcp.list(); }catch(_e){}
    const body=m.querySelector('#mcpList'); if(!body) return;
    body.innerHTML = rows.length
      ? rows.map(s=>{
          const http=s.transport==='http';
          const where=http?esc(s.url||''):(esc(s.command)+' '+esc((s.args||[]).join(' ')));
          const ttag=`<span class="mono" style="font-size:9.5px;color:var(--ink-3);border:0.5px solid var(--border);border-radius:3px;padding:0 4px;">${http?tt('远程','REMOTE'):tt('本地','LOCAL')}</span>`;
          const tools=(s.tools||[]).map(t=>esc(t.name)).join('、');
          const status = s.error ? `<span style="color:var(--ink-3);">${tt('连接失败','Failed')}</span>`
            : s.enabled ? (s.connected ? `<span style="color:var(--status-done);">${s.toolCount} ${tt('工具','tools')}</span>` : tt('连接中…','Connecting…'))
            : `<span style="color:var(--ink-3);">${tt('已停用','Disabled')}</span>`;
          const authLine = http ? `<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${s.authConfigured?('🔑 '+tt('令牌已配置','Token set')):tt('未配置令牌(无鉴权)','No token (unauthenticated)')}</div>` : '';
          // stdio 环境变量状态:只列已配变量名(值只在钥匙串、前端不见)+ 可点 × 清除。
          const envList=(s.envConfigured||[]).filter(e=>e&&e.status==='configured');
          const envLine = !http ? `<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${envList.length
            ? '🔑 '+envList.map(e=>`<span class="mono" style="font-size:10px;">${esc(e.var)}</span> <span data-mcpenvclear data-cn="${escA(s.name)}" data-cv="${escA(e.var)}" title="${tt('清除','Clear')}" style="cursor:pointer;color:var(--ink-3);padding:0 2px;">×</span>`).join('　')
            : tt('未配置环境变量','No env vars')}</div>` : '';
          return `<div style="padding:9px 0;border-bottom:0.5px solid var(--border);"><div style="display:flex;gap:10px;align-items:center;">
            <div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--ink);font-weight:500;">${ttag} ${esc(s.name)} · ${status}</div>
              <div style="font-family:var(--font-mono);font-size:10px;color:var(--ink-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${where}</div>
              ${tools?`<div style="font-size:11px;color:var(--ink-2);margin-top:3px;">${tools}</div>`:''}
              ${authLine}
              ${envLine}
              ${s.error?`<div style="font-size:11px;color:var(--ink-3);margin-top:3px;">${esc(s.error)}</div>`:''}</div>
            ${http?`<button class="btn" data-mcpauth="${escA(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('令牌','Token')}</button>`:''}
            ${!http?`<button class="btn" data-mcpenv="${escA(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('变量','Env')}</button>`:''}
            <button class="btn" data-mcptoggle="${escA(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${s.enabled?tt('停用','Disable'):tt('启用','Enable')}</button>
            <button class="btn" data-mcpdel="${escA(s.name)}" style="padding:4px 10px;font-size:11px;flex-shrink:0;">${tt('删除','Remove')}</button>
          </div>
          ${http?`<div class="mcp-authedit" data-for="${escA(s.name)}" style="display:none;gap:6px;margin-top:8px;">
            <input class="input" type="password" autocomplete="off" placeholder="${tt('鉴权令牌(留空保存 = 清除)','Auth token (save empty = clear)')}" style="flex:1;">
            <button class="btn btn-accent" data-mcpauthsave="${escA(s.name)}" style="padding:4px 12px;font-size:11px;flex-shrink:0;">${tt('保存','Save')}</button>
          </div>`:''}
          ${!http?`<div class="mcp-envedit" data-for="${escA(s.name)}" style="display:none;gap:6px;margin-top:8px;">
            <input class="input" data-envvar autocomplete="off" placeholder="${tt('变量名(如 BRAVE_API_KEY)','Var name (e.g. BRAVE_API_KEY)')}" style="flex:1;">
            <input class="input" type="password" data-envval autocomplete="off" placeholder="${tt('值(留空 = 清除该变量)','Value (empty = clear)')}" style="flex:1;">
            <button class="btn btn-accent" data-mcpenvsave="${escA(s.name)}" style="padding:4px 12px;font-size:11px;flex-shrink:0;">${tt('保存','Save')}</button>
          </div>`:''}
          </div>`;
        }).join('')
      : `<p style="color:var(--ink-3);padding:14px 0;text-align:center;">${tt('还没有 MCP 服务器。添加一个,让 AI 用上外部工具(每次调用都会先问你)。','No MCP servers yet. Add one to give the AI external tools — it asks before each call.')}</p>`;
    [...m.querySelectorAll('[data-mcptoggle]')].forEach(b=>b.onclick=async()=>{
      const s=rows.find(x=>x.name===b.dataset.mcptoggle); if(!s) return;
      try{ await rt.mcp.setEnabled(s.name, !s.enabled); }catch(e){ toast(errText(e)); } await render();
    });
    [...m.querySelectorAll('[data-mcpdel]')].forEach(b=>b.onclick=()=>{
      if(!G||!G.confirmDestructive) return;
      G.confirmDestructive({ title:tt('删除 MCP 服务器?','Remove MCP server?'), detail:(tt('将移除并断开:','Remove and disconnect: '))+b.dataset.mcpdel, confirmLabel:tt('删除','Remove'),
        onConfirm:async()=>{ try{ await rt.mcp.remove(b.dataset.mcpdel); }catch(_e){} await render(); } });
    });
    // 令牌:展开/收起行内输入 → setAuth(留空保存 = 清除)。令牌直送钥匙串。
    const findEdit=name=>[...m.querySelectorAll('.mcp-authedit')].find(x=>x.dataset.for===name);
    [...m.querySelectorAll('[data-mcpauth]')].forEach(b=>b.onclick=()=>{
      const box=findEdit(b.dataset.mcpauth); if(box) box.style.display = box.style.display==='none'?'flex':'none';
    });
    [...m.querySelectorAll('[data-mcpauthsave]')].forEach(b=>b.onclick=async()=>{
      const name=b.dataset.mcpauthsave, box=findEdit(name), inp=box&&box.querySelector('input');
      const has=!!(inp&&inp.value.trim());
      try{ await rt.mcp.setAuth(name, (inp&&inp.value)||''); toast(has?tt('令牌已保存','Token saved'):tt('令牌已清除','Token cleared')); }
      catch(e){ toast(errText(e)); }
      await render();
    });
    // 环境变量(stdio):展开行内「名 + 值」→ setEnv(值直送钥匙串;留空 = 清除该变量)。
    const findEnvEdit=name=>[...m.querySelectorAll('.mcp-envedit')].find(x=>x.dataset.for===name);
    [...m.querySelectorAll('[data-mcpenv]')].forEach(b=>b.onclick=()=>{
      const box=findEnvEdit(b.dataset.mcpenv); if(box) box.style.display = box.style.display==='none'?'flex':'none';
    });
    [...m.querySelectorAll('[data-mcpenvsave]')].forEach(b=>b.onclick=async()=>{
      const name=b.dataset.mcpenvsave, box=findEnvEdit(name);
      const vn=box&&box.querySelector('[data-envvar]'), vv=box&&box.querySelector('[data-envval]');
      const varName=(vn&&vn.value.trim())||''; if(!varName){ toast(tt('请填变量名','Enter a var name')); return; }
      const hasVal=!!(vv&&vv.value.trim());
      try{ await rt.mcp.setEnv(name, varName, (vv&&vv.value)||''); toast((hasVal?tt('已保存 ','Saved '):tt('已清除 ','Cleared '))+varName); }
      catch(e){ toast(errText(e)); }
      await render();
    });
    [...m.querySelectorAll('[data-mcpenvclear]')].forEach(el=>el.onclick=async()=>{
      const name=el.dataset.cn, varName=el.dataset.cv;
      try{ await rt.mcp.setEnv(name, varName, ''); toast(tt('已清除 ','Cleared ')+varName); }
      catch(e){ toast(errText(e)); }
      await render();
    });
  };
  await render();
  const addBtn=m.querySelector('#mcpAddBtn');
  if(addBtn) addBtn.onclick=async()=>{
    const name=val('#mcpName');
    if(!name){ toast(tt('请填名称','Enter a name')); return; }
    addBtn.disabled=true;
    try{
      if(mode==='http'){
        const url=val('#mcpUrl'); if(!url){ toast(tt('请填端点 URL','Enter endpoint URL')); return; }
        await rt.mcp.add(name, { url });
        const token=val('#mcpToken');
        if(token){ try{ await rt.mcp.setAuth(name, token); }catch(e){ toast(errText(e)); } }
      } else {
        const cmd=val('#mcpCmd'); if(!cmd){ toast(tt('请填命令','Enter command')); return; }
        await rt.mcp.add(name, { command:cmd, args:parseArgs(val('#mcpArgs')) });
      }
      toast(tt('已添加 ','Added ')+name);
      ['#mcpName','#mcpCmd','#mcpArgs','#mcpUrl','#mcpToken'].forEach(id=>{const e=m.querySelector(id); if(e)e.value='';});
      if(hint)hint.textContent='';
      await render();
    }
    catch(e){ toast(errText(e)); }
    finally{ addBtn.disabled=false; }
  };
  const testBtn=m.querySelector('#mcpTestBtn');
  if(testBtn) testBtn.onclick=async()=>{
    testBtn.disabled=true; if(hint)hint.textContent=tt('连接中…','Connecting…');
    try{
      let r;
      if(mode==='http'){
        const url=val('#mcpUrl'); if(!url){ if(hint)hint.textContent=''; toast(tt('请先填 URL','Enter URL first')); return; }
        const token=val('#mcpToken');
        r=await rt.mcp.probe({ url, token: token||undefined });
      } else {
        const cmd=val('#mcpCmd'); if(!cmd){ if(hint)hint.textContent=''; toast(tt('请先填命令','Enter command first')); return; }
        r=await rt.mcp.probe({ command:cmd, args:parseArgs(val('#mcpArgs')) });
      }
      if(hint)hint.textContent=tt('成功 · ','OK · ')+r.toolCount+tt(' 个工具',' tools');
      toast(tt('连接成功 · ','Connected · ')+r.toolCount+tt(' 工具',' tools'));
    }
    catch(e){ if(hint)hint.textContent=''; toast(errText(e)); }
    finally{ testBtn.disabled=false; }
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
    <button class="btn btn-accent" style="margin-top:16px;" onclick="toast('订阅页面 (mock)')">${tt('了解订阅','Learn more')} →</button>
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
    ${row(tt('演示空状态','Demo empty state'),`<button class="btn" onclick="showEmptyState()">${tt('查看引导态','View onboarding')}</button>`)}
    <div style="margin:14px 0 2px;"><p class="seclabel">— ${tt('隐私 · 历史与记忆','Privacy · history & memory')}</p></div>
    ${row(tt('会话历史','Chat history'),`<button class="btn" id="mgrHistory">${tt('查看与清除','View & clear')}</button>`)}
    ${row(tt('长期记忆','Long-term memory'),`<button class="btn" id="mgrMemory">${tt('查看与清除','View & clear')}</button>`)}
    ${row(tt('知识库 · 文档','Knowledge · docs'),`<button class="btn" id="mgrDocs">${tt('管理文档','Manage docs')}</button>`)}
    <div class="lock-note" style="margin:6px 0 14px;max-width:640px;"><span class="li">🔒</span><span>${tt('会话历史与长期记忆都只存在本地。<b>AI 不会查询你的会话历史</b>(只在当轮对话内拿上下文);长期记忆里若有你主动写出的信息,可在此查看或随时清除。<b>知识库文档</b>是你主动加入、供 AI 检索作答的语料(需配嵌入模型),其相关片段会用于回答 —— 同样只存本地、可随时删除。你掌控自己的数据。','Chat history and long-term memory stay local only. <b>AI cannot query your chat history</b> (only in-conversation context); review/clear volunteered memory here anytime. <b>Knowledge docs</b> are material you add for the AI to retrieve from (needs an embed model); relevant chunks are used in answers — also local-only and deletable anytime. You control your data.')}</span></div>
    <div style="margin:14px 0 2px;"><p class="seclabel">— ${tt('扩展 · MCP 工具','Extensions · MCP tools')}</p></div>
    ${row(tt('MCP 服务器','MCP servers'),`<button class="btn" id="mgrMcp">${tt('管理服务器','Manage servers')}</button>`)}
    <div class="lock-note" style="margin:6px 0 14px;max-width:640px;"><span class="li">🧩</span><span>${tt('MCP 让 AI 接入外部工具(文件 / 数据库 / API…)。<b>本地服务器 = 在你电脑上运行一个程序;远程服务器 = 连接你填的 HTTP 端点</b>,请只加你信任的来源;鉴权令牌只存系统钥匙串、绝不外发;AI 每次调用其工具都会<b>先征得你同意</b>,返回内容被当作数据(不可信、防注入)。仅桌面端可用。','MCP lets the AI use external tools (files / databases / APIs). <b>A local server runs a program on your machine; a remote server connects to the HTTP endpoint you enter</b> — only add sources you trust. Auth tokens live only in the system keychain and never leave it; the AI <b>asks your permission every time</b> it calls a tool, and returned content is treated as untrusted data. Desktop only.')}</span></div>
    ${row(tt('清空所有数据','Clear all data'),`<button class="btn" id="clearAllData">${tt('清空','Clear')}</button>`)}
  </div>`;
  sections.about=`<p class="seclabel">— ABOUT</p><h2 class="sectitle">${tt('关于','About')}<span class="dot">.</span></h2>
    <div style="margin-top:14px;font-size:14px;color:var(--ink-2);line-height:1.9;">
      <div style="font-weight:600;color:var(--ink);">${tt('JobHunt · 求职岗位研究工作台','Seeker · Job Research Workbench')}</div>
      <div class="mono" style="font-size:12px;color:var(--ink-3);margin:4px 0;">v 0.1.0 · 2026 · ${tt('本地优先','Local-first')}</div>
      <div style="color:var(--ink-3);max-width:600px;">${tt('一个本地优先的「目标岗位收集 + JD 解析 + 能力缺口分析 + 简历 + 面试陪练」工作台。所有数据存于本地,隐私信息不参与 AI 处理。','A local-first workbench for collecting target jobs, parsing JDs, analyzing skill gaps, resumes, and interview prep. All data stays local; private info never goes through AI.')}</div>
      <div style="display:flex;gap:14px;margin-top:14px;"><button class="btn" onclick="toast('已是最新版本')">${tt('检查更新','Check updates')}</button><button class="btn" onclick="toast('感谢反馈 (mock)')">${tt('反馈问题','Send feedback')}</button></div>
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
  // ②契约驱动 tab/extend 接线:全调(同原逻辑"$$ 选择器对非当前 tab 内容 no-op"的无条件风格),不做条件判断。
  appTabs.forEach(t=>{ if(typeof t.wire==='function') t.wire(); });
  appSpecs.forEach(s=>{ if(s.extend) Object.keys(s.extend).forEach(k=>{ const e=s.extend[k]; if(e&&typeof e.wire==='function') e.wire(); }); });
}

/* D3:导出 / 脱敏导出 / 导入(桌面真接平台核;web 沿用 mock)。导入用 <input type=file> 读文件,零新插件。 */
function wireDataIO(){
  const exp=$('#dataExport'), expR=$('#dataExportRedacted'), imp=$('#dataImport'), impFile=$('#dataImportFile');
  if(!exp) return;
  const mh=$('#mgrHistory'); if(mh) mh.onclick=openHistoryManager;   // 历史与记忆掌控(#4),web/桌面皆可
  const mm=$('#mgrMemory'); if(mm) mm.onclick=openMemoryManager;
  const md=$('#mgrDocs'); if(md) md.onclick=openDocsManager;          // RAG 知识库管理(#2)
  const mcpB=$('#mgrMcp'); if(mcpB) mcpB.onclick=openMcpManager;       // MCP server 管理(#2 C4)
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
          if(typeof hydrateJobs==='function') hydrateJobs();
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
