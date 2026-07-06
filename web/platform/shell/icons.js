// @ts-check —— 3.y 步3:base 图标集 classic 全局 → ES module(export)+ 过渡 window 兼容桥。
/** 平台 · UI 图标集 IC(check/sun/moon/plus/x/arrow,零红线零依赖)。const 对象、无重赋值 → dual-publish 同引用安全;
 *  classic 消费者(nav/copilot-chrome/render 等 + INIT-module 的 IC.sun/IC.moon)按全局名 IC 调不变;逐个改 import 后摘桥。 */
export const IC = {
  check:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>',
  plus:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  x:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  arrow:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9M9 4l4 4-4 4"/></svg>'
};
/* 过渡 window 兼容桥(约束⑤):classic 消费者 + INIT-module 按全局名 IC 调不变;逐个改 import 后摘。 */
const _w = /** @type {any} */ (window); _w.IC=IC;
