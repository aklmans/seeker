// @ts-check
/**
 * jobseek · 市场价值 app-tool 的**纯计算 + 契约元数据**(app-tool 契约 T3;迁自 src-tauri/src/jobseek.rs)。
 *
 * 本文件**零 import**(node 可测、真模块导出)—— `computeMarketValue` 会被平台以**源码字符串**注入三墙隔离
 * 沙箱执行(见 platform/capability/app-tools/sandbox.js),故它**必须自包含**:不引用任何模块作用域符号。
 * 呈现(render,需 tt/cEsc)在 market-value.js 装配 —— 那部分在前端跑,与本纯计算分离。
 *
 * 估算 = **目标岗位真实薪资(JOBS.pay)× 你对各岗位匹配分加权**(示意级、仍非真实定价模型,呈现处标「仅供参考」)。
 * ★取代旧 base20+Σlvl×1.6 求和公式(对真实 35 技能算 174万荒谬);job-pay 基于真实薪资、合理。**UI 与 app-tool 共用本函数。**
 */

/**
 * ★市场价值 = **目标岗位真实薪资(pay '40-65万')× 你对每个岗位的匹配分加权**。
 *   先量再改(评审第 N 轮翻案):旧 base20+Σlvl×1.6 求和公式对真实 35 项技能算出 174万(远超薪资带、荒谬)
 *   ——那是「打样级·非真实定价」公式,技能越多越离谱。job-pay 加权基于**真实岗位薪资**、合理(41-62万带)。
 *   **本函数 UI(intake-action.marketValue)与 app-tool 共用同一份 ⇒ 结构上不再发散**(评审第 N 轮 [建议]/[应改])。
 *   **自包含**(零 import + 匹配分内联):被平台以源码字符串注入三墙沙箱执行,不得引用任何模块作用域符号。
 * @param {any} _input 模型入参(本工具无参)
 * @param {{jobs?: any[], skills?: any[]}} rows 平台按 reads=['jobs','skills'] 取来的数据(D3 闸后)
 * @returns {{low:number, high:number, mid:number, jobs:number, gaps:string[]}}
 */
export function computeMarketValue(_input, rows) {
  var jobs = (rows && rows.jobs) || [];
  var skills = (rows && rows.skills) || [];
  // 内联匹配分(逐字复刻 computeMatch 的确定性评分,零 import 供沙箱):lvl≥3 满 1 / lvl 1-2 半 0.5 / 缺 0,score=10×Σcredit/need。
  /** @type {Record<string, number>} */
  var lvlOf = {};
  for (var i = 0; i < skills.length; i++) {
    var s = skills[i] || {};
    if (typeof s.name === 'string' && s.name) {
      var lv = Number(s.lvl);
      lvlOf[s.name] = lv >= 1 ? (lv > 5 ? 5 : Math.floor(lv)) : 0;
    }
  }
  /** @param {any[]} need @returns {number} */
  function matchScore(need) {
    if (!need || !need.length) return 0;
    var credit = 0;
    for (var k = 0; k < need.length; k++) {
      var l = lvlOf[need[k]] || 0;
      credit += l >= 3 ? 1 : l >= 1 ? 0.5 : 0;
    }
    return (10 * credit) / need.length;
  }
  // job-pay × 匹配加权 + 跨岗位聚合 gaps(lvl<3 的 need)。
  /** @type {{lo:number,hi:number,w:number}[]} */
  var parsed = [];
  /** @type {Record<string, number>} */
  var gapCnt = {};
  for (var j = 0; j < jobs.length; j++) {
    var job = jobs[j] || {};
    var need = job.need || [];
    var m = /(\d+)\s*[-–]\s*(\d+)/.exec(String(job.pay || '')); // '40-65万' → lo/hi(含 en-dash)
    if (m) parsed.push({ lo: +m[1], hi: +m[2], w: Math.max(0.1, matchScore(need)) }); // 匹配分 0-10 作权重,下限 0.1 防 Σ权重=0 除零
    for (var g = 0; g < need.length; g++) {
      var nm = need[g];
      if ((lvlOf[nm] || 0) < 3) gapCnt[nm] = (gapCnt[nm] || 0) + 1;
    }
  }
  var gaps = Object.keys(gapCnt)
    .sort(function (a, b) {
      return gapCnt[b] - gapCnt[a] || (a < b ? -1 : a > b ? 1 : 0);
    })
    .slice(0, 3);
  if (!parsed.length) return { low: 0, high: 0, mid: 0, jobs: 0, gaps: gaps };
  var W = 0, sumLo = 0, sumHi = 0;
  for (var p = 0; p < parsed.length; p++) {
    W += parsed[p].w;
    sumLo += parsed[p].lo * parsed[p].w;
    sumHi += parsed[p].hi * parsed[p].w;
  }
  var low = Math.round(sumLo / W);
  var high = Math.round(sumHi / W);
  return { low: low, high: high, mid: Math.round((low + high) / 2), jobs: parsed.length, gaps: gaps };
}

/** 给模型看的工具名(全局唯一,`jobseek_` 前缀)。 */
export const MARKET_VALUE_NAME = 'jobseek_market_value';

/** 本工具要读的集合(必填、⊆ manifest.collections;运行时再 ∩ 静态 QUERYABLE ∩ D3 可读集)。
 *  ★两集合 jobs+skills:job-pay 加权需目标岗位薪资(jobs)+ 你的技能(skills)⇒ **两层 D3**(上架 reads⊆readable + query_data 硬拒)。 */
export const MARKET_VALUE_READS = ['jobs', 'skills'];

/** 给模型看的「何时用」(应用自持可信文案)。 */
export const MARKET_VALUE_DESC =
  '估算用户当前的求职市场价值:读取用户的目标岗位薪资与技能,按用户对各岗位的匹配分加权,给出**示意级**年包参考区间与最该补的能力。' +
  '只读、不含任何隐私字段(姓名/电话/邮箱等一律不可读);**示意估算、非真实定价模型,仅供参考**。何时用:用户问「我值多少钱 / 我的市场价值 / 身价」等。';

/** 输出 JSON Schema —— 平台 projectToSchema 校验+投影(只留声明字段喂模型)。 */
export const MARKET_VALUE_OUTPUT = {
  type: 'object',
  required: ['low', 'high', 'mid', 'jobs', 'gaps'],
  properties: {
    low: { type: 'integer' },
    high: { type: 'integer' },
    mid: { type: 'integer' }, // 区间中值(便利;low/high 可导)
    jobs: { type: 'integer' }, // 参与估算的目标岗位数
    gaps: { type: 'array', items: { type: 'string' } }, // 跨岗位聚合的最该补能力(≤3)
  },
  additionalProperties: false,
};
