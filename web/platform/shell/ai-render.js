// @ts-nocheck —— 抽壳序1-f 过渡:引用 SeekerMarkdown/tt(壳),类型化留 3.y;逻辑零改动。
/** 平台 · AI 渲染 helper aiHTML/displayText/toolStatusText。
 *  aiHTML:不可信模型输出 → SeekerMarkdown 安全渲染,缺失则 fallback esc 转义(防注入,安全属性逐字保留)。
 *  依赖 SeekerMarkdown/tt;streamReply(序2 引擎)+aiLangHint 留 index.html。挂全局+载序前置零回归(约束⑤)。 */
function aiHTML(text){
  if(window.SeekerMarkdown && window.SeekerMarkdown.render) return window.SeekerMarkdown.render(text);
  return String(text==null?'':text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
/** 流式显示用:截断到任一 seeker 指令块起始之前(块在 onDone 解析,流式中途不外显原始 JSON)。 */
function displayText(s){
  s = String(s==null?'':s);
  const i = s.indexOf('```seeker:');
  return i>=0 ? s.slice(0, i) : s;
}
/** 工具循环进度文案(反焦虑:让用户知道 AI 正在读数据,而非卡住)。 */
function toolStatusText(info){
  const n = info && info.name;
  if(n==='query_data') return tt('正在查询你的本地数据…','Reading your local data…');
  if(n==='show_widget') return tt('正在生成…','Composing…');
  if(n==='memory'||n==='remember'||n==='recall') return tt('正在检索记忆…','Searching memory…');
  return tt('正在处理…','Working…');
}

/* ---- 抽壳序3-d-5(红线):AI 错误渲染 aiErrHTML —— provider 错误体经 streamReply onError 进 DOM,
   ★err 转义逐字保留:String(err.message||err).replace(/</g,'&lt;')(第11轮挂号,防 provider 错误注入);
   onclick 只 copClose + go('settings')(设置不可经对话改,仅导航打开)。依赖 tt/copClose/go(运行时全局);ai-engine.js onError 运行时调。 ---- */
function aiErrHTML(err){
  const m=String((err&&err.message)||err).replace(/</g,'&lt;');
  /* 配置类错误 → 引导去「数据设置」(密钥不可对话改) */
  return '<span style="color:var(--ink-2);">'+m+'</span> <button class="btn" style="margin-left:6px;" onclick="if(typeof copClose===\'function\')copClose();go(\'settings\')">'+tt('打开数据设置','Open settings')+'</button>';
}
