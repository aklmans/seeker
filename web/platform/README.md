# platform/ · 平台层(稳定 · 复用 · 业务无关)

平台层是**一次建好、反复复用的基座资产**:与"做什么业务"无关。换业务 = 删 `domain/` 重写,
`platform/` 原封不动;做新项目 = 复制 `platform/` 接一套新 `domain/`。

> **契约铁律**:`domain/` 只通过稳定的命令 / 能力接口用平台,**绝不直接碰 SQLite 表结构或密钥**;
> 平台层不知道任何业务细节。两层之间只靠契约通信。

## 子目录与里程碑

| 目录 | 职责 | 里程碑 | 文档 |
|---|---|---|---|
| `runtime/` | **运行时适配层**:统一 `Runtime` 契约(`rt.db/ai/secret/capability`)+ 桌面(Tauri invoke)/网页两套实现。前端只依赖契约,换端只换实现。 | **M0(本里程碑:契约 + 空实现)** | 总盘 ③⑤ |
| `data/` | 数据引擎:仓库接口 + SQLite(桌面)/IndexedDB(网页)+ 弹性 schema(骨架列 + `data_json`)+ 迁移/快照/备份。 | #3 | 数据层与迁移方案 |
| `ai/` | AI 网关:BYO 多协议适配(OpenAI/Anthropic/Gemini/Ollama)+ 流式 + 工具调用循环 + 提示组装(**排除 profile 隐私字段**)。 | #1 | AI 网关与 Agent 工具层方案 |
| `capability/` | 能力层 registry + 统一 `Capability` 契约 + 各能力插件(RAG/记忆/向量/MCP/ACP/Skills/show_widget)。注册即生效。 | #2 | 能力层与 Capability 契约方案 |
| `secret/` | 钥匙串读写。**明文密钥只进系统钥匙串,绝不回前端**(前端只见 `configured/empty`,见 `runtime/types.d.ts` 的 `SecretApi` 故意无 `get()`)。 | #4 | 安全与隐私模型方案 |
| `voice/` | 本地语音 sidecar(STT/TTS/VAD)调度;音频不出本机。 | #5(业务定型后) | 本地语音 sidecar 方案 |
| `guardrail/` | 破坏性操作护栏:删/清空/覆盖一律**预览 + 确认 + 可撤销**;无论触发者是 UI、Agent 还是 widget,统一走此。 | #3/#4 | 安全与隐私模型方案 |

## 当前状态(M0)

- 仅 `runtime/` 有内容:契约 `types.d.ts` + 工厂 `index.js` + `desktop.js`/`web.js` 空实现 + `errors.js`。
- 空实现被调用时抛 `NotImplementedError`(不返回假数据);`available()` 已体现"网页可降级子集"。
- 其余子目录为骨架占位,按上表里程碑逐步落地。
