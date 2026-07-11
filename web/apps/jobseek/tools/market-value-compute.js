// @ts-check
/**
 * jobseek · 市场价值 app-tool 的**纯计算 + 契约元数据**(app-tool 契约 T3;迁自 src-tauri/src/jobseek.rs)。
 *
 * 本文件**零 import**(node 可测、真模块导出)—— `computeMarketValue` 会被平台以**源码字符串**注入三墙隔离
 * 沙箱执行(见 platform/capability/app-tools/sandbox.js),故它**必须自包含**:不引用任何模块作用域符号。
 * 呈现(render,需 tt/cEsc)在 market-value.js 装配 —— 那部分在前端跑,与本纯计算分离。
 *
 * 估算公式与旧 Rust 打样逐字一致(**打样级、数据驱动**,非真实定价模型):base 20 + Σ(技能等级 × 1.6),
 * low = round(mid × 0.88),high = round(mid × 1.16),top5 按等级降序、同级按名升序。
 */

/**
 * @param {any} _input 模型入参(本工具无参)
 * @param {{skills?: any[]}} rows 平台按 reads=['skills'] 取来的数据(D3 闸后)
 * @returns {{low:number, high:number, n:number, top:{name:string, lvl:number}[]}}
 */
export function computeMarketValue(_input, rows) {
  var recs = (rows && rows.skills) || [];
  var skills = [];
  for (var i = 0; i < recs.length; i++) {
    var r = recs[i] || {};
    var name = typeof r.name === 'string' ? r.name : '';
    if (!name) continue;
    // ★入参解析**有意**不同于已删的旧 Rust(第74轮裁决①):非整数 lvl(如 3.9)这里 floor→3;
    //   旧 Rust `as_i64().unwrap_or(1)` 会让它塌成 1 —— 那是 `as_i64` 对 float 返 None 的 **artifact,非设计**。
    //   jobseek.rs 已删,没有「等价对象」可复刻;floor 更合理(且 skills.lvl 恒整数 ⇒ 实际不可达)。**勿把它「对齐」向已删代码。**
    var lvl = Number(r.lvl);
    if (!(lvl >= 1)) lvl = 1;
    if (lvl > 5) lvl = 5;
    lvl = Math.floor(lvl);
    skills.push({ name: name, lvl: lvl });
  }
  var sum = 0;
  for (var j = 0; j < skills.length; j++) sum += skills[j].lvl * 1.6;
  var mid = 20 + sum;
  var low = Math.round(mid * 0.88);
  var high = Math.round(mid * 1.16);
  var top = skills.slice().sort(function (a, b) {
    return b.lvl - a.lvl || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }).slice(0, 5);
  return { low: low, high: high, n: skills.length, top: top };
}

/** 给模型看的工具名(全局唯一,`jobseek_` 前缀)。 */
export const MARKET_VALUE_NAME = 'jobseek_market_value';

/** 本工具要读的集合(必填、⊆ manifest.collections;运行时再 ∩ 静态 QUERYABLE ∩ D3 可读集)。 */
export const MARKET_VALUE_READS = ['skills'];

/** 给模型看的「何时用」(应用自持可信文案;迁自 jobseek.rs schema.description)。 */
export const MARKET_VALUE_DESC =
  '估算用户当前的求职市场价值:读取用户的职业资产(技能),给出数据驱动的估算年包区间与依据。' +
  '只读、不含任何隐私字段(姓名/电话/邮箱等一律不可读)。何时用:用户问「我值多少钱 / 我的市场价值 / 身价」等。';

/** 输出 JSON Schema —— 平台 projectToSchema 校验+投影(只留声明字段喂模型)。 */
export const MARKET_VALUE_OUTPUT = {
  type: 'object',
  required: ['low', 'high', 'n', 'top'],
  properties: {
    low: { type: 'integer' },
    high: { type: 'integer' },
    n: { type: 'integer' },
    top: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'lvl'],
        properties: { name: { type: 'string' }, lvl: { type: 'integer' } },
      },
    },
  },
  additionalProperties: false,
};
