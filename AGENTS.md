@CLAUDE.md

# AGENTS.md · Seeker Agent 工作约定

> 本文件只补充自动化开发 Agent 的执行方式。产品事实、架构红线和设计原则以 `CLAUDE.md` 为唯一真相源；两者冲突时遵循约束更严格的一项。

## 1 · 开始工作前

- 完整阅读 `CLAUDE.md`；涉及运行时、数据或新应用时再读 `docs/ARCHITECTURE.md`。
- 先执行 `git status --short`、查看相关 diff 与最近提交，区分用户已有改动和本次任务改动。
- 不覆盖、不回滚、不顺手格式化用户的无关修改；无法安全绕开时先说明冲突。
- 先定位真实入口、契约、持久化路径和现有测试，再提出或实施改动，不凭文件名猜架构。

## 2 · 改动边界

- 前端业务只依赖 `RuntimeApi` / `SeekerShellApi`；`apps/` 不直接访问 SQLite、钥匙串、外网，也不跨应用 import。
- 新增或变更集合时，同步核对：`runtime/types.d.ts`、Web IndexedDB 白名单、Rust 表映射、便携备份白名单和 AI `QUERYABLE` 静态硬底。
- `profile` 只走独立 profile 通道；密钥只走系统钥匙串；不得为了复用把它们并入通用 `rt.db`。
- 多模型协议统一先进入 canonical message/tool 形状，只在 `src-tauri/src/provider.rs` 的出网边界转换供应商 wire format。
- 不新增 `@ts-nocheck`。现有债务只允许下降；优先清理数据、隐私、护栏和 AI 出口。
- UI 改动保持现有设计语言并补齐 `tt()/T()` 中英双语；不要引入前端框架或新的视觉体系。
- 删除、覆盖、清空等操作必须复用既有 guardrail/undo 语义，后端失败时不得让 UI 假装成功。

## 3 · 实施方式

- 用小而完整的增量推进：契约 → 两端实现 → 调用方 → 测试/文档；避免只改一端造成能力谎报。
- 编辑文件优先使用补丁，保持 diff 聚焦；生成物、依赖缓存、测试截图和临时服务器输出不入库。
- 修 bug 时先加能复现问题且修复前会失败的测试；安全边界同时保留正向控制组和 fail-closed 断言。
- 改架构或用户可见行为时同步维护 `docs/ARCHITECTURE.md` 或对应用户文档；不保留已失真的里程碑描述。

## 4 · 验证矩阵

按改动范围运行最小充分集合；交付跨层改动时运行全量集合。

```bash
npm test
npm run typecheck
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

- 浏览器主链必须经本地 HTTP 服务验证，不能把 `file://` 能打开当作 E2E 通过。
- 涉及 Tauri 前端资源时，最终 `cargo build` 应实际重新编译/嵌入；发布包只在用户明确要求时运行 `npm run build:all`。
- 某项验证因环境限制无法执行时，如实记录命令、原因和未覆盖风险，不用较弱检查冒充通过。

## 5 · Git 与提交

- Agent 新分支默认使用 `codex/` 前缀；不擅自切换、合并、推送、开 PR、打 tag 或发布。
- 一个可工作的逻辑增量一个 commit；提交前检查 `git diff --check`，提交后检查范围和工作区。
- 保留仓库配置的真实主作者身份，不用虚构姓名或邮箱覆盖 `user.name` / `user.email`。
- Codex 参与的每个提交都追加精确尾注：

```text
Co-Authored-By: Codex <noreply@openai.com>
```

- 只提交本次任务文件；暂存区已有无关内容时使用显式路径提交，绝不把用户改动顺带带入。

## 6 · 交付说明

交付时先说结果，再列验证证据、提交范围和仍存在的限制。明确区分“已提交”“已推送”“已发布”；没有做过的动作不要暗示已经完成。
