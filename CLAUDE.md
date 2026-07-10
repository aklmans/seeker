# CLAUDE.md · Seeker / app

> 本文件是 Seeker 应用源码目录的开发规则,Claude Code 在此目录工作时**始终遵循**。
> 设计文档在 `../prototypes/`(只读参考)。
> **冲突裁决规则:**
> - **架构 / 设计 / 接口 / 原则**:以 `../prototypes/` 文档为准,本文件与之冲突时指出。
> - **推进顺序(里程碑做的先后)**:以本文件 §5 为准。总盘里的 `M1/M2…` 编号是**逻辑分组,不是强制执行顺序**;§5 的"业务未定型先验证业务"是有意覆盖,**已裁决生效,无需每次再报备**。

---

## 1. 项目本质

Seeker 是**多应用平台**(2026-07-03 拍板升级,方案 `docs/proposal-app-platform.md`,D1–D7 按推荐):同一套前端跑**网页 + 桌面**,底下是**可插拔能力层**,上面是**壳 + N 个可开关的小应用**(时光序模式)。求职只是第一个应用(`jobseek`),找完工作可关掉它——UI/AI 下架、数据保留;后续应用:数据资产管理、记账、项目、健康……因此:

> **`platform/`(稳定·复用·业务无关)与 `apps/`(N 个可开关小应用)必须物理分离,只靠契约通信。**
> 应用经壳(`platform/shell/`)以 manifest 注册:页面 / 导航 / 卡片 / frameQuery / 设置段;应用间**禁止互相 import**。
> 新增应用 = 新目录 + manifest,平台零改动;数据集合白名单 = 各应用 manifest 声明之并集(新应用集合用 `<appId>_` 前缀,既有 5 集合由 jobseek 认领)。

---

## 2. 技术栈

- **外壳**:Tauri 2(Rust 核 + 系统 WebView)。**不用 Electron。**
- **前端**:原生 HTML/CSS/JS,**不引入前端框架**(沿用原型)。可拆模块。
- **运行时适配层**:前端只调统一接口(`rt.db` / `rt.ai` / `rt.secret` / `rt.capability` …);桌面落地 Tauri/Rust,网页落地后端代理/IndexedDB。**前端一份不分叉。**
- **数据**:桌面 SQLite / 网页 IndexedDB;**弹性 schema(骨架列 + `data_json`)**,加业务字段优先改 JSON、不写迁移。
- **AI**:BYO 多协议(OpenAI 兼容/Anthropic/Gemini/Ollama),中立内部格式 + 适配器;前端只发文字、收 token 流。
- **能力层**:RAG/向量库/记忆/MCP/ACP/Skills/show_widget 均实现统一 `Capability` 契约,注册即生效。

---

## 3. 目录约定

```
app/
├── web/             # 前端 web 根 —— frontendDist 指向此(须排除 src-tauri,故独立成目录)
│   ├── index.html   # 前端入口(原型;含 A 层快捷键接线)
│   ├── platform/    # 平台层(稳定)
│   │   ├── runtime/     # 运行时适配:桌面/网页能力接口与实现
│   │   ├── keys/        # 应用内快捷键(A 层 · 集中分发)
│   │   ├── data/        # 数据引擎:仓库接口 + SQLite/IndexedDB + 迁移/快照
│   │   ├── ai/          # AI 网关:协议适配 + 流式 + 工具循环 + 提示组装
│   │   ├── capability/  # 能力层 registry + Capability 契约 + 各能力插件
│   │   ├── secret/      # 钥匙串读写
│   │   ├── voice/       # 语音 sidecar 调度
│   │   ├── shell/       # 应用壳:AppManifest 契约 + 注册表 + 导航/设置/Copilot chrome 装配
│   │   └── guardrail/   # 破坏性操作护栏(预览+确认+撤销)
│   └── apps/        # 小应用层(每应用一目录;互不 import)
│       └── jobseek/     # 第一个应用:求职工作台(manifest + 页面模块)
└── src-tauri/       # Tauri/Rust 工程(在 web/ 外 → 不被嵌入 WebView 资产)
```
> `web/` 独立成前端根:Tauri 的 `generate_context!` 会**递归嵌入整个 frontendDist**,若含 `src-tauri/` 会把 target 也卷进去而编译失败;故前端与 `src-tauri/` 必须分处。
> **搬迁过渡态(阶段 1–3)**:求职业务逻辑仍内联在 `index.html`,经 `apps/jobseek/` 适配器 manifest 注册进壳;按 `docs/proposal-app-platform.md` 阶段 3 逐页迁入 `apps/jobseek/`。旧 `domain/` 目录(空壳)随迁移移除。
> 写代码前先判断它属于 `platform/`(壳与能力)还是某个 `apps/<appId>/`(业务)。业务规则、提示词、字段定义尽量**配置化**,别硬编码进平台层。

