# 方案 · Prompt 库 → Skills(可执行技能)

> 承评审第76/77轮次序(app-tool 契约 T0–T3 落地后解锁;Skills 契约方案是「更大的已解锁 P2」)。
> 上游愿景:[proposal-agent-native.md](proposal-agent-native.md) P1 能力中心 + P2.3「Prompt 库→Skills」+ P2.4「assets 退役」。
> **契约优先(§6)· 先量再改**(智能匹配教训:连自己方案的 premise 也先量)。

---

## 0. 一句话

把 `assets_prompts`(名称+文本、`navigator.clipboard.writeText` **人肉复制**)升级为 **Skill(可执行技能)**:
**用户自撰的具名指令**,进 Agent 命令面板、**一点即运行**(Agent 用该指令跑一轮),平台**能力中心**管理;
迁移完成后 assets 应用退役(数据保留)。**从「人肉复制的文本」变「可执行技能」。**

---

## 1. 事实基础(量出来的)

- **prompts 现状**:`apps/assets/pages/prompts.js`(82 行)—— CRUD(新建/编辑/删)+ **复制**(`navigator.clipboard.writeText`,prompts.js:48)。数据 `assets_prompts`(D3 静态底 + manifest `aiReadable:'default-off'`)。**功能面零连接**:只能复制到剪贴板、人肉粘进对话。
- **能力中心现状**:P1-a 已建(`platform/shell/capability-center.js`)= **平台管理面**(归 platform,§1 铁律:管理 UI 非业务)。
- **Skills 后端**:**全绿地**(`Kind` 仅 Tool/Context/Sink;registry 未注册 Skill;无 Skill backend)—— 别套 MCP「已建」光环。
- **Agent 命令面板先例**:jobseek `manifest.appCommands()` → `SeekerShell.appCommands()` 并集 → Agent chrome 渲染(可执行斜杠命令的现成机制)。
- **真化件先例**:`ai_generate`(无工具)/ `ai_chat`(带工具循环)—— Skill 运行 = 用其指令跑一轮。

---

## 2. 什么是 Skill(雏形 vs 完整)

**雏形(本方案主体)= 用户自撰的可执行具名指令**:

```ts
interface Skill {
  id: string;
  name: string;          // 面板显示名(如「把 JD 拆成硬性/软性要求」)
  description?: string;  // 一句话(可选)
  prompt: string;        // 用户自撰的指令正文(运行时作为 instruction)
  // 完整版(后续,非本方案):tools?: string[](绑 app-tool)· trigger?(定时/事件)· reads?(D3 取数)
}
```

- **可执行**:进命令面板;用户点 → Agent **用 `prompt` 跑一轮**(见 §4)。这是 prompts 与 Skills 的唯一本质差别:**prompts 复制到剪贴板、Skills 直接运行。**
- **雏形只做 prompt-only**:绑工具/触发/取数留完整版(那些**建在 app-tool 契约上** —— 这就是「app-tool 是 Skills 地基」的含义:Skill 绑的工具 = app-tool)。

---

## 3. 归属 + 存储(平台能力中心,非 apps)

- **★归属 = platform**(§1 铁律):Skill 是**跨应用的用户能力**(任何应用的 Agent 都能用),管理 UI 是平台管理面 ⇒ **Skill 存储 + 管理归 `platform/`,不塞 apps**。这修正 prompts 当初「塞进 assets 应用」的错位(proposal-agent-native.md 已点名「需求错位」)。
- **存储**:平台 `skills` 集合(骨架列 + `data_json`,同弹性 schema)。**★不进 `QUERYABLE`**——Skill 是**用户指令**、非「AI 检索的数据」(与 prompts 当初的 `aiReadable` 数据语料用例分开;AI-引用留完整版、显式 opt-in)。
- **迁移**:`assets_prompts`(名称+文本)→ 平台 `skills`(名称+prompt)。**知情**(数据从应用搬到平台能力,同 notes→知识库的知情同意纪律),幂等、原数据保留。

---

## 4. 调用 + 信任

