// @ts-check
/**
 * show_widget 前端渲染(#2 · W1 沙箱 / W2 自适应·主题 / W3 交互回流 / W4 容错·a11y)
 * —— 平台层,业务无关,两端通用。
 *
 * 不可信的 LLM 生成 HTML 在**三道墙**中渲染:
 *   墙1 `iframe sandbox="allow-scripts"`(不加 allow-same-origin → null 起源,够不到父 DOM/cookie/存储);
 *   墙2 srcDoc 内 `<meta CSP default-src 'none'>`(掐断一切网络,即便沙箱异常);
 *   墙3 父窗口零信任(入站消息只读结构化字段;widget_id 由端口归属定、不信 iframe 自报;
 *        widget-action 当意图、破坏性过 platform/guardrail)。
 * sanitize + ≤64KB 闸在平台核(Rust)已做(拒外链 + 限长);此处负责安全外壳、隔离渲染、
 * 自适应高度、主题热跟随、交互回流与**加载/错误兜底**。
 */

import {styleCSS,normalizeStyle} from '../../creations/style.js';
import {WIDGET_CSS} from './design-system.js';
import {tt} from '../../shell/i18n.js';
import {snapshotWidget} from './snapshot.js';
/** srcDoc 内 CSP:掐断网络;允许内联样式/脚本(widget 必需);图片仅 data:。 */
const SRCDOC_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";

/** 注入 widget 的主题变量(读父窗口当前主题)。 */
const THEME_VARS = [
  '--bg', '--bg-elevated', '--bg-subtle',
  '--ink', '--ink-2', '--ink-3', '--ink-mute',
  '--border', '--border-strong', '--accent', '--accent-soft',
];

/** widget 高度上限(占视口比例),防超长 widget 撑爆对话。 */
const MAX_HEIGHT_RATIO = 0.7;

/** 字体栈(静态;与原型一致)注入 widget,使设计底座可用 --font-*。 */
const FONT_VARS =
  "--font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Hiragino Sans GB',sans-serif;" +
  "--font-mono:'SF Mono',Menlo,Monaco,Consolas,'Courier New',monospace;" +
  "--font-serif:'Iowan Old Style',Georgia,'Times New Roman','Songti SC',serif";

/**
 * 设计底座样式表:把 widget 里的常见元素(标题/段落/列表/按钮/表格/代码/输入/链接…)默认就渲成
 * Seeker 设计语言 —— 系统字体栈、暖橙节制(仅链接/CTA/选中)、0.5px 边框、Mono 大写标签。
 * 这样**即便 LLM 只写朴素语义 HTML 也自动合风格**(不再吃浏览器默认的 Times 标题/灰按钮)。
 * 注:用元素选择器(低特异性),LLM 若显式硬编码样式仍可覆盖——故系统提示同时引导其用语义标签、勿乱设颜色字体。
 */
const BASE_CSS =
  "*{box-sizing:border-box}html,body{margin:0;padding:0}" +
  "body{padding:12px 14px;background:var(--bg-elevated,#fff);color:var(--ink,#1a1a1a);font-family:var(--font-sans);font-size:13.5px;line-height:1.6;-webkit-font-smoothing:antialiased}" +
  "h1,h2,h3,h4,h5,h6{font-family:var(--font-sans);color:var(--ink,#1a1a1a);font-weight:600;line-height:1.3;margin:0 0 9px;letter-spacing:-0.01em}" +
  "h1{font-size:19px}h2{font-size:16px}h3{font-size:14px}h4,h5,h6{font-size:12.5px}" +
  "p{margin:0 0 9px;color:var(--ink-2,#3a3a3a)}" +
  "a{color:var(--accent,#c95f3d);text-decoration:none}a:hover{text-decoration:underline}" +
  "strong,b{color:var(--ink,#1a1a1a);font-weight:600}" +
  "small,.eyebrow,.label{font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3,#6b6b6b)}" +
  "ul,ol{margin:0 0 9px;padding-left:18px}li{margin:3px 0;color:var(--ink-2,#3a3a3a)}" +
  "hr{border:0;border-top:0.5px solid var(--border,#e5e3de);margin:12px 0}" +
  "code{font-family:var(--font-mono);font-size:12px;background:var(--bg-subtle,#f5f2ec);padding:1px 5px}" +
  "pre{font-family:var(--font-mono);font-size:12px;background:var(--bg-subtle,#f5f2ec);padding:10px 12px;border:0.5px solid var(--border,#e5e3de);overflow:auto}pre code{background:none;padding:0}" +
  "button{font-family:var(--font-sans);font-size:12.5px;color:var(--ink,#1a1a1a);background:var(--bg-elevated,#fff);border:0.5px solid var(--border-strong,#c0bfba);padding:7px 14px;cursor:pointer;transition:border-color 120ms ease,color 120ms ease}" +
  "button:hover{border-color:var(--accent,#c95f3d);color:var(--accent,#c95f3d)}" +
  "button.btn-accent,button.primary,button[data-accent]{background:var(--accent,#c95f3d);color:#fff;border-color:var(--accent,#c95f3d)}" +
  "button.btn-accent:hover,button.primary:hover,button[data-accent]:hover{opacity:.92;color:#fff}" +
  "table{border-collapse:collapse;width:100%;font-size:12.5px;margin:0 0 9px}" +
  "th,td{text-align:left;padding:7px 10px;border-bottom:0.5px solid var(--border,#e5e3de)}" +
  "th{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3,#6b6b6b);font-weight:500}td{color:var(--ink-2,#3a3a3a)}" +
  "input,select,textarea{font-family:var(--font-sans);font-size:13px;color:var(--ink,#1a1a1a);background:var(--bg-elevated,#fff);border:0.5px solid var(--border-strong,#c0bfba);padding:6px 9px}" +
  ".card,.box,.panel{border:0.5px solid var(--border,#e5e3de);background:var(--bg-elevated,#fff);padding:12px 14px;margin:0 0 9px}" +
  ".muted{color:var(--ink-3,#6b6b6b)}.accent,.dot{color:var(--accent,#c95f3d)}";

