// @ts-check
/** 平台 · Markdown 编辑/展示共享 helper —— 笔记 / Prompt / Skill 指令 / 项目指令 复用。
 *
 *  设计:**不引富文本框架**(守技术栈红线),复用平台既有安全渲染器 `renderMarkdown`
 *  (build-from-esc:先转义 & < > " ' 再插白名单标签 ⇒ 原始 HTML 变实体、无 script/事件属性,
 *  同 AI 消息/RAG 的 Untrusted 渲染)。故用户内容含 `<img onerror>` 之类只会被当纯文本显示。
 *
 *  两件事:
 *   - **展示**:`mdRender(text)` → 安全 HTML(列表卡 / 预览用);容器加 class="md-body" 排版。
 *   - **编辑**:`mdField(opts)` 产出「编辑 / 预览」双态字段(内含稳定 id 的 textarea,保存方读它即可,
 *     调用方 save 逻辑零改);`wireMdField(root)` 接线切换。
 */
import { renderMarkdown } from '../markdown/render.js';
import { tt } from './i18n.js';

/** 展示:Markdown → 安全 HTML(空/畸形不抛)。 @param {unknown} text @returns {string} */
export function mdRender(text) {
  return renderMarkdown(String(text == null ? '' : text));
}

/** textarea RCDATA 转义:防 `</textarea>` 提前终结 + 实体化 `&`(值原样往返)。 @param {unknown} v */
function taEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * 编辑字段:「编辑 / 预览」双态 + 提示行。内含 `id` 的 textarea(保存方 `$('#id').value` 读原文,零改)。
 * @param {{id:string, value?:string, rows?:number, mono?:boolean, placeholder?:string, hint?:boolean}} opts
 * @returns {string}
 */
export function mdField({ id, value = '', rows = 8, mono = false, placeholder = '', hint = true }) {
  const font = mono ? 'font-family:var(--font-mono);font-size:12.5px;' : 'font-size:13.5px;';
  return `<div class="md-field">
    <div class="md-tabs">
      <button type="button" class="md-tab on" data-md="edit">${tt('编辑', 'Edit')}</button>
      <button type="button" class="md-tab" data-md="preview">${tt('预览', 'Preview')}</button>
      ${hint ? `<span class="md-hint">${tt('支持 Markdown:# 标题 · **粗体** · - 列表 · 表格', 'Markdown: # heading · **bold** · - list · tables')}</span>` : ''}
    </div>
    <textarea class="input md-src" id="${id}" rows="${rows}" style="width:100%;line-height:1.75;${font}" placeholder="${String(placeholder).replace(/"/g, '&quot;')}">${taEsc(value)}</textarea>
    <div class="md-body md-preview" hidden></div>
  </div>`;
}

/**
 * 接线:切「编辑/预览」。root 内每个 .md-field 独立。
 * @param {Element|null} root
 */
export function wireMdField(root) {
  if (!root) return;
  root.querySelectorAll('.md-field').forEach((/** @type {Element} */ f) => {
    const src = /** @type {HTMLTextAreaElement|null} */ (f.querySelector('.md-src'));
    const pv = /** @type {HTMLElement|null} */ (f.querySelector('.md-preview'));
    if (!src || !pv) return;
    f.querySelectorAll('.md-tab').forEach((/** @type {Element} */ t) => {
      /** @type {HTMLElement} */ (t).onclick = () => {
        const preview = /** @type {HTMLElement} */ (t).dataset.md === 'preview';
        f.querySelectorAll('.md-tab').forEach((/** @type {Element} */ x) => x.classList.toggle('on', x === t));
        if (preview) pv.innerHTML = mdRender(src.value) || `<span style="color:var(--ink-mute);">${tt('(空)', '(empty)')}</span>`;
        src.hidden = preview;
        pv.hidden = !preview;
      };
    });
  });
}

