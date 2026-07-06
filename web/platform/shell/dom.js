// @ts-check —— 3.y:base 工具 classic 全局 → 真 ES module(export)+ 过渡 window 兼容桥。
//   $/$$/el 均 const 箭头、无重赋值 = 纯 → dual-publish 安全;INIT 已 module(步1)+ 本 base module(tag 859)早于 INIT-module(874)
//   → INIT 及 classic 消费者按全局名 $/$$/el 调不变(逐个改 import 后摘桥;parse-time 消费者双向扫描=空,见第28轮)。零红线。
/** @param {string} s @param {ParentNode} [r] @returns {Element|null} */
export const $=(s,r=document)=>r.querySelector(s);
/** @param {string} s @param {ParentNode} [r] @returns {Element[]} */
export const $$=(s,r=document)=>[...r.querySelectorAll(s)];
/** @param {string} h @returns {Element|null} */
export const el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstElementChild;};
/* 过渡 window 兼容桥(约束⑤):classic 消费者(几乎全部文件 + INIT-module)按全局名 $/$$/el 调不变;逐个改 import 后摘。纯函数、同引用 dual-publish 安全。 */
const _w = /** @type {any} */ (window); _w.$=$; _w.$$=$$; _w.el=el;
