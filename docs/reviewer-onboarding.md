# 评审 Agent · 入职简报

> 给**新接手的评审 Agent**。读完这份 + `CLAUDE.md` + 待审的 proposal/commit,你就能独立、严格地参与评审。
> 你不是执行者(执行者=另一个 Agent,下称 exec);你是**独立复核方**。你的价值在于:**不采信送审词,独立复现、对抗性核实、给裁定。**
> 更新 2026-07-08。

---

## 0. 你的角色(一句话)

exec 每完成一刀就送审。你**独立验证**它的声称(功能、红线、账目),给 `[阻断] / [应改] / [建议] / 通过` 裁定。历史上你抓出过真回归(潜伏 ReferenceError、二次 innerHTML 放大面、载序陷阱),也纠正过 exec 的过度声称——**这份严格是项目质量的第二道闸,请保持。**

---

## 1. 项目是什么

**Seeker** —— 本地优先的**多应用平台**(Tauri 2 = Rust 核 + 系统 WebView;同一套前端跑桌面 + 网页)。

- **壳 + N 个可开关小应用**(时光序):`platform/`(稳定、复用、业务无关)与 `apps/`(N 个小应用,首个=求职 `jobseek`,第二个=数据资产 `assets`)**物理分离,只靠契约通信**。
- **前端**:原生 HTML/CSS/JS,**不引框架**;可拆 ES module。
- **运行时适配层**:前端只调统一接口(`rt.db`/`rt.ai`/`rt.secret`/`rt.capability`…),桌面落地 Tauri/Rust、网页落地后端代理/IndexedDB,**前端一份不分叉**。
- **能力层**(Rust,已建 C1-C3):`ai_chat` 工具循环 + capability registry(query_data/show_widget/记忆/RAG)+ 破坏性护栏 + D3 三层闸。

目录:`web/platform/{shell,runtime,ai,capability,data,secret,guardrail,voice,keys}` · `web/apps/{jobseek,assets}` · `src-tauri/src/*.rs` · `docs/` · `../prototypes/`(**只读**设计文档,冲突时以它为准)。

---

## 2. 现况(2026-07-08)

| 阶段 | 状态 |
|---|---|
| 阶段 0–2 壳/契约/应用管理页/D3 三层闸 | 第5–6轮过审 |
| 阶段 3 求职逐页迁入 apps/jobseek | 搬迁收官 |
| 阶段 4 第二应用 assets | 第23轮过审(验证「新增应用净成本≈manifest+2页+白名单≈10行、平台 JS 零改」) |
| **3.y 类型化 + 账本清空 + §1 契约化** | **第1–50 轮全过审收官**。@ts-nocheck→全 ES module 全 import;**业务桥 198→0**(仅剩 3 个平台 HTML 跨内联块结构桥);§1 契约化四契约(pageNew/pageActions/widgetActions/cActions)+ notifyDataImported/greeting —— **平台对 apps 符号裸读全经契约收口 = 「platform/apps 物理分离只靠契约」第一性原理实质达成** |

**当前待审**:`docs/proposal-agent-native.md`(**AI-Native 转向**,定位级)。见 §5。
**遗留(不阻塞)**:10d② 真机 desktop-gated persist 写路径;#6 macOS 签名公证(需用户 Apple 证书=手动);阶段5(记账/项目/健康,已入 ROADMAP、暂缓)。

---

## 3. 不可违背的红线(评审最该守的 · CLAUDE.md §4)

1. **本地优先** —— 数据默认存本机、不外发;联网只为调用户自填模型端点。
2. **隐私红线**:
   - 密钥**只进系统钥匙串**,绝不入库/配置/前端/日志;前端只见 `configured/empty`。
   - profile(姓名/电话/邮箱)存独立仓库、**AI 永不读写**、类型层隔离(profile 仓库无「导出给 AI」方法)。
   - **应用数据 AI 可读走三层闸**:启用 ∩ manifest `aiReadable` ∩ 用户 per-app 授权;健康类 default-off。**强制点在能力层 `query_data` 的 invoke**(非仅提示层)。**`QUERYABLE` 静态常量硬底**(profile/messages/settings/secrets 永不在内)——**⚠ 切勿重构成动态函数**(第6轮钉死)。
   - **设置不能经对话改**;Agent 只能引导去设置页。
3. **反焦虑** —— 不用红色/倒计时;破坏性操作(删/清/覆盖)一律**预览+确认+可撤销**,无论触发者(Agent/widget/UI),统一走 `platform/guardrail`。
4. **不可信代码沙箱化** —— show_widget:`iframe sandbox="allow-scripts"` + srcDoc CSP `default-src 'none'` + 父窗口零信任 + MessageChannel 专属端口;外部内容(RAG/MCP/JD)标注 `Untrusted`、进 DOM 前转义。
5. **设计语言统一** —— 暖橙节制、0.5px 边框、系统字体栈、Mono 大写标签、衬线斜体标题;沿用原型 CSS token,不自创视觉。
6. **中英 i18n** —— `tt()/L()/T()`,新增文案双语。

---

## 4. 你会用到的评审方法论(权威裁定 · standing · 每轮复用)

这些是过去 50 轮沉淀的判据,**exec 也守同一套**;你核实时按它们对齐。

**① 有状态符号 litmus**(哪些能上 `window`):reassigned(整体重赋)→ 访问器 getter/setter、**不上 window**(current/lastUndo/appMode/appReady);mutated-property(仅 `.k=`/`.push`)→ `window.X=X` dual-publish 同引用免访问器(setState/JOBS/MODEL);**PROFILE 走 import 不上 window**(隐私最小暴露、window/AI 结构性不可达)。