---

## 4. 不可违背的原则(每段代码都要守)

1. **本地优先** —— 数据默认存本机、默认不外发;联网只为调用户自填的模型端点。
2. **隐私红线** ——
   - API Key 等密钥**只进系统钥匙串**,绝不入库 / 配置文件 / 前端 / 日志;前端只见 `configured/empty`。
   - 个人隐私字段(姓名/电话/邮箱…)存独立 `profile`,**AI 永不读取/修改**,从类型层面隔离(`profile` 仓库不提供"导出给 AI"的方法)。
   - **应用数据的 AI 可读走三层闸**:应用启用 ∩ manifest 默认(`aiReadable`)∩ 用户 per-app 授权;健康类应用 **default-off**。关应用 = 其集合即刻退出 AI 可读集。**强制点在能力层 `query_data` 的 invoke**——**非仅提示层暗示**(工具 `enum` 裁剪只是给模型的提示,模型越界发串仍被 invoke 独立硬拦)。**`QUERYABLE` 保持静态常量硬底**(`profile`/`messages`/`settings`/`secrets` 永不在内);D3 以 `静态 QUERYABLE ∩ 运行时可读集` 在其上**收紧、只窄不宽**——**永不能加入 `QUERYABLE` 之外的表**。故与既有 profile 隔离(`table_for`/`QUERYABLE` + 编译期不变量)的结构性强制**叠加、不削弱**:`profile` 永不 AI 可读,不受任何应用 `aiReadable` 影响。**⚠ 后续切勿把静态 `QUERYABLE` 重构成动态函数 —— 静态底是 profile 永不入的关键保证(第6轮审查钉死)。**
   - 设置**不能经对话修改**;Agent 只能引导去设置页。
