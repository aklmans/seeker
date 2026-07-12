// @ts-check
/**
 * 平台 Project(目标工作区)数据模型 —— fail-safe 归一化(proposal-project PJ1)。
 * **零 import**(node 可测、真模块导出)。
 *
 * ★★红线(第98轮 · 与「AI 不能给自己排任务」同族,缺席钉死):**永不注册任何可写
 *   `platform_projects` 的 capability / app-tool** —— Agent 能创建/切换/改写项目 =
 *   自改「每轮注入的项目指令」= **自我提示注入通路**(自我改写行为基线,比自排任务更直接)。
 *   本红线是结构性缺席,**加此类工具即拆除**;有形锚:capability.rs 守卫测试
 *   (`!is_queryable("platform_projects")` + 工具枚举不含)+ registry `caps.len` 断言(写半承重)
 *   + 本注释 + types.d.ts Project 注释。项目 CRUD 只在能力中心管理面(§4-2 延伸)。
 *
 * ★信任:项目 `instructions` = 用户在管理面自撰 = 可信(同 Skill prompt,S2 先例);
 *   **未来若做项目分享/导入,指令即第三方内容,须走 I1 同款 untrusted-until-reviewed**。
 */

/**
 * @typedef {{id:string, name:string, instructions:string, archived:boolean, created_at:number, updated_at:number}} NormProject
 */

/**
 * 防御性归一:任意存储记录 → 良构项目。**fail-safe:非对象/畸形绝不抛。**
 * `archived` 垃圾值 → false(往「可见」侧靠:错误地隐藏项目 = 用户以为内容丢了;显示无害)。
 * @param {unknown} rec
 * @returns {NormProject}
 */
export function normProject(rec) {
  const r = /** @type {any} */ (rec && typeof rec === 'object' ? rec : {});
  const num = (/** @type {any} */ v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
  return {
    id: String(r.id == null ? '' : r.id),
    name: String(r.name == null ? '' : r.name),
    instructions: typeof r.instructions === 'string' ? r.instructions : '',
    archived: r.archived === true,
    created_at: num(r.created_at),
    updated_at: num(r.updated_at),
  };
}
