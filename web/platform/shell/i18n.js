// @ts-check
/** 平台 · i18n 读取基元 I18N/L/T/tt(抽壳序1-c · 读 setState.lang)。
 *  setLang(写+重渲)依赖 nav/chrome → 留序3;setState 是壳全局(序5 抽)。
 *  过渡态:classic 全局 + 载序前置 → apps/index.html 按全局名引用不变、抽壳零回归(约束⑤);契约化留 3.y。 */
/** @type {Record<string,{zh:string,en:string}>} */
const I18N={editor:{zh:'编辑器',en:'Editor'},agentSub:{zh:'说出需求,我判断并执行 · 需要展示时右侧画布才出现',en:'Tell me what you need — I decide & act; the canvas appears on the right when needed'},collapseCanvas:{zh:'⤜ 收起画布',en:'⤜ Collapse'},cmdLabel:{zh:'技能 / 命令 · 也可输入 /',en:'Skills / commands · or type /'},agentPh:{zh:'说出需求,或输入 / 唤起命令',en:'Tell me what you need, or type / for commands'},agentGreet:{zh:'嗨,我是你的求职 Agent。直接说需求,我来判断该做什么并执行 —— 匹配岗位、改简历、出面试题、排计划、查缺口都行,结果会显示在右侧画布。也可以点下面的技能快捷开始。',en:"Hi, I'm your job-hunt Agent. Just tell me what you need and I'll figure out what to do — match jobs, tailor your resume, run interview prep, plan training, find gaps — results show on the right canvas. Or tap a skill below."}};
/** @param {{label:string,en?:string}} p */
function L(p){return setState.lang==='en'?(p.en||p.label):p.label;}
/** @param {string} k */
function T(k){const e=I18N[k];return e?(setState.lang==='en'?e.en:e.zh):k;}
/** @param {string} zh @param {string} en */
function tt(zh,en){return setState.lang==='en'?en:zh;}
