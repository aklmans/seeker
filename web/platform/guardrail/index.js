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
 * `changes`(可选):结构化「前→后」对比预览(如 AI 改写简历模块)。一律用 textContent 渲染,
 * 不可信内容(模型产出)天然无法注入。反焦虑:不用红色,旧值删除线 + 新值高亮。
 *
 * ★★`onConfirm` 的返回值契约(与 `toast.js` 的 `toastUndo` **逐字同款**,评审第61/63轮):
 *   · 返回 **显式 `false` 或 `0`**(`0` = 一条都没销毁)⇒ **没有可还原之物** ⇒ **根本不给撤销按钮**;
 *   · 返回 `undefined`(块体箭头的隐式返回)⇒ 视为已执行 ⇒ 照旧给按钮。**现存 15 个调用点全是块体箭头
 *     (AST 机械核实)⇒ 零回归**;
 *   · **抛错** ⇒ 销毁是否发生**未知** ⇒ 同样不给按钮(承第58轮 [建议]A 的不变式:
 *     **提供撤销 ⇔ 销毁确已发生**)。失败因由由调用方自报 —— guardrail 在 i18n 之下,
 *     不持文案(同 `toastUndo` 把「报失败」归还 `restoreFn` 的分层理由)。
 *
 * ⚠ **`undefined` 而非 `true` 才是默认值**:这是「零回归 opt-in」的代价 —— 新写的失败路径**忘记
 *   `return false` 就会给出一个还原不了的按钮**。重量压在 JSDoc 义务 + 评审纪律上(同 `toastUndo`)。
 *
 * ⚠⚠ **本函数 resolve 的布尔量 = 「用户是否点了确认」,不是「是否执行成功」**。**勿把二者合并** ——
 *   [capability/mcp/confirm.js](../capability/mcp/confirm.js) 把它直接当作 `approved` 回传
 *   `rt.mcp.confirmResolve`(允许 / 拒绝一次 MCP 工具调用)。若改成「执行成功」语义,
 *   一个返回 `false` 的 `onConfirm` 会把**用户的「允许」静默翻转成「拒绝」**。
 *
 * @param {{
 *   title?: string, detail?: string, confirmLabel?: string,
 *   changes?: {label?: string, before?: string, after?: string}[],
 *   onConfirm: () => (void | boolean | number | Promise<void | boolean | number>),
 *   onUndo?: () => (void | Promise<void>), undoText?: string, undoMs?: number,
 *   source?: string
 * }} opts
 * @returns {Promise<boolean>} **用户是否点了确认**(≠ 是否执行成功;见上)
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

    // 结构化「前→后」预览(可选):用 textContent 渲染,不可信内容无法注入。
    /** @type {HTMLDivElement | null} */
    let changesEl = null;
    if (Array.isArray(opts.changes) && opts.changes.length) {
      const list = document.createElement('div');
      list.style.cssText = 'margin:2px 0 14px;display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow:auto;';
      opts.changes.forEach((c) => {
        const item = document.createElement('div');
        item.style.cssText = 'border:0.5px solid var(--border,#e6e4df);padding:8px 10px;';
        const lb = document.createElement('div');
        lb.style.cssText = 'font-family:var(--font-mono,monospace);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3,#6b6b6b);margin-bottom:5px;';
        lb.textContent = c.label || '';
        const bef = document.createElement('div');
        bef.style.cssText = 'font-size:12px;color:var(--ink-3,#9a9a9a);text-decoration:line-through;line-height:1.5;margin-bottom:4px;white-space:pre-wrap;';
        bef.textContent = (c.before == null || c.before === '') ? '(空)' : String(c.before);
        const aft = document.createElement('div');
        aft.style.cssText = 'font-size:13px;color:var(--ink,#1a1a1a);line-height:1.55;white-space:pre-wrap;';
        aft.textContent = c.after == null ? '' : String(c.after);
        item.append(lb, bef, aft);
        list.appendChild(item);
      });
      changesEl = list;
    }

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

    card.append(head, detail);
    if (changesEl) card.appendChild(changesEl);
    card.append(note, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => { if (overlay.parentNode) overlay.remove(); };
    cancel.onclick = () => { close(); resolve(false); };
    ok.onclick = async () => {
      close();
      // executed 默认 true:块体箭头隐式返回 undefined ⇒ 判据恒真 ⇒ 现存 15 个调用点零回归。
      // ★判据与 `toast.js` 的 `succeeded()` **逐字同款**(`v!==false && v!==0`),而非只判 `!== false`:
      //   否则 `onConfirm: async () => (await rt.x.remove(id)).deleted` 返回 `0`(什么都没删)时,
      //   两个姊妹原语会给出**相反**的结论。一份契约,一条规则。
      let executed = true;
      try {
        const v = await opts.onConfirm();
        executed = v !== false && v !== 0;
      } catch (e) {
        executed = false; // 销毁是否发生未知 ⇒ 绝不提供撤销(提供撤销 ⇔ 销毁确已发生)
        console.error('[guardrail] 执行失败', e);
      }
      // ★不再**无条件** showUndo:销毁没发生 / 无可还原之物 ⇒ 按钮根本不出现,
      //   而不是给一个点下去一声不吭(或报错)的死按钮。
      if (executed && opts.onUndo) showUndo(opts.undoText || '已执行', opts.onUndo, opts.undoMs || 6000);
      resolve(true); // ← 「用户点了确认」。**勿改成 executed**(见函数头 ⚠⚠:会翻转 MCP 的 approved)
    };
  });
}
