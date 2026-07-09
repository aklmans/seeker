// @ts-check —— 3.y 步3:i18n base 读取基元 classic 全局 → ES module(export)+ 过渡 window 兼容桥。
//   I18N=const 表(内部私有、仅 T/L 消费)、tt/L/T=函数(读 setState.lang)→ 均 dual-publish 安全。
//   ★批10b:setState 改 import(shell-state.js;曾经 apps 侧 monolith-globals.d.ts 供 ambient=跨层泄漏,账本删)。
//   ⚠已裁(批10 方案 §2):shell-state.js 函数体裸调 tt → 待其 flip 后与本文件构成 i18n⇄shell-state **运行时环**——两侧读全在函数体、零 eager 互读,ESM 语义安全,接受。
/** 平台 · i18n 读取基元 I18N/L/T/tt(读 setState.lang)。classic 消费者(几乎全部)+ INIT-module 按全局名 tt/L/T 调不变;逐个改 import 后摘桥。 */
/** ★文案归属已清(第14轮账 · 3.y 尾 greeting 契约):agentGreet + copGreet 现为**中性平台招呼语**(不名任何应用功能),
 *  仅作 `SeekerShell.greeting(mode)` 未命中时的回退;jobseek 味开场白(求职 Agent/Copilot · 匹配岗位 · 改简历…)已随 manifest.greeting 归 jobseek。
 *  余 agentSub/agentPh/cmdLabel = 通用助手 UI 串(不名应用功能),留平台 i18n。 */
import { setState } from './shell-state.js';

/** @type {Record<string,{zh:string,en:string}>} */
const I18N={editor:{zh:'编辑器',en:'Editor'},agentSub:{zh:'说出需求,我判断并执行 · 需要展示时右侧画布才出现',en:'Tell me what you need — I decide & act; the canvas appears on the right when needed'},collapseCanvas:{zh:'⤜ 收起画布',en:'⤜ Collapse'},cmdLabel:{zh:'技能 / 命令 · 也可输入 /',en:'Skills / commands · or type /'},agentPh:{zh:'说出需求,或输入 / 唤起命令',en:'Tell me what you need, or type / for commands'},agentGreet:{zh:'嗨,我是你的助手。直接说需求,我来判断该做什么并执行,结果会显示在右侧画布。也可以点下面的技能快捷开始。',en:"Hi, I'm your assistant. Just tell me what you need and I'll decide what to do and act — results show on the right canvas. Or tap a skill below."},copGreet:{zh:'嗨,我是你的助手。用一句话就能指挥整个工作台。试试:',en:"Hi, I'm your assistant. Command the whole workbench in one line. Try:"}};
/** @param {{label:string,en?:string}} p */
export function L(p){return setState.lang==='en'?(p.en||p.label):p.label;}
/** @param {string} k */
export function T(k){const e=I18N[k];return e?(setState.lang==='en'?e.en:e.zh):k;}
/** @param {string} zh @param {string} en */
export function tt(zh,en){return setState.lang==='en'?en:zh;}
/* 过渡 window 兼容桥(约束⑤):classic 消费者(几乎全部 + INIT-module 的 tt)按全局名 tt/L/T 调不变;逐个改 import 后摘。I18N 内部私有不上桥。 */
const _w = /** @type {any} */ (window); 