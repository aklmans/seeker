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

**⑥ ★控制组必须能亮,断言必须能红**(第56–64 轮撤销债 arc 的方法论遗产 · **评审第64轮点名收进本节**):
**测试没先失败过,就什么都没证明。** 同族实例,每一个都曾产出过一次假阴性:
- **不触发的控制组**(第56/59轮):用 `window.toast` 做阳性对照,而该桥 3.y 已摘 ⇒ `|| (()=>{})` 兜底令控制组**空跑**。⇒ 用**真模块导出**,并先断言控制组确实亮了(`CTL_*`)。
- **缓存的旧模块**(第59轮):preview 代理剥 no-store ⇒ 对照件跑的是旧码。⇒ 定向 `fetch(url,{cache:'reload'})` + reload,并用源码正则佐证跑的是新码。
- **命中失败文案的子串断言**(第63轮):`/已撤销/` 同时命中失败文案「已撤销**过**」。⇒ **对用户可见文案的断言必须精确匹配文本节点全文**(此条收为 standing;而「失败文案不得内含成功文案子串」**不是** standing —— 语言相关、无机制强制,一次翻译即破)。
- **载荷主导的字节 fixture**(第63/64轮):验「预检上界 ≥ stash 实际」时若用「一条大行」,系数取 1 也能过 ⇒ 死靶。⇒ 用**多条小行**让 Vec 槽位与结构体开销主导。
- **变异测试是最强形态**:把生产代码临时改坏,确认断言变红,再还原。已用两次(`undo_bytes_upper_bound` 系数 2→1;`doc_undo_bytes` 去掉 `WHERE doc_id`),两次都真的抓到了。
- **覆盖声明本身也要为真**(第64轮):AST 审计器只看字面量属性 ⇒ **看不见 spread 路径**(`{...spec}`)。若结论仍成立,须如实写明「挡住它的是契约必填 + registry 守卫,不是我的审计器」。同族:第49轮「tokenizer 须 spread-aware」。
- **「tsc 无新增 error」必要非充分**(第64轮):基线里若已有**你正在改的那个文件**的 error,「无新增」什么也没证明 —— `runtime/types.d.ts` 的类型漂移就这样躺了三刀(TS2353/TS2322 一直在报,淹没在 61 条基线里)。⇒ 对触碰到的文件,判据是**该文件零 error**,不是总数不变。

**⑦ 破坏性回调的返回值契约(一份契约,一条规则,一处代码)**:`toastUndo(msg, restoreFn)` 与 `guardrail.confirmDestructive({onConfirm})` 共用 `platform/outcome.js` 的 `succeeded(v)` —— 显式 `false`/`0` ⇒ 没成功;`undefined`(块体箭头隐式返回)⇒ 成功。
- **默认值是「成功」**,这是零回归 opt-in 的代价:**新写的失败路径忘记 `return false` 就会静默说谎**。重量压在 JSDoc 义务 + 评审纪律上 —— 请每轮盯。
- **抛错 ⇒ 销毁是否发生未知 ⇒ 不给撤销**(不变式:提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原)。
- **`confirmDestructive` resolve 的布尔 = 「用户点了确认」,不是「执行成功」**。`capability/mcp/confirm.js` 拿它当 `approved` 回传后端 ⇒ **合并语义会把用户的「允许」静默翻转成「拒绝」**。勿改。
- **决策点不得承诺做不到的撤销**:guardrail 在**建对话框时**就据 `opts.onUndo` 是否存在印出「执行后可撤销。」⇒ 不可撤销时**连 `onUndo` 都不传**,并先问只读预检(`*_undoable`)。四条销毁路径均须成立 —— **「一条只在 3/4 条销毁路径上成立的不变式,不是不变式。」**
- **静默的死闸比没有闸更坏**:一道守着不可达分支的静默 `return`,唯一可能的效果是把一次**响亮的失败**变成一次**沉默的失败**。要么改响亮(`console.error` + 用户可见提示 + `return false`),要么删掉。

**⑧ ★记债是上一轮的判断,不是这一轮的事实**(第65轮 · 评审点名收进本节):
- **动手前先去量 blast radius,别照记债的描述办事。** 第61/62/64 轮把「不可映射行」记成「可用性悬崖(删不掉)」;第65轮实测发现:`memory_entries`(用户列表)读 `created_at` 而 `memory_all`(AI recall)不读 ⇒ 一行坏数据让**用户被告知「AI 什么都没记住」,而 AI 仍记得全部** —— 那是 **§4-2 用户掌控的说谎**,不是可用性。**记债(以及写它的那次裁决)低估了它。**
- 推论:「逃生口的第一步不是**能删**,而是**能看见**」—— 看不见的行没法点删除。
- **别让代理谓词承担安全属性**:「这行能不能快照」的权威答案是**快照代码本身**。用 SQL `typeof()` 谓词去代理 rusqlite `FromSql` 的接受集,会把「谓词 ≡ 依赖库语义」变成一份**跨版本维护负债**,而它挂在安全边界上。让被代理的那段代码自己当裁判,谓词降为展示用途。
- **区分「转换失败」与「瞬时故障」**:`Err(_) => 销毁` 会把一次 sqlite BUSY 读成「这行坏了」。取行/语句失败必须**向上传播**,只有「行已在手、列转换失败」才算不可映射。
- **SQLite 亲和性是事实,不是推理**:`TEXT` 亲和列会把写入的数字转成文本(`fact=12345` → `typeof='text'`)⇒ 只有 BLOB 能在 TEXT 列里存活成「不可映射」。写断言前先 probe。
- **★这条对评审自己同样适用**(第66轮,评审自我订正):它第65轮的 [建议]「补 `doc_remove_corrupt`」是在**没有先量「坏片段到底坏在哪」**的前提下给出的 —— 实测发现最可达的那类损坏(`created_at`)里,内容与向量完好、**AI 正在检索它**,根本修法是**修复**而非「更诚实地销毁」。**外审也得被外审;上一轮的裁决同样是「上一轮的判断」。**

