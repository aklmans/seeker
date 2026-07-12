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
 * @typedef {{id:string, name:string, description:string, prompt:string, updated_at:number, tools:(string[]|undefined), imported:boolean, reviewed:boolean}} NormSkill
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
  // ★I1 导入信任标志(untrusted-until-reviewed)fail-closed 归一:
  //   imported:**truthy 即视为导入**(垃圾值往不可信侧靠——宁多审不漏审);缺失 → false = 本地自撰。
  //   reviewed:仅对导入有意义,**须显式 === true 才算已背书**(缺失/垃圾 → false = 待审,fail-closed);本地恒 true。
  //   ⇒ 缺两标志(既有本地 Skill / S3 迁移件 / 用户新建)= imported:false/reviewed:true = 本地可信,**零回归**。
  //   ★此默认的安全性**全系于**「导入路径永远强制 imported:true」(importSkillWire 载重不变式)——缺失标志才必是本地。
  const imported = !!r.imported;
  const reviewed = imported ? r.reviewed === true : true;
  return {
    id: String(r.id == null ? '' : r.id),
    name: String(r.name == null ? '' : r.name),
    description: String(r.description == null ? '' : r.description),
    prompt: String(r.prompt == null ? '' : r.prompt),
    updated_at: typeof r.updated_at === 'number' && isFinite(r.updated_at) ? r.updated_at : 0,
    // ★三态保真:数组 → 过滤非空串(可为 `[]`);非数组(缺失/畸形)→ `undefined`。绝不把 undefined 塌成 []。
    tools: Array.isArray(r.tools) ? r.tools.filter((/** @type {any} */ x) => typeof x === 'string' && x) : undefined,
    imported,
    reviewed,
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

/**
 * ★I1 待审判据(双点拒的谓词):导入且未背书 ⇒ 不可运行。消费者:runSkill fail-closed 守卫 +
 * 命令面板 platformSkills() 完全不列(第92轮预裁④)。本地自撰(imported:false)恒 false、永不待审。
 * @param {unknown} skill
 * @returns {boolean}
 */
export function skillNeedsReview(skill) {
  const s = normSkill(skill);
  return s.imported && !s.reviewed;
}

/**
 * ★★导入载重不变式(第92轮 [建议]-强 · proposal-skills-import §3):粘贴 JSON → **白名单提取**。
 * **只取 `{name, description, prompt, tools}`;`imported:true / reviewed:false` 由平台强制、永不取自粘贴数据**
 * ——粘贴里的 `imported`/`reviewed`/`id` 等一律丢弃(不在白名单):
 *   - 恶意 JSON 带 `reviewed:true` / 省略 `imported`(吃 normSkill 本地可信默认)⇒ 若靠 spread 顺序或
 *     直接 `normSkill(粘贴)` 入库,审阅门**全线可绕** —— 信任关键字段必须在不可信数据之外设定;
 *   - 粘贴 `id` 也危险:命中既有 id 的 keyed upsert 会 **clobber 用户已有 Skill** ⇒ 丢弃,
 *     调用方必须配 fresh id(同 S3 迁移 fresh-id 纪律)。
 * 无 prompt 正文 → null(审阅门摊的就是 prompt,无正文的导入无意义)。**绝不抛。**
 * @param {unknown} text 粘贴的 JSON 文本(不可信)
 * @returns {{name:string, description:string, prompt:string, tools:(string[]|undefined), imported:true, reviewed:false}|null}
 */
export function importSkillWire(text) {
  let w;
  try {
    w = JSON.parse(String(text == null ? '' : text));
  } catch (_e) {
    return null;
  }
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const name = typeof w.name === 'string' ? w.name.trim() : '';
  const description = typeof w.description === 'string' ? w.description.trim() : '';
  const prompt = typeof w.prompt === 'string' ? w.prompt : '';
  if (!prompt.trim()) return null;
  // tools 三态过导入面保真:缺失/非数组 → undefined(未限定);数组 → 滤非空串(可为 [] = 无 app-tool)。
  // 运行时 scopeAppTools 仍 ∩ readable 减权(F1)⇒ 导入声明超出可读集也够不到,无需此处再闸。
  const tools = Array.isArray(w.tools) ? w.tools.filter((/** @type {any} */ x) => typeof x === 'string' && x) : undefined;
  return { name, description, prompt, tools, imported: true, reviewed: false };
}

/**
 * ★I2 分享导出(白名单,与 importSkillWire 对称 · 第93轮盯点①②):Skill → 可分享 wire 对象。
 * **只导出 `{name, prompt, description?, tools?}` —— 绝不含 id / updated_at / imported / reviewed**:
 *   - **剥信任标志是不依赖接收方实现的防线**:标准接收方(I1 importSkillWire)本会丢弃粘贴标志,
 *     但导出侧不携带 = 旧版本/第三方接收实现也**吃不到 `reviewed:true`**(绕不了审阅门);
 *   - 剥 id = 接收方必然 fresh id(不可能 clobber);导出的是**指令本身**,接收方重走审阅(预裁③)。
 * tools 三态过导出面保真:未限定(undefined)不导出键;`[]` / `['x']` 原样导出。
 * 无 prompt 正文 → null(与 importSkillWire 对称:无正文的分享无意义)。**绝不抛。**
 * @param {unknown} skill
 * @returns {{name:string, prompt:string, description?:string, tools?:string[]}|null}
 */
export function exportSkillWire(skill) {
  const s = normSkill(skill);
  if (!s.prompt.trim()) return null;
  /** @type {{name:string, prompt:string, description?:string, tools?:string[]}} */
  const out = { name: s.name, prompt: s.prompt };
  if (s.description) out.description = s.description;
  if (Array.isArray(s.tools)) out.tools = s.tools;
  return out;
}
