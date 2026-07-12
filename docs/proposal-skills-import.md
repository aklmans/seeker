# 方案 · Skills 导入/分享(untrusted-until-reviewed · 信任模型升级)

> 承 proposal-skills-full.md §4「(后续)· 导入/分享 = 改信任模型」+ 第79轮 [建议]1 + 第90/91轮排序注记
> (「scoping 真价值锚在安全导入」)。**用户拍板方向 = 起导入方案(F1+F2 收官后)。**
> **★先量再改**:写方案前先量,四条已量清(见 §1),避免空中楼阁 premise(同 §5 先量翻案教训)。

---

## 0. 一句话

**Skill 可导入(第三方分享)** —— 但导入的 Skill 是**第三方指令、默认不可信**:导入即置 `imported:true, reviewed:false`,
**未审阅不可运行**;用户经**知情审阅门**(摊 prompt 全文 + 声明的 tools scope,标注 Untrusted)显式认可后 `reviewed:true`,
此后运行同本地自撰。**这是「untrusted-until-reviewed」:审阅是信任转移点、不是给新权力。**

---

## 1. ★先量事实(方案落在实底上)

- **①F1 已保证导入 tools 减权 ⇒ 导入无需新 tools 强制机制**:运行时 `scopeAppTools(readableAppTools(), skill.tools)` 结果**恒 ⊆ readable ⊆ D3**([readable.js](web/platform/capability/app-tools/readable.js));导入 Skill 即便声明 `tools:['profile_dump','secrets_read']`,运行时也**结构性够不到**(第90轮坐实)。**导入不改 tools 侧安全,F1 已 airtight。**
- **②platform_skills 弹性 schema(`id,updated_at,data_json`)⇒ `imported`/`reviewed` 字段零迁移**([data.rs:113](src-tauri/src/data.rs))。normSkill 扩两 bool 字段(fail-safe 默认)、同弹性 schema「加字段改 JSON 不写迁移」纪律。
- **③审阅门挂点已知**:`runSkill`([copilot-chrome.js:83](web/platform/shell/copilot-chrome.js))`skillRunnable` 守卫旁加「未审阅拒运行」;命令面板 `platformSkills()`([:95](web/platform/shell/copilot-chrome.js))`.filter(skillRunnable)` 同点收口(未审阅不入可运行面板)。
- **④知情审阅最贴先例 = notes→知识库知情同意闸**([notes.js](web/apps/assets/pages/notes.js)):信任升级、模态说清后果、**fail-closed(状态未知拒绝行动)**;**非** S3 prompts→Skills 知情通知(那是不扩大 AI 可读的纯通知)。导入 Skill 比 notes **更强**(可执行指令、非数据)⇒ 审阅须摊 **prompt 全文**(标 Untrusted)+ 声明 tools。

---

## 2. 核心信任模型转变(方案的「为什么」)

- **本地自撰 Skill = 可信**:用户亲手写 prompt ⇒ runSkill = `agentSend(skill.prompt)` = **用户打字重放**,红线(D3/profile/guardrail/设置不可经对话改)**结构性继承**(第81轮:「不给新权力=结构结论」)。
- **★导入 Skill = 第三方指令 = 不可信** —— 关键转变:第三方写的 prompt 若直接当「用户消息」发给 ai_chat,就是**让第三方的文字以用户身份驱动 Agent**。
  - **硬红线结构性不破**(先厘清、别过度设计):D3 取数闸 / profile 不可读 / guardrail 破坏性确认 / 设置不可经对话改,**不管消息来源都拦**(第三方 prompt 同用户打字一样绕不过)⇒ 导入 Skill **不会**突破这些。
  - **★新增风险 = 第三方 prompt 的「意图操纵」**(硬红线**内**的):第三方可写个 prompt 让 Agent 做**用户没意识到**的事(硬红线允许范围内)—— 如诱导性查询/展示、以用户口吻的误导。这**不违反**硬红线,但用户导入时可能没读懂 prompt 在干嘛。
  - **⇒ 审阅门堵的正是「意图操纵」**:摊开 prompt 全文让用户**读懂这个第三方指令会让 Agent 干什么**、显式认可。**审阅 ≠ 给新权力**(tools 仍 F1 减权、硬红线仍在);**审阅 = 用户对「这段第三方指令的意图」知情并背书**。审阅后它转为「用户认可的指令」,此后同本地自撰。

---

## 3. 设计

