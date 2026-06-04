// @ts-check
/**
 * show_widget 前端渲染(#2 · W1)—— 平台层,业务无关,两端通用。
 *
 * 不可信的 LLM 生成 HTML 在**三道墙**中渲染:
 *   墙1 `iframe sandbox="allow-scripts"`(不加 allow-same-origin → null 起源,够不到父 DOM/cookie/存储);
 *   墙2 srcDoc 内 `<meta CSP default-src 'none'>`(掐断一切网络,即便沙箱异常);
 *   墙3 父窗口零信任(W1 父侧不接收任何 widget 消息;交互回流 + MessageChannel 见 W2/W3)。
 * sanitize + ≤64KB 闸在平台核(Rust)已做;此处只负责安全外壳与隔离渲染。
 */

/** srcDoc 内 CSP:掐断网络;允许内联样式/脚本(widget 必需);图片仅 data:。 */
const SRCDOC_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";

/** 注入 widget 的主题变量(W1:当前主题静态快照;热更新见 W2)。 */
const THEME_VARS = [
  '--bg', '--bg-elevated', '--bg-subtle',
  '--ink', '--ink-2', '--ink-3', '--ink-mute',
  '--border', '--border-strong', '--accent', '--accent-soft',
];

/** @returns {string} 读父窗口当前主题的 CSS 变量,拼成 `:root{...}` 内容。 */
function themeSnapshot() {
  try {
    const cs = getComputedStyle(document.documentElement);
    return THEME_VARS
      .map((n) => [n, cs.getPropertyValue(n).trim()])
      .filter(([, v]) => v)
      .map(([n, v]) => `${n}:${v}`)
      .join(';');
  } catch (_e) {
    return '';
  }
}

/**
 * 构造 srcDoc:可信外壳(CSP + reset + 主题)包裹不可信 body。
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
    (html || '') +
    '</body></html>'
  );
}

/**
 * 渲染一张 widget 卡:可信外壳(标题栏 + SANDBOXED 标记)+ 隔离 iframe。
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
  // 墙2:srcDoc 内含 CSP default-src 'none'。
  frame.setAttribute('srcdoc', buildSrcDoc(html));

  card.appendChild(bar);
  card.appendChild(frame);
  return card;
}
