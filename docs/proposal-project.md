# 方案 · Project(目标工作区 · 对话分组 + 项目指令 + 上下文隔离)

> 最后一件能力中心绿地(proposal-p1-capability-center §4「纯绿地、单出方案」)。
> 用户拍板语义(第94轮):**Project = 目标工作区** —— 类 Claude Projects:对话按项目分组 + 项目内定制指令/资料。
> **★先量再改**:写方案前量了六条(§1);其中一条挖出**存量死功能**(多轮历史从未生效),Project 恰好一举修活它。

---

## 0. 一句话

**一个 Project = 一个目标的工作区**:它有自己的**对话线**(消息按项目分组、切换即换线)、自己的**上下文记忆**
(多轮历史按项目隔离——A 项目聊的内容不会漏进 B 项目)、自己的**定制指令**(每次对话自动生效的项目背景)。
默认工作区「日常」承接既有对话(零回归);找完一个目标,项目可归档、数据保留。

---

## 1. ★先量事实(方案的地基)

- **①消息模型弹性**:`{id, surface, role, text, ts, cards?}`(data-store persistMsg)⇒ **+`projectId` 字段零迁移**;`hydrateMessages` 已按 `surface==='agent'` 过滤重渲 ⇒ **按 projectId 过滤 = 同一模式扩一维**。
- **②★存量死功能(本次先量最大发现)**:Rust `History = HashMap<sessionId, Vec>`(ai.rs:70,**已按 key 键控**、HISTORY_MAX 20 封顶、"持久化跨重启待 messages 接入")—— 但 **desktop.js `req.sessionId || genSessionId()`,前端全仓无一处传 sessionId** ⇒ 每次 agentSend = 新 id = `prior` 恒空 ⇒ **「多轮历史 #1 G2」从未生效**(写入后无人以同 key 读、写完即孤儿;真机表现 = Agent 每轮失忆)。
- **③⇒ Project 的核心机制免费**:把 `sessionId` 稳定化为**当前项目 id**(前端一处传参)⇒ **一举两得**:修活多轮历史(同项目内 Agent 记得前文)+ **per-project 上下文隔离天然成立**(History 本就按 key 隔离,切项目=换 key,**Rust 零改**)。
- **④项目指令不能走 `task`**:prompts.rs task 是**受约束查表键、绝不插值**(结构纪律)⇒ 用户自撰的项目指令须另走通路(§3,两候选拍板)。
- **⑤新集合 `platform_projects`**:三处白名单 + **DB_VERSION 4→5**(S1b 教训);**不进 QUERYABLE**——项目指令的生效方式是**注入当前会话**(功能本身),不是让模型 query_data 挖所有项目的配置(不需要、不给)。
- **⑥能力中心 cc-soon 占位就绪**;Agent 窗口 chrome(切换器)是新 UI 面。

---

## 2. 信任 / 红线

- **项目指令 = 用户自撰 = 可信**(同 Skill prompt / 用户打字,S2 先例):以用户身份进上下文、**不走 untrusted 框定**;**未来若做项目分享/导入,指令即第三方内容,须走 I1 同款 untrusted-until-reviewed**(先钉住,别静默延伸)。
- **项目管理(增删改指令)只在管理 UI**(§4-2「设置不可经对话改」延伸):Agent 不能创建/切换/改写项目——**否则模型可自改「每轮注入的指令」= 自我提示注入通路**(同「AI 不能给自己排任务」一族:自我持续/自我改写类通路一律缺席)。`platform_projects` 不进 QUERYABLE + 无任何可写它的 capability/app-tool(**沿用第95轮 [建议]-强三件套**:守卫测试 + 契约注释 + caps.len 承重)。
- **上下文隔离是产品承诺也是隐私承诺**:A 项目的对话不进 B 项目的模型上下文(History 按 key 隔离结构性保证);**messages 仍不进 QUERYABLE**(AI 不能 query_data 挖任何项目的历史,含当前)。
- **多轮历史激活 = 行为变化,须告知**:此前每轮失忆(死功能),修活后同项目带最近 ~10 轮上下文 ⇒ **token 成本上升**(BYO 自觉:HISTORY_MAX 20 已封顶,文案说明「项目内 Agent 记得最近对话」)。
- **零回归**:既有消息无 projectId → 归**默认工作区**;默认工作区不可删;所有既有流(Skills/Scheduled/命令面板)不感知项目、落当前工作区,行为不变。

---

## 3. 设计

