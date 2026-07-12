# 方案 · Scheduled tasks(定时任务 · 无人值守运行的红线设计)

> 承 proposal-p1-capability-center §4「Scheduled = 纯绿地、单出方案」(第53轮)+ 第94轮次序(绿地方案先行)。
> 用户拍板:**Scheduled 先于 Project**(Project=目标工作区语义已对齐,后续单出方案)。
> **★先量再改**:写方案前量清六条(§1);核心结论 = **调度器落前端壳、fire 经 runSkill ⇒ 零新 Rust plumbing、红线全继承**。

---

## 0. 一句话

**到点自动跑一枚 Skill** —— 语义 = 「你预先设定:到那一刻,等于你亲手点了这枚 Skill 的『运行』」。
产出落 Agent 对话(回来就看到);**无人值守 ≠ 新权力**:破坏性依旧只能提议等你确认、未审阅导入件依旧跑不了、AI 依旧不能给自己排任务。

---

## 1. ★先量事实(方案的地基)

- **①Rust 零 scheduler 基建 + ai_chat 只有前端命令**(需 Window 发事件;后台自发起 = 全新 plumbing)⇒ **MVP 调度器落前端壳**(app 开着时计时 due-check),**fire = `runSkill(skill)`(既有结构)** ⇒ **零新 Rust 面**;红线(四红线 + F1 scoping + I1 needsReview 双点拒)**结构性继承**,不是重新实现。
- **②事件驱动 due-check 先例已有**:`auto_backup_if_due`([data.rs:62](src-tauri/src/data.rs))= boot 时查「到期没」而非常驻定时器 —— 同模式:壳 boot 查一次 + 开着时每分钟 tick 查。
- **③Skills 全线可用**(S1-S4/F1-F2/I1-I2 全过审):runSkill 内建 `skillRunnable`(草稿不跑)+ `skillNeedsReview`(导入未审不跑)+ scoping(tools ∩ readable 减权)⇒ **scheduled fire 经 runSkill = 这些守卫免费继承**。
- **④对话 = 单全局线程**(persistMsg 无 thread)⇒ 定时产出**落同一 Agent 对话**(MVP 现实,不造新面板)。
- **⑤`streaming` 是 streamReply 闭包局部、无全局忙标志** ⇒ 「避撞正在飞的流」需一枚极小的壳级忙信号(design detail,§3)。
- **⑥新集合 = `platform_schedules`**:table_for + web COLLECTIONS + **IndexedDB 须升 DB_VERSION(3→4)**(S1b 教训:不升版本 objectStore 不建、只有 preview E2E 能暴露)。**不进 QUERYABLE**(见 §2)。

---

## 2. 信任 / 红线(本方案的设计核心:无人值守运行)

- **运行的授权语义**:设定调度 = **用户预先发起**(「到点重放我这枚 Skill」);fire 经 runSkill = agentSend 用户打字路径 ⇒ **D3 / profile 不可达 / 设置不可经对话改 全部照常**。
- **★破坏性 = 结构性 fail-closed(已有,无需新造)**:模型在任何运行里都**只能提议**(渲染 cAB 确认卡),**用户显式点击才执行**(第57/58轮裁定)。无人值守时**没人点 ⇒ 什么都不执行**,确认卡留在对话里等用户回来。**「预授权确认」结构上不存在,本方案也绝不引入**(那会把「用户显式点击不可伪造」的第58轮闸拆掉)。
- **★★AI 不能给自己排任务(本方案唯一新增红线)**:若 Agent 能创建/修改调度,它就获得**自我持续执行**的通路(排任务→任务再排任务 = 自激励循环、且叠加 BYO 成本)。⇒ `platform_schedules` **不进 QUERYABLE**(AI 不可读)、**调度 CRUD 只在能力中心管理面**(§4-2「不可经对话改」延伸);Agent 只能引导用户去管理面。
- **未审阅导入件不可被调度(双点)**:UI 选择器只列 `skillRunnable && !skillNeedsReview` 的 Skill;且 fire 经 runSkill,其守卫**兜底**(即便存储里的调度指向一枚后来变待审的 Skill——如用户编辑了导入件 prompt 触发 [建议]2 重审——fire 也是 no-op,fail-closed)。
- **BYO 成本可见(反焦虑)**:每次 fire 记 `last_run_at/last_status`;管理面一键停用;**不设激进默认频率**(最密 = 每天一次起步,§5 拍板)。错过不补跑(§5 推荐)= 防「开机风暴」连跑积压任务烧配额。