3. **反焦虑** —— 不用红色警告、不用倒计时施压。破坏性操作(删/清空/覆盖)**分两档**(第56轮裁定;旧写法「一律统一走 guardrail」与 notes/prompts/resumes/jobs 的既有逐条删相矛盾,是条会被代码证伪的声明):
   - **安全内核(不可让步)** —— 凡**非用户直接发起**的破坏性(Agent / 模型 / widget 触发)**永远**走 `platform/guardrail`(预览 + 确认 + 可撤销)。能力层已结构性保证:破坏性能力须 `Permission::Destructive`,`invoke_raw` 拒绝自动执行、必走护栏。
     - **★「触发」= 执行发起点,不是提议者**(第57轮 [建议] 澄清):模型**只能提议**(渲染确认卡/建议),**用户显式点击确认**即属**用户发起**(与 widgetActions「收规格不收执行」同源)。**已认可先例**:`agentDeleteJob`(copilot-actions.js)由模型渲染确认卡、用户点 `cAB` 才执行,其撤销是**闭包快照**(`JOBS.splice(idx,0,job)`)⇒ 可靠 ⇒ 合规走 `toastUndo`。**反之,模型/widget 自行执行的破坏性一律不得绕过 guardrail。**
     - **★★「用户显式点击确认」不得可被伪造**(第58轮 [建议]B · 堵后门):上条成立的**前提**是两道约束,缺一即失效 ——
       ① **动作来自白名单注册表**:确认按钮只能派发 `cActions` 里已注册的函数(`Object.create(null)` + own-enumerable + function-only),模型无法凭字符串调任意代码;
       ② **按钮文案与动作语义由应用/平台自持**(硬编码),**绝不得由模型 / RAG / MCP 派生内容决定「这个按钮是干什么的」**。不可信派生内容**只能作为已转义的数据**出现在描述里(先例:`cAB('确认删除','agentDeleteJob',…)` 的按钮文案硬编码,详情里的公司名走 `cEsc(j.co)`)。
       **否则**:模型可造一张写着「点此继续查看结果」的卡、底下挂破坏性动作,把「用户显式点击确认」**伪造**出来。与 `greeting`(第50轮:须应用自持可信文案)、`widgetActions`(收规格不收执行)同源纪律。
   - **用户 UI 发起** —— **清空 / 覆盖 / 批量仍走 guardrail**;**单条删除**若「低恢复成本」且**撤销可靠**,可用「即时删 + `toastUndo` 撤销」(不弹模态,反而更反焦虑)。现例:notes / prompts / resumes / jobs / 记忆 的逐条删。
   - **★「可撤销」必须是真的**(第56轮 [应改] 用真数据丢失换来的判据):撤销的 **UI 语义必须与后端 trash 语义一致**。后端**单槽** trash(`MemTrash`/`DocTrash`:`*trash = snap` 覆盖写、`undo` 用 `mem::take`)只能承诺「**撤销最近一次销毁**」—— **绝不可**给每行一个假装独立的撤销按钮,否则窗口内连删两条会**静默永久丢数据 + 还原错记录**。落码前先读后端 trash 是单槽还是 keyed;做不到可靠撤销就走 guardrail 确认闸。**别声明做不到的不变式。**
4. **不可信代码沙箱化** —— show_widget 等 LLM 生成 UI:`iframe sandbox="allow-scripts"` + srcDoc 内 CSP(`default-src 'none'`)+ 父窗口零信任 + MessageChannel 专属端口;外部内容(RAG/MCP/JD)标注 `Untrusted` 防注入。
5. **设计语言统一** —— 暖橙节制(仅句号/标号/CTA/选中/进度/竖线)、0.5px 边框、系统字体栈、Mono 大写标签、衬线斜体标题 + 暖橙句号。沿用原型 CSS token,**不要自创视觉**。
6. **中英 i18n** —— 沿用原型的 `tt()/L()/T()` 机制;新增 UI 文案需双语。

---

## 5. 推进顺序(业务未定型,先验证业务、后压重工程)

> **本节是推进顺序的权威来源,优先于总盘的 M1/M2… 编号。** 总盘编号是逻辑分组;实际开发按下表(业务优先)进行——此为已裁决基线,执行时无需就"顺序与总盘不符"再报备。

| 阶段 | 内容 | 文档 |
|---|---|---|
| **M0 + #6** | Tauri 骨架 + 原型前端入 WebView + **签名/公证最小闭环(早做)** | 总盘 · 构建签名发布 |
| **#1 + #4** | AI 网关(单协议流式)+ 安全红线(钥匙串/隐私隔离) | AI 网关 · 安全 |
| **#3** | 弹性数据层 + 仓库接口 + 迁移/快照 | 数据层 |
| **#2** | 能力层 registry + Capability + RAG/记忆 + show_widget | 能力层 · show_widget |
| **#5** | 本地语音 sidecar(业务定型后) | 语音 |

