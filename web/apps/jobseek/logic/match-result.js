// @ts-check
/**
 * jobseek · 智能匹配 —— **确定性技能重叠公式 + fail-safe 归一化**(schema-first · M1)。
 * —— 见 docs/proposal-smart-match.md。**零 import**(node 可测、真模块导出;computeMatch 自包含,将来可注入沙箱做 app-tool)。
 *
 * ★先量再改修正(方案原premise 被推翻):`j.match` **不是 mock,是用户 intake 表单的自评滑块**
 *   (「我现在的能力对得上吗?」)。故 `computeMatch` 产的是**与之不同的东西** —— 基于**真实 skills** 的
 *   客观技能重叠分,智能匹配页据此显示「综合匹配度 · 基于你的技能」;**不覆盖** j.match(用户主观自评仍归其滑块 + 排序)。
 *
 * ★两通道语义分离(第76轮:混合别合并):**分/集合由 computeMatch(确定性、可复现)产,reasoning 由 AI 产(M3)**。
 *   AI 永不自报分(承重不信 AI,同反馈刀 overall 平台重算)。
 */

/** 匹配分析的 AI 理由 wire schema(M3;确定性分不在此、由 computeMatch 产)。 */
export const MATCH_REASONING_SCHEMA = {
  type: 'object',
  properties: { reasoning: { type: 'string' } },
  additionalProperties: true,
};

/**
 * 确定性技能重叠匹配:每个 `job.need` 技能 —— 有且 lvl≥3 → 满分、lvl 1-2 → 半分、缺 → 0;
 * `score = 10 × Σ信用 / need 数`(0-10,1 位小数)。**打样级**(非真实招聘匹配模型),呈现须标「示意/基于你的技能」。
 * 自包含(不引用模块符号)⇒ 可复用(UI 直调)+ 将来注入沙箱做 app-tool。
 * @param {any} job `{need:string[]}`
 * @param {any[]} skills `[{name,lvl}]`(候选人职业资产)
 * @returns {{score:number, matched:string[], partial:string[], missing:string[], gaps:string[]}}
 *   matched=有且 lvl≥3(=strengths)· partial=lvl1-2 · missing=缺 · gaps=need 序的非满分(=topGapsOf 等价)
 */
export function computeMatch(job, skills) {
  var need = job && Array.isArray(job.need) ? job.need : [];
  /** @type {{[k:string]:number}} */
  var lvlByName = {};
  var arr = Array.isArray(skills) ? skills : [];
  for (var i = 0; i < arr.length; i++) {
    var s = arr[i] || {};
    if (typeof s.name === 'string' && s.name) {
      var lv = Number(s.lvl);
      lvlByName[s.name] = Number.isFinite(lv) && lv >= 1 ? Math.min(5, Math.floor(lv)) : 1;
    }
  }
  /** @type {string[]} */ var matched = [];
  /** @type {string[]} */ var partial = [];
  /** @type {string[]} */ var missing = [];
  /** @type {string[]} */ var gaps = [];
  for (var k = 0; k < need.length; k++) {
    var n = need[k];
    if (typeof n !== 'string' || !n) continue;
    var l = lvlByName[n] || 0;
    if (l >= 3) {
      matched.push(n);
    } else {
      (l >= 1 ? partial : missing).push(n);
      gaps.push(n); // need 序,与 topGapsOf 等价(缺 或 lvl<3)
    }
  }
  var total = matched.length + partial.length + missing.length;
  var credit = matched.length + partial.length * 0.5;
  var score = total > 0 ? Math.round((credit / total) * 100) / 10 : 0; // credit/total×10,1 位
  return { score: score, matched: matched, partial: partial, missing: missing, gaps: gaps };
}

/**
 * 归一化匹配结果(fail-safe,承重消费者不崩):score 钳 0-10、集合强制字符串数组有界、reasoning 截断。
 * computeMatch 产的本已规范;本函数供 M3 校验 AI reasoning 后合并、及任何外部来源兜底。
 * @param {any} raw
 * @returns {{score:number, matched:string[], partial:string[], missing:string[], reasoning?:string}}
 */
export function normMatchResult(raw) {
  var r = raw && typeof raw === 'object' ? raw : {};
  var sc = Number(r.score);
  var score = Number.isFinite(sc) ? Math.round(Math.max(0, Math.min(10, sc)) * 10) / 10 : 0;
  var list = function (/** @type {any} */ v) {
    return Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 20)
      : [];
  };
  /** @type {any} */
  var out = { score: score, matched: list(r.matched), partial: list(r.partial), missing: list(r.missing) };
  if (typeof r.reasoning === 'string' && r.reasoning.trim()) out.reasoning = r.reasoning.trim().slice(0, 600);
  return out;
}
