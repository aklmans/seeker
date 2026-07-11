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
