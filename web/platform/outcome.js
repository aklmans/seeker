// @ts-check
/**
 * 平台 · **零依赖叶子**:一条判据,一处代码。
 *
 * 「回调用返回值告诉调用方:这件事到底成了没有」——这条规则今天被两个姊妹原语共用:
 *  · `shell/toast.js` 的 `toastUndo(msg, restoreFn)` —— `restoreFn` 说了不算就不报「已撤销」;
 *  · `guardrail/index.js` 的 `confirmDestructive(opts)` —— `onConfirm` 说没销毁就不给撤销按钮。
 *
 * ★评审第64轮 [建议]:两处原本各写一份 `v !== false && v !== 0`。**一旦漂移,后果正是
 *   「两个姊妹原语对同一个返回值给出相反结论」** —— 这个具体的分歧曾被一条 `C4_returnsZero` 断言抓到
 *   (guardrail 只判 `!== false` 时,`onConfirm: async () => (await rt.x.remove(id)).deleted` 返回 `0`
 *   会被读成「删成功了」而给出撤销按钮)。故抽到这里。
 *
 * 放在 `platform/` 根而非 `platform/shell/`:`guardrail/` 不该为了一个纯谓词去依赖 `shell/`
 * (层级方向)。本模块**零 import、零副作用、零 i18n** ⇒ 无环、不移动任何 module-eval 求值序。
 */

/**
 * 回调是否表示「这件事确实发生了」。
 *
 * **默认值是「成功」**,这是「零回归 opt-in」的代价:块体箭头 `() => { … }` 隐式返回 `undefined`,
 * 于是所有既有调用点无需改动。**代价是新写的失败路径忘记 `return false` 就会静默说谎** ——
 * 重量压在 JSDoc 义务与评审纪律上。
 *
 * @param {unknown} v 回调的返回值(已 await)
 * @returns {boolean} `false` / `0` ⇒ 没成功;其余(含 `undefined`)⇒ 成功
 */
export function succeeded(v) {
  return v !== false && v !== 0;
}