**② 载序**:classic parse-time 早于全部 deferred module。classic 已清零 ⇒ 只剩两险:(a) **tag-order**(跨模块 eager module-eval 读需 provider tag 在前设桥);(b) **import 边=第二种载序移动机制**(provider 的 module-eval 被提前到 consumer 的 tag 位;查提前区间有无 eager 读/被跳副作用)。**SCC 环不变式**:任一 SCC 内成员顶层(含 IIFE)不得急读同环成员的**非函数声明**绑定(function 声明 hoisted 安全)——TS AST + 阳性对照机械复跑。

**③ preview 缓存陷阱**:preview 代理(8123)**剥 no-store 头** → 浏览器按 URL 缓存 → classic→module 同 URL 转换供 stale(空 exports)。修=**定向单文件** `fetch(url,{cache:'reload'})`+reload(非全量,全量会扰载序)。**on-window module 绝不可 `?bust=` import**(第二实例顶层 `window.X=` clobber canonical 桥、读假值);off-window 才可 cache-bust 验 exports。**asset:// 真机免 HTTP 缓存 = 最可信判据。**

**④ 验证判据**:
- parse-time/契约/安全类改动 = **功能测必要**(node/tsc 看不见 @ts-nocheck 间缺 export、只有运行时 link 能判)。
- **「0 console」必要非充分**(不捕获 module 级 uncaught SyntaxError / import link 死;Blob 重放使其可捕获)→ **主证 = 正向断言**(契约面数值 + 内联块跑完证据 + 功能链 LIVE),console 仅辅证。
- **死桥判据须排除 DOM 具名访问**:`typeof window.X!=='undefined'` 不足证桥在——任何 `id="X"` 元素经 DOM 具名访问占据 `window.X`;判据加 `instanceof HTMLElement`/`===getElementById`。
- **不采信送审词**:桥账逐文件独立集差 + 全树消费者扫描(tokenizer 剥注释/字符串/regex、spread-aware → 零裸读无 import);**双向阳性对照**(拿修复前的 commit 复跑你的扫描器,确认它能抓到已知问题,防扫描器自身 bug)。

**⑤ §4-4 安全**:
- `cEsc` 转义 `&<>"`;**cAB 结构消除 onclick 注入**(data-cargs 按值传 + 文档级委派 + cEsc)。
- **注册表即白名单**:cActions 用 `Object.create(null)` + own-enumerable + function-only(优于 Set+`window[name]`;免疫 gadget / 原型污染 / DOM 遮蔽)。**委派白名单不得含把 data-cargs 反射进 innerHTML/eval/Function/setTimeout(串) 的处理器**(agentChat 教训:改无参包装)。
- **破坏性契约 = 收规格不收执行**:应用 return spec、平台自驱 guardrail;`source` 由平台端口 widgetId 注入且置于 spread 之后(不可伪造);fail-closed `if(!G)return` 在咨询契约前;let snap 闭包。
- **红线搬进类型面**:把不变式固化到 `types.d.ts` 注释(widgetActions 的 `WidgetActionSpec`、greeting 的信任前提都这么做),让下一个作者在类型层就看到红线。

---

## 5. 本次待审 · AI-Native 转向方案

**读**:`docs/proposal-agent-native.md`。**性质**:定位级(重要性同多应用平台化),方案先行、过审+拍板后才动工。

**背景**:真机反馈——「能用,但产品设计/业务逻辑混乱、非 AI-Native、Agent 窗口杂」。转向 = 从「带 AI 的工作台」→「AI-Native:Agent 窗口即唯一入口、一切功能皆 Agent 可调工具」。

**请你重点核实**:
1. **诊断准不准**(两个重叠 AI 面板 / 8 处 aiRun 演出 mock / assets 201 行孤立薄页)——代码事实,可自查。
2. **★「地基已建」的推论有没有低估前端成本**:Rust `ai_chat` 工具循环 + capability registry 确已建(`src-tauri/src/{ai,capability}.rs`),但前端接上真循环 + 收窗口 + 应用能力→工具契约的**真实工作量与风险**,请独立评估。
3. **工具契约草案 A(前端桥 `manifest.tools`)vs B(下沉 Rust Capability)** 取向;红线映射(§4 表)是否真复用已有机制、无新破口。
4. **§7 四个待拍板点的预裁**(P0 三事先后 / 契约 A-B / 编辑器模式删留 / assets 原地重构 or 新应用)。

---

## 6. 评审工作流与节奏(你加入的循环)

- exec 一刀一 commit;每刀**自验**(node --check + `tsc --noEmit` 真退出码 + preview 净方法功能测 + 高危/红线刀跑**真机 WKWebView `cargo run` boot**)后送审,并在 `docs/review-log.md` 写「⏳ 待审」留痕 + 一段送审 writeup。
- **你**:独立复核 → 裁定。裁定后 exec 把 review-log 该条翻「🏁 第 N 轮通过」并同步记忆;`[应改]`/`[阻断]` 则 exec 即修复验、你复核闭环。
- **裁定分级**:`[阻断]`(必须修才能过)/`[应改]`(该修、可能纵深防御非致命)/`[建议]`(前瞻/措辞)/通过。历史每轮都留在 `docs/review-log.md`(第1–50 轮),**读它能看到判据怎么演化的**。
- 约束:**契约扩展(`SeekerShell.*` / `manifest.*`)必审**;红线基元**加倍审**;范围克制(文档没覆盖的先提方案)。

**读清单**(按序):`CLAUDE.md`(根规则)→ 本文件 → 待审的 proposal/commit + `docs/review-log.md` 尾部几轮(看判据风格)→ 需要时 `../prototypes/工程文档索引.html` 起的设计文档。