**当前主线 · 多应用平台化(2026-07-03 拍板,详见 `docs/proposal-app-platform.md`)**:

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 方案对齐 + 基线更新(本文件修订) | 完成 |
| 1 | 壳与契约(`platform/shell/` + jobseek 适配器,**行为零回归**) | 第5轮过审 |
| 2 | 应用管理页(开/关/排序)+ **D3 三层闸落能力层**(静态 `QUERYABLE` 硬底 ∩ 运行时可读集,只窄不宽)| 第6轮过审 |
| 3 | 求职逐页迁入 `apps/jobseek/`(每页一 commit;剩余交织按第8轮裁定) | **搬迁 + 3.y 全线收官**(择取+抽壳序1–5 全落,index.html −71%→1330;**第1–49 轮全过审**)。**3.y(第26–49轮)= 类型化 + 账本清空 + §1 契约化**:@ts-nocheck→全 module 全 import(classic 外链 0、账本 d.ts 0)· 桥 198→**3**(**业务桥 0**,仅 3 平台 HTML 跨内联块结构桥)· **§1 契约化四契约 pageNew/pageActions/widgetActions/cActions + notifyDataImported 收官** ⇒ 平台层(shell-keys/nav/widget-actions/copilot-chrome/settings)对 apps 符号裸读**全经契约收口 = 「platform/apps 物理分离、只靠契约通信」第一性原理实质达成**。**剩归属债(非阻塞)**:10d checklist(AGENT_CMDS @ts-check header flip)· agentGreet→manifest.greeting 文案债。 |
| 4 | 第二应用「数据资产管理」(验证新增应用成本) | **完成,待外审第23轮**(前置账已清:clearAllDataFlow→`SeekerShell.collections()` 存在性枚举 + 第9契约 onDataCleared;assets 应用=manifest+2页,**成本盘点:壳/平台 JS 零改动,仅后端集合白名单3处追加≈10行=D3 静态硬底的固有代价**) |
| 5 | 记账(AI 网关 token 用量埋点)/ 项目 / 健康(隐私分级示范) | |

各阶段遵循对应文档的 G/C/D/S/V/P 分阶段清单。**每个里程碑可独立演示;完成后与我对齐(+外审)再进下一阶段。**

**阶段 3 搬迁方式(第 8 轮裁定 · 权威)**:剩余 jobseek 与壳基元交织,走 **C(混合,B 方向)**——壳基元(`SEEKER_CARDS` 引擎 / `streamReply` / `extractSeekerBlock` / Copilot chrome / `hydrate`·`persist` 框架 / 设置框架)终态归属 **`platform/shell/`**;纯 jobseek(卡实现 / frameQuery 意图 / 业务数据 / 简历主资料段)归 **`apps/jobseek/`**。**C1 升级为「归属驱动的零逻辑改动移动」**:判据 = 每段去对了家 + 移动本身零逻辑改动(非块连续;本意一直是零代码改 = 零回归),允许非连续择取、允许抽壳,零回归靠 C2(node-check + contentLen + 冒烟)验。**抽壳 = 重入平台层,5 约束**:① 一基元一 commit(独立搬+验,不一把梭);② 契约扩展(`SeekerShell.*`)必审;③ 红线基元加倍审(`extractSeekerBlock`/`streamReply` 抽出保无 XSS、`persist`/`hydrate` 抽出不削弱 profile 隔离、frameQuery 保 Untrusted 框定);④ 平台新模块尽量 @ts-check(小纯基元直接类型化);⑤ 先低风险择取(卡/frameQuery → apps)后抽壳。3.y 类型化(@ts-nocheck → 真 ES module + 账本清空 + 适配器删)单列里程碑审。

