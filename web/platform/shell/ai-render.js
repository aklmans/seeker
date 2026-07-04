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