- **调用**:Skill 进命令面板(`SeekerShell` 新契约 `platformSkills()` 或复用 appCommands 汇入);用户点 → Agent 以 `skill.prompt` 为 **instruction 跑一轮**(`ai_chat` 带工具循环,或 `ai_generate` 无工具——**取决于雏形是否允许 Skill 调工具**;雏形建议 `ai_chat`,让 Skill 能用平台既有工具如 query_data,但**不新绑 app-tool**)。
- **★信任**:`skill.prompt` 是**用户自撰的指令**(用户亲手写、亲手点运行)⇒ **可信侧**(同用户在对话框打字),**不走 untrusted 框定**。与「面试答案/JD=不可信」区别:那是**待评估的外部/输入数据**,Skill 是**用户自己的指令**。
  - ⚠ **红线守恒**:Skill 运行走 `ai_chat` ⇒ 仍受 `ai_chat` 的全部结构性红线(query_data 的 D3 闸、profile 结构不可达、破坏性走 guardrail)。**Skill 不给用户任何新权力** —— 它只是把用户「本来就能打的指令」存下来一键重放。
- **设置不可经对话改**(§4-2):Skill 的**管理**(增删改)在能力中心 UI,**不经 Agent 对话**(同设置红线)。

---

## 5. 与 app-tool 契约的关系(评审「地基」的含义)

- **雏形(prompt-only)不需要 app-tool** —— 它只是存指令、跑一轮。
- **完整版(Skill 绑工具)建在 app-tool 上**:「这个 Skill 能调 `jobseek_market_value`」= Skill 声明 `tools:['jobseek_market_value']`,运行时 Agent 的工具表 = 平台工具 ∪ Skill 绑定的 app-tool。**app-tool 契约(T0–T3)是 Skill 可执行工具的地基**;没有它,Skill 只能是 prompt。
- **故本方案先落 prompt-only 雏形**(无 app-tool 依赖),绑工具留完整版。

---

## 6. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **S1 · Skill 契约 + 平台存储** | `Skill` 类型 + 平台 `skills` 集合(rt.db,**不进 QUERYABLE**)+ 能力中心「Skills」段(增删改,平台管理面)。**无迁移、无调用**——先立契约与管理面。 | Skill CRUD 在能力中心;不进 D3;设置红线(管理不经对话) |
| **S2 · Skill 可执行(命令面板 + 运行)** | Skill 进命令面板契约;点击 → `ai_chat`(skill.prompt 为 instruction);信任=可信侧、红线守恒。 | 用户点 Skill 即运行;红线不破(D3/profile/guardrail 继承 ai_chat) |
| **S3 · prompts → Skills 迁移** | `assets_prompts` → 平台 `skills`(知情、幂等、原数据留);prompts 页留「已迁入 Skills」提示或转入口。 | 迁移知情+幂等+自愈(同 notes→知识库) |
| **S4 · assets 退役** | notes(→知识库,已完成)+ prompts(→Skills)都迁完 ⇒ assets 应用关闭(数据保留)。 | 关应用=下架 UI+AI,数据保留(D2) |
| **(后续)· Skill 绑工具** | Skill `tools:[app-tool]`,建在 app-tool 契约上。 | 完整版,非本方案 |

---

## 7. 推荐 + 三未决(用户已拍板)

**S1 先行**(立契约 + 平台存储 + 能力中心管理面,零迁移零调用、低风险)。

**三未决 · 用户拍板**:
1. **运行模式 = `ai_chat`(带工具)** ✅ —— Skill 能用平台既有工具(query_data 等),「可执行」更名副实;**红线由 `ai_chat` 结构性守**(D3/profile/guardrail),Skill 不给新权力(只是把用户本就能打的指令一键重放)。**⚠ 承重:S2 落 `ai_chat` 运行时须逐条验红线继承**(query_data 的 D3 闸仍在、profile 结构不可达、破坏性走 guardrail)。
2. **存储 = 新平台 `skills` 集合** ✅(归属清晰:Skill 是平台能力、非 assets 应用数据;迁移是真搬)。
3. **命令面板 = 新契约 `SeekerShell.platformSkills()`** ✅(Skill 是平台级、跨应用;`appCommands` 是应用级,不合并语义 —— 同第64轮别合并两条通道)。

---

## 8. 诚实边界

- 本文**未落一行码**;§6 分期与 §2 契约都可能落码时被事实推翻——先量再改。
- Skill 运行的端到端(真模型)需 BYO;preview 以 stub 验契约面。
- **不与 Notion/Obsidian 竞争**(prompts 当初「重造三方软件弱鸡版」的批评)——Skill 定位「Agent 可执行的用户指令」,不是笔记/文档管理。
