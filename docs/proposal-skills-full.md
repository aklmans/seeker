# 方案 · Skills 完整版(工具 scoping · 最小权限)

> 承 proposal-skills.md §5「Skill 绑工具」+ 第88轮次序(Skills 完整版)。用户拍板方向 = **工具 scoping**。
> **★先量再改**(第 N 次):写方案前先量,推翻了 §5 的「绑工具 = 加入工具表」premise。

---

## 0. 一句话

**Skill 声明 `tools:[app-tool]` ⇒ 运行时把工具表「限定」到「平台能力 + 仅声明的 app-tool」**(排除其他 app-tool)——
**从「加入」翻转为「限定」= 最小权限**(一个 Skill 不该有多余能力)。**未声明 = 默认全工具(雏形行为不变)。**

---

## 1. ★先量事实(推翻 §5 premise)

- **proposal-skills.md §5 假设**:「Skill 绑工具 = 运行时工具表 **∪** 绑定的 app-tool」(加入)。
- **读码量清 = 空操作**:runSkill → `agentSend(prompt)` → `streamReply`([ai-engine.js:51](web/platform/shell/ai-engine.js#L51))→ `rt.ai.stream({ userText, appTools: readableAppTools() })` —— **prompt-only Skill 运行时,ai_chat 的工具表已含全部可读 app-tool**(`filterReadableTools(SeekerShell.appTools(), aiReadableCollections())`)。「∪ 绑定」是 no-op(工具本就在表里)。
- ⇒ **完整版的真实价值不是「加入」而是「限定」**:声明工具 = 把这个 Skill 能用的 app-tool **收窄**到声明集 = **最小权限**。安全/可预测(「市场价值报告」Skill 只用 market_value、不误触其他工具)。

---

## 2. 设计(scoping)

- **契约**:`Skill.tools?: string[]`(声明的 app-tool 名;可选)。
- **运行时**:`runSkill(skill)` —— 若 `skill.tools` 声明 ⇒ 把**作用域**穿过 `agentSend(prompt, {scopeTools: skill.tools})` → `streamReply` → **过滤** `readableAppTools()` 到 `∩ scopeTools`;未声明 ⇒ 不过滤(全工具、雏形不变)。
- **工具表构成(兑现评审盯点①「平台工具 ∪ Skill 绑定」)**:
  - **平台 Rust 能力**(query_data / show_widget / memory / doc)—— **恒在**(ai_chat 结构内,非前端 app-tool,scoping 不动它们);
  - **app-tool**(前端 appTools)—— 限定为 `readable ∩ scopeTools`(声明集)。
- **★结构性收窄、不旁路**(评审盯点①):scoping 只是把 appTools 列表**取子集**(⊆ readable),每个 app-tool 仍走 T0–T3 全管线(D3 取数 / iframe 隔离 compute / projectToSchema+框定);且 ai_chat dispatch 已 `app_tool_names.contains(call.name)`([ai.rs](src-tauri/src/ai.rs))—— **模型调未传入的工具不匹配、不执行** ⇒ 声明外的 app-tool 结构性够不到。**scoping 减权、绝不增权,红线全继承。**
- **管理 UI**(能力中心 Skills 段):Skill 编辑加「限定此 Skill 可用的工具」开关 + 「可用工具」多选(从 `SeekerShell.appTools()` 列)。**三态(严格同 §5.2,勿写反)**:开关**未勾** = `undefined`(不限定 = 全工具、雏形零回归)/ 勾 + **选定** = `['x']` / 勾 + **全不选** = `[]`(**无 app-tool**,非全工具)。工具名进 DOM 走 cEsc。**★注意**:`[]` = 无 app-tool 是**最小权限**;绝不可解读成「空 = 全」——那会把最小权限反转成提权(第91轮 [建议] 修正的反转残留)。

---

## 3. 信任(承第79轮 [建议]1)

- **本地自撰 = 可信**:Skill(prompt + tools 声明)是用户亲手写 ⇒ 可信侧(同雏形)。scoping **减权**故不引入新信任风险。
- **★导入/分享仍是改信任模型的功能**(第79轮 [建议]1):导入的 Skill 是第三方指令 ⇒ **untrusted-until-reviewed**(首次运行知情审阅);**本完整版仍只做本地自撰、无导入**,导入留后续单出。
- **platform 对 apps 零 import**(评审盯点③):Skill 绑 app-tool **靠 registry 按名查**(`SeekerShell.appTools()` 找声明的名),**非 import**;同能力中心先例。scopeTools 是字符串名、不是模块引用。

---

## 4. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **F1 · 契约 + scoping 运行时** | `Skill.tools?` 类型 + runSkill 穿 scopeTools + agentSend/streamReply 过滤 appTools。**无 UI(先立机制)**。 | 声明工具 → 工具表限定(preview:scoped Skill 只见声明工具、平台能力恒在);未声明 → 全工具;红线继承(收窄非旁路) |
| **F2 · 管理 UI** | 能力中心 Skills 编辑加「可用工具」多选(SeekerShell.appTools() 列);tools 存 platform_skills。 | 用户可声明/改工具;工具名 cEsc;管理不经对话 |
| **(后续)· 导入/分享** | Skill 分享导入 = 改信任模型 ⇒ 导入=untrusted-until-reviewed(第79轮 [建议]1)。非本方案。 | 导入首次运行知情审阅 |

推荐 **F1 先行**(立 scoping 机制 + 红线继承验证,零 UI)。

---

## 5. 三未决 · 用户拍板

1. **未声明 tools 默认 = 全工具(雏形不变)** ✅ —— `undefined`(未声明,含所有现有雏形 Skill)= 全部可读 app-tool(同 runSkill=用户打字重放的全工具语义)。scoping 是 **opt-in 收窄**;零回归(现有雏形行为不变)。
2. **scopeTools `[]`(声明了但空)= 无 app-tool** ✅ —— 显式声明空 = 「我不要任何 app-tool」(只平台 Rust 能力);区别于 `undefined`(未声明=全工具)。⇒ **三态**:`undefined`=全 / `[]`=无 app-tool / `['x']`=仅 x。
3. **工具列表来源 = `SeekerShell.appTools()`** ✅ —— F2 管理 UI 从既有 app-tool 契约并集列(当前仅 jobseek_market_value;§1 契约、非硬编码名)。

**★三态语义须 F1 逐条测**(`undefined`/`[]`/`['x']` 各产什么工具表 + 结构性够不到声明外)。

---

## 6. 诚实边界

- 本文**未落一行码**;§2 机制落码时可能被载序/信任事实推翻——先量再改(本方案 §1 已是一次)。
- scoping 减权、红线全继承 —— 但「红线继承」须 F1 **逐条验**(收窄后 D3/profile/guardrail 仍在、声明外工具够不到),真模块导出 + 双向阳性对照,别只声明。
- 端到端真模型需 BYO;preview 以 stub 验工具表限定 + 结构性够不到。
