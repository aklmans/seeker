// @ts-nocheck —— 批10c:最后一个 classic 外链 → ES module;依赖全改 import、消费者(copilot-chrome/intake-job)同刀 flip → **零 window 桥收官**。函数体逐字节零改。
/** 平台 · AI 引擎 extractSeekerBlock/streamReply(+aiLangHint 私有)—— 解析/流式渲染不可信 AI 输出(红线)。
 *  安全属性(逐字保留 · 第10轮评审逐刀验、批10c 加倍审):
 *   ① streamReply 卡剥离走 SeekerShell.cards() 契约、prose 经 aiHTML(Markdown 安全/esc 回退)、AI 原始 HTML 不进 DOM、持久卡 CARDS[k].persist 过滤;
 *   ② extractSeekerBlock 提取 JSON 经 CARDS[kind].valid 校验后才 push/show(不臆造/不注入);
 *   ③ Untrusted 框定:AI 输出经解析 + valid、当数据非指令。
 *  ★载序(裁定② · 第42轮[应改]订正):import 边把 provider 的 module-eval 提前到 consumer 的 tag 位 ⇒ 判据 = 查「提前区间内有无 eager 读 / 被跳过的副作用」,非「依赖 tag 更早 ⇒ 无提升」。
 *    实测 i18n@861/ai-render@864/shell-state@866 早于本文件 @869(无提升);**data-store@870 晚于 @869 → 确有一次提升**——但提升惰性:data-store 零 import、顶层仅 `let __msgSeq=0`+桥赋值、零 eager 读,且 869↔870 间只夹本文件的空 body(顶层零语句)→ 桥反而更早就绪,安全。
 *    本文件顶层零语句(仅函数声明)→ 零 eager 读;消费者全 runtime(copSend/agentSend/doExtract)。aiLangHint 零外部消费者 → 私有不 export。 */
import { tt } from './i18n.js';
import { setState } from './shell-state.js';
import { aiHTML, displayText, toolStatusText, aiErrHTML } from './ai-render.js';
import { persistMsg } from './data-store.js';
import { filterReadableTools } from '../capability/app-tools/readable.js';

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
/**
 * 收集启用∩可读的 app-tool 描述符,随请求携给网关(app-tool 契约 T2b)。
 * ★D3「上架」闸:只带 **reads ⊆ 运行时可读集**(aiReadableCollections)的工具——reads 不可读即**不上架**;
 *   运行时「调用硬拒」另由后端 query_data 的 D3 闸独立兜底(取数时若不可读则拒)。
 * ★fail-closed:缺 SeekerShell / appTools 返 `[]`(无 app-tool,不误上架)。
 * ★**只带 name/description/parameters**(应用自持可信元数据),**不带** compute/reads/output/render / 任何用户数据 / profile。
 * @returns {{name:string,description:string,parameters:object}[]}
 */
function readableAppTools(){
  const S = /** @type {any} */ (window).SeekerShell;
  if(!S || typeof S.appTools!=='function' || typeof S.aiReadableCollections!=='function') return [];
  return filterReadableTools(S.appTools(), S.aiReadableCollections());
}
export function streamReply(thinkBubble, text, who, scrollFn){
  const dots='<span class="ai-dots"><i></i><i></i><i></i></span>';
  thinkBubble.innerHTML='<span class="who">'+who+'</span><div class="cop-think">'+dots+'<span class="ai-status">'+tt('思考中…','Thinking…')+'</span></div>';
  let acc='', span=null, streaming=false;
  const startStream=()=>{ if(streaming)return; streaming=true; thinkBubble.innerHTML='<span class="who">'+who+'</span><span class="ai-stream"></span>'; span=thinkBubble.querySelector('.ai-stream'); };
  const setStatus=(msg)=>{ const s=thinkBubble.querySelector('.ai-status'); if(s) s.textContent=msg; };
  window.SeekerRT.ai.stream({ userText:text+aiLangHint(), appTools:readableAppTools() }, {
    onToken(t){ if(!streaming) startStream(); acc+=t; if(span) span.innerHTML=aiHTML(displayText(acc)); if(scrollFn) scrollFn(); }, // Markdown 安全渲染
    onTool(info){ if(!streaming) setStatus(toolStatusText(info)); if(scrollFn) scrollFn(); }, // 工具循环进度(此前未接,致空气泡)
    onWidget(w){
      /* ★AI-Native P0:show_widget 沙箱卡投**右画布**(#agentCanvasBody),不再内联进对话;并切 split 显示画布
         (appMode 恒 agent、流式期 appReady 必真 → 直设 dataset,免 import agentShowCanvas 造 ai-engine⇄copilot-chrome 环)。兜底:无画布容器则仍内联(#2 · W1 沙箱不变)。 */
      if(!streaming) startStream();
      try{
        const card=window.SeekerWidgets.renderWidget(w);
        const canvasBody=document.getElementById('agentCanvasBody');
        if(canvasBody){ canvasBody.appendChild(card); document.body.dataset.canvas='widget'; document.body.dataset.agent='split'; }
        else { const host=thinkBubble.parentElement; if(host) host.appendChild(card); }
      }
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