---

## 3. 设计

- **数据模型**(`platform_schedules`,弹性 schema):`{id, skillId, kind:'daily'|'weekly', time:'HH:MM', dow?:0-6, enabled:boolean, last_run_at?:number, last_status?:'ok'|'error'|'skipped'}`。
- **due 判定 = 零 import 纯函数**(`schedule-model.js`,node 可测):`scheduleDue(sched, lastRunAt, now)` —— 「上次运行之后、最近一个排点已过」;错过多个排点也只算 due 一次(错过不累积)。fail-safe 归一 `normSchedule`(同 normSkill 纪律)。
- **调度器**(`platform/shell/scheduler.js`):壳 boot 起 `setInterval(60s)` tick → 遍历 enabled 调度 → `scheduleDue` → fire。fire 前查壳级忙信号(一枚 module 布尔,streamReply 开/收流时置/清)——**忙则跳过本 tick、下分钟再查**(不排队,简单且防堆积)。fire = 按 skillId 从 skill-store 取 → `runSkill(skill)` → 写回 last_run_at/last_status。
- **管理 UI**(能力中心 Scheduled 段,同 Skills 段形制):列表(Skill 名 / 排点 / 上次运行+状态 / 启停 toggle)+ 新建/编辑模态(Skill 选择器〔仅可运行且已审〕+ daily/weekly + 时间)+ 逐条删(toastUndo)。文案说清「**仅 Seeker 开着时触发**」。
- **产出**:落 Agent 对话(runSkill 既有行为:用户消息气泡 = skill.prompt + AI 回复)。

---

## 4. 分期(每刀一 commit 一送审)

| 刀 | 内容 | 判据 |
|---|---|---|
| **SC1 · 契约 + 调度核心 + 最小管理面** | `platform_schedules` 集合(三处 + DB_VERSION 3→4)+ `schedule-model.js`(normSchedule/scheduleDue 纯函数)+ `scheduler.js`(tick/忙跳过/fire 经 runSkill)+ 能力中心段(列表/新建/启停/删)。**一刀含最小闭环**(F1 教训:无消费者的机制=休眠件)。 | scheduleDue node 测(边界:跨天/周、错过一次/多次只 due 一次、禁用不 due)+ 变异证红;preview:到点 fire 经 runSkill(spy ai.stream)、未审件选择器不列且 fire no-op、忙时跳过;调度 CRUD 只在管理面;DB_VERSION 升级 web 可建 objectStore;真机 boot 0 panic |
| **SC2 · 打磨** | 运行记录面板(最近 N 次)/ 错过提示(「错过 2 次,未补跑」)/ 每小时档(若 §5 拍板要) | 记录准确、反焦虑文案 |

---

## 5. 未决 · 用户拍板

1. **错过策略(app 关着时排点已过)**:①**跳过不补跑 + UI 显示错过**(推荐:反焦虑、防开机风暴烧 BYO 配额;`scheduleDue` 语义天然如此)②开机补跑一次。
2. **频率档位**:①**daily / weekly 起步**(推荐:最简、够用、成本可控)②加「每 N 小时」档(SC2 可加)。
3. **忙时策略**:①**跳过本 tick、下分钟重查**(推荐:简单、不堆积)②排队 fire(流一收就跑)。
4. **产出去向**:①**同一 Agent 对话**(推荐:单线程现实、回来即见)②独立「运行记录」面板(SC2 的记录面板可部分承担)。

---

## 6. 诚实边界

- **仅 app 开着时触发**(本地优先、无服务器、无 OS 级调度)。app 关着 = 不跑(错过策略见 §5)。**OS 级调度(launchd/计划任务)= 另一个方案**(签名/权限面大),本方案不做、不假装。
- web 端同 work(IndexedDB + setInterval),但标签页须开着 —— 同一诚实边界。
- 调度器纯前端 = 时间精度分钟级(60s tick),**不承诺秒级**;文案不写「准时」写「到点后一分钟内」。
- 真模型 BYO;preview 以 stub 验 fire 链与守卫继承。
- 本文未落一行码;§3 落码时可能被载序/忙信号事实推翻 —— 先量再改。
