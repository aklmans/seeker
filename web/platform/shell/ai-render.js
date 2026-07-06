// @ts-nocheck —— 3.y 类型化:classic 全局 → 真 ES module(export)+ 过渡 window 兼容桥。
//   仍 @ts-nocheck:依赖 SeekerMarkdown(已 module 全局)/tt(过渡 classic 全局,经共享全局词法环境解析);
//   消费者(ai-engine/copilot-chrome/cards,均 @ts-nocheck)按全局名调不变 → 逐字节零回归;待其转 module 后改 import + @ts-check。
/** 平台 · AI 渲染 helper aiHTML/displayText/toolStatusText/aiErrHTML(均无模块态=纯函数,dual-publish 安全)。
 *  aiHTML:不可信模型输出 → SeekerMarkdown 安全渲染,缺失则 fallback esc 转义(防注入,安全属性逐字保留)。 */
export function aiHTML(text){
  if(window.SeekerMarkdown && window.SeekerMarkdown.render) return window.SeekerMarkdown.render(text);
  return String(text==null?'':text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
/** 流式显示用:截断到任一 seeker 指令块起始之前(块在 onDone 解析,流式中途不外显原始 JSON)。 */
export function displayText(s){
  s = String(s==null?'':s);
  const i = s.indexOf('```seeker:');
  return i>=0 ? s.slice(0, i) : s;
}
/** 工具循环进度文案(反焦虑:让用户知道 AI 正在读数据,而非卡住)。 */
export function toolStatusText(info){
  const n = info && info.name;
  if(n==='query_data') return tt('正在查询你的本地数据…','Reading your local data…');
  if(n==='show_widget') return tt('正在生成…','Composing…');
  if(n==='memory'||n==='remember'||n==='recall') return tt('正在检索记忆…','Searching memory…');
  return tt('正在处理…','Working…');
}
/* ---- 抽壳序3-d-5(★红线;3.y 转 module 逐字节保留安全属性):AI 错误渲染 aiErrHTML —— provider 错误体经 streamReply onError 进 DOM,
   ★err 转义逐字保留:String(err.message||err).replace(/</g,'&lt;')(第11轮挂号,防 provider 错误注入);
   onclick 只 copClose + go('settings')(设置不可经对话改,仅导航打开)。依赖 tt/copClose/go(运行时全局);ai-engine.js onError 运行时调。 ---- */
export function aiErrHTML(err){
  const m=String((err&&err.message)||err).replace(/</g,'&lt;');
  /* 配置类错误 → 引导去「数据设置」(密钥不可对话改) */
  return '<span style="color:var(--ink-2);">'+m+'</span> <button class="btn" style="margin-left:6px;" onclick="if(typeof copClose===\'function\')copClose();go(\'settings\')">'+tt('打开数据设置','Open settings')+'</button>';
}
/* 过渡 window 兼容桥(约束⑤延续):classic 消费者(ai-engine/copilot-chrome/cards)按全局名调不变 → 零回归;逐个改 import 后摘。纯函数、零模块态 → dual-publish 安全。 */
window.aiHTML=aiHTML; window.displayText=displayText; window.toolStatusText=toolStatusText; window.aiErrHTML=aiErrHTML;
