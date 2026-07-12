// @ts-check
/**
 * app-tool「上架」D3 过滤(平台层,纯函数、node 可测)。
 *
 * 只把 **reads ⊆ 运行时可读集** 的工具摆给模型(reads 不可读 ⇒ 不上架,同 `DataQuery.available` 不列)。
 * 这是 D3 双点闸的**上架**半;**调用硬拒**半在后端 `query_data` 的 invoke(即便上架,取数仍二次硬校验)。
 *
 * ★只 map `{name, description, parameters}`(应用自持可信元数据)——**compute / reads / output / render /
 *   任何用户数据 / profile 一律不给模型**。seam 结构性最小暴露。
 *
 * @param {{name:string, description:string, parameters:object, reads?:string[]}[]} tools 全部启用应用的 app-tool(SeekerShell.appTools())
 * @param {string[]} readableCollections 运行时可读集(SeekerShell.aiReadableCollections())
 * @returns {{name:string, description:string, parameters:object}[]}
 */
export function filterReadableTools(tools, readableCollections) {
  const readable = new Set(readableCollections || []);
  return (tools || [])
    .filter((t) => t && Array.isArray(t.reads) && t.reads.every((c) => readable.has(c)))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/**
 * ★Skills 完整版 F1(工具 scoping · 最小权限):把**已 readable** 的 app-tool 描述符按 Skill 声明**收窄**。
 *
 * ★★減権不増権(结构不变式):结果**恒 ⊆ 入参**(readableTools)⇒ Skill 永不能拿到用户不可读的工具、无提权面。
 * 三态(用户拍板):
 *   - `scopeTools` **非数组(`undefined` = 未声明,含所有雏形 Skill / 用户打字)** ⇒ 不收窄(全 readable、雏形零回归);
 *   - **`[]`(显式声明空)** ⇒ **无 app-tool**(注意:**非「无工具」—— 平台 Rust 能力 query_data / memory / show_widget / doc 不在本列表、恒在 ai_chat、各由自身红线闸**);
 *   - **`['x']`** ⇒ 仅 `x`(∩ readable;声明外结构性够不到)。
 * ★純函数(node 可测,同 filterReadableTools)。
 *
 * @param {{name:string}[]} readableTools 已过 filterReadableTools 的描述符(SeekerShell.appTools() ∩ D3)
 * @param {string[]|undefined} scopeTools Skill.tools(三态)
 * @returns {{name:string}[]} 收窄后的描述符(⊆ readableTools)
 */
export function scopeAppTools(readableTools, scopeTools) {
  const arr = Array.isArray(readableTools) ? readableTools : [];
  if (!Array.isArray(scopeTools)) return arr.filter(Boolean); // undefined / 非数组 = 全(不收窄、雏形零回归;两分支都产干净表)
  const scope = new Set(scopeTools);
  return arr.filter((t) => t && scope.has(t.name)); // [] → 空;['x'] → 仅 x∩readable
}
