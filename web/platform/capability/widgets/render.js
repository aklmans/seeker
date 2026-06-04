// @ts-check
/**
 * show_widget 前端渲染(#2 · W1 沙箱 + W2 自适应/主题)—— 平台层,业务无关,两端通用。
 *
 * 不可信的 LLM 生成 HTML 在**三道墙**中渲染:
 *   墙1 `iframe sandbox="allow-scripts"`(不加 allow-same-origin → null 起源,够不到父 DOM/cookie/存储);
 *   墙2 srcDoc 内 `<meta CSP default-src 'none'>`(掐断一切网络,即便沙箱异常);
 *   墙3 父窗口零信任(入站消息只读结构化字段;widget-action 当意图、经护栏——W3)。
 * sanitize + ≤64KB 闸在平台核(Rust)已做;此处只负责安全外壳、隔离渲染、自适应高度与主题热跟随。
 *
 * W2:每 widget 一个 **MessageChannel 专属端口**。bridge(srcDoc 内)用 ResizeObserver 防抖上报高度;
 * 应用切深浅色 → 父侧 MutationObserver 监到 → 经各端口 postMessage 主题变量(不 reload,保住交互状态)。
 */

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
  return o;
}

/** @returns {string} `:root{...}` 内容(静态初值;后续热更新走端口)。 */
function themeSnapshot() {
  return Object.entries(themeVarsObject()).map(([n, v]) => `${n}:${v}`).join(';');
}

// ── W2:活跃端口注册表 + 主题广播(切深浅色时热推给所有 widget)──────
/** @type {Set<MessagePort>} */
const PORTS = new Set();
/** @type {MutationObserver | null} */
let themeObserver = null;

function broadcastTheme() {
  const vars = themeVarsObject();
  for (const port of PORTS) {
    try { port.postMessage({ type: 'theme', vars }); }
    catch (_e) { PORTS.delete(port); }
  }
}

/** 懒启动:监听父窗口 data-theme 变化 → 广播主题(无需 domain 改动)。 */
function ensureThemeObserver() {
  if (themeObserver) return;
  themeObserver = new MutationObserver(() => broadcastTheme());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** 父侧处理来自 widget 的入站消息(零信任:只读结构化字段)。
 *  @param {HTMLIFrameElement} frame @param {string} widgetId @param {any} msg */
function handlePortMessage(frame, widgetId, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'widget-resize' && typeof msg.height === 'number' && isFinite(msg.height)) {
    const max = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
    frame.style.height = Math.max(40, Math.min(max, Math.ceil(msg.height))) + 'px';
    return;
  }
  if (msg.type === 'widget-action' && typeof msg.action === 'string') {
    // 零信任:widget_id 由**端口归属**(widgetId)确定,绝不信任 iframe 自报;payload 仅当数据。
    // 一律交给 domain 的 onAction —— 破坏性动作由其经 platform/guardrail(预览+确认+撤销)。
    const sw = /** @type {any} */ (window).SeekerWidgets;
    if (sw && typeof sw.onAction === 'function') {
      try { sw.onAction(widgetId, msg.action, msg.payload); }
      catch (e) { console.error('[widget] onAction 出错', e); }
    } else {
      console.warn('[widget] 收到 widget-action 但无 onAction 处理器:', msg.action);
    }
  }
  // widget-error(W4)后续接入。
}

/** srcDoc 内的可信 bridge(运行在沙箱里):端口握手 + 高度上报 + 主题热更新。 */
const BRIDGE = "(function(){var port=null,t=0,last=0;" +
  "function send(m){if(port){try{port.postMessage(m);}catch(e){}}}" +
  // widget 交互上抛:LLM 在按钮等处调 seeker.action('id', data) → 经端口当「用户意图」回流父侧(过护栏)。
  "window.seeker={action:function(n,p){send({type:'widget-action',action:String(n),payload:p});}};" +
  "function report(){if(!port)return;var h=Math.ceil(document.documentElement.scrollHeight);if(Math.abs(h-last)<2)return;last=h;send({type:'widget-resize',height:h});}" +
  "function schedule(){if(t)clearTimeout(t);t=setTimeout(function(){t=0;report();},80);}" +
  "window.addEventListener('message',function(e){" +
  "if(e.source!==window.parent)return;" + // 拒绝自投递,只认父窗口握手
  "if(e.data==='__seeker_widget_port'&&e.ports&&e.ports[0]){port=e.ports[0];" +
  "port.onmessage=function(ev){var d=ev.data;if(!d||typeof d!=='object')return;" +
  "if(d.type==='theme'&&d.vars){var r=document.documentElement;for(var k in d.vars){if(Object.prototype.hasOwnProperty.call(d.vars,k))r.style.setProperty(k,String(d.vars[k]));}}};" +
  "report();}});" +
  "if(window.ResizeObserver){try{new ResizeObserver(schedule).observe(document.documentElement);}catch(e){}}" +
  "document.addEventListener('DOMContentLoaded',report);window.addEventListener('load',report);" +
  "})();";

