# 提案 · AI-Native 转向 —— Agent 窗口即入口,一切功能皆工具

> 起草 2026-07-08(真机体验反馈后)。定位级动议,重要性同 `proposal-app-platform.md`(多应用平台化)。
> 架构「为什么」交叉引用 `../prototypes/AI 网关与 Agent 工具层方案.html`(#1)、`能力层与 Capability 契约方案.html`(#2)。
> **本提案是执行前的方案对齐,过审后按期分刀;先行,不直接动工。**

---

## 0. 一句话

平台从「**带 AI 的传统工作台**」转向「**AI-Native**:Agent 窗口是唯一主入口,任何功能都能在对话里完成 —— 因为任何功能都是一个 Agent 可调的**工具/能力**」。

好消息:**这个转向的地基已经建好**(见 §2),P0 主要是「把已建的循环接上前端 + 把窗口收敛」,不是从零造。

---

## 1. 诊断 —— 真机反馈的三条,代码坐实

| 反馈 | 代码事实 | 病根 |
|---|---|---|
| **Agent 窗口很杂** | index.html 里**两个聊天面板**:`#agentChat`(Agent 全屏 aside:agentMsgs/agentCmds/agentInput)+ `#copPanel`(Copilot 浮窗:copMsgs/copInput),再加 `#modeSwitch` 的「Agent / 编辑器」切换 | 两个重叠 AI 面 + 一个编辑器模式,职责不清 |
| **不是 AI-Native** | jobseek 核心流程(匹配/简历/面试/市场价值)由 **8 处 `aiRun`**(intake-action.js:252 = 脚本步骤 + 罐头结果的**演出 mock**)驱动,不是真工具循环;真流式 `streamReply` 只在 Copilot 问答里用 | 功能是「按钮 + 假 AI 演出」,不是「对话 + 真执行」 |
| **笔记/Prompt 库简陋、需求错位** | `apps/assets` = manifest(49)+notes(70)+prompts(82)= **201 行**孤立薄页;与能力层(记忆/知识库/Skills)**零连接** | 重造了三方软件的弱鸡版,而非利用平台已有的记忆/RAG/工具能力;2026 真需求是 Skills/Connector/Project/Scheduled tasks 的**管理**,不是存文本 |

---

## 2. 关键洞察 —— 地基已建(Rust 侧 C1–C3 落地)

**不要重造。** 后端能力层与工具循环已实现:

- **`ai_chat` = 完整工具循环**(`src-tauri/src/ai.rs`):从 capability registry 取 `Kind=Tool` 的 schema 塞进请求 → 累积流式 `tool_calls` → 经 registry 统一执行 → 结果回灌 → 续推;最后一轮强制不带 tools 逼出最终文本。
- **capability registry 已注册 4 个真能力**(`capability.rs:177-180`):`DataQuery`(query_data)、`ShowWidget`、`LongTermMemory`、`DocContext`(RAG-over-docs)。`Kind` 枚举含 Tool/Retriever/Memory/…/**Destructive**。
- **红线在循环里已强制**:
  - **D3 三层闸**:`tool_schemas` 里 `query_data` 的 `collection.enum` **运行时裁剪为当前 AI 可读集**;`QUERYABLE` 静态硬底(profile/messages/settings/secrets 永不在内)。
  - **破坏性护栏**:`invoke_raw` 对 `Permission::Destructive` **直接拒绝自动执行**(capability.rs:236-238),必须走护栏(预览+确认+撤销)。
  - **show_widget 沙箱**:不可信 HTML 经 sanitize + iframe。

**缺口在前端与应用契约层**:① 前端核心流程走 mock 不走真循环;② 应用(jobseek)的业务能力没暴露成 Agent 可调工具;③ 没有 Skills/Connector/Tasks 的能力**管理面**;④ 两个 AI 面板没收敛。

---

## 3. 三期分期(业务优先 · 每期可独立演示 + 外审)

### P0 · 工具循环落地 + Agent 窗口收敛为一 **(地基,先做)**

1. **单一 AI 面**:`#agentChat` 与 `#copPanel` **收敛为一个 Agent 窗口**。取向:左对话 + 右画布(canvas,按需出现,承载 show_widget / 卡片 / 表单);删「编辑器」模式或降为画布的一种视图。⌘K 唤起、Esc 逐层退。
2. **前端真接工具循环**:核心问答走 `SeekerRT.ai.stream` → Rust `ai_chat` 工具循环;AI 要查数据/开组件/写记忆时,真的调 `query_data`/`show_widget`/`memory`,而非 mock。
3. **应用能力 → 工具契约**:新增 `manifest.tools`(见 §4),让应用把自己的动作声明为 Agent 可调工具;平台把它们注册进能力层(或经前端工具桥),Agent 窗口即可调用。
4. **/命令面板 → 工具/Skills 的快捷**:现有 `AGENT_CMDS` 升级为「可执行工具的快捷入口」,不再是「发一句预设文本」。

**完成态**:一个 Agent 窗口能查数据、开组件、跳页、调应用动作;破坏性动作弹护栏。可演示「用一句话完成一件事」。

### P1 · 能力中心(用户点名的 2026 真需求)

数据资产应用重构为 **「能力中心」**:统一管理 —— **Skills · Connector(MCP)· Project · Scheduled tasks · 记忆 · 知识库(RAG)**。每类是能力层的一种 `Kind`,管理面 = 列表 + 开关 + 授权 + per-item 配置。Connector(MCP)最薄(Rust `mcp.rs` 已有 McpManager),先落。

### P2 · 首个应用真化 + 数据资产迁移

1. **jobseek 真化**:8 处 `aiRun` 演出 → 真工具调用(匹配/缺口/市场价值都变成 Agent 用 `query_data` + 业务工具算出来的真结果)。
2. **笔记 → 记忆/知识库**:砍独立笔记页;「记下来」成为 Agent 动作(写 `LongTermMemory` 或知识库集合),在能力中心可查可删。**不与 Obsidian/Notion 竞争** —— 定位是「Agent 的长期上下文」。
3. **Prompt 库 → Skills**:现有 prompts 数据迁为 Skill 雏形(名称 + 提示词,后续可绑工具/触发);在能力中心管理,Agent 直接调用。**从「人肉复制的文本」变「可执行技能」。**

---

## 4. 工具契约草案(P0 核心 · 约束② 必审)

应用把业务动作声明为 Agent 可调工具。两条路线,倾向 **A**:

- **A(前端工具桥,推荐先行)**:新增 `manifest.tools?: () => ToolSpec[]`,`ToolSpec = { name, description, inputSchema(JSON Schema), run(input): Promise<Output>, destructive?: boolean }`。平台把启用应用的 tools 汇总(汇总型契约,同 cards),在工具循环里作为「前端工具」暴露给模型;模型调用时前端执行 `run`。**破坏性 tool 一律走 `platform/guardrail`(收规格不收执行,复用 widgetActions 先例)。**
- **B(下沉 Rust Capability)**:应用工具实现为 Rust `Capability` —— 更统一但应用不能用 JS 写工具、成本高。留后。

**红线映射(全部已有机制,不新造)**:
| 红线 | 落点 |
|---|---|
| profile 永不入工具 | `QUERYABLE` 静态硬底(profile 不在内)+ profile 仓库无「导出给 AI」方法 |
| 应用数据 AI 可读 | D3 三层闸(启用 ∩ manifest aiReadable ∩ 用户授权),`query_data` enum 运行时裁剪 |
| 破坏性动作 | `Destructive` 工具循环拒绝自动执行 → `platform/guardrail`(预览+确认+撤销) |
| 设置不可经对话改 | 设置类工具不注册;Agent 只能「引导去设置页」 |
| 不可信 UI | show_widget:iframe sandbox + srcDoc CSP + 父窗口零信任 |
| 工具参数 → DOM | 沿用 cEsc / 契约类型注释固化(同 greeting/widgetActions 先例) |

---

## 5. Agent 窗口信息架构(P0 · 收敛后的样子)

```
┌────────────── Agent 窗口(唯一 AI 面)──────────────┐
│  对话流(左)                    │  画布 canvas(右,按需)  │
│  · 用户 / Agent 消息            │  · show_widget 沙箱组件   │
│  · 工具调用可见(调了什么/结果) │  · 卡片(match/plan…)     │
│  · 破坏性动作 → 护栏卡          │  · 表单 / 预览            │
│  ────────────────────────────  │                          │
│  输入框 + / 命令(= 工具/Skills)│  上下文来源(RAG 命中可见)│
└─────────────────────────────────────────────────────┘
   ⌘K 唤起 · Esc 逐层退 · 附件/@提及数据源
```

原则:**任何功能都有「在对话里做」的路径**;页面/按钮是对话的补充视图,不是唯一入口。工具调用**对用户可见**(信任 + 可审计)。

---

## 6. 不变的红线(任何期都守 · 见 CLAUDE.md §4)

本地优先 · profile 硬隔离 · D3 静态 QUERYABLE 硬底(勿改动态)· 破坏性预览+确认+撤销 · 设置不可经对话改 · show_widget 沙箱 · 不可信内容转义+Untrusted 标注 · platform/apps 物理分离只靠契约。

---

## 7. 待裁定(动工前需你拍板)

1. **P0 三件事的先后**:窗口收敛 / 前端接真循环 / manifest.tools —— 建议先「窗口收敛」(纯前端、可独立演示)再「接真循环」。
2. **工具契约走 A(前端桥)还是 B(下沉 Rust)** —— 建议 A 先行。
3. **「编辑器」模式**:删掉,还是保留为画布的一种视图?
4. **assets → 能力中心**:是原地重构 assets,还是新应用 `capabilities`(assets 关掉、数据保留)?

> 过审 + 拍板后:P0 起刀,仍走「一刀一 commit、一轮送审、真机金标准」的既有节奏。