/** @returns {{[k:string]:string}} 父窗口当前主题 CSS 变量快照。 */
function themeVarsObject() {
  /** @type {{[k:string]:string}} */
  const o = {};
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const n of THEME_VARS) {
      const v = cs.getPropertyValue(n).trim();
      if (v) o[n] = v;
    }
  } catch (_e) { /* ignore */ }
  Object.assign(o,chartVars(document.documentElement.dataset.theme==='dark'));
  return o;
}

/** Categorical colors are readable in both themes, independent from the single CTA accent.
 * @param {boolean} dark */
function chartVars(dark){
  return {'--chart-1':dark?'#88afc4':'#476e87','--chart-2':dark?'#dba07e':'#a36543',
    '--chart-3':dark?'#a9b99a':'#607a56','--chart-4':dark?'#b7a5ce':'#84699e',
    '--widget-color-scheme':dark?'dark':'light','--widget-on-accent':dark?'#1a1a1a':'#ffffff'};
}
/** @param {{[key:string]:unknown}|undefined} style */
const followsTheme=style=>!style||style.theme==='auto';

// ── 活跃端口注册表 + 主题广播(切深浅色时热推给所有 widget)──────
/** @type {Set<MessagePort>} */
const PORTS = new Set();
/** Includes fixed-style widgets: their snapshot ports need the same lifetime as theme ports.
 * @type {Map<MessagePort,{frame:HTMLIFrameElement,dispose:(reason:string)=>void}>} */
const CHANNELS = new Map();
/** @type {WeakMap<HTMLElement,( )=>Promise<{html:string,width:number}>>} */
const SNAPSHOTS = new WeakMap();
/** @param {HTMLElement} card */
export async function requestWidgetSnapshot(card){
  if(!card.isConnected)throw Error(closedWidgetMessage());
  let request=SNAPSHOTS.get(card);
  if(!request){
    const frame=card.querySelector('iframe');
    if(!frame)throw Error(tt('组件尚未就绪，请稍后重试','Widget is not ready; retry shortly'));
    await new Promise((resolve,reject)=>{
      const loaded=()=>{clearTimeout(timer);resolve(undefined);};
      const timer=setTimeout(()=>{frame.removeEventListener('load',loaded);reject(Error(tt('组件加载超时，请重试','Widget loading timed out; retry')));},8000);
      frame.addEventListener('load',loaded,{once:true});
    });
    request=SNAPSHOTS.get(card);
  }
  if(!request||!card.isConnected)throw Error(tt('组件已关闭或尚未就绪，请重新打开','Widget closed or not ready; reopen it'));
  return request();
}
/** @type {MutationObserver | null} */
let themeObserver = null;
/** @type {MutationObserver | null} */
let removalObserver = null;
const closedWidgetMessage=()=>tt('组件已关闭，请重新打开后导出','Widget closed; reopen it to export');

/** A shared observer handles direct removal and ancestor replacement in the same DOM turn. */
function ensureRemovalObserver(){
  if(removalObserver)return;
  removalObserver=new MutationObserver(()=>{
    for(const {frame,dispose} of CHANNELS.values())if(!frame.isConnected)dispose(closedWidgetMessage());
  });
  removalObserver.observe(document.documentElement,{childList:true,subtree:true});
}