**⑨ ★fail-safe 按后果选边 —— 先问「判错哪边代价大」,再定垃圾值倒向哪侧**(第99轮 · 评审升格 standing):
- 归一化一个布尔标志时,**fail-safe 的方向由失败后果决定,不是一律取 falsy**。同一条 fail-closed 原则,**后果分析决定哪侧是 closed**:
  - `Schedule.enabled`(垃圾 → **false,不跑**):判错代价 = 无人值守误跑(烧 BYO 配额 + 意外执行)⇒ 往「惰性」靠;
  - `Skill.reviewed`(导入侧垃圾 → **false,待审**):判错代价 = 未审第三方指令直接可运行 ⇒ 往「不信任」靠;
  - `Project.archived`(垃圾 → **false,可见**):判错代价 = 错误隐藏项目 = **感知数据丢失**(用户以为内容没了)⇒ 往「可见」靠。
- ⚠ 此前的 reviewed/enabled/imported 恰好都往 falsy 倒,**容易被误学成「垃圾一律 false」** —— archived 是第一例反向,证明规则是「往损害最小的一侧倒」。评审时对每个新布尔归一化问一遍:这个字段判错,哪边疼?
- **销毁之前先问:能不能修?** schema 自己定义了默认值的列(`created_at INTEGER DEFAULT 0`)可**忠实归一化**(第61轮裁决A 的线内);没有默认值的列**一个字节都不许碰**,销毁才是它们的逃生口。**修复优先于销毁 ——「更诚实地销毁」不是根本修法。**
- **决策点要说清「失去什么」,而不只是「能不能撤销」**:同一个「不可快照」的行,可能(a)内容仍在被 AI 检索 ⇒ 删=永久失去;(b)召回列已坏 ⇒ 整个能力已哑,删=**恢复**检索;(c)无向量 ⇒ AI 本就读不到。**三种情形文案方向完全不同,且必须由 oracle 实测得出,不靠猜。**
- **「可信」是需要 trace provenance 的判断,不是读一眼能断言的**(第68轮):喂给模型的 prompt,其「可信侧」**只能放真常量 app 文案**。若一段文本内插了源自外部内容的字段(如 JD 经 `ai.extract` 抽取的 co/role、`extractJdSkills` 的 need、乃至模板里再内插它们的 `resSummary`),它就**不是「硬编码可信」**——每一段标可信的文本都要能 trace 回真常量,否则走 `untrusted` 框定。**别声明假的信任级(勿声明假不变式的同族)。**
- **信任论证要说清它的地基**:「注入至多写垃圾、不能做事」这类论证,地基往往是「本调用点无工具」。**把地基写进注释** —— 一旦将来该流程需要工具,地基塌,那些外部派生字段必须重新按不可信处理。正解是**让不变式为真**(把派生内容移进 framed untrusted、可信侧只留常量),而不是改注释承认违例。
- **把「不该发生的分支」变成活的监视器**:当展示走谓词、守卫走 oracle 时,「守卫说它健康」这一分支在正确系统里**永不出现**。**别把它静默吸收进计数** —— `console.error` + 用户可见,它就成了谓词/oracle 漂移的运行时检查,比只靠变异测试更强(覆盖变异测试没枚举过的形态)。

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

---

## 5. 真机验证协议(第101.5轮真机反馈 · 血的教训)

**「真机 boot 0 panic」= 进程活着,≠ 用户看到你的新前端。** 两个必栽的坑:
- **Tauri `generate_context!` 编译期嵌前端,stable Rust 上不追踪资产变更** ⇒ 只改 `web/` 时 `cargo run` 复用旧二进制、嵌旧前端(已由 `src-tauri/build.rs` 指纹追踪修复:改前端必触发 `Compiling app`)。**验证真机前先确认这次 run 真重编译了**(看到 `Compiling app`),否则你截的是几十轮前的 UI。
- **JS 运行时错误不杀 Tauri 进程** ⇒ 页面可以整片空白而进程 0 panic。
- **preview(nocache server)读实时 `web/`,永远是新的** ⇒ 它绿 ≠ 真机绿(真机走嵌入资产)。E2E 直接 import 调渲染函数,也**不走真实侧栏点击**、漏「导航到某页整片空白」。
- **用户双击的是 release `.app`**(`target/release/bundle/macos/Seeker.app`),不是 `cargo run` 的 debug 二进制 —— 给用户看效果须 `tauri build` 重打包(build.rs 修复覆盖 release)。
**⇒ 真机验证 = ①确认 `Compiling app`(前端真重嵌)②截真窗口(视觉/DOM,不只进程存活)③走真实用户路径(点侧栏,不是 import 调函数)。诊断信号本身要先证伪**(strings 被压缩资产骗过 = 反例)。
