// @ts-nocheck —— 批10c:最后一个 classic 外链 → ES module;依赖全改 import、消费者(copilot-chrome/intake-job)同刀 flip → **零 window 桥收官**。函数体逐字节零改。
/** 平台 · AI 引擎 extractSeekerBlock/streamReply(+aiLangHint 私有)—— 解析/流式渲染不可信 AI 输出(红线)。
 *  安全属性(逐字保留 · 第10轮评审逐刀验、批10c 加倍审):
 *   ① streamReply 卡剥离走 SeekerShell.cards() 契约、prose 经 aiHTML(Markdown 安全/esc 回退)、AI 原始 HTML 不进 DOM、持久卡 CARDS[k].persist 过滤;
 *   ② extractSeekerBlock 提取 JSON 经 CARDS[kind].valid 校验后才 push/show(不臆造/不注入);
 *   ③ Untrusted 框定:AI 输出经解析 + valid、当数据非指令。
 *  ★载序(裁定②):本文件依赖(i18n@861/ai-render@864/shell-state@866/data-store@867)tag 皆早于本文件 @869 → import 边零提升;
 *    顶层零语句(仅函数声明)→ 零 eager 读;消费者全 runtime(copSend/agentSend/doExtract)。aiLangHint 零外部消费者 → 私有不 export。 */
import { tt } from './i18n.js';
import { setState } from './shell-state.js';
import { aiHTML, displayText, toolStatusText, aiErrHTML } from './ai-render.js';
import { persistMsg } from './data-store.js';

export function extractSeekerBlock(text, kind){
  const s = String(text==null?'':text);
  const m = s.match(new RegExp('```seeker:' + kind + '\\s*([\\s\\S]*?)```'));
  if(!m) return { prose:s, data:null };
  let data = null;
  try{ data = JSON.parse(m[1].trim()); }catch(_e){}
  const prose = data ? (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim() : s; // 解析成功才剥离
  return { prose, data };
}

/** 把「思考中」气泡变成流式目标,逐 token 写入(textContent 防注入)。
   关键:保留「思考中」指示直到首 token 才切流式 —— 工具循环(query_data 等)首字可达 10s+,
   期间用状态行反馈「正在查询你的本地数据…」,否则空 who 气泡会被误当「没反应」。 */
// AI 回复语言:把当前界面语言作为指令附在发给模型的文本末尾。
// (系统提示在平台层、domain 改不了;故经 user_text 传达。显示给用户的仍是原文,只有发给模型的带此指令。)
function aiLangHint(){ return setState.lang==='en' ? '\n\n[Please reply in English.]' : '\n\n[请用简体中文回复。]'; }
export function streamReply(thinkBubble, text, who, scrollFn){
  const dots='<span class="ai-dots"><i></i><i></i><i></i></span>';
  thinkBubble.innerHTML='<span class="who">'+who+'</span><div class="cop-think">'+dots+'<span class="ai-status">'+tt('思考中…','Thinking…')+'</span></div>';
  let acc='', span=null, streaming=false;
  const startStream=()=>{ if(streaming)return; streaming=true; thinkBubble.innerHTML='<span class="who">'+who+'</span><span class="ai-stream"></span>'; span=thinkBubble.querySelector('.ai-stream'); };
  const setStatus=(msg)=>{ const s=thinkBubble.querySelector('.ai-status'); if(s) s.textContent=msg; };
  window.SeekerRT.ai.stream({ userText:text+aiLangHint() }, {
    onToken(t){ if(!streaming) startStream(); acc+=t; if(span) span.innerHTML=aiHTML(displayText(acc)); if(scrollFn) scrollFn(); }, // Markdown 安全渲染
    onTool(info){ if(!streaming) setStatus(toolStatusText(info)); if(scrollFn) scrollFn(); }, // 工具循环进度(此前未接,致空气泡)
    onWidget(w){
      /* show_widget(#2 · W1):平台渲染器产沙箱卡 → 插入对话流(thinkBubble 所在容器)。 */
      if(!streaming) startStream();
      try{ const card=window.SeekerWidgets.renderWidget(w); const host=thinkBubble.parentElement; if(host) host.appendChild(card); }
      catch(e){ console.error('[widget] 渲染失败', e); }
      if(scrollFn) scrollFn();
    },
    onError(err){ thinkBubble.innerHTML='<span class="who">'+who+'</span>'+aiErrHTML(err); if(scrollFn) scrollFn(); },
    onDone(){
      if(!streaming) startStream();                                   // 兜底:无 token 也有流式容器(不留空气泡)
      let prose = acc; const pending = [];                            // 逐卡型剥离 ```seeker 指令块(注册表驱动,加卡零改)
      const CARDS = window.SeekerShell.cards();                       // 壳组合:启用应用贡献的卡注册表
      for(const kind in CARDS){
        const b = extractSeekerBlock(prose, kind);
        if(b.data && CARDS[kind].valid(b.data)){ pending.push([kind, b.data]); prose = b.prose; }
      }
      if(span) span.innerHTML = aiHTML(prose);                        // 最终 Markdown 渲染(已去所有 JSON 块)
      const persistCards = pending.filter(([k])=>CARDS[k].persist).map(([kind,data])=>({kind,data}));
      persistMsg(who==='Agent'?'agent':'cop','ai', prose, persistCards); // 文字 + 可持久化卡指令(重启后重渲)
      for(const [kind, data] of pending){ try{ CARDS[kind].show(thinkBubble, data, who); }catch(e){ console.error('[card] '+kind, e); } }
      if(scrollFn) scrollFn();
    }
  });
}