function broadcastTheme() {
  const vars = themeVarsObject();
  for (const port of PORTS) {
    const channel=CHANNELS.get(port);
    if(!channel?.frame.isConnected){channel?.dispose(closedWidgetMessage());continue;}
    try { port.postMessage({ type: 'theme', vars, mode:document.documentElement.dataset.theme==='dark'?'dark':'light' }); }
    catch (_e) { channel.dispose(tt('组件连接已关闭，请重新打开','Widget connection closed; reopen it')); }
  }
}

/** 懒启动:监听父窗口 data-theme 变化 → 广播主题(无需 domain 改动)。 */
function ensureThemeObserver() {
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => broadcastTheme());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** srcDoc 内的可信 bridge(运行在沙箱里):端口握手 + 高度上报 + 主题热更新 + 交互上抛 + 错误兜底。 */
const BRIDGE = "(function(){var port=null,t=0,last=0,pendingErr=null;" + snapshotWidget.toString() + ';' +
  "function send(m){if(port){try{port.postMessage(m);}catch(e){}}}" +
  // widget 交互上抛:LLM 在按钮等处调 seeker.action('id', data) → 经端口当「用户意图」回流父侧(过护栏)。
  "window.seeker={action:function(n,p){send({type:'widget-action',action:String(n),payload:p});}};" +
  // 错误兜底:沙箱内脚本异常 → 缓冲并上报,父侧展示兜底(不影响主应用)。
  "function reportErr(m){pendingErr=String(m||'error').slice(0,200);send({type:'widget-error',message:pendingErr});}" +
  "window.addEventListener('error',function(e){reportErr(e&&e.message?e.message:'script error');});" +
  "window.addEventListener('unhandledrejection',function(){reportErr('unhandled rejection');});" +
  "function report(){if(!port)return;var h=Math.ceil(document.documentElement.scrollHeight);if(Math.abs(h-last)<2)return;last=h;send({type:'widget-resize',height:h});}" +
  "function schedule(){if(t)clearTimeout(t);t=setTimeout(function(){t=0;report();},80);}" +
  "window.addEventListener('message',function(e){" +
  "if(e.source!==window.parent)return;" + // 拒绝自投递,只认父窗口握手
  "if(e.data==='__seeker_widget_port'&&e.ports&&e.ports[0]){port=e.ports[0];" +
  "port.onmessage=function(ev){var d=ev.data;if(!d||typeof d!=='object')return;" +
  "if(d.type==='widget-snapshot'){try{send({type:'widget-snapshot',requestId:d.requestId,result:snapshotWidget()});}catch(e){send({type:'widget-snapshot',requestId:d.requestId,error:String(e)});}return;}" +
  "if(d.type==='theme'&&d.vars){var r=document.documentElement;for(var k in d.vars){if(Object.prototype.hasOwnProperty.call(d.vars,k))r.style.setProperty(k,String(d.vars[k]));}r.dataset.theme=d.mode==='dark'?'dark':'light';window.dispatchEvent(new Event('seeker:themechange'));schedule();}};" +
  "report();if(pendingErr){send({type:'widget-error',message:pendingErr});}}});" +
  "if(window.ResizeObserver){try{new ResizeObserver(schedule).observe(document.documentElement);}catch(e){}}" +
  "window.addEventListener('resize',function(){window.dispatchEvent(new Event('seeker:resize'));schedule();});" +
  "document.addEventListener('DOMContentLoaded',report);window.addEventListener('load',report);" +
  "})();";

/**
 * 构造 srcDoc:可信外壳(CSP + reset + 主题 + bridge)包裹不可信 body。
 * @param {string} html 不可信(已 sanitize)HTML 片段
 * @param {{[key:string]:unknown}=} style Saved output style; omitted or theme=auto inherits the app.
 * @returns {string}
 */
export function buildSrcDoc(html, style) {
  const auto=followsTheme(style),s=normalizeStyle(style);
  const rgb=s.background.slice(1).match(/../g)?.map(v=>parseInt(v,16))||[255,255,255];
  const dark=auto?document.documentElement.dataset.theme==='dark':(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)<128;
  const vars=auto?themeVarsObject():chartVars(dark);
  const theme=Object.entries(vars).map(([n,v])=>`${n}:${v}`).join(';');
  return (
    `<!doctype html><html data-theme="${dark?'dark':'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">` +
    `<style>:root{${theme};${FONT_VARS}}${BASE_CSS}${WIDGET_CSS}${auto ? '' : styleCSS(s)}</style></head><body>` +
    '<script>' + BRIDGE + '<\/script>' + // bridge 先于不可信内容,确保 window.seeker 就绪
    (html || '') +
    '</body></html>'
  );
}

