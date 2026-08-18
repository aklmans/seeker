# platform/ · 平台层

平台层是业务无关的稳定基座。`apps/` 只能通过 `RuntimeApi` 与 `SeekerShellApi` 使用它，不能直接碰 SQLite、钥匙串或外网；平台也不能反向写死某个应用的页面或数据结构。

| 目录 | 当前职责 |
| --- | --- |
| `runtime/` | 桌面/Web 运行时契约与适配；SQLite/IndexedDB、AI、profile、secret、MCP 等统一入口 |
| `shell/` | 导航、设置、Agent chrome、应用 registry、项目/定时/Skills 管理与启动编排 |
| `capability/` | app-tool 过滤与执行、MCP 确认、widget 沙箱渲染 |
| `guardrail/` | 破坏性操作的预览、确认和可撤销执行 |
| `data/` / `ai/` / `secret/` / `voice/` | 预留的更深层拆分目录；当前真实桌面实现位于 `src-tauri/src/` |

真实数据流、协议矩阵和新增应用检查表见 [架构文档](../../docs/ARCHITECTURE.md)。接口变更先改 `runtime/types.d.ts` 或 `shell/types.d.ts`，再同时更新 desktop/web 实现与测试。
