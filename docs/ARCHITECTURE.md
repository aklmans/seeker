# Seeker 架构与扩展边界

本文记录当前代码的真实运行方式。设计原则以 [CLAUDE.md](../CLAUDE.md) 为最高约束；这里回答“代码在哪里、数据怎么走、扩展时不能越过什么边界”。

## 运行时主链

```text
index.html
  → platform/runtime/index.js 选择 desktop.js 或 web.js
  → 安装 window.SeekerRT，并发出 seeker-rt-ready
  → platform/shell/registry.js 安装 window.SeekerShell
  → apps/*/manifest.js 注册页面、集合、工具与生命周期钩子
  → shell-boot.js 构建导航、页面与 Agent chrome
```

前端只依赖 `RuntimeApi`。桌面实现通过 Tauri invoke 进入 Rust；Web 实现把通用数据落到 IndexedDB。不要在业务模块直接调用 SQLite、钥匙串或外网。

## 数据所有权与 AI 可读性

| 数据 | 桌面真相源 | Web 真相源 | AI 可读规则 |
| --- | --- | --- | --- |
| jobs / skills / actions / resumes / assets | SQLite | IndexedDB | 应用启用 ∩ manifest 授权 ∩ 用户授权；Rust 静态白名单再兜底 |
| messages | SQLite | IndexedDB | 不在 `QUERYABLE`；只在当前多轮历史中使用 |
| profile | 独立 profile 表 | 独立 profile store | 永不进入通用 `rt.db`，AI 无读取/写入接口 |
| API key / MCP token | 系统钥匙串 | Web 不持有桌面密钥 | 前端只见状态，类型接口没有 `get()` |
| memories / doc_chunks | SQLite 私有表 | IndexedDB 只保全便携包 | 仅能力实现访问，不开放通用集合查询 |
| 自动备份策略 | SQLite settings | Web 明确不支持后台备份 | 只经窄命令 `backup_policy_get/set` |

便携备份格式当前为 v2：通用集合、隔离 profile、设置、记忆/文档和便携偏好统一导出。导入先快照、校验后单事务合并；清空必须先得到可导入备份，再原子删除。

## AI 协议边界

Rust 内部使用一份 canonical message/tool 形状，`src-tauri/src/provider.rs` 只在出网边界翻译：

| 协议 | 对话/工具 | 图片抽取 | 嵌入 |
| --- | --- | --- | --- |
| OpenAI-compatible | `/chat/completions` + SSE | `image_url` | `/embeddings` |
| Anthropic | `/v1/messages` + 原生 tool blocks | base64 image source | 不支持，记忆/RAG 诚实停用 |
| Gemini | `streamGenerateContent` + function calls | `inlineData` | `batchEmbedContents` |
| Ollama | 官方 OpenAI-compatible `/v1` | 兼容 vision | 兼容 `/v1/embeddings`，key 可选 |

系统提示、项目指令、历史和不可信资料在 canonical 层组装；适配器不得自行读取 profile。工具结果返回模型前仍须经过既有的 Untrusted 框定与破坏性护栏。

## Task Agent 运行域

`任务中心`是独立于聊天工具循环的受控执行面。前端只负责收集用户选择、展示 TaskSpec、
调用 `RuntimeApi.agent` 和呈现状态；权限缩减、状态转换、文件写入、恢复与完成判定全部在
Rust 核完成。

```text
可信 UI 确认 1–5 个岗位 + 专业简历
  → Rust 生成固定 TaskSpec 与 5 步顺序计划
  → 读取 jobs / skills / resumes 快照
  → 确定性计算匹配分数
  → 无工具、无历史、无 profile 的模型调用生成 5 道问题
  → 原子写入 2 个 DOCX + 2 个 Markdown
  → 重读文件并校验目录、格式、大小与 SHA-256
  → 全部通过后才写 succeeded
```

运行元数据落在 `platform_agent_tasks/runs/steps/artifacts/approvals/events` 六个集合；它们可
进入完整便携备份，但永久排除在 AI `QUERYABLE` 之外。`profile` 仍走独立通道，任务只读
取不含联系方式的专业简历记录；artifact 路径由平台在应用数据目录内生成，模型与前端均
不能提交任意路径。

暂停和取消通过运行级 cancellation token 在安全检查点生效。应用重启不会偷偷续跑：
遗留的 created/planning/running 运行改为 interrupted；正在执行的只读步骤回到 pending，副作用
步骤改为 outcome_unknown。当前唯一副作用步骤先在 run 级 staging 目录写齐四个文件，再以
目录 rename 发布；四条 artifact 记录也在单一 SQLite 事务中提交。副作用开始后的错误不会
降级成普通 failed。恢复前 Rust 会核对记录和磁盘：完整且可信则承认成功；不完整则必须先
清掉该 run 的受控目录和记录，清理或事务失败时继续保持 outcome_unknown，禁止重放。

协调器的开始、步骤完成、失败和最终完成状态与对应审计事件均按事务提交；未被步骤分支
覆盖的顶层异常也会尽力收敛到 failed 或 interrupted。若数据库当时不可写而无法收敛，下次
启动仍会把遗留 created/planning/running 恢复为 interrupted。产物打开前必须已有
`verified=true`，并现场
复算大小和 SHA-256；摘要不符会持久化 invalid 状态、追加审计事件，并撤销 run/task 的
“已完成”可信结论。

任务输入有效性与产物字段使用同一契约：纯 URL、日期、布尔值，以及叙述/公司/作品集字段中的
纯域名等占位不能单独构成职业资料；`skills/need/requiredSkills` 按字段语义允许无协议、无路径
的点号技术名，不依赖技术名白名单。所有允许作为实质输入的简历字段都会确定性进入定制简历，
summary 等可用事实也会进入求职信证据。模型不负责改写这些源事实。

桌面端具备真实执行与本地文件能力；Web 端只保全、导入并展示任务记录，所有执行和打开
文件方法都明确返回不支持，界面不提供伪执行入口。完整状态机、权限和预算见
[AGENT-TASKS.md](AGENT-TASKS.md)，人工验收见
[AGENT-TASKS-ACCEPTANCE.md](AGENT-TASKS-ACCEPTANCE.md)。

## 新增应用检查表

1. 在 `web/apps/<id>/manifest.js` 注册页面、集合、AI 默认授权和生命周期钩子。
2. 业务模块只能向 `platform/` 单向依赖；应用之间不得直接 import。
3. 新集合同时更新前端 `Collection`、Web IndexedDB 白名单、Rust 表映射和便携备份白名单。
4. 若集合可被 AI 查询，必须显式加入 Rust `QUERYABLE`；profile、messages、settings 与私有能力表禁止加入。
5. 可写/破坏性动作只能声明提案，执行走 `SeekerGuardrail`，并提供真实快照撤销。
6. 外部文本、MCP/RAG 返回值和模型 UI 一律按不可信数据处理。
7. 为纯逻辑加 Node 单测；为用户主链加 Playwright；桌面边界加 Rust 测试。

## 验证命令

```bash
npm test
npm run typecheck
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

`test/type-debt.test.mjs` 把 `@ts-nocheck` 数量锁为只降不升；优先清理数据、隐私、护栏和 AI 出口，再处理展示页。
