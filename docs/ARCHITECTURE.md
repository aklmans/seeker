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
