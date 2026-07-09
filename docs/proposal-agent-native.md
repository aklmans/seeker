# 提案 · AI-Native 转向 —— Agent 窗口即入口,一切功能皆工具

> 起草 2026-07-08(真机体验反馈后)。**v2 · 独立评审后修订**(评审代码坐实,抓出契约 A 的 profile/D3 结构性破口 = [应改],已改 B 先行;订正若干事实)。
> 定位级动议,重要性同 `proposal-app-platform.md`。架构「为什么」交叉引用 `../prototypes/AI 网关与 Agent 工具层方案.html`(#1)、`能力层与 Capability 契约方案.html`(#2)。
> **本提案是执行前的方案对齐,过审+拍板后按期分刀;先行,不直接动工。**

---

## 0. 一句话

平台从「**带 AI 的传统工作台**」转「**AI-Native**:Agent 窗口是唯一主入口,任何功能都能在对话里完成 —— 因为任何功能都是一个 Agent 可调的**工具/能力**」。

地基**已建**(Rust 工具循环 + 能力层,见 §2),但**前端分叉**:自由问答早已跑真循环(近完成),核心业务流仍是演出 mock、且**应用能力→工具**这条链需要新造(见 §2/§4)。**P0 = 收窗口 + 通画布 + 用 Rust Capability(路线 B)落头 1–2 个真工具打样**,不含前端工具桥(路线 A,缓,§4)。

---

## 1. 诊断 —— 真机反馈三条,代码坐实(评审订正后)

| 反馈 | 代码事实 | 判定 |
|---|---|---|
| **Agent 窗口很杂** | index.html **两个聊天面板**:`#agentChat`(:913 全屏 aside)+ `#copPanel`(:926 浮窗)+ `#modeSwitch`(:897「Agent / 编辑器」) | 属实。两个重叠 AI 面 + 一个并列模式 |
| **不是 AI-Native** | jobseek 核心流程由 **6 处 `aiRun` 演出 mock** 驱动(match.js:38 / job-actions.js:22 / resume-modals.js:36 / resumes.js:170,319,436;定义 intake-action.js:252 = 假进度步 `setTimeout(360+rand*220)` + 确定性 `resultFn()`) | 属实(计数订正 8→6)。核心流是「按钮+假 AI 演出」 |
| **assets 简陋、需求错位** | `apps/assets` = 201 行(manifest49+notes70+prompts82) | **UI/功能面零连接**成立(notes/prompts 只有 CRUD + `navigator.clipboard.writeText` 人肉复制)。**数据面 D3 通路已铺**:`assets_prompts/assets_notes` 已在 Rust `QUERYABLE` 静态底 + manifest `aiReadable:'default-off'`(默认关)。「重造三方软件弱鸡版」的核心批评成立;真需求是 Skills/Connector/Project/Scheduled tasks 的**管理**,不是存文本 |

---

## 2. 关键洞察 —— 地基已建,但前端分叉(评审核实后)

### 2.1 Rust 侧:比 v1 说的**更强**(判断成立、证据链完整)

- **`run_chat` 完整工具循环 C1-C3**(`ai.rs:372-543`):多轮流式、`tool_calls` 分片累积、`invoke_raw` 统一执行、**破坏性直拒**(capability.rs:237)、show_widget→`ai_widget` 下发(ai.rs:505)、**MCP 走「用户确认→Untrusted 回灌」专路**(ai.rs:548)、末轮强制无 tools 逼出终文本(:444)、重试/退避/取消/历史封顶。
- **capability registry** 注册 4 能力(capability.rs:177-180:DataQuery/ShowWidget/LongTermMemory/DocContext-RAG);**D3 `enum` 运行时裁剪**(:202-211)+ `query_data.invoke` **二次硬拦**(:456)。
- **★事实订正**:`Kind` 枚举实际只有 **Tool / Context / Sink**(capability.rs:26);**`Destructive` 是 `Permission`,不是 `Kind`**(:59)。(此订正影响 §3 P1 成本判断。)

### 2.2 前端侧:两件性质完全不同的事,勿捆绑

**(A) 自由问答 —— 已接真循环(v1 反而低估)**:`streamReply` 已调 `SeekerRT.ai.stream`(ai-engine.js:37)→ `ai_chat`;`onTool/onWidget` 已接;widget 经 `SeekerWidgets.renderWidget` **三墙沙箱**渲染(render.js:149:iframe `allow-scripts`-only + srcDoc CSP `default-src 'none'` + 端口零信任);`mcp_confirm` 由 `initMcpConfirm` 接妥(confirm.js:35)。**Copilot/Agent 问答早已跑在真工具循环上,不是 mock —— 这块 P0 近完成。**
- 但 widget 当前**渲染在对话内联**(`thinkBubble.parentElement`,ai-engine.js:43),**未路由到画布**。画布布局态 `data-agent='split'` 已有(copilot-chrome.js:127)。故 §5「右画布」= 收敛两面板 + 把 show_widget 输出**改投画布**,**中等前端工作量,非从零**。

**(B) 应用能力 → 工具 —— 这是新造的跨界协议(v1 严重低估)**:
- `ai_chat` 签名是 `(session_id, user_text, task)`(ai.rs:203)——**没有 frontend tools 参数**;命令清单无 `frontend_tool_resolve` 之类(lib.rs:40)。循环内**非 MCP 工具一律 `registry.invoke_raw` 在 Rust 内执行**(ai.rs:502)。
- **循环里根本没有「派发给前端执行 `run()` 再把结果喂回」的机制**。MCP 专路只回传**批准 bool**、执行仍在 Rust;widget 的 `seeker.action`→`onAction`→guardrail 是**意图上抛**、非循环级工具执行。二者都不能充当前端工具桥的执行回路。
- 故**路线 A(前端工具桥)需新造**:① `ai_chat` 加参数携带前端工具 schema;② 一套「Rust emit 工具调用 → 按 call_id park 在 oneshot → 前端跑 `run()` → 新命令 `frontend_tool_resolve` → 续推」往返原语(镜像 `mcp_confirm_and_call` 但回传**任意结果载荷**);③ 超时/取消/错误整合。**这是新跨界协议,不是「接上已建循环」。**

---

## 3. 三期分期(评审重排后 · 业务优先 · 每期可独立演示+外审)

### P0 · Agent 窗口收敛 + show_widget 投画布 + 用 B 落 1–2 真工具 **(地基,先做)**

1. **单一 AI 面**:`#agentChat` 与 `#copPanel` **收敛为一个 Agent 窗口**(左对话 + 右画布 canvas);**删「Agent / 编辑器」并列模式切换**、页面降为画布/导航视图(见 §7.3)。⌘K 唤起、Esc 逐层退。
2. **show_widget 输出路由到画布**:从对话内联改投右画布(§2.2 已分析 = 中等)。
3. **用路线 B 落头 1–2 个 jobseek 真工具打样**(match / gap / market-value 之一):实现为 **Rust Capability**(§4)——零新循环管道、复用破坏性闸口 + D3 + profile-free `CallCx`、红线零新破口。可演示「一句话完成一件事」。
> Q&A 真循环已基本完成(§2.2A),**不单列**;前端工具桥(路线 A)**移出 P0 主线**(§4)。

### P1 · 能力中心(用户点名的 2026 真需求 · **多为绿地,勿套「已建」光环**)

统一管理 **Skills · Connector(MCP)· Project · Scheduled tasks · 记忆 · 知识库(RAG)**。
- **归属订正(§1 铁律)**:能力**管理 UI** 是**平台/壳管理面**(同应用管理页),归 `platform/`,**不塞进 `apps/`**(否则违反「apps=业务、platform=业务无关」)。
- **成本真相**:Connector(MCP)最薄——`mcp.rs`(1669 行)+ 设置页确已建,**先落**。但 **Skills/Project/Scheduled 后端零基础**(`Kind` 仅 Tool/Context/Sink,`Sink` 尚 dead_code;registry 未注册这些;Scheduled 无任何 backend)= **全绿地**。别把 MCP 的「已建」外溢到它们。

### P2 · 首个应用真化 + 数据资产迁移退役

1. **jobseek 真化**:6 处 `aiRun` 演出 → 真工具(match/gap/market-value 用 `query_data` + 业务工具算真结果)。
2. **笔记 → 记忆/知识库**:「记下来」成为 Agent 动作(写 `LongTermMemory` / 知识库集合),能力中心可查可删。**不与 Obsidian/Notion 竞争** —— 定位「Agent 的长期上下文」。
3. **Prompt 库 → Skills**:prompts 数据迁为 Skill 雏形(名称+提示词,后续绑工具/触发);能力中心管理、Agent 直接调用。**从「人肉复制的文本」变「可执行技能」。**
4. **assets 应用退役(数据迁移)**:notes/prompts 数据迁入平台能力后,assets 应用关掉(数据保留)。见 §7.4。

---

## 4. 工具契约 —— **路线 B 先行(评审 [应改] 已采纳)**

### ★为何 B 先行、A 缓:A 开了 profile + D3 两个结构性破口

- **今天 profile 硬隔离与 D3 三层闸的强制点是 Rust 结构性闸口**:profile 不在 `QUERYABLE`、`query_data.invoke` 结构上拿不到 profile 表、D3 在 `invoke` 内二次校验可读集(capability.rs:456)。红线#2 明文要求「**非仅提示层**」。
- **路线 A 的破口**:`manifest.tools[].run(input)` 在**前端 JS 执行**,结果作为 tool message **直接喂回模型**,**完全绕过 `invoke_raw`/`query_data`**;而前端**能读 profile**(`SeekerRT.profile.getAll()` 运行时全局,profile.js:18 / 命令 profile_get_all)。于是存在新链路:某 app 的 `run()` → 读 `rt.profile.getAll()`(或读 D3 未授权/`aiReadable` 关闭的集合)→ 回灌模型。**profile「AI 永不读」与 D3「启用∩manifest∩授权」这两条今天由 Rust 结构性保证的红线,在 A 下被前端旁路。** v1 §4「全部已有机制、不新造」——只覆盖 query_data、不覆盖任意 `run()`,对 A **不成立**。
- **路线 B 无此问题**:工具 = **Rust Capability**,走同一 `invoke_raw`,`CallCx` 结构上无 profile,纳入同一 `QUERYABLE`/`Permission` 纪律,破坏性直拒自然覆盖。

### 取向裁定
- **B 先行 / 混合**:头 1–2 个 jobseek 工具先实现为 Rust Capability(最省、最快演示、红线零新破口)。
- **★路线 B 封顶一枚(评审第51轮 [建议]2 · 防打样蔓延)**:Rust 侧无 `apps/` 概念,`src-tauri/src/jobseek.rs` 是**唯一许可的路线 B 打样**;**app-tool 契约落地前,不新增 `src-tauri/src/<app>.rs` 应用工具**。否则第二个应用照此加 Rust 工具,打样会静默变事实模式、§1「platform 业务无关」债累积。第二枚起必须等契约。
- **★呈现留前端(评审第51轮 [建议]1 · 红线#6 债)**:打样工具在 Rust 里生成 HTML 文案 = **中文硬编码、无双语**(触红线#6),根因是 locale 为前端态(`localStorage 'jh-lang'`)、Rust 够不到。**正式 app-tool 契约须让工具只回结构化数据、呈现(含 i18n)回前端 `tt()`**(或经上下文传 locale)。此即「呈现该留前端」的又一佐证——打样阶段记债,契约落地即消。
- **A(前端工具桥)推迟**到某 app 确实需要 JS 自写工具时再建,**且届时 A 必须配一条新红线强制**:前端工具在**无 profile 访问的受限上下文**执行 + 结果经平台校验;`ai_chat` 契约扩展 + 往返原语 + profile/D3 前端强制**各自独立送审**(隐私/破坏性基元加倍审)。
- **破坏性部分**「收规格不收执行、复用 widgetActions 先例」**A/B 都成立**(guardrail 是前端破坏性的正典闸口)。

### 红线映射(B 路线 · 全部复用已有机制)
| 红线 | 落点 |
|---|---|
| profile 永不入工具 | `CallCx` 结构无 profile;`QUERYABLE` 静态硬底不含 profile |
| 应用数据 AI 可读 | D3 三层闸(`query_data` enum 运行时裁剪 + invoke 内二次硬拦) |
| 破坏性动作 | `Permission::Destructive` 工具循环拒绝自动执行 → `platform/guardrail`(预览+确认+撤销) |
| 设置不可经对话改 | 设置类不注册为工具;Agent 只引导去设置页 |
| 不可信 UI | show_widget:三墙沙箱(iframe + srcDoc CSP + 端口零信任) |
| 外部内容 | MCP 结果 `Untrusted` 回灌专路;进 DOM 转义 |

---

## 5. Agent 窗口信息架构(P0 收敛后)

```
┌────────────── Agent 窗口(唯一 AI 面)──────────────┐
│  对话流(左)                    │  画布 canvas(右,按需)  │
│  · 用户 / Agent 消息            │  · show_widget 三墙沙箱   │
│  · 工具调用可见(调了什么/结果) │  · 卡片(match/plan…)     │
│  · 破坏性动作 → 护栏卡          │  · 表单 / 预览            │
│  ────────────────────────────  │                          │
│  输入框 + / 命令(= 工具/Skills)│  上下文来源(RAG 命中可见)│
└─────────────────────────────────────────────────────┘
   ⌘K 唤起 · Esc 逐层退 · 附件/@提及数据源
```
原则:任何功能都有「在对话里做」的路径;页面/按钮是补充视图非唯一入口;工具调用**对用户可见**(信任+可审计)。画布 `data-agent='split'` 布局态已有;当前 widget 内联,需改投画布。

---

## 6. 不变的红线(任何期都守 · CLAUDE.md §4)

本地优先 · profile 硬隔离 · D3 静态 QUERYABLE 硬底(**勿改动态**)· 破坏性预览+确认+撤销 · 设置不可经对话改 · show_widget 三墙沙箱 · 不可信内容转义+Untrusted 标注 · platform/apps 物理分离只靠契约。

---

## 7. 待拍板(动工前需你拍板 · 附评审预裁)

1. **P0 三事先后** —— 预裁:① 窗口收敛(纯前端、低危、独立演示)→ ② show_widget 投画布 → ③ 用 **B** 落 1–2 真工具。Q&A 真循环已基本完成不单列;manifest.tools(A)移出 P0。
2. **工具契约 A / B** —— **[应改] 采纳:B 先行 / 混合,A 缓**(A「更省」是误判、「无新破口」不成立,见 §4)。
3. **「编辑器」模式** —— 预裁 **删**:`appMode` 默认 `'editor'`(copilot-chrome.js:110)非富文本编辑器,是**传统页面工作台视图**;删的是「Agent / 页面工作台」并列模式切换(:116),让 Agent 成默认框、页面降画布/导航视图。低危纯前端。
4. **assets → 能力中心归属** —— 预裁 **拆两半**:(a) 能力**管理 UI** 归 `platform/`(壳管理面,**非 app**,否则违 §1);(b) assets 的 notes/prompts **数据**迁入平台能力(记忆/知识库/Skills),assets 应用**退役(数据迁移)**而非「重构成能力中心」。**建议 P1 起时单独出一页小方案再拍**(范围克制,文档未覆盖)。

> 过审 + 拍板后:P0 起刀,仍走「一刀一 commit、一轮送审、真机金标准」既有节奏。