- **数据**:`platform_projects` 记录 `{id, name, instructions, archived:boolean, created_at, updated_at}`(弹性 schema;`normProject` fail-safe 同族)。**当前项目 = 壳态**(shell-state,localStorage 持久;缺省 = 默认工作区 id `''`)。
- **消息分组**:persistMsg 加 projectId(当前项目;默认工作区 = 不写字段,既有数据天然归它);hydrateMessages / 切换重渲按 projectId 过滤。
- **上下文隔离**:streamReply 传 `sessionId = 'proj_' + (当前项目 id || 'default')` ⇒ History 按项目积累/隔离(②③)。**切项目 = 换 key**;删/归档项目 → 该 key 的内存历史一并作废(App 重启本就清空,MVP 不做跨重启历史——ai.rs 注释里的既有边界,如实保留)。
- **项目指令注入(两候选,拍板 §5.2)**:
  - **A(推荐)· `ai_chat` 加可选 `projectInstructions` 参数**:Rust 组装进 messages(system 之后、history 之前,角色 system、前缀「用户设定的项目背景/指令:」)。**每轮注入一次、不入 history**(不随轮数重复膨胀);参数是用户自撰可信文本,与 user_text 同信任级;**不碰 task 查表纪律**。约 15 行 Rust。
  - B · 前端拼进 toAI(aiLangHint 先例、零 Rust):但指令会**进 history 每轮重复**(token 膨胀 + 模型看到 N 份)且污染「user 消息 = 用户原话」语义。列出仅为诚实比较。
- **Agent 窗口切换器**:Agent 顶栏(收起画布按钮旁)加当前项目名下拉:列非归档项目 + 默认工作区 + 「管理项目…」(去能力中心);切换 = 存壳态 + 清空 #agentMsgs + hydrateMessages(projectId) + agentGreet(空线时)。
- **管理面**(能力中心 PROJECT 段,同 Skills/Scheduled 形制):列表(名/指令预览/归档态/该项目消息数)+ 新建/编辑模态(名 + 指令 textarea)+ 归档/还原(**不删消息**,数据保留;归档项目不出现在切换器)+ 删除(guardrail:项目消息**批量**属「清空/批量」档,预览+确认+可撤销;或 MVP 只给归档不给删,拍板 §5.4)。
- **Skills / Scheduled 交互**:runSkill 产出落**当前项目**(它走 agentSend,天然带当前 projectId,零改);scheduled fire 同(落 fire 时的当前项目——诚实文案标注)。

---

## 4. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **PJ1 · 契约 + 存储 + 管理面** | platform_projects(三处 + DB_VERSION 4→5 + ∉QUERYABLE 守卫三件套)+ project-model(normProject,零 import)+ project-store + 能力中心 PROJECT 段(新建/编辑/归档;删除按 §5.4 拍板)。**无切换器**(先立数据面)。 | 守卫测试能红;normProject fail-safe node 测;管理面 CRUD;既有行为零回归 |
| **PJ2 · 切换器 + 对话分组 + 上下文隔离** | 壳态 currentProject + Agent 顶栏切换器 + persistMsg/hydrateMessages 带 projectId + **streamReply 传稳定 sessionId(修活多轮历史)**。 | 切换重渲正确(A 线消息不出现在 B 线);**★上下文隔离活证**(spy:同项目第二轮 prior 含第一轮、切项目 prior 空);既有消息归默认工作区零回归;多轮历史激活的行为变化在文案/送审明示 |
| **PJ3 · 项目指令注入** | 按 §5.2 拍板落(推荐 A:ai_chat 可选参数、Rust 组装、不入 history)。 | 指令进上下文活证(spy/单测:messages 含注入、位置对、不随轮重复);task 纪律不破;指令=可信侧、管理不经对话 |

---

## 5. 未决 · 用户拍板

1. **切换器位置**:①**Agent 顶栏下拉**(推荐:对话的属性放对话旁)②侧栏导航组。
2. **指令注入通路**:①**A · ai_chat 可选参数**(推荐:每轮一次不入 history、语义干净;~15 行 Rust)②B · 前端拼 userText(零 Rust 但每轮重复入 history)。
3. **默认工作区命名**:①**「日常」**(推荐)②「收件箱」③不命名(下拉里显示「默认」)。
4. **项目删除档位**:①**MVP 只归档不删**(推荐:数据保留原则最简落法;真删后续按 guardrail 批量档单出)②给删(guardrail 批量档:预览+确认+快照撤销)。
5. **多轮历史激活范围**:①**随 PJ2 全局激活**(推荐:修活死功能,默认工作区也受益;HISTORY_MAX 20 封顶)②仅项目内激活、默认工作区维持失忆(维持现状但语义怪)。

---

## 6. 诚实边界

- **历史跨重启不续**(Rust History 进程内存;ai.rs 既有边界注释如实保留):重启后项目对话**显示**完整(messages 持久)但模型上下文从零开始。跨重启模型历史 = 后续单出(从 messages 重建 prior,有 token/隐私取舍)。
- **知识库/记忆不按项目隔离**(MVP):召回仍全局。per-project 资料域 = 另一个方案(触 doc/memory 模型),本方案不做、不假装。
- **多轮历史激活是行为变化**:token 成本上升(封顶 20 条),送审/文案明示;它是修活既有设计(#1 G2)而非新权力。
- 本文未落一行码;§3 落码时可能被载序/state 事实推翻——先量再改(§1 已量六条,含一条死功能翻案)。
