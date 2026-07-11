// @ts-check
/**
 * jobseek · 面试反馈评分 —— **schema + fail-safe 归一化**(ivScore schema 刀;解锁面试反馈真化)。
 *
 * 评分 `{scores:{structure,depth,quant,overall}, good, improve}` 是面试子系统的**承重结构**:
 * 单题反馈 / 整轮平均(`avg(k)=Σ scores[k]/n`)/ 整轮总评 / 总评页 / 成长曲线 / `iv_records` 持久化 全消费它。
 * 故在**真化之前**先把这个契约钉死:分数由谁产出(现 mock / 将来 AI)与「结构+校验」解耦。
 *
 * - **wire 形(扁平)** = 产出方给的 `{structure, depth, quant, good?, improve?}`(mock 现在给、AI 真化后给,
 *   经 `IV_FEEDBACK_SCHEMA` 校验)。**无 overall** —— 平台算,产出方不自报(防 AI 报个与维度不符的 overall)。
 * - **canonical 形(嵌套)** = 承重消费者用的 `{scores:{structure,depth,quant,overall}, good, improve}`。
 * - `normIvFeedback(wire)` 把前者归一为后者:各维钳 0–10、**overall 永远由 3 维重算**(与显示一致)、
 *   good/improve 强制字符串数组且有界。**fail-safe**:缺失/畸形 → 合理默认,**绝不抛**(承重消费者不得因一次
 *   坏反馈而崩:整轮平均 NaN / 总评页 `.toFixed` 报错 / 持久化坏行)。
 *
 * 本文件**零 import**(node 可测、真模块导出;与 market-value-compute 同纪律,源守卫钉零 import)。
 */

/** 被评分的三个维度(overall 由它们派生,不在此列)。 */
export const IV_DIMS = ['structure', 'depth', 'quant'];

/** 面试反馈的 wire schema(扁平)。真化时 AI 产出经此校验;含可选 good/improve 文字。 */
export const IV_FEEDBACK_SCHEMA = {
  type: 'object',
  required: ['structure', 'depth', 'quant'],
  properties: {
    structure: { type: 'number' },
    depth: { type: 'number' },
    quant: { type: 'number' },
    good: { type: 'array', items: { type: 'string' } },
    improve: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
};

/** 单维钳到 [0,10],保留 1 位小数;非数 → 0(fail-safe)。 @param {any} v @returns {number} */
function clampDim(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
}

/** 强制字符串数组、去空、截断、有界(fail-safe)。 @param {any} v @param {number} max @returns {string[]} */
function coerceList(v, max) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().slice(0, 240))
    .slice(0, max);
}

/**
 * 把 wire 形反馈归一为承重 canonical 形。**overall 永远由 3 维重算**(不信输入的 overall)。fail-safe、绝不抛。
 * @param {any} wire `{structure, depth, quant, good?, improve?}`(缺失/畸形皆可)
 * @returns {{scores:{structure:number,depth:number,quant:number,overall:number}, good:string[], improve:string[]}}
 */
export function normIvFeedback(wire) {
  const w = wire && typeof wire === 'object' ? wire : {};
  const structure = clampDim(w.structure);
  const depth = clampDim(w.depth);
  const quant = clampDim(w.quant);
  const overall = Math.round(((structure + depth + quant) / 3) * 10) / 10;
  return {
    scores: { structure, depth, quant, overall },
    good: coerceList(w.good, 4),
    improve: coerceList(w.improve, 5),
  };
}

/**
 * 从模型的自由文本里抽出 JSON 反馈对象(wire 形);无 `{` 或 parse 失败 → `null`。
 * 真化时:模型被要求只输出 JSON,但可能裹 ```json 或前后带散文 —— 抽**第一个平衡的 `{…}` 块**(串内的花括号
 * 不计数),容错但**不臆造**。返回 null / 非法 ⇒ 调用方走 schema 硬闸的诚实降级(**绝不喂 normIvFeedback 造 0 分**)。
 * @param {any} text @returns {any|null}
 */
export function parseFeedbackWire(text) {
  const s = String(text == null ? '' : text);
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch (_e) {
          return null;
        }
      }
    }
  }
  return null;
}
