// @ts-check
/**
 * jobseek · 简历解析承重契约 + fail-safe 归一化(schema-first · 真化前置,同 ivScore/match schema 刀)。
 * **零 import**(node 可测、真模块导出)。
 *
 * ★承重:解析结果**写入 SKILLS**(computeMatch / 市场价值 / 智能匹配 全读它)+ RESUME 档案 ⇒
 *   结构 + 校验先钉死,AI 产出经 `RESUME_PARSE_SCHEMA` 硬闸(失败诚实降级、绝不把畸形写进 SKILLS);
 *   `normResumeParse` fail-safe 是**承重防崩**(写 SKILLS 前保证良构),非「AI 乱答就写空档案」的产品语义。
 * ★信任:简历文本是**用户输入 = 不可信**(后端 frame_untrusted 框定「数据非指令」);instruction 纯 app 常量;
 *   地基 = ai_generate 结构性无工具(注入至多让模型给个歪档案,不能调工具/写记忆)。真化在 Cut2。
 */

/** @typedef {{name:string, lvl:number, evidence:string[]}} ParsedSkill */
/** @typedef {{skills:ParsedSkill[], years:number, summary:string}} ParsedResume */

/** AI 产出 wire 的 JSON Schema —— 平台 projectToSchema 硬闸(承重写入前)。 */
export const RESUME_PARSE_SCHEMA = {
  type: 'object',
  required: ['skills'],
  properties: {
    skills: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'lvl'],
        properties: {
          name: { type: 'string' },
          lvl: { type: 'integer' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    years: { type: 'integer' },
    summary: { type: 'string' },
  },
};

/**
 * fail-safe 归一:AI 产出 → 良构 ParsedResume。lvl 钳 **1-5**(对齐 computeMatch 消费者语义、无效→1)、字段强制、丢无名/重名技能、evidence 只留非空串。**绝不抛。**
 * @param {any} wire
 * @returns {ParsedResume}
 */
export function normResumeParse(wire) {
  const w = wire && typeof wire === 'object' ? wire : {};
  const rawSkills = Array.isArray(w.skills) ? w.skills : [];
  /** @type {ParsedSkill[]} */
  const skills = [];
  const seen = new Set();
  for (let i = 0; i < rawSkills.length; i++) {
    const r = rawSkills[i] && typeof rawSkills[i] === 'object' ? rawSkills[i] : {};
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || seen.has(name)) continue; // 无名 / 重名 剔除
    seen.add(name);
    const lvNum = Number(r.lvl);
    // ★lvl 对齐 SKILLS 消费者语义(computeMatch/市场价值:`Number.isFinite&&>=1?min(5,floor):1` ⇒ <1 当 1):
    //   钳 **1-5、无效/未知→1** —— 抽出的技能=候选人「有」的技能(lvl≥1),存储===生效(避 stored-0/effective-1);
    //   「AI 判不出等级」→ 当最小 1(minimal credit 0.5)是 computeMatch 已有的合理降级。(评审 Cut1 [建议],趁契约刀对齐)
    const lvl = Number.isFinite(lvNum) && lvNum >= 1 ? Math.min(5, Math.floor(lvNum)) : 1;
    const evidence = Array.isArray(r.evidence)
      ? r.evidence.filter((/** @type {any} */ x) => typeof x === 'string' && x.trim()).map((/** @type {any} */ x) => String(x))
      : [];
    skills.push({ name, lvl, evidence });
  }
  const yrNum = Number(w.years);
  const years = Number.isFinite(yrNum) && yrNum >= 0 ? Math.floor(yrNum) : 0;
  const summary = typeof w.summary === 'string' ? w.summary : '';
  return { skills, years, summary };
}

/**
 * 从模型自由文本抽**第一个平衡 `{…}` JSON 块**(串内花括号不计数;容错但不臆造)。无/畸形 → null。同 parseFeedbackWire。
 * @param {unknown} text @returns {any}
 */
export function parseResumeWire(text) {
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

/**
 * ★承重 merge(纯函数,零 import 供入库测;评审 Cut2 [建议]):既有 SKILLS + 解析技能 → **新 SKILLS 记录清单**。
 * merge-by-name:**解析定清单**(resume 是能力档案的源);匹配既有名**保留市场字段**(demand/pri/years —— 非简历派生);
 * 新技能给**诚实默认**(years 0 / demand 6 / pri mid,非编造);`state` 恒按新 lvl 重算(lvl 已在 normResumeParse 钳 1-5)。
 * ★调用方(applyParsedResume)只做副作用(写 SKILLS/RESUME/persist);本函数是它决定「进 SKILLS 什么」的承重核心 ⇒ 入库测防漂移。
 * @param {any[]} prevSkills 既有 SKILLS(保市场字段)
 * @param {ParsedSkill[]} parsedSkills normResumeParse 后的技能
 * @returns {any[]} 新 SKILLS 记录清单
 */
export function mergeParseIntoSkills(prevSkills, parsedSkills) {
  /** @type {Record<string, any>} */
  const prevByName = {};
  (Array.isArray(prevSkills) ? prevSkills : []).forEach((s) => {
    if (s && typeof s.name === 'string' && s.name) prevByName[s.name] = s;
  });
  return (Array.isArray(parsedSkills) ? parsedSkills : []).map((ps) => {
    const prev = prevByName[ps.name];
    const lvl = ps.lvl;
    const state = lvl >= 3 ? '已掌握' : lvl >= 2 ? '进行中' : '仅基础'; // 从 lvl 重算(非留旧 state)
    return {
      name: ps.name,
      lvl,
      years: prev ? prev.years : 0, // 既有名保留,新技能未知→0(诚实,非编)
      demand: prev ? prev.demand : 6, // 市场字段非简历派生 ⇒ 既有保留、新技能中性默认
      pri: prev ? prev.pri : 'mid',
      state,
      evidence: ps.evidence && ps.evidence.length ? ps.evidence : prev ? prev.evidence || [] : [],
    };
  });
}
