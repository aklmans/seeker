// @ts-check
/**
 * 破坏性操作护栏(平台 · #2 W3)——**预览 + 确认 + 可撤销**。
 *
 * 原则(安全/反焦虑):无论触发者是 Agent、widget 按钮还是 UI,破坏性动作一律走这一道:
 * 先预览要做什么 → 用户确认 → 执行 → 限时可撤销。不用红色恐吓,用「可撤销」消解紧张。
 * 不可信的 widget 只能**提议**(widget-action),真正执行前必过此门(见 capability/widgets/render.js)。
 */

/** @param {string} label @param {boolean} accent @returns {HTMLButtonElement} */
function mkBtn(label, accent) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'padding:7px 15px;font-size:13px;font-family:inherit;cursor:pointer;border:0.5px solid ' +
    (accent ? 'var(--accent,#c95f3d)' : 'var(--border-strong,#c0bfba)') +
    ';background:' + (accent ? 'var(--accent,#c95f3d)' : 'transparent') +
    ';color:' + (accent ? '#fff' : 'var(--ink,#1a1a1a)') + ';';
  return b;
}

/** 限时可撤销 toast。 @param {string} text @param {() => (void|Promise<void>)} onUndo @param {number} ms */
function showUndo(text, onUndo, ms) {
  const t = document.createElement('div');
  t.className = 'gr-undo';
  t.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:14px;' +
    'background:var(--ink,#1a1a1a);color:var(--bg,#fff);padding:10px 16px;font-size:13px;font-family:var(--font-sans,sans-serif);border:0.5px solid var(--border-strong,#c0bfba);';
  const span = document.createElement('span');
  span.textContent = text;
  const u = document.createElement('button');
  u.textContent = '撤销';
  u.style.cssText = 'background:transparent;border:none;color:var(--accent,#E8835B);cursor:pointer;font-size:13px;font-family:inherit;letter-spacing:.05em;';
  let done = false;
  const close = () => { if (t.parentNode) t.remove(); };
  u.onclick = async () => { if (done) return; done = true; close(); try { await onUndo(); } catch (e) { console.error('[guardrail] 撤销失败', e); } };
  t.append(span, u);
  document.body.appendChild(t);
  setTimeout(close, Math.max(1500, ms));
}

/**
 * 预览 + 确认 + (可选)可撤销执行。
 * @param {{
 *   title?: string, detail?: string, confirmLabel?: string,
 *   onConfirm: () => (void | Promise<void>),
 *   onUndo?: () => (void | Promise<void>), undoText?: string, undoMs?: number,
 *   source?: string
 * }} opts
 * @returns {Promise<boolean>} 用户是否确认并执行
 */
export function confirmDestructive(opts) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gr-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);';
    const card = document.createElement('div');
    card.style.cssText =
      'background:var(--bg-elevated,#fff);border:0.5px solid var(--border-strong,#c0bfba);max-width:430px;width:90%;padding:20px 22px;font-family:var(--font-sans,sans-serif);';

    const head = document.createElement('div');
    head.style.cssText = 'font-size:15px;font-weight:600;color:var(--ink,#1a1a1a);margin-bottom:8px;';
    head.textContent = opts.title || '确认操作';

    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:13px;color:var(--ink-2,#3a3a3a);line-height:1.6;margin-bottom:6px;';
    detail.textContent = opts.detail || '';

    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:var(--ink-3,#6b6b6b);margin-bottom:18px;';
    note.textContent = opts.onUndo ? '执行后可撤销。' : '';

    if (opts.source) {
      const src = document.createElement('div');
      src.style.cssText = 'font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-mute,#9a9a9a);margin-bottom:10px;';
      src.textContent = '来源 · ' + opts.source;
      card.appendChild(src);
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancel = mkBtn('取消', false);
    const ok = mkBtn(opts.confirmLabel || '确认执行', true);
    row.append(cancel, ok);

    card.append(head, detail, note, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => { if (overlay.parentNode) overlay.remove(); };
    cancel.onclick = () => { close(); resolve(false); };
    ok.onclick = async () => {
      close();
      try { await opts.onConfirm(); } catch (e) { console.error('[guardrail] 执行失败', e); }
      if (opts.onUndo) showUndo(opts.undoText || '已执行', opts.onUndo, opts.undoMs || 6000);
      resolve(true);
    };
  });
}
