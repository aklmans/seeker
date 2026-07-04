// @ts-check
/** 平台 · DOM 基础工具 $/$$/el(抽壳阶段·序1「基础工具」首刀 · 第9轮裁定自底向上 —— 最底层、零红线)。
 *  过渡态:classic 全局(载序置于消费者之前),兼容 @ts-nocheck 的 apps/index.html 按全局名引用不变
 *  → 抽壳本身零回归(第9轮约束⑤,同 SeekerShell/SeekerKeys 先例);显式契约(SeekerShell.dom / import)留 3.y。 */
/** @param {string} s @param {ParentNode} [r] @returns {Element|null} */
const $=(s,r=document)=>r.querySelector(s);
/** @param {string} s @param {ParentNode} [r] @returns {Element[]} */
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
/** @param {string} h @returns {Element|null} */
const el=(h)=>{const t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstElementChild;};