**3.y 进度(2026-07-07)**:步1-2(INIT 迁 module + dispatch 拆末位)+ 步3 中层**叶子刀**(base 工具 dom/icons/i18n/toast/modal/ai-render → nav〔★有状态 `current` 访问器 `currentPage()`〕→ copilot-chrome〔★appMode getter + appReady setter,数据流向定 get/set〕+ persistence/shell-boot/data-store)**第26-32轮全过审**。**有状态符号 litmus(第27/31/32轮权威)**:① reassigned(`X=…` 整体重赋,快照会过时)→ 封装,**按数据流向**:外部读→getter、外部写→setter,**不上 X 桥**(current/lastUndo/SEED/appMode/appReady);② mutated-property(仅 `X.k=`/`X.push`,引用稳定)→ `window.X=X` dual-publish 同引用即安全、**免访问器**(setState/JOBS/MODEL/PROFILE);③ PROFILE 额外走 import、**不上 window**(隐私最小暴露)。**注册链批 A(第33轮 + 真机 WKWebView 金标准过审)= registry/keys 解锁**:registry/manifest×2/SHELL BOOT → module + INIT 重排到注册之后(原子协调刀,解 parse-time `SeekerShell` 消费;新载序 registry→manifest→SHELL BOOT→INIT→dispatch)。**僵尸桥清扫**:12 个 0 外部消费者桥删(82→70)。**★剩 = classic 业务层 module 化(单列大块)**:profile 链②(`PROFILE` 双红线 import-first 不上 window)+ 账本清空大头(余 70 桥 + monolith-globals 27 条)**同源** —— 都要先把 `index.html` inline + `settings.js`/`resumes.js`/`interview.js`/`intake-action.js`/`data.js`/`cards.js`/… + assets ≈13 个 classic 业务文件拆 module、消费者改 `import`(含 `ivRec` 跨文件 reassigned、`resumes.js` parse-time 读 `JOBS[0]`);做完则 profile 解锁 + 账本自然清空。**3.y 硬骨头(3 个 parse-time 重排:INIT 迁 module / dispatch 拆末位 / 注册链)全过审;此业务层大块单列、比单基元刀大一档。**

**抽壳顺序(第 9 轮裁定 · 权威)· 择取批 3-d~g 过审后转抽壳,自底向上 + 红线自轻到重**:**1 基础工具**(`tt`/`$`/`$$`/`el`/`esc`/`go`/`toast`/`openModal`/`aiHTML`/`IC` —— 最底层、零红线、纯函数/DOM,风险最低)→ **2 AI 引擎**(`extractSeekerBlock`/`streamReply` —— 红线:保 Untrusted+无 XSS)→ **3 Copilot/Agent chrome**(`copInit`/`copSend`/`copClose`/`cAct`/`agentInit`;jobseek 专属响应留 apps)→ **4 数据框架**(`persistColl`/`persistMsg`/`hydrate*` 通用部分 —— 红线:persist 永不把 profile 写通用 AI 可读集;jobseek 专属集合留 apps)→ **5 设置框架**(`renderSettings` 壳部分[主题/语言/密度/模型]+`persistProfileField` —— 双红线:profile + 设置不可经对话改;jobseek 设置段[主简历/权重]留 apps,需 `manifest.settings` 契约扩展)。**关键约束⑤(抽壳零回归的钥匙)**:壳基元抽到 `platform/shell/` 但**仍挂 window 全局 + 保持 classic 载序**(在消费者前加载)——兼容 @ts-nocheck 的 apps/index.html 按全局名引用不变 → **抽壳本身零回归**;显式契约 import 留 3.y;载序每刀验。同 `SeekerShell`/`SeekerKeys` 先例。

---

## 6. 工作约定

- **小步提交**:每个可工作的增量一个 commit,信息清晰、风格一致。
- **契约优先**:跨层调用先定接口契约再实现;两端实现同一契约。
- **范围克制**:文档没覆盖的细节,先提方案说取舍,等我确认再写;不自行扩大范围(延续原型"少即是多")。
- **关键路径测试**:密钥不外发、profile 不进提示、破坏性可撤销、迁移可回滚 —— 必须有测试。
- **不做的事**:不引前端框架;不把密钥/隐私塞前端或日志;不让 widget/模型直接执行破坏性操作;不偏离原型视觉;不改 `../prototypes/`。

---

## 7. 起步

1. 读 `../prototypes/工程文档索引.html` + 总盘,向我复述你理解的分层与推进顺序(确认)。
2. 初始化 Tauri 2 + git;把 `../prototypes/求职岗位研究工作台.html` 前端装进 WebView 跑起来(M0)。
3. 搭 `platform/` 与 `domain/` 骨架 + 运行时适配层接口(先空实现 + 类型)。
4. 跑通签名/公证最小闭环(#6 · P1)。
5. M0 完成,停下对齐,再进 #1。
