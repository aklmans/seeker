// @ts-check
/**
 * 平台 Skill 数据模型 —— **fail-safe 归一化 + 可运行判据**(schema-first · proposal-skills.md S1)。
 * **零 import**(node 可测、真模块导出)。承第79轮 [建议]1(信任=本地自撰)+ 第80轮 [建议](S2 承重前先测归一化)。
 *
 * ★为何在 S1 抽+测(而非等 S2):S2 运行 Skill = `skill.prompt` 作 `ai_chat` 的 instruction。
 *   存储记录可能缺字段/类型漂移(弹性 schema data_json)⇒ `normSkill` 是 **S2 prompt→instruction 依赖的 fail-safe**
 *   (保证 prompt 是字符串、绝不喂 undefined/对象给模型)。同 normIvFeedback/normMatchResult 在 schema 刀就抽+测。
 *
 * ★与 ivScore/match 的差异:Skill 是**用户自撰**(可信、非 AI 产出)⇒ **不需要** projectToSchema 式「防 AI 畸形」硬闸;
 *   只需「存储记录 → 良构字符串」(normSkill)+「能不能运行」(skillRunnable:prompt 非空)。
 */

/**
 * @typedef {{id:string, name:string, description:string, prompt:string, updated_at:number, tools:(string[]|undefined)}} NormSkill
 */

/**
 * 防御性归一:任意存储记录 → 良构 Skill(字段强制字符串、时间戳强制数)。**fail-safe:非对象/畸形绝不抛。**
 * ★Skills F1(工具 scoping)`tools` **三态,必须保真**(不可把 `undefined` 塌成 `[]`,二者语义不同):
 *   - `undefined`(未声明,含所有雏形 Skill / 用户打字)= **全可读 app-tool**(雏形零回归);
 *   - `[]`(声明了但空)= **无 app-tool**(注意:非「无工具」—— 平台 Rust 能力 query_data/memory/show_widget/doc 恒在 ai_chat);
 *   - `['x']` = 仅 x(∩ 可读)。
 *   ⇒ 数组则过滤成 `string[]`(可空)、非数组一律 `undefined`。scoping 减权不增权(见 readable.js scopeAppTools)。
 * @param {unknown} rec
 * @returns {NormSkill}
 */
export function normSkill(rec) {
  const r = /** @type {any} */ (rec && typeof rec === 'object' ? rec : {});
  return {
    id: String(r.id == null ? '' : r.id),
    name: String(r.name == null ? '' : r.name),
    description: String(r.description == null ? '' : r.description),
    prompt: String(r.prompt == null ? '' : r.prompt),
    updated_at: typeof r.updated_at === 'number' && isFinite(r.updated_at) ? r.updated_at : 0,
    // ★三态保真:数组 → 过滤非空串(可为 `[]`);非数组(缺失/畸形)→ `undefined`。绝不把 undefined 塌成 []。
    tools: Array.isArray(r.tools) ? r.tools.filter((/** @type {any} */ x) => typeof x === 'string' && x) : undefined,
  };
}

/**
 * 可运行判据:一枚 Skill 能否作为指令运行(S2 命令面板据此裁)= 归一后 `prompt` 去空白非空。
 * 与 skills.js 保存守卫(name 或 prompt 非空)不同:保存允许「只填名的草稿」,运行则必须有指令正文。
 * @param {unknown} skill
 * @returns {boolean}
 */
export function skillRunnable(skill) {
  return normSkill(skill).prompt.trim().length > 0;
}