/**
 * 渲染一张 widget 卡:可信标题栏 + 隔离 iframe + 端口桥接 + 加载/错误兜底。
 * 返回卡片元素,由调用方(domain)插入对话流。
 * @param {import('../../runtime/types').WidgetPayload} payload
 * @param {{style?:{[key:string]:unknown}}} [options]
 * @returns {HTMLElement}
 */
export function renderWidget(payload, options = {}) {
  const id = (payload && payload.id) || '';
  const title = (payload && payload.title) || 'Widget';
  const minHeight = Math.max(40, Math.min(800, (payload && payload.minHeight) || 80));
  const html = (payload && payload.html) || '';

  const card = document.createElement('div');
  card.className = 'widget-card';
  card.setAttribute('data-widget-id', id);
  card.setAttribute('role', 'group'); // a11y
  card.setAttribute('aria-label', tt('AI 组件 · ','AI widget · ') + title);
  card.style.cssText =
    'border:0.5px solid var(--border-strong,#c0bfba);background:var(--bg-elevated,#fff);margin:10px 0;max-width:92%;overflow:hidden;';

  // 可信标题栏(沿用应用设计 token;静态文案,无注入面)。
  const bar = document.createElement('div');
  bar.style.cssText =
    "display:flex;align-items:center;gap:7px;padding:7px 12px;border-bottom:0.5px solid var(--border,#e5e3de);background:var(--bg-subtle,#f5f2ec);font-family:var(--font-mono,monospace);";
  bar.innerHTML =
    '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent,#c95f3d);flex:0 0 auto;"></span>' +
    '<span class="widget-title" style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3,#6b6b6b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
    '<span class="widget-kind" style="margin-left:auto;flex:0 0 auto;font-size:10px;letter-spacing:.04em;color:var(--ink-3,#6b6b6b);"></span>';
  const kind=bar.querySelector('.widget-kind');if(kind)kind.textContent=tt('交互作品','Interactive');
  const titleEl = bar.querySelector('.widget-title'); // 标题来自 LLM → textContent 防注入
  if (titleEl) titleEl.textContent = title;

  // 主体:相对定位容器,内含 iframe + 加载占位(就绪即移除)。
  const bodyWrap = document.createElement('div');
  bodyWrap.style.cssText = 'position:relative;';

  const frame = document.createElement('iframe');
  // 墙1:仅 allow-scripts —— 不加 allow-same-origin(否则隔离失效)、不加 forms/popups/top-navigation。
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', title);
  // The selected editor may begin below the fold; export must not depend on scrolling first.
  frame.setAttribute('loading', 'eager');
  frame.style.cssText = `display:block;width:100%;border:0;height:${minHeight}px;background:transparent;`;
  // 墙2:srcDoc 内含 CSP default-src 'none'(+ bridge)。
  frame.setAttribute('srcdoc', buildSrcDoc(html,options.style));

  // ── 加载态(仅当 >120ms 未就绪才显示,避免快速加载闪烁)──
  let readyDone = false;
  /** @type {HTMLElement | null} */
  let loadingEl = null;
  const loadTimer = setTimeout(() => {
    if (readyDone) return;
    loadingEl = document.createElement('div');
    loadingEl.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg-elevated,#fff);' +
      'color:var(--ink-3,#6b6b6b);font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.14em;text-transform:uppercase;';
    loadingEl.textContent = tt('加载中…','Loading…');
    bodyWrap.appendChild(loadingEl);
  }, 120);
  function markReady() {
    if (readyDone) return;
    readyDone = true;
    clearTimeout(loadTimer);
    if (loadingEl && loadingEl.parentNode) { loadingEl.remove(); loadingEl = null; }
  }

  // ── 错误兜底(沙箱内脚本异常)——展示一条安心提示,不影响主应用 ──
  let errShown = false;
  function showError(/** @type {unknown} */message) {
    if (errShown) return;
    errShown = true;
    markReady();
    const e = document.createElement('div');
    e.className = 'widget-error';
    e.style.cssText =
      'padding:8px 12px;border-top:0.5px solid var(--border,#e5e3de);background:var(--bg-subtle,#f5f2ec);' +
      'color:var(--ink-3,#6b6b6b);font-size:12px;font-family:var(--font-sans,sans-serif);';
    e.setAttribute('role','status');
    e.textContent = tt('部分内容未能显示。可以重新加载，或打开作品修复内容。','Some content could not be displayed. Reload, or open the creation to repair its content.');
    const details=document.createElement('details'),summary=document.createElement('summary'),error=document.createElement('pre');
    summary.textContent=tt('错误详情','Error details');error.textContent=typeof message==='string'?message.slice(0,200):tt('组件脚本出错','Widget script error');
    error.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;';details.append(summary,error);
    const retry=document.createElement('button');retry.className='btn';retry.textContent=tt('重新加载（重置交互）','Reload (reset interaction)');
    retry.onclick=()=>{e.remove();errShown=false;frame.srcdoc=buildSrcDoc(html,options.style);};
    e.append(details,retry);
    card.appendChild(e);
  }

  // W2/W3:iframe 加载后建专属 MessageChannel,port2 交沙箱 bridge,port1 留父侧零信任处理入站。
  /** @type {(reason?:string)=>void} */
  let clearChannel=()=>{};
  frame.addEventListener('load', () => {
    clearChannel();
    markReady(); // 内容已出,撤加载态
    if(!card.isConnected||!card.contains(frame))return;
    try {
      const ch = new MessageChannel();
      /** @type {Map<string,{resolve:(v:{html:string,width:number})=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>}>} */
      const requests=new Map();
      clearChannel=(reason=tt('组件已重新加载，请重试导出','Widget reloaded; retry export'))=>{
        PORTS.delete(ch.port1);CHANNELS.delete(ch.port1);SNAPSHOTS.delete(card);
        ch.port1.onmessage=null;ch.port1.close();
        for(const request of requests.values()){clearTimeout(request.timer);request.reject(Error(reason));}
        requests.clear();clearChannel=()=>{};
        if(!PORTS.size){themeObserver?.disconnect();themeObserver=null;}
        if(!CHANNELS.size){removalObserver?.disconnect();removalObserver=null;}
      };
      SNAPSHOTS.set(card,()=>new Promise((resolve,reject)=>{
        const requestId=crypto.randomUUID();
        const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error(tt('组件未响应，请重新打开后重试','Widget did not respond; reopen and retry')));},8000);
        requests.set(requestId,{resolve,reject,timer});ch.port1.postMessage({type:'widget-snapshot',requestId});
      }));
      ch.port1.onmessage = (e) => {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if(msg.type==='widget-snapshot'&&typeof msg.requestId==='string'){
          const request=requests.get(msg.requestId);if(!request)return;
          requests.delete(msg.requestId);clearTimeout(request.timer);
          const r=msg.result;
          if(r&&typeof r.html==='string'&&new TextEncoder().encode(r.html).length<=2_000_000&&Number.isFinite(r.width)&&r.width>0&&r.width<=2400)request.resolve({html:r.html,width:r.width});
          else request.reject(new Error(tt('无法导出此组件的当前状态','Could not export this widget state')));
          return;
        }
        if (msg.type === 'widget-resize' && typeof msg.height === 'number' && isFinite(msg.height)) {
          markReady();
          const max = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
          frame.style.height = Math.max(40, Math.min(max, Math.ceil(msg.height))) + 'px';
          return;
        }
        if (msg.type === 'widget-error') { showError(msg.message); return; }
        if (msg.type === 'widget-action' && typeof msg.action === 'string') {
          // 零信任:widget_id 由**端口归属**(id)确定,绝不信任 iframe 自报;payload 仅当数据。
          // 一律交 domain 的 onAction —— 破坏性动作由其经 platform/guardrail(预览+确认+撤销)。
          const sw = /** @type {any} */ (window).SeekerWidgets;
          if (sw && typeof sw.onAction === 'function') {
            try { sw.onAction(id, msg.action, msg.payload); }
            catch (err) { console.error('[widget] onAction 出错', err); }
          } else {
            console.warn('[widget] 收到 widget-action 但无 onAction 处理器:', msg.action);
          }
        }
      };
      CHANNELS.set(ch.port1,{frame,dispose:clearChannel});ensureRemovalObserver();
      if(followsTheme(options.style)){PORTS.add(ch.port1);ensureThemeObserver();}
      if (frame.contentWindow) {
        frame.contentWindow.postMessage('__seeker_widget_port', '*', [ch.port2]);
        // Catch a theme change between srcdoc construction and port readiness.
        if(followsTheme(options.style))ch.port1.postMessage({type:'theme',vars:themeVarsObject(),mode:document.documentElement.dataset.theme==='dark'?'dark':'light'});
      }
    } catch (e) {
      clearChannel();
      console.error('[widget] 端口建立失败', e);
    }
  });

  bodyWrap.appendChild(frame);
  card.appendChild(bar);
  card.appendChild(bodyWrap);
  return card;
}