/**
 * 构造 srcDoc:可信外壳(CSP + reset + 主题 + bridge)包裹不可信 body。
 * @param {string} html 不可信(已 sanitize)HTML 片段
 * @returns {string}
 */
export function buildSrcDoc(html) {
  const theme = themeSnapshot();
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">` +
    `<style>:root{${theme}}*{box-sizing:border-box}` +
    'html,body{margin:0;padding:0}' +
    "body{padding:4px;background:var(--bg,#fff);color:var(--ink,#1a1a1a);" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.55}" +
    'a{color:var(--accent,#c95f3d)}</style></head><body>' +
    '<script>' + BRIDGE + '<\/script>' + // bridge 先于不可信内容,确保 window.seeker 就绪
    (html || '') +
    '</body></html>'
  );
}

/**
 * 渲染一张 widget 卡:可信外壳(标题栏 + SANDBOXED 标记)+ 隔离 iframe + 端口桥接。
 * 返回卡片元素,由调用方(domain)插入对话流。
 * @param {import('../../runtime/types').WidgetPayload} payload
 * @returns {HTMLElement}
 */
export function renderWidget(payload) {
  const id = (payload && payload.id) || '';
  const title = (payload && payload.title) || 'Widget';
  const minHeight = Math.max(40, Math.min(800, (payload && payload.minHeight) || 80));
  const html = (payload && payload.html) || '';

  const card = document.createElement('div');
  card.className = 'widget-card';
  card.setAttribute('data-widget-id', id);
  card.style.cssText =
    'border:0.5px solid var(--border-strong,#c0bfba);background:var(--bg-elevated,#fff);margin:10px 0;max-width:92%;overflow:hidden;';

  // 可信 chrome:标题栏 + SANDBOXED 标记(沿用原型设计 token;静态内容,无注入面)。
  const bar = document.createElement('div');
  bar.style.cssText =
    "display:flex;align-items:center;gap:7px;padding:7px 12px;border-bottom:0.5px solid var(--border,#e5e3de);background:var(--bg-subtle,#f5f2ec);font-family:var(--font-mono,monospace);";
  bar.innerHTML =
    '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent,#c95f3d);flex:0 0 auto;"></span>' +
    '<span class="widget-title" style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3,#6b6b6b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
    '<span style="margin-left:auto;flex:0 0 auto;font-size:8.5px;letter-spacing:.08em;color:var(--ink-mute,#9a9a9a);border:0.5px solid var(--border,#e5e3de);padding:1px 5px;">SANDBOXED</span>';
  // 标题来自 LLM → textContent 防注入(可信 chrome 不接受不可信标记)。
  const titleEl = bar.querySelector('.widget-title');
  if (titleEl) titleEl.textContent = title;

  const frame = document.createElement('iframe');
  // 墙1:仅 allow-scripts —— 不加 allow-same-origin(否则隔离失效)、不加 forms/popups/top-navigation。
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', title);
  frame.setAttribute('loading', 'lazy');
  frame.style.cssText = `display:block;width:100%;border:0;height:${minHeight}px;background:transparent;`;
  // 墙2:srcDoc 内含 CSP default-src 'none'(+ bridge)。
  frame.setAttribute('srcdoc', buildSrcDoc(html));

  // W2:iframe 加载后建专属 MessageChannel,把 port2 交给沙箱 bridge;port1 留父侧(零信任处理入站)。
  frame.addEventListener('load', () => {
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => handlePortMessage(frame, id, e.data);
      PORTS.add(ch.port1);
      ensureThemeObserver();
      if (frame.contentWindow) {
        frame.contentWindow.postMessage('__seeker_widget_port', '*', [ch.port2]);
      }
    } catch (e) {
      console.error('[widget] 端口建立失败', e);
    }
  });

  card.appendChild(bar);
  card.appendChild(frame);
  return card;
}