- **契约(扩 Skill / NormSkill)**:`imported?: boolean`(第三方来源)+ `reviewed?: boolean`(用户已审阅背书)。normSkill fail-safe 默认(缺失→本地自撰语义:`imported:false, reviewed:true`——**保守默认必须是「本地可信」不塌成「导入未审」**,否则既有本地 Skill 全变不可运行=回归;**但导入路径显式置 `imported:true, reviewed:false`**)。
- **导入 = 显式不可信**:导入动作置 `imported:true, reviewed:false, tools:<声明>`;**runSkill 守卫**:`imported && !reviewed ⇒ 不运行、引导审阅`(挂 skillRunnable 旁,同草稿态 no-op 先例);命令面板 `platformSkills()` 未审阅**不入可运行面板**(或入但点击触发审阅门)。
- **★知情审阅门(承 notes 同意闸 · fail-closed)**:模态摊开 ——
  - **prompt 全文**(标 **Untrusted**「第三方指令、非你亲写;审阅其意图」、cEsc);
  - **声明的 tools scope**(用户看清这个 Skill 想用哪些工具;**注明运行时仍 ∩ 你的可读集减权**);
  - **说清后果**:「这是他人写的指令,运行时会以**你的身份**驱动 Agent(在红线内)。确认你已读懂并信任它。」;
  - 用户显式「我已审阅、信任并启用」→ `reviewed:true`(**信任转移点**);可「删除」丢弃。
- **审阅后运行**:走正常 `runSkill`(用户已背书 ⇒ 同本地自撰、红线结构性继承、tools F1 减权)。
- **tools scope**:**F1 已强制减权**(§1①),导入**无需新机制**;审阅门只须**呈现** scope 让用户知情(cEsc、注明运行时 ∩ readable)。
- **平台对 apps 零 import**:导入是平台壳能力(能力中心 Skills 段),不碰 apps;导入 Skill 的 tools 声明是**字符串名**(F1 scopeTools 同)、非模块引用。

---

## 4. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **I1 · 契约 + 审阅门 + 导入** | `imported/reviewed` 契约(normSkill 扩、保守默认本地可信)+ runSkill/命令面板未审阅拒运行 + 导入入口(格式见 §5)+ 知情审阅门(摊 prompt/tools、fail-closed)。 | 导入→未审阅**不可运行**(runSkill+命令面板双点证);审阅门摊 prompt 全文(Untrusted)+ tools scope;审阅后可运行(走标准 runSkill、红线继承);既有本地 Skill **零回归**(保守默认可信)。 |
| **I2 · 分享导出** | Skill → 可分享格式(§5 拍板);导出**不含** imported/reviewed 元(导出的是指令本身,接收方重新走审阅)。 | 导出格式可被 I1 导入并触发审阅;导出不泄漏本机隐私(Skill 无 profile 字段)。 |

推荐 **I1 先行**(信任模型 + 审阅门 = 安全核心;分享导出是产出侧、可后)。

---

## 5. 未决 · 用户拍板

1. **导入格式**:①**JSON 文本粘贴**(推荐:最简、本地优先、无网络、同简历粘贴先例)②文件导入(.json)③分享码/URL(引入网络/解析面,与本地优先张力)。**推荐 ① 起步**,②③后续。
2. **审阅粒度**:每枚导入 Skill **逐条审阅**(推荐:Skill 是可执行指令、逐条读懂再启用,同破坏性逐条确认精神)vs 批量导入后逐条审阅。
3. **分享导出(I2)是否本方案**:并入(I1+I2 一方案分两刀)vs 单出(仅导入,分享另议)。**推荐并入**(导入/导出对称、一方案交代完整)。
4. **未审阅 Skill 在命令面板**:①完全不列(推荐:未审阅=不可运行,不该出现在可运行面板)vs ②灰列、点击触发审阅门。

---

## 6. 诚实边界

- 本文**未落一行码**;§3 机制落码时可能被信任/载序事实推翻 —— 先量再改(本方案 §1 已先量四条)。
- **审阅门是「知情」不是「沙箱」**:审阅后第三方 prompt 以用户身份运行(硬红线内);安全边界 = **硬红线(结构性)+ tools F1 减权 + 用户知情背书**,**非**把第三方 prompt 关进沙箱(它本就要驱动 Agent)。这条须 I1 逐条验:审阅门真堵未审阅运行、审阅呈现真实(prompt 全文/真实 tools scope)、保守默认真不回归。
- 与 notes→知识库同意闸同源(信任升级、fail-closed),但**更强**(可执行指令 vs 数据)⇒ 审阅摊 prompt 全文。
