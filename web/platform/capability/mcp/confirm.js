// @ts-check
/**
 * MCP 工具调用确认桥(平台 · #2 C4)——把后端 `mcp_confirm` 事件接到 guardrail。
 *
 * 安全 / 反焦虑:MCP server 是用户安装的**不可信**外部程序。模型每次想调用其工具,后端都**挂起等待**,
 * 这里弹护栏预览(server · 工具 · 参数)由用户允许 / 拒绝 → 回传后端唤醒。执行结果在后端标 Untrusted。
 * `readOnlyHint` 不当安全边界(只影响提示语气)。
 */

/** 懒绑双语(domain 的 window.tt 在对话期早已就位)。 @param {string} zh @param {string} en */
function T(zh, en) {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  return typeof w.tt === 'function' ? w.tt(zh, en) : zh;
}

/** @param {unknown} v */
function safeJson(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch (_e) {
    return String(v);
  }
}

/**
 * 安装 `mcp_confirm` 监听(仅桌面;web 无 MCP)。幂等:重复调用先解绑旧监听。
 * @param {object} deps
 * @param {any} deps.rt 运行时(用 rt.mcp.confirmResolve)
 * @param {(opts:any)=>Promise<boolean>} deps.confirmDestructive 护栏确认(确认 true / 取消 false)
 */
export function initMcpConfirm({ rt, confirmDestructive }) {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
  const ev = (w.__TAURI__ && w.__TAURI__.event) || null;
  if (!ev || !ev.listen) return; // 非桌面(web 端 MCP 不可用)→ 跳过
  ev.listen('mcp_confirm', /** @param {any} e */ async (e) => {
    const p = (e && e.payload) || {};
    let approved = false;
    try {
      approved = await confirmDestructive({
        title: T('允许外部工具调用?', 'Allow external tool call?'),
        detail:
          T(`Agent 想调用 MCP server「${p.server}」的工具「${p.tool}」。`, `Agent wants to call "${p.tool}" on MCP server "${p.server}".`) +
          (p.readOnly ? '' : T(' 该工具可能改动数据。', ' This tool may modify data.')),
        changes: [{ label: T('调用参数', 'Arguments'), before: '', after: safeJson(p.args) }],
        confirmLabel: T('允许', 'Allow'),
        source: 'MCP · ' + (p.server || ''),
        onConfirm: () => {}, // 实际执行在后端;此处仅取「允许 / 拒绝」信号
      });
    } catch (_e) {
      approved = false;
    }
    try {
      await rt.mcp.confirmResolve(p.confirmId, approved);
    } catch (_e) {
      /* 后端可能已超时清理;忽略 */
    }
  });
}
