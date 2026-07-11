# 里程碑审查日志 · 发现 agent + 出口红线

> 外审 Agent 对 `5249874`(首轮 PASS 末提交)之后各批次的里程碑审查记录 + 落地闭环留痕。最新在下。
> 相关:[proposal-discovery-agent.md](proposal-discovery-agent.md)(方案 + 威胁模型 + P0–P2 分期)。

---

## 第 1 轮 — 通过(约 2026-06)

首批(远程 MCP + 简历导出/录入等)。3 项 [应改] 全落地:
- **①** `rust-toolchain.toml` 钉 1.95.0 + 全仓 `cargo fmt`(修 fmt drift)。
- **②** CI `check` job 增 `cargo test`。
- **③** 远程 MCP 令牌**禁明文 http 外发**(`is_plaintext_remote` 放 `connect_client` 咽喉 + `mcp_add` 早拒,双层)。

[建议]:McpManager 按 server 分锁(落地)、简历导出前守卫未生成简历(落地)、钥匙串往返测试(合理跳过——OS 资源,纯函数已测)。

## 第 2 轮 — 通过(约 2026-06-12,范围 `5249874..2bf9d8b`,8 提交)

独立实测 76 test / clippy `-D warnings` / `fmt --check` exit 0 / tsc 全净。上轮 3 项 [应改]+[建议] 复验闭环。新增**可配置 UA** + **发现 agent P0 受控抓取**(SSRF 护栏逐 IP + 逐跳重定向复检 + scheme 白名单 + 限额 + html→text 不进 WebView)判定安全、有测试;`connect-src` 实测 `'self' ipc: http://ipc.localhost` 无 `https://*`。

- **1 条 [建议]**:AI 端点 warn 日志响应体脱敏(纵深防御)→ `733ada0` `redact_secret` 落地(两路日志均脱敏)。
- **P1/P2 前必须收口**:① DNS-rebinding(TOCTOU)② 6to4/Teredo 隧道(评审补入清单)。

## 第 3 轮 — 通过(带待办)(2026-07-03,范围 `2bf9d8b..HEAD`,11 提交)

独立实测 **79 test / 3 ignored live / clippy / fmt / tsc 全净**。

**第 2 轮遗留全闭环并经复验**:`redact_secret` 两路都用;**DNS-rebinding 用钉 IP 直连收口**(`resolve_allowed` 解析→校验全部 addr→钉首个;`fetch_raw` 每跳 `.resolve(&host, addr)`,reqwest 不二次解析,重定向逐跳重钉——正是第 2 轮所开方子,TOCTOU 窗口关闭);**6to4/Teredo 已拦**(取内嵌 IPv4 递归校验)。

**发现 agent P1/P2 出口红线升级**(自动抓 agent 产出的搜索 URL)护栏到位:钉 IP + 逐跳复检、`verify_sources` 是**确定性 domain 命令(模型拿不到 fetch 工具)**、卡片 URL 不进 DOM href、抓回 title 不渲染(无 XSS)、契合排序**读 resumes 非 profile**(QUERYABLE 仍排除 profile)。

### [应改] open_external 的 Windows 命令注入 → 已修(commit `5a54fdb`)
- **根因**:Windows 路径 `cmd /C start "" <url>`;Rust 的 arg 转义不转 cmd 元字符(`& | < > ^`),cmd.exe 二次解析 → `http://x/?a&calc.exe` 执行 calc.exe(注入,RCE 级),且含 `&` 的多参 URL(`?utm=a&ref=b`)被截断打不开(功能 bug)。macOS `open`/Linux `xdg-open` 走 argv、无 shell,安全。
- **触达**:P2 卡的 URL 由 agent 从搜索结果产出(可受攻击者影响)或用户粘贴,经用户点「在浏览器打开」触发。依据红线#4(不可信外链零信任/防注入)。
- **定级**:Windows 出货路径注入,当前开发/发布焦点是 Mac → [应改](Windows 发布前必修;若近期发 Windows 则升 [阻断])。不阻塞当前 Mac 里程碑。
- **修法**:改用 **`explorer`**——URL 作**单个 argv** 传入、**无 shell 解析**(元字符全当字面量),与 macOS `open`/Linux `xdg-open` 同属"argv 启动器"(评审认定二者安全的同一性质)。URL 仍先过 `validate_fetch_url`(仅 http/https)。**零依赖、无 unsafe FFI**;一并修掉多参 URL 打不开。
- **验证**:macOS `fmt`/`clippy --all-targets`/`test`(79)/`tsc` 全净;Windows fn 与已验证的 macOS/Linux 启动器**结构同构**(纯 std,仅程序名不同)→ 编译确定,**运行时需 Windows 构建点验**(与被替换的 cmd 代码同一局限)。

### [建议] web.js open 未复检 scheme → 已做(commit `5a54fdb`)
`web.js` 的 `open` 加 `^https?://` 闸,镜像桌面 `open_external`;契约两端 scheme 语义一致,防未来他处传 `javascript:`/`data:`。

### 仍开(不阻塞 Mac 里程碑)
- **真实搜索 MCP 接入**:stdio per-server env → 钥匙串(用户 2026-07-03 选暂缓)。→ **随后 greenlit 并实现,见第 4 轮**。
- **R1 macOS WKWebView GUI 冒烟**:job-sources 卡过 tsc/node/重嵌,真机全量目测待屏幕录制授权。

## 第 4 轮 — 通过(2026-07-03,范围 `274ae94..a1b2cb2`)· stdio MCP env→钥匙串

接靠 `API_KEY` env 的 stdio 搜索 MCP(Brave/Exa),把发现 agent 从 mock 机制级带向真实端到端。三片:①平台核(`McpServerConfig.env` 存名 · `mcp_set_env` 名校验 → 值直送钥匙串 `mcp.<name>.env.<VAR>` · `connect_client` 经 `spawn.env()` 注入 · `mcp_remove` 清孤儿 · `mcp_list.envConfigured` 只报名+状态)②契约 `rt.mcp.setEnv` 双端 ③设置页「变量」write-only UI。

独立实测:`cargo test` **81 → 82 passed / 4 ignored**、clippy `-D warnings` 净、`fmt --check` 0、tsc 净。**六条密钥红线逐条代码层核实(非采信声明)全部成立**:值不入配置/前端/日志(grep 实锤无 env 值日志)· `mcp_list` 只名+status · `mcp_remove` 清 env · 拒 URL 传 key · 名校验三层(set/resolve/spawn)· Untrusted/guardrail 未动。设计微调(spawn 收合成 `(name,value)` 对、钥匙串读值放 `connect_client`)**认可且更优**——让 `stdio_env_injection` 端到端验证注入而不污染登录钥匙串。**结论:通过,无阻断 / 无应改。**

### 2 条不阻塞 [建议] → 均已落地(commit `46d2c6c`)
- **[建议] 钥匙串 account 的 server 名字符隔离**(既有 token+env 通病,极低危):`is_valid_server_name` 拒名含 `.`(账户分隔符)+ 控制字符,`mcp_add` 早拒;关 account 串歧义,一并覆盖 token 与 env。CJK/空格等展示名仍放行。单测覆盖。
- **[建议] fixture docstring drift**:`mock_search_mcp.py` 注释更正(`env_echo` 会读 `SEEKER_TEST_ENV`)。

### 仍开
- **真实 Brave/Exa 接入 = 用户一步配置**(设置页填 `BRAVE_API_KEY` 值 + 该 server 用 npx 拉包);机制已由 `stdio_env_injection` 端到端证实,接上即发现 agent 真·端到端。
- **R1 macOS WKWebView GUI 冒烟**:待屏幕录制授权。

## 第 5 轮 — 通过(2026-07-03,范围 `a1b2cb2..HEAD`,7 提交)· 多应用平台化 阶段0+1

**方向级基线变更**(用户 2026-07-03 拍板 D1–D7):平台基座 → 平台 + 壳 + N 个可开关小应用(时光序模式)。`CLAUDE.md` §1/§3/§4/§5 + `RISKS` R4 + `proposal-app-platform.md` 已更新。**执行 Agent 披露此 diff 无任何前置独立评审(其 4-agent workflow 撞会话限额空跑)→ 本轮为第一双独立眼睛,按此加权深核。**

独立实测:`cargo test` **82 passed / 4 ignored**、clippy `-D warnings` 净、`fmt --check` 0、tsc 净、`node --check`(registry.js/manifest.js)净。**「平台层零触碰」验证成立**:rt 适配器 / capability / guardrail / keys / secret / `tauri.conf.json`(CSP)本范围全未改 → 前 4 轮平台结论仍立。

**零回归(硬验收)代码层核实**:① 时序链正确(`registry.js` head classic 先定义 `SeekerShell` → 内联块定义 `SEEKER_CARDS`/`frameQuery` → `manifest.js` 外链在其后执行,立即求值面仅 `SeekerShell`+`SEEKER_CARDS`、render/liveCount/frameQuery 全箭头惰性 → BOOT `setShell`+`PAGES.push` → INIT;ESM 的 `seeker-rt-ready` dispatch 在所有 classic 之后、监听器均 classic 内注册,不变式保持);② INIT 序列 **git show 旧版逐字节一致**;③ buildNav/syncNavCounts/rerenderPages/buildPages 语义等价(图标逐字节迁入 manifest、liveCount 表达式逐字同、`SEEKER_CARDS`/`frameQuery` 消费经 shell 解析回同对象/同语义);④ Mod+1..9 由 `initKeys` 未改 + PAGES 序保持 → **构造上等价**;⑤ `collections()` 无消费方(印证阶段1 集合声明纯元数据)。两处有意改动(buildPages 逐页 try/catch、徽标回调)为改善、happy-path 无回归。契约 `types.d.ts`(阶段2–5 长命)干净最小。**结论:通过,无阻断 / 无应改。**

**未自跑 live 浏览器冒烟**:preview 工具被另一会话占 8123 端口且未采纳备用端口而阻塞;零回归结论依上述代码层核实 ①–⑤ + 执行 Agent 浏览器实证(9 页 contentLen 逐字节对齐 / i18n 回程复原 / 框定链 / 零告警)。残留低。

### [建议] D3 三层闸红线措辞宜点名"结构性强制点"(阶段2 前)→ 已落地(commit 见下)
新增红线「应用数据 AI 可读 = 应用启用 ∩ manifest `aiReadable` ∩ 用户 per-app 授权」是好策略,但作后续验收依据宜再钉一句:**强制点在能力层 query 白名单(由三层闸动态计算),非仅提示层**——与既有 profile 隔离(`table_for`/`QUERYABLE` 白名单 + 编译期不变量)的结构性强制同格;否则易被实现成弱的提示暗示。并明确 D3 作用于 app 集合、与 profile 硬隔离**叠加**(profile 永不 AI 可读,不受任何 app `aiReadable` 影响)。
**落地**:CLAUDE.md §4 + proposal D3 已按上述措辞钉死(阶段 2 按此验收)。顺带提前闭掉后续关注②:registry `register`/`setShell` 增**注册期分组校验**(page.group ∈ 本 manifest.groups,失败指名道姓;正负向浏览器实测——非法 manifest 被拒且注册表不脏);proposal §7 补 per-collection 粒度开放问题。

### 披露评估(4 项)
- ① 无前置评审 → 本轮即独立评审,已按加权深核(代码层 + 尝试 live 冒烟)。
- ② 桌面 WKWebView 目测仍欠(R1)→ 同意,R4/R1 已录;网页降级冒烟证同一份 JS 功能等价,非 WKWebView 渲染。
- ③ 设置页语言绑定怪癖(~2295 行,只重绘设置页不走 setLang)= 既有、非本轮引入;**认可"零回归下不顺手修"的判断**,列后续清理候选。
- ④ messages 集合归属声明 = 阶段1 纯元数据(`collections()` 无消费方,已验)、`CLEARABLE_COLLS` 未动、行为零变化;阶段3 对齐。

### 后续关注
- A组 `is_valid_server_name`(拒 `.`/控制符、放行 CJK/空格)裁决充分,account 串唯一解析无遗漏面。
- buildNav 的 `GROUPS[p.group]` 若页 group 缺失会抛;阶段2 宜在壳注册期校验 `page.group ∈ groups`。
- `AppManifest.aiReadable` 为 per-app 单档;将来含差异敏感度集合的应用或需 per-collection 粒度。
- R1 屏幕录制权尽早授予,拿重构前 WKWebView 视觉基线(R4 闭合前置)。

## 第 6 轮 — 通过(2026-07-03)· 多应用平台化 阶段2 · D3 三层闸落能力层(`979b5fc..d4c3deb`)

> **结论:通过。无 [阻断]/[应改]。** 新增红线 D3 的结构性强制经评审逐行 + 构造绕过场景核实成立、非提示层可绕、与 profile 硬隔离叠加不削弱。独立实测 83 test/clippy/fmt/tsc/node 净;`secret.rs`/`data.rs` `table_for`/`types.invariants.ts`/CSP 本范围未改 → 既有 profile 硬隔离完好。
> **三重心逐条过**:① D3 强制在 `DataQuery::invoke` 独立双检(**静态 QUERYABLE ∩ 运行时可读集**),enum 裁剪仅提示、模型越界仍被拒 → 执行层强制;② 构造"前端推 profile":`sanitize_readable` 与 invoke 的 `is_queryable` **两处独立剔除** + 未改的 table_for/QUERYABLE/编译期不变量 = 3+ 层,`set_ai_readable` 非 capability 模型调不到 → 叠加不削弱;③ 后端 e2e 未跑 + 无内部预审 → 已加权深核,后端强制结构性代码层可证,残留并入 R1。
> **唯一 [建议](代码无需动,措辞精度)**:§4 红线原写「QUERYABLE 由常量变运行时函数」与实现分歧——**实现更强**(保留静态 QUERYABLE 硬底 + D3 交集只窄不宽),措辞应校正为"静态硬底 + 收紧",防未来照字面丢掉静态底。→ **已落地**(本次:CLAUDE.md §4 + §5 + proposal D3 措辞校正 + ⚠ 勿改动态)。
> **后续关注**:后端默认全 QUERYABLE 的启动窗口(rt-ready 前极短,仅应用自身业务数据、非 profile/跨应用,单用户桌面可忽略;求严格 D2 可默认空集)· R1 真机拿视觉基线 + 补 D3 后端 e2e。

以下为送审时的执行 Agent 完成说明(留痕)。**本轮验收重心 = D3 三层闸落能力层**。

**D3 三层闸能力层强制点(红线)· `capability.rs`**:三层(应用启用 ∩ manifest `aiReadable` ∩ 用户 per-app 授权)在**前端** shell 算 → `aiReadableCollections()` → `rt.capability.setAiReadable` 推给后端 → **强制在 capability.rs**(非提示层):
- `AiReadable(Mutex<HashSet>)` managed state,默认全 `QUERYABLE`(back-compat);
- `set_ai_readable` → `sanitize_readable` **只收 QUERYABLE 子集**(profile/未知/他应用剔除);**非对话可改**(模型调不到命令);
- query_data 三处收紧(`cx.app` 取 state):`invoke` 硬拦 = **静态 QUERYABLE ∩ 运行时可读集**、`available` 空集下架、`tool_schemas` 的 `collection.enum` 运行时裁剪;
- **硬不变式**:强制取**静态** QUERYABLE → `profile`/`messages`/`settings`/`secrets` 永不在内 → 交集永不含隐私表(无论前端推什么)→ 与 profile 硬隔离**叠加不削弱**。单测 `d3_readable_gate_sanitizes_and_defaults`。

**其余分片**:契约 `rt.capability.setAiReadable` 双端(desktop invoke / web noop);shell registry(`platform/shell`)enabled/order/per-app 授权持久化 `localStorage 'seeker-apps'` + `setEnabled/setOrder/setAiGrant/isAiReadable/aiReadableCollections/subscribe`,组合按启用+序过滤;应用管理页(侧栏网格入口→模态:开/关·↑↓排序·AI 授权·清数据走 guardrail+备份+reload),`shellReassemble` 重装配(重算 PAGES/GROUPS→页 DOM 对账→重建 nav→当前页下架则跳走→推 set_ai_readable)。

**执行 Agent 自验**:cargo test **83**(+d3 门)/clippy --all-targets/fmt/tsc/node/build 全净、桌面重启 0 错误;浏览器 e2e——关 jobseek 后 nav 仅设置/页对账/current 跳走/壳好用、**D3 可读集随开关/授权即刻变**(启用∩授权→5 集合;关或撤权→空)、应用管理模态开+四类按钮。

**诚实披露**:① 桌面 D3 后端强制 e2e(需 AI 工具循环+可用模型+桌面)未跑——浏览器验前端三层闸+装配,后端强制靠 Rust 单测(纯逻辑)+ 代码核实;② 本轮**无内部评审 workflow**(Ultracode off + 上轮撞会话限额)→ 外审是第一双独立眼睛,红线部分请加权;③ WKWebView 目测仍 gated(R1)。

**执行 Agent 建议重点审**:D3 强制的结构性(invoke 闸+静态交集是否非提示层可绕、sanitize 遗漏面)· profile 硬隔离叠加(构造"前端被注入推 profile"场景)· 重装配边界(当前页被关/全关仅剩壳/重复开关)· `'seeker-apps'` 损坏降级。

## 第 7 轮 — 通过(2026-07-04)· 平台化阶段3-a 逐页搬迁第一刀 + `@ts-nocheck` 模式批准(`d4c3deb..HEAD`)

> **结论:通过。无 [阻断]/[应改]。`@ts-nocheck` 作为逐页搬迁统一过渡模式 —— 批准(附 C1–C5 约束)。** actions 页经**逐字节纯剪切**核实零回归(actions.js 第8–125行 = index.html 删除的 ACTIONS 整块,仅加 @ts-nocheck 头 + 注释、零代码改动);平台层/红线/CSP 本范围空 diff;第6轮 [建议] D3 措辞逐字落地;R1 核心闭合按真机留痕采信(评审无法复跑设备操作)。83 test/clippy/fmt/tsc/node 净。
> **关键判断**:index.html 本就 tsconfig `exclude`(0 检查),搬进 apps/+@ts-nocheck 仍 0 检查 = **类型状态零退化**,却把搬迁变成纯机械剪切 = "一次只变一维"的正确重构纪律。
> **批准的 5 条边界约束(剩余页须守)**:C1 只纯剪切(同 commit 零代码改动;确需改代码→单独 tsc-checked commit)· C2 零回归靠 `node --check`+contentLen+渲染冒烟逐页验(tsc 不再兜底)· C3 @ts-nocheck 头带过渡标记+出口 · C4 账本随页销账(清空=适配器可删=搬迁完成)· C5 **新应用/新功能必 @ts-check**(@ts-nocheck 只给逐字搬的旧单体,绝不借此写新无类型代码)。
> **偏离信号**:每页 diff 应只有"整块平移 + @ts-nocheck 头 + 账本标注 + script 标签",出现别的即回归信号。3.y 类型化(转真 ES module + 账本清空 + 删适配器)建议单列里程碑审。

以下为送审时的执行 Agent 完成说明(留痕)。**本轮验收重心 = 搬迁模式确立**。范围含第6轮收尾(2144acf/812bfa8)+ R1 闭合(ff85d20)+ 阶段3-a(7b1dc24,核心)。

**阶段3-a · actions 页搬迁**(`7b1dc24`):行动清单页整个纵切(`renderActions` + `sessMins`/`recalcProgress`/`toggleAction`/`openActionDetail` + `actTab`,118 行)从 index.html 内联块**原样搬出** → `apps/jobseek/pages/actions.js`(classic 外链)。
- **零回归机理**:classic 全局语义不变 → `renderActions` 等全局名照旧,manifest / rerenderPages / jobsReRender / toggleAction→renderOverview 等引用**零改**。用 python 脚本精确搬(读实际内容,避免手抄 118 行出错)。
- **零回归实证**:浏览器 e2e——actions 页 contentLen **11095 = 与阶段1 基线逐字节一致**、8 卡+tabs、**toggle 点击成功、0 告警**;tsc / node --check(actions.js + 全内联)/ build 重嵌 / 桌面重启 全净。index.html 收缩 ~117 行。

**★ 需评审确认的模式决策 · `@ts-nocheck`**:搬进 `apps/`(tsc `include`)暴露——**单体代码从没过 tsc strict**(index.html 一直 `exclude`)。改到过 = 改代码 = 违背"原样搬零回归"(且几十处 implicit-any/possibly-undefined)。处理:搬出的页文件加 **`@ts-nocheck`**(原样搬、零回归;逻辑模块化阶段 3.y 改真 ES module 导出时再逐步类型化)。**论点**:搬到 apps/@ts-nocheck 与留 index.html/exclude 是**同等**类型检查状态,但换来物理分离(换业务=删 apps/jobseek/)+ 为模块化铺路;是过渡态,非终态。`monolith-globals.d.ts` 账本:`renderActions` 标注"实现已搬出、声明留作 manifest 的 tsc 桥"。**请评审判此妥协是否可接受作为阶段3 逐页搬迁的统一模式。**

**附 · 第6轮收尾**:D3 §4 红线措辞按第6轮 [建议] 校正为"静态 QUERYABLE 硬底 + 交集只窄不宽"(CLAUDE.md §4/§5 + proposal D3,`2144acf`)。**附 · R1 核心闭合**(`ff85d20`,非代码):屏幕录制授权后 computer-use 真机冒烟(dev binary 包 .app 装 /Applications)——WKWebView 逐项目测 总览/智能匹配/设置/应用管理模态 + 浅↔深主题 + 应用开关(关求职→壳好用)+ shellReassemble,全部正确;取得阶段2 后视觉基线。

**执行 Agent 建议重点审**:① @ts-nocheck 作搬迁统一模式是否可接受(核心);② 搬迁零回归(classic 全局语义下 renderActions 全局可见性、加载序);③ 账本 `monolith-globals.d.ts` 的语义(声明留作 tsc 桥,清空条件=逻辑模块化)。**过审后批量搬剩余 7 页 + 业务逻辑/卡片/frameQuery/数据层。**

## 第 8 轮 — ✅ 通过 · 平台化阶段3-b/c 批量搬迁 + 剩余交织策略裁定(`2efcba2..47beb65`)

> 3-b/3-c 经**逐字节纯剪切核实**零回归、C1–C5 全守;剩余交织**裁定走 C(混合,B 方向),否决 A**,C1 升级为「归属驱动零逻辑改动移动」。裁定详情见文末。

**3-b 渲染页组**(`6c7a21a`):overview/jobs/analysis/skills 四页渲染器 → `apps/jobseek/pages/*.js`。**3-c 业务逻辑组**(`3f24b8c`):录入×2 + SMART MATCH + RESUME modals + INTERVIEW + RESUMES 六块 → `apps/jobseek/logic/*.js`(含最后 3 页渲染器 match/resumes/interview)。
**成果**:全 8 页渲染器 + 录入 + 匹配/简历/面试逻辑搬出(共 11 文件);index.html 4557→**3130**(本批 −1427、累计 −33%)。
**守 C1–C5 零回归实证**:python 按注释块精确剪(整块平移)+ 清空块;**全 9 页 contentLen 与阶段1 基线逐字节一致**(1528/1836/2728/9935/15419/31329/11095/5709/2522)、搬出函数全局可用、tsc/node(11 文件+全内联)/build/桌面全净、0 告警;账本随刀销账(8 页渲染器全标"已搬出→*.js");平台层/红线/CSP 本范围未触。

### ★ 策略问询:剩余交织部分怎么搬(请评审对齐 C1 边界 + 裁定策略)
前 3 刀能"整块平移"因块**纯 jobseek**。剩余在单体的 jobseek **与壳基元交织**——卡片实现(renderMatchCardEl…)交织 `SEEKER_CARDS` 注册表 + `streamReply`(壳机制)· Copilot 业务(copMatch/copInterview/copReply)交织 Copilot chrome(壳)· `frameQuery` 紧邻壳的 `extractSeekerBlock` · 业务数据(JOBS/字典)+ hydrate/persist/seed 交织壳数据层 · 设置的 jobseek 段(goals/weights/主简历)交织壳设置框架。**不再是整块平移**。三条路:
- **A · 择取式**:从混块择 jobseek 搬走、留壳。零代码改动,但 diff 非整块平移(有择取痕迹)→ C1「纯剪切」边界需放宽到"择取式零改动移动"。
- **B · 先抽壳基元到 `platform/shell/`**:把交织的壳机制(`SEEKER_CARDS` 注册表 / Copilot chrome / `extractSeekerBlock` / 数据 hydrate 引擎 / 设置框架)先抽到 platform/shell/ 独立模块,让 index.html 剩的 jobseek 变纯净、再整块搬。更彻底(壳/应用真正分离,壳基元本不该在 index.html),但**动壳基元**(须严格零回归)。
- **C · 混合**:小的(卡片/frameQuery)择取式,大的(Copilot chrome/数据层/设置框架)先抽壳。
**执行 Agent 倾向 B/C**:壳基元抽到 platform/shell/ 是壳/应用分离的终态,且抽完后 jobseek 剩余又回到"整块平移"(C1 满足)。**请评审裁定策略 + C1 边界。**

**评审裁定(第 8 轮 · 通过)**:
- **3-b/c 逐字节纯剪切核实**:resumes.js 452 行 / match.js 53 行**全来自旧 index.html**;搬出函数在 index.html 无重复定义(grep「renderMatch 1 处」经查是 `renderMatchCardEl` 子串假阳性——卡渲染器,正确留 index.html);平台层/红线/CSP 空 diff;cargo 83 / clippy / fmt / tsc / node 10-of-10 净;index.html −33%。**通过**。
- **策略 = C(混合,B 方向),否决 A**。依据 §1 platform/apps 必须物理分离:壳基元(`SEEKER_CARDS` 引擎 / `streamReply` / `extractSeekerBlock` / Copilot chrome / `hydrate`·`persist` 框架 / 设置框架)**终态归属 `platform/shell/`**,现留 index.html 是过渡债;A 择取式不解决壳基元错位、不朝终态走,故否决作主策略。C 按归属分流:纯 jobseek(卡实现 / frameQuery 意图 / 专属数据 / 简历主资料段)→ `apps/jobseek/`(多为择取,引擎早已 shell 侧契约化);壳引擎 / 解析 / chrome / 数据框架 / 设置框架 → `platform/shell/`(真抽壳)。
- **C1 边界升级**:「整块连续平移」→「**归属驱动的零逻辑改动移动**」。判据 = 每段是否去对了家 + 移动本身零逻辑改动(非块连续;C1 本意一直是零代码改 = 零回归);允许非连续择取、允许抽壳,零回归靠 C2(node-check + contentLen + 冒烟)逐步验。
- **抽壳 5 约束**(抽壳 = 重入前几轮审过的平台层,非机械 @ts-nocheck 剪切):① **一基元一 commit**(各自独立搬+验,不一把梭);② 零逻辑改 + **契约扩展(`SeekerShell.*`)必审**(=平台面);③ **红线基元加倍审**——`extractSeekerBlock`/`streamReply` 抽出须保住无 XSS(URL 不进 DOM href / title 不渲染 / 卡 show() 转义)、`persist`/`hydrate` 抽出**绝不削弱 profile 隔离**(persist 永不把 profile 写进通用 AI 可读集、D3/profile 边界不动)、frameQuery 保 Untrusted 框定;④ **平台新模块尽量 @ts-check**(小纯基元如 `extractSeekerBlock` 直接类型化,同 registry.js;大的如 Copilot chrome 可 @ts-nocheck 过渡但优先类型化);⑤ **先低风险择取**(卡实现/frameQuery 意图 → apps,已契约分离)**后抽壳**(高风险平台重构)。
- **后续评审关注**:契约扩展面、`extractSeekerBlock`/`streamReply` 抽出无 XSS、`persist`/`hydrate` 抽出 profile 隔离不削弱;建议抽壳后补壳基元最小测试/冒烟(卡剥离 + 数据 persist,@ts-nocheck 下无 tsc 兜底)。

## 第 9 轮 — ✅ 通过 · 平台化阶段3-d~g 择取批(4 刀)+ 转抽壳裁定(`bcf7743..fa6c0b5`)

> 4 刀逐字节纯剪切核实零回归、C1 升级判据全守、红线基元卡系统安全属性逐字保留。**裁定:① 通过;② 现在转抽壳;③ 抽壳顺序 基础工具→AI引擎→Copilot chrome→数据框架→设置框架(自底向上+红线自轻到重)。** 详见文末。

**四刀**(均 @ts-nocheck · 归属驱动零改动移动):

| 刀 | 内容 | 归属证明 | 行 |
|---|---|---|---|
| 3-d `8ccda82` | frameQuery 意图框定 | 从壳基元 aiErrHTML/extractSeekerBlock **间**择出 → logic/frame-query.js | 41 |
| 3-e `c414476` | 卡实现束 + SEEKER_CARDS(30 函数) | 从 extractSeekerBlock/streamReply **间**择出 → cards.js | 404 |
| 3-f `fbfaf75` | 业务数据 const(STATUS/JOBS/SKILLS/ACTIONS/分析) | IC 壳图标留;⚠外链置块A前(match.js 解析期读 JOBS[0]) → data.js | 198 |
| 3-g `1971ead` | 数据派生 helper(jobsByStatus/topGapsReal…) | 从 $/$$/el(上)、PAGES(下)壳基元**间**择出 → data-helpers.js | 21 |

**零回归实证(C1 升级判据 / C2 / C3 / C4)**:每刀 git diff 删除行 == 搬入内容**逐字节一致**(零逻辑改动);搬出符号在 index.html 无定义、壳基元(extractSeekerBlock/streamReply/aiHTML/`$`/tt/IC/PAGES)原地留存待抽壳;逐刀冒烟(壳框定链各意图含**改简历联系方式红线** / 卡系统 11 种经壳齐全 + renderMatchCardEl 实渲染 / 数据 JOBS12·SKILLS35·ACTIONS8 完整 + **matchState 解析期读 JOBS[0]** / 数据 helper 全工作 + analysis 页渲染 / 0 console 错);tsc `--noEmit` 净、node `--check` 每文件净、内联 8 块语法净、加载序正确(data.js 913 < pages 1120 < match.js 1723)。**index.html 4675→2470(阶段3 起点 −47%)**;apps/jobseek 现 16 .js。平台层/红线/CSP 本批空 diff。

### ★ 策略确认:择取到此为界,请裁定转抽壳时机 + 顺序
按约束⑤「先低风险择取」已择完**干净可择取**的部分。**发现分水岭**:前三刀几乎不引用壳基元(frameQuery 纯函数 / 卡实现经 manifest 契约 / 数据纯字面量);**3-g 数据 helper 起引用 `tt`(壳 i18n · 运行时)**,而剩余 jobseek 与壳基元耦合更深——Copilot 业务响应(copMatch/copReply…)引用 `copClose`/`cAct`/`cBtn`(Copilot chrome)且**非连续**(与 chrome 交错)、设置 jobseek 段引用 `renderSettings`/`setState`/`persistProfileField`(**profile 红线**)。再硬择取会:diff 碎(非连续)+ apps 对 index.html 壳全局(tt/$/copClose)依赖增多、离终态更远。
**执行 Agent 建议转抽壳(评审 B 方向)**:先抽壳基元(i18n+DOM `tt`/`$`/`L`/`go` · Copilot chrome · AI 渲染引擎 `extractSeekerBlock`/`streamReply`/`aiHTML` · `hydrate`/`persist` 数据框架[红线:不削弱 profile 隔离] · 设置框架)→ `platform/shell/`,jobseek 剩余引用变契约调用、再整块归位(C1 自然满足)。
**请评审裁定**:① 择取批(3-d~g)是否通过;② 转抽壳时机(现在转 vs 再硬择取几刀);③ 抽壳顺序(建议先低风险 `tt`/`$` i18n+DOM,后 Copilot chrome / AI 引擎 / 数据框架[红线] / 设置框架)。抽壳批将**一基元一 commit + 契约扩展/红线基元必审**(遵第8轮 5 约束)。

**评审裁定(第 9 轮 · 通过)**:
- **① 择取批通过** —— 4 刀逐字节纯剪切核实(cards/data/frame-query/data-helpers 代码行全来自旧 index.html、0 重复定义、账本销账、平台层空 diff);**红线基元 cards.js 的 job-sources 卡无 XSS 逐字保住**(URL 经 `/^https?:/` 过滤 + `data-opensrc` 用索引非 URL 不进 DOM href、`rt.web.open` 走 scheme 校验、验链状态静态 innerHTML 抓回 title 不渲染、内容全 `esc`);加载序不变式满足(data.js@913 < match.js@1703,JOBS[0] 解析期可读);cargo 83/clippy/fmt/tsc/node 净;index.html −47%。
- **② 转抽壳时机 = 现在**(择取批过审即转)。分水岭精准:干净可择取已择完,3-g 起引用 `tt`(壳),剩余 Copilot 业务↔chrome(非连续)、设置段↔profile 红线,都是真交织本就该抽壳;继续硬择取是堆 apps→壳全局(tt/copClose/renderSettings)依赖负债、离终态越远。
- **③ 抽壳顺序 = 自底向上 + 红线自轻到重**:

| 序 | 抽哪个壳基元 → `platform/shell/` | 位置理由 |
|---|---|---|
| 1 | **基础工具** `tt`/`$`/`$$`/`el`/`esc`/`go`/`toast`/`openModal`/`aiHTML`/`IC` | 最底层、被引用最多、**零红线**、纯函数/DOM → 风险最低;抽出后其余基元 + apps 立即能改契约 |
| 2 | **AI 引擎** `extractSeekerBlock` + `streamReply` 卡剥离循环 | **红线**:保 Untrusted 框定 + 无 XSS;依赖①;卡遍历已走 `shell.cards()` 契约 |
| 3 | **Copilot/Agent chrome** `copInit`/`copSend`/`copClose`/`cAct`/`agentInit` | UI plumbing;依赖①②;jobseek 专属响应留 apps |
| 4 | **数据框架** `persistColl`/`persistMsg`/`hydrate*` 通用部分 | **红线**:profile 隔离不削弱(persist 永不把 profile 写通用 AI 可读集);单独严审;jobseek 专属集合 hydration 留 apps |
| 5 | **设置框架** `renderSettings` 壳部分(主题/语言/密度/模型)+ `persistProfileField` | **双红线**:profile + 设置不可经对话改;最后最严;jobseek 设置段(主简历/权重)留 apps,需 `manifest.settings` 契约扩展 |

- **贯穿约束(抽壳 = 重入平台层,非机械剪切)**:① 一基元一 commit 独立验;② 契约扩展(`SeekerShell.*`)必审;③ 红线基元(2/4/5)加倍审;④ 平台新模块尽量 @ts-check(①②直接类型化,同 registry.js);⑤ **过渡期壳基元抽到 `platform/shell/` 但仍挂 window 全局 + 保持 classic 载序**(兼容 @ts-nocheck 的 apps/index.html 按全局名引用 → 抽壳本身零回归;显式契约 import 留 3.y;载序每刀验[同第 5 轮时序法])——同 `SeekerShell`/`SeekerKeys` 先例。
- **后续关注**:抽壳 2/4/5 刀重点审契约面 + `extractSeekerBlock`/`streamReply` 无 XSS+Untrusted + `persist`/`hydrate` profile 隔离不削弱 + 设置「不可经对话改」;建议 AI 引擎+数据框架抽出后补最小冒烟/测试(共享 + @ts-nocheck 无 tsc 兜底)。

## 第 10 轮 — ✅ 通过 · 抽壳序1 基础工具(7 刀)(`a881196..5330bf4`)

> 序1 抽壳零回归经逐字节核实,抽壳模式 + 账本销账机制首次跑通。**裁定:① 序1 通过;② 放行序2(AI 引擎),红线批从严逐刀审。** 详见文末。

| 刀 | 基元 | → platform/shell/ | 类型 | 看点 |
|---|---|---|---|---|
| 1-a `a881196` | `$`/`$$`/`el` DOM | dom.js | @ts-check | 确立抽壳模式 |
| 1-b `b6e2638` | `IC` 图标 | icons.js | @ts-check | 零依赖 |
| 1-c `4486543` | `I18N`/`L`/`T`/`tt` | i18n.js | @ts-check | **首次账本销账**(tt 桥删) |
| 1-d `4bceb3e` | `toast`/`toastUndo` | toast.js | @ts-nocheck | 引用 $/el 返回值 |
| 1-e `9695c08` | `focusableIn`/`openModal`/`closeModal` | modal.js | @ts-nocheck | overlay 立即绑定留 index.html |
| 1-f `de1c455` | `aiHTML`/`displayText`/`toolStatusText` | ai-render.js | @ts-nocheck | aiHTML 保 SeekerMarkdown+esc 防注入 |
| 1-g `5330bf4` | 导航装配群(buildNav/setLang/go/toggleTheme/buildPages…) | nav.js | @ts-nocheck | 3 段非连续、跳过 chrome |

**抽壳模式(约束⑤落地)**:壳基元剪到 `platform/shell/xxx.js` + **挂全局(classic const/function)+ 载序前置**(在消费者之前;`setLang`/`go` 运行时调后定义的 chrome/setState/PAGES,函数延迟求值)→ apps/index.html 按全局名引用不变 → **抽壳本身零回归**。约束④:纯基元(dom/icons/i18n,不引用 DOM 返回值)直接 @ts-check+JSDoc;引用 `$`/`el` 返回值(Element|null)或复杂依赖(toast/modal/ai-render/nav)@ts-nocheck 过渡(null 处理留 3.y)。**账本销账首次示范**:`tt` 从 `monolith-globals.d.ts` 桥删(i18n.js @ts-check 实际定义,manifest 引用不断、tsc 仍净)——预演 3.y 收尾机制。

**逐刀零回归实证**:每刀符号逐字来自旧 index.html(逐字节 diff)、留存壳基元/绑定核实(overlay 立即绑定 grep -F、chrome 定义留)、node `--check` 每文件净、内联 8 块语法净、tsc `--noEmit` 净、载序验;冒烟——语言切换 zh↔en(setLang 调 chrome 无错)、模态焦点陷阱(openModal 聚焦/closeModal 清理/overlay)、go 切 9 页全对(current===p)、toggleTheme(documentElement data-theme light↔dark 复原)、0 console 错误。**platform/shell 从 registry 单文件 → 8 文件;index.html 2470→2316。平台层红线(profile/D3/CSP)本批未触。**

**请评审确认序1 通过 + 放行序2** —— 序2 = AI 引擎 `extractSeekerBlock`/`streamReply`(红线,评审此刀起逐刀重点审无 XSS + Untrusted 框定)。

**评审裁定(第 10 轮 · 通过)**:
- **① 序1 通过** —— 7 文件逐字节纯剪切核实(0 不来自旧 index.html、0 重复、node 7/7、cargo 83/tsc 净);抽壳零回归机制(classic 全局 + 载序前置 head 858-865)+ **首次账本销账 tt**(桥删→i18n.js @ts-check 成 tsc 真相源→净)双跑通;ai-render 的 aiHTML esc 防注入逐字保留;nav.js 非连续抽取正确(chrome 延迟引用留序3);红线核心(runtime/capability D3/secret/data profile/CSP/invariants)空 diff。
- **② 放行序2(AI 引擎),红线批从严逐刀审** —— 抽出后**逐刀验四条安全属性逐字保留**:① **streamReply 卡剥离**仍走 `window.SeekerShell.cards()` 契约、prose 经 aiHTML、**AI 原始 HTML 不进 DOM**、持久卡过滤不变;② **extractSeekerBlock** 提取 JSON 仍经 `CardSpec.valid` 校验后才渲染(不臆造/不注入);③ **Untrusted 框定**(数据非指令)不削弱;④ 抽出后挂全局 + 载序前置(streamReply 依赖 aiHTML@ai-render.js 序1 已就位)+ 类型化倾向同约束④;**补卡剥离 + aiHTML 最小冒烟**(引擎共享、@ts-nocheck 无 tsc 兜底)。
- **后续关注**:序4(数据框架)/序5(设置框架)是更重红线批(profile 硬隔离/设置不可经对话改),届时逐刀构造场景审;3.y 类型化单列里程碑审。

## 第 11 轮 — ✅ 通过 · 抽壳序2 AI 引擎(红线首刀)(`39bc96a`)

> AI 引擎四条安全属性经评审**代码层逐条核实**(+构造注入场景,不采信冒烟)、逐字节纯剪切。**裁定:① 序2 通过;② 放行序3(chrome)。** 详见文末。

**抽壳**:`extractSeekerBlock` + `streamReply`(+`aiLangHint`,48 行 2 段)→ ai-engine.js(@ts-nocheck);载序 ai-engine@866 在 ai-render@864 后(依赖 aiHTML)。消费者 copSend/agentSend(序3)运行时调。

**四条安全属性(评审第10轮点名 · 逐字保留 + 运行时冒烟)**:

| # | 属性 | 代码(逐字保留) | 冒烟实证 |
|---|---|---|---|
| ① | 卡剥离走契约 + **AI HTML 不进 DOM** | onDone:`CARDS=window.SeekerShell.cards()`→`extractSeekerBlock`→`CARDS[kind].valid`→`aiHTML(prose)`;流式 `aiHTML(displayText(acc))` | `aiHTML('<img onerror><script>')` → `<p>&lt;img…&quot;`(转义);probe **无 script 元素/无 img[onerror]** |
| ② | extractSeekerBlock 经 **valid 校验** | `if(b.data && CARDS[kind].valid(b.data))` 才 push/show | `valid({jobId:1})=true` / `valid({})=false`(拒无效) |
| ③ | **Untrusted 框定** | AI 输出经解析 + valid、当数据非指令 | 解析 `{jobId:1}` + prose 剥离(`前言文字`) |
| ④ | 挂全局 + 载序前置 | ai-engine@866 在 ai-render@864 后 | extractSeekerBlock/streamReply/aiLangHint 全局可用 |

**零回归**:3 符号逐字来自旧 index.html、index.html 无定义、安全属性代码逐字保留(`SeekerShell.cards`×3 / `valid` / `aiHTML`×3 grep 核实)、node/内联 8 块/tsc 净;冒烟 0 console 错误。**index.html 2316→2271;platform/shell 9 文件。红线核心(profile/D3/CSP)空 diff。** 建议评审构造场景验(恶意 seeker 块 / XSS payload)。

**过审后进序3(Copilot/Agent chrome)。**

**评审裁定(第 11 轮 · 通过)**:
- **① 序2 通过** —— 评审读全文 + **构造注入场景**,四条安全属性**代码层逐条成立(不采信冒烟)**:所有 AI 文本经 aiHTML 转义/净化**不进 DOM**、`JSON.parse`+`valid` gate(无 ReDoS/正则注入)、Untrusted 数据非指令、载序正确;ai-engine.js 45 实义行逐字节来自旧 index.html(@ts-nocheck 下无暗改);红线核心空 diff;cargo 83/tsc/node 净。**红线首刀证明红线批同样能纯剪切零回归。**
- **② 放行序3(Copilot/Agent chrome)** —— chrome 红线较轻,评审逐刀验:① `copSend`/`agentSend` 的 `copAppend('user', text.replace(/</g,'&lt;'))` **用户输入进 DOM 前的转义逐字保留**;② `frameQuery→streamReply` 转发链不变。jobseek 专属响应(copMatch/copReply)留 apps。
- **后续关注**:序4(数据框架·profile)/序5(设置框架·双红线)是更重红线批,届时构造场景逐刀审。

## 第 12 轮 — ✅ 通过 · 序3-a/b/c:Copilot 面板机制 + jobseek 业务择取 + appReply 契约扩展(`3202030..fdb3e1a`)

> 三刀纯剪切/择取零回归;**appReply 契约扩展代码层核实正当**(合 §1);web 缓存缺口裁为测试环境产物、非代码缺陷。**裁定:① 序3-a/b/c 通过;② 缓存缺口接受;③ 序3-d 红线刀放行条件重申。** 详见文末。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 3-a `f64737b` | Copilot 面板机制 copEl/copOpen/copClose/copToggle/copScroll/copAppend + cCard/cAct/cBtn/cSuggs | platform/shell/copilot-chrome.js | 纯抽壳 |
| 3-b `c558d6d` | jobseek Copilot 业务 aiSuggs/copMatch群/agentDeleteJob/findX/copReply(85 行,5 段非连续) | apps/jobseek/logic/copilot-actions.js | 纯择取 |
| 3-c `fdb3e1a` | **appReply 契约扩展** | registry/types/manifest/账本/index.html | **契约扩展(必审)** |

**★ 序3-c appReply 契约(评审必审 · SeekerShell.* 扩展)**:发现 copSend/agentSend 降级 mock **直调 copReply(jobseek 业务,3-b 已搬 apps)** —— chrome 抽 platform 前须契约化(平台不能直调 apps 业务,违反 platform 业务无关)。新增 `SeekerShell.appReply(text)`(**类比 frameQuery**):registry 遍历启用应用调 `a.appReply`、首个非空生效(无则空串);manifest 注册 `appReply: (t)=>copReply(t)`;copSend/agentSend 的 `copReply(text)` → `window.SeekerShell.appReply(text)`。**代码层核实**:tsc 净(契约类型 + manifest 引用 copReply 桥[账本 declare])、registry `register` 存整个 manifest(不过滤字段)、copReply 直调消失(只余注释)、SeekerShell.appReply 2 处;**契约链手动补测**(绕 web 缓存):SeekerShell.appReply 委派 jobseek copReply、delegatesToJobseek/works=true、无匹配返回空。

**⚠ 诚实缺口**:web 预览 webview **强缓存旧 manifest.js**(XHR cache-bust 拉的文件含 appReply,但 SeekerShell.list()[0] 加载的 manifest 对象无 appReply、只有 frameQuery)——**纯 web 开发环境问题**,桌面 Tauri(asset 协议无 HTTP 缓存)+ 浏览器硬刷新工作;"真实加载 appReply"我在 web 预览没能亲眼跑通,靠代码层 + 手动补测(jobseek.appReply=(t)=>copReply(t) 后契约链 delegates 成功)证明。请评审代码层核实契约正确性 + 判断此缺口。

**零回归(3-a/b)**:符号逐字来自旧 index.html、chrome 留存(copGo/agentChat/agentCancel/copSend)、jobseek 业务无定义、node/内联 8 块/tsc 净;冒烟——面板机制 copOpen/copClose/copAppend、copReply mock 回复工作(reload 后真实加载,非缓存)。index.html 2263→2156(3-a/b);红线核心(profile/D3/CSP)空 diff。

**过审后做序3-d 红线刀**(copSend/agentSend 抽 platform,逐刀验用户输入转义 `text.replace(/</g,'&lt;')` + frameQuery→streamReply 链;initShell 壳启动/agent mode 归属届时定)。

**评审裁定(第 12 轮 · 通过)**:
- **① 序3-a/b/c 通过** —— 3-a chrome 抽壳 / 3-b jobseek 择取逐字节纯剪切(copilot-chrome.js 10 行 / copilot-actions.js 112 行,0 不来自旧 index.html、copReply 0 重复);**3-c appReply 契约扩展代码层核实正当**:`registry.appReply` 遍历 enabledApps 首个非空生效(同 frameQuery、类型守卫齐)、types 契约干净、manifest 注册、账本加 copReply 桥、copSend/agentSend 经 `SeekerShell.appReply` 解耦不再直调 apps copReply(**合 §1 platform 业务无关**);用户输入转义(`copAppend('user', text.replace(/</g,'&lt;'))`)逐字未动、copReply 只嵌业务数据不回显用户输入 → 无用户输入 XSS;红线核心(runtime/D3/secret/profile/CSP/invariants)空 diff;cargo 83/clippy/fmt/tsc/node 净。
- **② 缓存缺口裁断 = 测试环境产物、非代码缺陷,接受** —— web 预览「加载的 manifest 对象无 appReply」是 HTTP 强缓存把同 URL 旧脚本喂给 webview;契约链代码层正确(逐环核实)、文件含 appReply(cache-bust XHR 证);桌面 Tauri `asset://` 无缓存 + web 硬刷新解;appReply 仅降级 mock 回复(未配 AI 的演示回退)、缓存态空回复属 cosmetic。→ 后续:真机 / 硬刷新顺带目测 appReply 降级路径(低优先,并入 R1)。
- **③ 序3-d 红线刀放行条件(重申)**:copSend/agentSend 抽 platform,逐刀验用户输入转义 `text.replace(/</g,'&lt;')` 逐字保留、`frameQuery→appReply→streamReply` 转发链不变、`persistMsg` 依赖处理;`initShell`/agent mode 归属(壳 vs apps)动前先判。
- **后续关注(下一 session)**:序4(数据框架)/序5(设置框架)是**最重红线批**(profile 硬隔离 / 设置不可经对话改),抽 `persist*`/`hydrate*`/`renderSettings` 时构造场景严审——保持一基元一 commit + 契约扩展必审,别合刀图快。

## 第 13 轮 — ✅ 通过 · 序4-a/b/c:数据框架(collId 契约 + 通用引擎 + messages · profile 红线)(`5529d77..e73aadf`)

> profile 硬隔离**代码层 + 构造场景验证逐字保持(双重保护)**;messages 不可 AI query;collId 契约语义等价、§1 纯净。**裁定:① 序4-a/b/c 通过;② 序4 剩余放行(新 session)。** 详见文末。

| 刀 | 内容 | 去向 | 红线/契约 |
|---|---|---|---|
| 4-a `06a6d81` | `SeekerShell.collId` 契约扩展(集合 id 键规则解耦) | registry/types/manifest/index.html | **契约扩展(必审)** · platform 零 jobseek knowledge、合 §1 |
| 4-b `0ee9cde` | 通用集合引擎 collPersistOn/seededColl/markSeededColl/withCollId/persistColl/hydrateColl | platform/shell/data-store.js | **profile 红线**:引擎零 rt.profile、只碰通用集合 rt.db |
| 4-c `e73aadf` | messages 持久化 __msgSeq/persistMsg | data-store.js(追加) | **红线**:messages 移出 QUERYABLE、AI 不可 query |

**★ 4-a collId 契约(评审必审 · 类比 appReply/frameQuery)**:通用引擎 withCollId 原含 skills 特判(`name==='skills'`→用 name 作键)=jobseek 集合 schema——抽 platform 前须契约化。`SeekerShell.collId(name,r)`:registry 遍历启用应用调 `a.collId`、首个非空生效(无则 undefined,调用方默认生成 r_id);manifest 注册 `collId:(name,r)=>name==='skills'?r.name:undefined`;withCollId 改用 `SeekerShell.collId`(平台无 jobseek knowledge)。代码层核实:tsc 净、skills 特判从 index.html 消失、契约链手动补测(绕 web 缓存)skills→name / 默认生成 / 有 id 原样 / 无规则→undefined 全对。

**★ profile 硬隔离(4-b/c 红线)**:persist 走 `rt.db`(通用集合)、profile 走独立 `rt.profile`——两条物理分离的 rt 通道(注释 1661「隐私表不在此(走 profile)」+ 1741「messages 移出 QUERYABLE」明证);data-store.js **零 rt.profile**(grep 核实);抽壳零逻辑改动,隔离逐字保持。**评审可构造场景验**:往 persistColl/persistMsg 塞 profile 字段也进不了 profile 仓库(不同 rt API)、AI 不可 query_data('messages')。

**零回归**:各刀符号逐字来自旧 index.html、搬出符号 index.html 无定义、node/内联 8 块/tsc 净;冒烟——collId 契约链(skills→name)、data-store 全局(persistColl/hydrateColl/withCollId)、collPersistOn web=false、0 错误。index.html 2156→2121;platform/shell 11 模块。红线核心(runtime/D3/secret/profile 文件/CSP/invariants)空 diff。

**序4 剩余(过审后新 session)**:4-d jobseek 专属数据大择取(jobs/resumes/种子/编排→apps,5 段 + rt-ready 绑定)+ jobsPersistOn/onboarding/demoMode 归属 + hydrateMessages(chrome 依赖)+ **profile 序5(persistProfileField/hydrateProfile · 双红线,构造场景严审)**。

**评审裁定(第 13 轮 · 通过)**:
- **① 序4-a/b/c 通过** —— **profile 硬隔离双重保护逐字保持(代码层 + 构造场景验)**:① 引擎零 `rt.profile`(data-store persistColl/hydrateColl/persistMsg 只走 `rt.db.upsert/list`,rt.profile 唯一命中是红线注释、无调用 → profile 仓库经此引擎碰不到)② 后端 `table_for` 兜底(data.rs/capability.rs/invariants/CSP 本批空 diff,即便前端 `persistColl('profile',…)` 后端 table_for 白名单**拒 'profile' 集合**);**构造场景** `persistColl('jobs',[{…,phone}])` → 字段进 jobs 业务集合 data_json、**非 profile 仓库**(rt.profile 独立通道)。**messages 不可 AI query**(QUERYABLE=jobs/skills/actions/resumes/iv_records 本批未改、不含 messages)。**4-a collId 契约语义等价 + §1 纯净**:withCollId has-id 分支不变、`collId('skills',r)=r.name` 精确等价旧特判、jobseek schema 移入 manifest、平台引擎零 schema knowledge。data-store 33 行 31 逐字节纯剪切 + 2 行 collId 改写(验等价);cargo83/clippy/fmt/tsc/node 净;红线核心空 diff。**证明「最重红线也能纯剪切 + 契约化零回归」。**
- **② 序4 剩余放行条件(新 session)**:4-d jobseek 专属数据大择取(**验搬出符号不重复 + rt-ready 绑定时序**;jobsPersistOn/onboarding/demoMode 归属动前判 壳 vs apps);序5 profile 设置框架(persistProfileField/hydrateProfile + renderSettings 壳部分 —— **抽 rt.profile 通道本身,逐行 + 构造场景严审**:profile 写仍只经 rt.profile 不串 rt.db、AI 仍拿不到 profile、设置不可经对话改)。
- **后续关注(备查)**:① 序4-d **rt-ready 立即执行绑定**(hydrateColl 在 seeker-rt-ready 触发)搬 apps 须保**监听器注册在 dispatch 前的不变式**(同第5轮时序法);② collId 生成格式与旧略异(不透明 id、边缘路径),**非回归**,记一笔。

## 第 14 轮 — ✅ 通过 · 序3-d Copilot/Agent chrome 前三刀:发送核心 + appSuggs 契约 + copInit(`e78fc55..e55562d`)

> 序3-d chrome 批前三刀送审(自第13轮 `e73aadf` 后无外审):3-d-1 发送核心(**红线转义**,已 commit 未外审)+ 3-d-2 第 4 个契约 `SeekerShell.appSuggs` 解耦 copInit 的 `aiSuggs` 反向依赖(合 §1)+ 3-d-3 copInit 逐字节纯剪切归位平台。**契约扩展必审 + 3-d-1 红线转义逐刀验**;附一条 ⚠ 开场白文案过渡债披露,请评审裁定。
> ⚠ 范围说明:3-d-1 于第13轮过审后单独 commit、无对应审查轮,本轮并入送审(红线刀不应跳过外审);若已另行审过,评审可略去该行。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 3-d-1 `e78fc55` | Copilot/Agent 发送核心 copSend/agentAppend/agentSend(22 行,2 段) | platform/shell/copilot-chrome.js | **红线抽壳**:用户输入进 DOM 前转义逐字保留 |
| 3-d-2 `8fa62bb` | **appSuggs 契约扩展**(开场建议解耦) | registry/types/manifest/账本/index.html | **契约扩展(必审)** · platform 零 jobseek knowledge、合 §1 |
| 3-d-3 `e55562d` | Copilot 面板初始化 copInit(10 行) | platform/shell/copilot-chrome.js | 纯抽壳(挂全局 + 载序前置) |

**★ 序3-d-1 发送核心(红线 · 评审第11轮点名逐刀验)**:copSend/agentAppend/agentSend(22 行 2 段)→ copilot-chrome.js。**用户输入进 DOM 前转义逐字保留**:`copAppend('user', text.replace(/</g,'&lt;'))` / `agentAppend('user', text.replace(/</g,'&lt;'))`;`frameQuery→(streamReply | appReply)` 转发链不变(appReply 契约序3-c 已就位)。零回归:3 符号逐字来自旧 index.html、copSend 无定义、node/内联/tsc 净;冒烟构造 `<img onerror=alert>` → copSend 转义为 `&lt;img&gt;`(DOM 无 img 元素)。index.html 2121→2101。

**★ 序3-d-2 appSuggs 契约(评审必审 · SeekerShell.* 第 4 个扩展 · 类比 appReply/frameQuery)**:copInit 开场白末尾 `cSuggs(aiSuggs())` —— `aiSuggs` 是 jobseek 业务(序3-b 已搬 apps/jobseek/logic/copilot-actions.js),copInit 抽 platform 前须契约化(平台不能直调 apps 业务,违反 §1)。新增 `SeekerShell.appSuggs()`:
- registry 遍历 `enabledApps` 调 `a.appSuggs()`、**首个非空数组生效**(无则空数组 → `cSuggs` 的 `.map` 安全),严格类比 appReply 的"首个非空生效";
- types 声明 `AppManifest.appSuggs?: () => string[]` + `SeekerShellApi.appSuggs(): string[]`;
- manifest 注册 `appSuggs: () => aiSuggs()`;账本(monolith-globals.d.ts)加 `aiSuggs` tsc 桥(同 copReply 桥);
- copInit 调用点 `cSuggs(aiSuggs())` → `cSuggs(window.SeekerShell.appSuggs())`。

**§1 纯净核实**:平台 `registry.appSuggs` 纯遍历委派、**零 jobseek schema/knowledge**;jobseek 建议器(零数据引导 vs 有数据真实查询的分支)全留 apps。**契约链冒烟(fresh static server,无 web 缓存缺口)**:`SeekerShell.appSuggs()` 委派 jobseek `aiSuggs()`、返回值与 `aiSuggs()` 直调**逐字一致**(4 建议);`loadedManifest.hasAppSuggs=true`——本轮无第12轮那种缓存缺口。

**★ 序3-d-3 copInit 抽壳**:`aiSuggs` 反向依赖经 appSuggs 契约解耦后,copInit 依赖全落平台(`$`/`IC`/`tt` 序1 + 本文件 copToggle/copClose/copSend/copAppend/cSuggs)→ 逐字节纯剪切归 copilot-chrome.js(接 copSend/agentSend 后)。挂全局 + 载序前置(copilot-chrome.js@868;copInit 于 INIT@copInit() 运行时调)→ 抽壳零回归。

**⚠ 诚实披露 · 开场白文案过渡债(请评审裁定)**:copInit 开场白 `tt('嗨,我是你的求职 Copilot…匹配岗位、改简历…')` 是 **jobseek 味业务文案**,随 copInit 逐字搬入平台。判断:appSuggs 契约解耦的是**跨层 call**(aiSuggs 反向依赖,硬红线);**文案**是更软的一类,且与**已过审的既有状态一致**——`agentGreet` 用 `T('agentGreet')`(平台 i18n)、序1-c 整张 i18n 表(含全部 jobseek 串)已在平台(第10轮过审)。故按**过渡债**处理(3.y 或后续 i18n 命名空间 / `manifest.greeting` 类契约清),**非本刀新增违规**,inline 注释 + 本披露留痕。若评审要求现在契约化开场白,即追加一刀;未擅自扩张 appSuggs 契约形态。

**零回归实证**:
- copInit 全局唯一定义(`grep -rn "function copInit" web/` = 1);copInit 函数体 **git diff 删除块 == copilot-chrome.js 搬入块 逐字节一致**(`diff -q` 空);
- 契约扩展 5 文件 +19/-1、copInit 刀 2 文件;node `--check` 每文件净、内联 8 块语法净、tsc `--noEmit` 净;
- 载序不变式:registry@858 定义 appSuggs、manifest@1990 注册、copilot-chrome@868 定义 copInit,INIT@copInit() 运行时消费,全在位;
- **红线核心空 diff**:src-tauri(capability.rs D3 / secret.rs / data.rs profile / tauri.conf CSP)+ types.invariants + runtime 本批未触(git status 核实);
- **index.html**:2121→2101(3-d-1)→2091(3-d-2/3);platform/shell 仍 11 模块(copilot-chrome.js 追加 copSend/agentSend + copInit)。

**序3-d 剩余(过审后续做)**:agentInit(内嵌 command-palette,cmd 归属先厘清)+ mode(renderModeSwitch/setAppMode/appMode/agentShowCanvas/agentCollapse/agentGreet)+ 辅助(copGo/agentChat/agentCancel/aiChatAvailable/**aiErrHTML[红线 err 转义]**/agentScroll)+ updateAgentChrome/updateCopChrome;⚠ **initShell 是壳启动非 chrome**,归属动前判。

**评审裁定(第 14 轮 · 通过 · 无阻断/应改)**:
- **① 序3-d-1/2/3 通过** —— **3-d-1 红线**(第11轮点名逐刀验):用户输入进 DOM 前转义逐字保留(copilot-chrome.js:23/34 `Append('user', text.replace(/</g,'&lt;'))`)、构造 `<img onerror>`→`&lt;img&gt;`(DOM 无 img)、逐字节纯剪切、copSend/agentSend 0 重复;**3-d-2 appSuggs 契约正当 + §1 纯净**:`registry.appSuggs`(遍历应用、首个非空数组生效、否则 `[]`、Array 守卫,同 frameQuery/appReply/collId 模式)+ types 干净 + manifest `appSuggs:()=>aiSuggs()` + 账本 aiSuggs 桥;调用点 `cSuggs(aiSuggs())→cSuggs(SeekerShell.appSuggs())` → 平台 copInit **零 aiSuggs 直调(=0)**、经契约委派、jobseek 建议器(aiSuggs)留 apps、语义等价(单应用退化为 aiSuggs 结果);**3-d-3 copInit** 31 新增行中 30 逐字节纯剪切、1 行 appSuggs 改写(已验)。平台核心空 diff(capability D3/secret/data profile/CSP/invariants/runtime 未触);cargo83/clippy/fmt/tsc/node 净;index.html 2121→2091。
- **② ★ 开场白文案过渡债 = 认可按过渡债处理,不要求现在契约化** —— 依据:硬红线(跨层 call)已正确契约化(appSuggs);开场白是**文案(内容)非跨层 call**——jobseek 味串留平台 copInit **不导致结构耦合**(删 jobseek 平台后 copInit 仍能跑、只显示一句孤儿问候,不像跨层 call 会调未定义函数断裂)→ 属**内容洁净度软债、非 §1 结构违规**;既有先例(第10轮已过审)i18n.js I18N 表已含 jobseek 文案(agentGreet=「求职 Agent / 匹配岗位 / 改简历」),单独要求 copInit 契约化却放任 agentGreet 不一致;未过度设计(没把开场白硬塞进 appSuggs 污染"建议数组"契约语义,好判断);有出口(inline 注释 + 披露留痕)。**附约束**:开场白 + i18n 表 jobseek 串**统一记入「文案归属待清账」**,3.y / 一个专门刀以 `manifest.greeting` 契约 + i18n 命名空间拆分(平台 i18n 只留平台串、jobseek 串随 manifest)一并清,别无限期滞留。→ **本轮已落显式出口**:`platform/shell/i18n.js` 头部 + `copilot-chrome.js` copInit inline 注释标出待清账。
- **③ 后续关注(序3-d 剩余,过审后续做)**:① **aiErrHTML(红线 err 转义)** 抽时逐刀验其对 err 的转义保留(第11轮已挂号——provider 错误体经它进 DOM,须保转义);② **initShell 是壳启动非 chrome**,动前判归属(壳 vs apps)、别顺手混入 chrome 刀;③ agentInit 内嵌 command-palette(cmd 归属先厘清)、mode 群、hydrateMessages(依赖 chrome agentAppend)按归属分刀。

## 第 15 轮 — ✅ 通过(补审) · 序3-d 剩余 chrome:辅助群 + aiErrHTML 红线 + mode 群(`a267eac..80a5489`)

> 序3-d chrome 批续三刀(无契约扩展):辅助 chrome 群 + 红线 aiErrHTML(err 转义)+ Agent mode 群,逐字节纯剪切归位平台。**红线刀 aiErrHTML 逐刀验 err 转义**(第11/14轮挂号);命令面板 / agentInit / initShell 按归属留待下一子批(见文末)。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 3-d-4 `02bfb70` | 辅助 chrome copGo/agentChat/agentCancel/aiChatAvailable/agentScroll(5 单行) | platform/shell/copilot-chrome.js | 纯抽壳 |
| 3-d-5 `9977231` | **红线** AI 错误渲染 aiErrHTML | platform/shell/ai-render.js | **红线抽壳(err 转义)** |
| 3-d-6 `80a5489` | Agent mode 群 appMode/appReady/renderModeSwitch/setAppMode/agentShowCanvas/agentCollapse/agentGreet | platform/shell/copilot-chrome.js | 纯抽壳(2 段非连续绕 initShell) |

**★ 序3-d-5 aiErrHTML(红线 · 第11/14轮挂号 · 评审逐刀验 err 转义)**:provider 错误体经 streamReply onError → DOM。转义逐字保留:`const m=String((err&&err.message)||err).replace(/</g,'&lt;')`;onclick 只 `copClose()+go('settings')`(**设置不可经对话改**、仅导航打开,不改配置/密钥)。归 `ai-render.js`(与 aiHTML esc 安全家族同处)。**构造场景冒烟**(手动补最新 ai-render.js 绕 webview 缓存):`aiErrHTML({message:'<img src=x onerror=alert(1)><script>bad()</script>'})` → probe **无 img 元素 / 无 script 元素** + `&lt;img` 转义字面在 + 设置按钮在 → provider 错误注入防住。

**序3-d-4 辅助 chrome**:copGo(关面板+导航)/agentChat(追加到活动面板)/agentCancel(取消回执)/aiChatAvailable(流式能力判定)/agentScroll,5 个单行 chrome,无红线、无 jobseek 代码耦合(jobseek 经 onclick 字符串运行时调 copGo/agentCancel = 过渡态,同 copReply 先例)。

**序3-d-6 mode 群**:appMode/appReady(classic 全局词法绑定,与消费者 copSend/agentChat 同文件)+ renderModeSwitch/setAppMode/agentShowCanvas/agentCollapse/agentGreet。2 段非连续(绕开 initShell)。⚠ agentGreet 的 `T('agentGreet')` = 平台 i18n jobseek 味开场白 = **文案归属待清账**(同 copInit,第14轮已裁认可、i18n.js 头部出口已挂)。⚠ **initShell 是壳启动非 chrome**,留 index.html、归属另判(评审后续关注③),未混入本刀。

**零回归实证**:
- 12 基元各全局唯一定义(grep `function X`/`let X` = 1);函数体/代码行 **git diff 删除 == 搬入 逐字节一致**(3-d-4:5 行;3-d-5:5 行含转义;3-d-6:20 代码行,唯我加的 3 行块注释非代码);
- node `--check` 每文件净、内联 8 块语法净、tsc `--noEmit` 净;
- 冒烟(fresh server;mode 群/辅助 chrome 真加载,aiErrHTML 手动补最新绕缓存):红线 aiErrHTML 转义防注入、setAppMode('agent')→body[data-appmode]=agent + agentGreet 渲染 + renderModeSwitch [agent:on,editor:off] + agentChat 追加、reset editor、0 console 错;
- **红线核心空 diff**:src-tauri(capability D3/secret/data profile/CSP)+ invariants + runtime 本批未触;
- index.html 2091→2064;copilot-chrome.js 追加辅助群+mode 群,ai-render.js 追加 aiErrHTML。

**⚠ 诚实缺口(同第12轮裁定)**:webview 强缓存旧 ai-render.js(3-d-5 前无 aiErrHTML)——`served_hasAiErrHTML=true`(cache-bust fetch 证磁盘最新含 aiErrHTML)、但初次加载页面 `window.aiErrHTML=undefined`;copilot-chrome.js 反而新鲜加载(copGo/setAppMode 全在)。**测试环境 HTTP 强缓存产物、非代码缺陷**(桌面 Tauri asset:// 无缓存);红线冒烟靠「手动补最新 ai-render.js」证真实代码工作。

**序3-d 剩余(下一子批 · 需第 5 个契约,请评审预裁方向)**:命令面板 = **通用机制**(cmdIsOpen/cmdFilterList/cmdRender/cmdOpen/cmdClose/cmdRun)+ **jobseek 命令数据**(AGENT_CMDS 的 /match…/settings、renderAgentCmds 的技能 chips)——**cmd 归属**:机制→platform、数据→apps;机制 cmdFilterList 引用 AGENT_CMDS = 反向依赖须契约化(拟 **`SeekerShell.appCommands()`**,类比 appSuggs 首个非空委派);agentInit 随命令面板;updateAgentChrome(调 renderAgentCmds)随之(或经契约);updateCopChrome 可独立抽;**initShell**(壳启动)归属决策(拟壳侧 init 模块、非 chrome);hydrateMessages(依赖 agentAppend)。

**评审裁定(第 15 轮 · 补审 · 通过 · 无阻断/应改)**:
- **补审闭合审查链缺口** —— 15 轮(含红线刀 aiErrHTML)序列先于 16/17 由另一 flow 送审、评审未审;现补送 = **红线刀不跳外审**(第14轮定的原则);16/17 建其上、15 过审**回溯验证 16/17 基线**,**14→15→16→17 审查链无缺口**。
- **① ★ 3-d-5 aiErrHTML 红线(第11/14轮挂号)= 成立**:**err 转义** `String((err&&err.message)||err).replace(/</g,'&lt;')` → provider 错误体 `<`→`&lt;` 再进 `<span>`;构造 `{message:'<img onerror><script>'}` → 无 `<` 字面 → **无法形成元素**(转义 `<` 足矣,同代码库既有防注入模式);**onclick 仅 `copClose()+go('settings')`——仅导航打开设置、不改设置**(合 §4.2 设置不可经对话改),onclick 串静态、`m` 不入 onclick → 无二次注入;归 ai-render.js(与 aiHTML esc 安全家族同处)得当。
- **② 3-d-4 辅助群 / 3-d-6 mode 群纯剪切**:逐字节来自旧 index.html、非纯剪切仅模块注释、0 重复;`agentGreet` 的 `T('agentGreet')` = **第14轮已裁「文案归属待清账」**(同 copInit,3.y manifest.greeting + i18n 命名空间清)——一致、无新裁定。平台核心空 diff;cargo83/clippy/fmt/tsc/node 净;index.html 2091→2064。
- **③ 缓存缺口 = 复用第12轮裁断:接受** —— webview 强缓存旧 ai-render.js 是**测试环境 HTTP 强缓存产物、非代码缺陷**(`served_hasAiErrHTML=true` 证磁盘正确;桌面 asset:// 无缓存 + 硬刷新);红线冒烟靠手动补最新文件证真实代码 → **后续关注**:真机顺带目测一次错误卡(低优先,并入 R1)。
- **④ 命令面板方向(15轮末问)= 已第16轮落地并过审**:第 5 契约 `SeekerShell.appCommands()` 用**并集语义**(汇总型,同 cards())——方向正确、已闭环。

## 第 16 轮 — ✅ 通过 · 序3-d 命令面板 + agentInit:appCommands 契约(第 5 个)(`a142306..28e392f`)

> 序3-d chrome 第三子批(命令面板归属):第 5 个契约 `SeekerShell.appCommands` 解耦命令数据 → jobseek 命令数据择取 apps → 命令面板机制抽壳 → agentInit 抽壳。**契约扩展必审**;附 renderAgentCmds 触发用 typeof 守卫 vs 契约 的判断,请评审预裁。(注:本轮基于第15轮之上,第15轮尚待审。)

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 3-d-7 `7e97391` | **appCommands 契约扩展**(命令面板数据解耦) | registry/types/manifest/账本/index.html | **契约扩展(必审)** · §1 纯净 |
| 3-d-8 `3a8de1f` | jobseek Agent 命令数据 AGENT_CMDS + renderAgentCmds | apps/jobseek/logic/copilot-actions.js | 纯择取 |
| 3-d-9 `f3b0e28` | Agent /命令面板机制 cmd*(8 基元) | platform/shell/copilot-chrome.js | 纯抽壳 |
| 3-d-10 `28e392f` | Agent 输入+命令面板接线 agentInit | platform/shell/copilot-chrome.js | 抽壳(1 行 renderAgentCmds 加守卫) |

**★ 3-d-7 appCommands 契约(评审必审 · 第 5 个 SeekerShell.* 扩展)**:命令面板机制 `cmdFilterList` 硬引用 `AGENT_CMDS`(jobseek 命令数据)= 反向依赖,抽机制前须契约化。`SeekerShell.appCommands()`:
- registry 遍历 enabledApps 调 `a.appCommands`、**并集 push**(★不同于 framer/appReply/appSuggs 的"首个非空"——命令面板汇总多应用命令,同 `cards()`/`pages()` 合并语义);
- types 增 `CommandSpec` 接口(cmd/label/desc/run,与单体 AGENT_CMDS 同构)+ `AppManifest.appCommands?` + `SeekerShellApi.appCommands()`;
- manifest `appCommands:()=>AGENT_CMDS`;账本 `declare const AGENT_CMDS: CommandSpec[]` tsc 桥;
- `cmdFilterList`:`AGENT_CMDS` → `const A=window.SeekerShell.appCommands()`(缓存一次,行为等价)。
**§1 纯净**:registry.appCommands 纯遍历委派、**零 jobseek 命令 knowledge**(grep AGENT_CMDS/jobseek/aiSuggs = 0);命令数据 + chips renderer 留 apps。**契约链冒烟(fresh server,无缓存缺口 · loadedManifest.hasAppCommands=true)**:`SeekerShell.appCommands()` 返 13 命令 ≡ AGENT_CMDS;cmdFilterList('match')=[/match]、('简历')=[/resume];live 面板 cmdOpen 渲 13 行、filter('interview')=[/interview]、cmdClose 收。

**★ 3-d-10 agentInit 的 renderAgentCmds 触发(请评审预裁 typeof 守卫 vs 契约)**:agentInit 唯一 jobseek 触点是 `renderAgentCmds()`(技能 chips,3-d-8 在 apps)。抽平台后改 `if(typeof renderAgentCmds==='function') renderAgentCmds()`——**同 updateAgentChrome 的既有守卫**(pre-existing 单体既有代码,index.html:945;非第10轮专门审——第10轮审 nav.js),jobseek 启用时行为等价、禁用时 no-op 不抛;§1:平台不硬依赖 app 渲染器。**判断**:renderAgentCmds 是 render 触发(非数据/非跨层 mock),既有 updateAgentChrome 已 typeof 守卫先例,故用守卫(而非再加第 6 契约)保持一致、不半迁移。**若评审偏好 `renderAppChips` 契约**替代守卫,建议与 updateAgentChrome 一并迁(下一批,两处同改)——本刀先守卫、留出口。

**3-d-8/9 纯剪切/择取**:AGENT_CMDS(13 条)+ renderAgentCmds(7 chips 渲染器)→ apps(29 行逐字节);cmd* 机制 8 基元(11 行)→ platform 逐字节。

**零回归实证**:
- 各基元全局唯一定义(agentInit/cmd*/renderAgentCmds = 1;AGENT_CMDS = 1 真定义 + 1 账本 ambient declare 桥,同 aiSuggs);
- 逐字节:3-d-8 removed⊂apps(29 行)、3-d-9 removed⊂platform(11 行)、3-d-10 agentInit 17 非守卫行 verbatim + 1 行 renderAgentCmds 加守卫(已隔离展示);
- node/内联 8 块/tsc 净;**红线核心空 diff**(capability/secret/data profile/CSP/invariants/runtime);
- 冒烟 0 console 错、截图命令面板 13 命令 + 7 chips;index.html 2064→2006(阶段3 起 −57%)。

**序3-d 剩余(收尾)**:updateAgentChrome/updateCopChrome(updateAgentChrome 调 renderAgentCmds——与本刀 agentInit 守卫呼应,一并定 typeof vs renderAppChips 契约)+ **initShell**(壳启动非 chrome,归属决策:拟壳侧 init 模块)+ hydrateMessages(依赖 agentAppend)。之后序3-d 收官,转序4-d / 序5。

**评审裁定(第 16 轮 · 通过 · 无阻断/应改)**:
- **① 序3-d-7~10 通过** —— **★ appCommands 契约并集语义验证正确**:`registry.appCommands` 对所有启用应用 `out.push(...cs)`(**并集**,同 cards()),非首个非空 —— **契约分类清晰**:**汇总型**(cards/collections/groups/**appCommands**)并集、**选择型**(frameQuery/appReply/appSuggs/collId)首个非空;CommandSpec 类型干净;§1 纯净(registry `AGENT_CMDS`=0、cmdFilterList 经 `SeekerShell.appCommands()`);单应用退化为 AGENT_CMDS 语义等价。3-d-8/9/10 逐字节纯剪切(AGENT_CMDS/renderAgentCmds、cmd* 面板、agentInit 全 verbatim,"非纯剪切"仅模块头注释 + 2 处预期改写=cmdFilterList 契约 / agentInit 守卫;0 重复定义)。**红线转发链保留**:agentSend 用户输入转义 `text.replace(/</g,'&lt;')` + `frameQuery(契约)→streamReply|appReply(契约)` 逐字未动。平台核心空 diff;cargo83/clippy/fmt/tsc/node 净;index.html 2064→2006(阶段3 −57%)。
- **② ★ renderAgentCmds 守卫 = 认可守卫作本刀处理,附强制待契约化出口** —— 依据(均已核实):(1)**§1 结构底线满足**:守卫使 jobseek 缺失/禁用时不调不抛(旧 agentInit 是**直调 `renderAgentCmds()`**,jobseek 禁用会 ReferenceError)→ 守卫是**必要的 §1 适配、比旧直调更安全、非退步**;(2)**一致性**:`updateAgentChrome`(index.html:949)**既有 typeof 守卫**(pre-existing 单体既有,非第10轮——第10轮审 nav.js;既有事实成立、一致性论点站得住),单独契约化 agentInit 却放任 updateAgentChrome=半迁移;(3)未过度设计。**★ 强制约束(非可选 · 本轮通过前提)**:序3-d chrome 收尾抽 `updateAgentChrome`/`updateCopChrome` 时**必须**把 `renderAgentCmds` **两触点一并契约化**(`SeekerShell.renderAppChips` / chrome 扩展点契约),**不留永久符号耦合**;记入**待契约化账**。→ **本轮已落显式出口**:copilot-chrome.js agentInit + index.html updateAgentChrome 两处 inline 注释标出强制 renderAppChips 待契约化账。
- **③ 契约体系观察(正面)**:5 个 `SeekerShell.*`(frameQuery/appReply/appSuggs/collId/appCommands)语义分类成熟一致 —— **选择型首个非空、汇总型并集**;壳/应用解耦良性收敛。
- **④ 后续关注**:**待契约化账** = `renderAgentCmds`(2 触点,chrome 收尾以 renderAppChips 清)+ 开场白/i18n 文案归属(3.y 以 manifest.greeting + i18n 命名空间清);`aiErrHTML`(红线,第15轮送审中)、`initShell`(壳启动非 chrome,归属先判)仍在序3-d 剩余清单。

## 第 17 轮 — ✅ 通过 · 序3-d 收官:renderAppChips 强制契约(第 6 个)+ updateChrome + hydrateMessages(`b316eb5..d345586`)

> 序3-d chrome 收官三刀:**第 16 轮强制待契约化账兑现** —— 第 6 个契约 `SeekerShell.renderAppChips` 清 `renderAgentCmds` 符号耦合;`updateAgentChrome`/`updateCopChrome` + `hydrateMessages` 抽壳。**契约扩展必审**;`initShell` 归属裁定见文末。**序3-d chrome 至此收官。**

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 3-d-11 `a7ef879` | **renderAppChips 契约(第 6 个)· 兑现第16轮强制账** | registry/types/manifest/账本/index.html/copilot-chrome.js | **契约扩展(必审)** · §1 符号解耦 |
| 3-d-12 `92d8e3e` | updateAgentChrome/updateCopChrome(语言重渲 chrome) | platform/shell/copilot-chrome.js | 纯抽壳 |
| 3-d-13 `d345586` | 对话历史恢复 hydrateMessages(messages 壳自持) | platform/shell/copilot-chrome.js | 纯抽壳(红线 esc) |

**★ 3-d-11 renderAppChips 契约(必审 · 第 6 个 SeekerShell.* · 兑现第16轮强制账)**:第16轮裁定 `renderAgentCmds` 两触点(agentInit + updateAgentChrome)typeof-守卫直调 = 活符号耦合,**强制(非可选)契约化**。`SeekerShell.renderAppChips()`:
- registry 遍历 enabledApps 全调 `a.renderAppChips`、**汇总型副作用**(无返回,同 cards() 合并类;chrome 扩展点);
- types `AppManifest.renderAppChips?` + `SeekerShellApi.renderAppChips()`;manifest `renderAppChips:()=>renderAgentCmds()`;账本 `declare function renderAgentCmds` 桥;
- 两触点 `if(typeof renderAgentCmds==='function')renderAgentCmds()` → `window.SeekerShell.renderAppChips()`。
**★强制账已清 · 代码层核实**:平台**代码**零 `renderAgentCmds` 引用(grep platform/ + index.html:仅注释解释解耦,代码全 `renderAppChips()`);符号耦合断,jobseek 经 manifest 暴露渲染器。§1 纯净(registry 零 jobseek 符号)。**契约链冒烟(fresh server,无缓存缺口 · loadedManifest.hasRenderAppChips=true)**:`SeekerShell.renderAppChips()` → jobseek renderAgentCmds 渲 7 chips 进 #agentCmds;lang 切 en → updateCopChrome copLaunch='Ask AI · ⌘K' + updateAgentChrome agentSub=EN + chips 重渲、zh 复原。

**3-d-12 updateChrome / 3-d-13 hydrateMessages 纯剪切**:updateAgentChrome/updateCopChrome(11 行)语言重渲、nav.js setLang 运行时调;hydrateMessages(20 行)messages 壳自持集合历史恢复,**★红线:持久用户文本 `esc(r.text)` 转义逐字保留**、AI 文本 aiHTML、持久卡 CARDS[kind].persist&show;纯平台依赖、无 jobseek 耦合(web collPersistOn=false 早退,桌面路径 esc 代码层验)。

**★ initShell 归属裁定(评审后续关注② · 我的决策请评审确认)**:initShell(壳启动:拖放守卫/侧栏宽度·语言恢复/hydrateSettings/侧栏·语言·resize 接线/setLang)**非 chrome**。**决策:不并入本 chrome 批(遵评审"别混入 chrome 刀"),归 序5(设置框架)或独立 shell-boot 刀** —— 理由:initShell 调 `hydrateSettings`(@990,restores goals/weights/appearance = 序5 设置 territory)+ toggleSidebar(侧栏 chrome,未抽);核心耦合是设置 hydration,与序5 同批最连贯。留 index.html,序5 一并处理。

**零回归实证**:
- 各基元全局唯一定义;逐字节:3-d-12 removed⊂platform(11 行)、3-d-13 removed⊂platform(20 行含 esc);3-d-11 两触点改写(typeof 守卫→契约)+ registry/types/manifest 契约;
- node/内联 8 块/tsc 净;**红线核心空 diff**(capability/secret/data profile/CSP/invariants/runtime);
- 冒烟 0 console 错、截图 7 chips 经契约渲染 + lang 双向;**index.html 2006→1974(阶段3 起 −58%)**。

**序3-d chrome 收官** —— Copilot/Agent chrome 全抽 platform/shell/copilot-chrome.js(面板机制 / 发送核心 / copInit / 辅助群 / mode 群 / 命令面板 / agentInit / updateChrome / hydrateMessages)+ ai-render(aiErrHTML)+ **6 契约**(frameQuery / appReply / appSuggs / appCommands / collId / renderAppChips)。**剩余非 chrome**:`initShell`(序5)+ 序4-d jobseek 数据大择取 + 序5 profile 设置框架[双红线,最严]。

**评审裁定(第 17 轮 · 通过 · 无阻断/应改 · 🏁 chrome 收官)**:
- **① 序3-d-11/12/13 通过** —— **★★ 第16轮强制账已清(硬验收 grep 实证,不采信"已清"声明)**:`registry.renderAppChips` 是**汇总型副作用**(`enabledApps().forEach(a=>a.renderAppChips?.())`,全调无 return,同 cards()、chrome 扩展点)、两触点(agentInit@115 / updateAgentChrome@127)均改 `SeekerShell.renderAppChips()`、**平台代码零 `renderAgentCmds` 引用**(grep 命中全在注释解释解耦、无一处代码调用/typeof 守卫)→ **活符号耦合断、第16轮强制条件精确兑现**;第 6 契约。**3-d-13 hydrateMessages 红线** `r.role==='user' ? esc(r.text) : aiHTML(r.text)` 用户文本转义 + AI aiHTML 逐字保留;3-d-12/13 体纯剪切、0 重复。平台核心空 diff;cargo83/clippy/fmt/tsc/node 净;index.html 2006→1974(阶段3 −58%)。
- **② ★ initShell 归属 = 认可(不并入 chrome、归序5/独立 shell-boot 刀)** —— 依据:initShell 是壳启动 bootstrap **非 chrome**(并入 chrome 破"归属驱动分刀"纪律,第8/9轮判据);调 `hydrateSettings`(序5 设置/profile territory 双红线,过早抽会在 chrome 批碰序5红线面);留 index.html 不阻塞不变。不必提前独立抽,随序5 最自然(序5 过大则届时拆独立 shell-boot 刀)。
- **③ 🏁 序3-d chrome 收官**:Copilot/Agent chrome 全落 copilot-chrome.js + ai-render(aiErrHTML)+ **6 契约** —— **选择型首个非空**(frameQuery/appReply/appSuggs/collId)、**汇总型并集/副作用**(cards/collections/groups/appCommands/renderAppChips);契约面成熟一致。**评审 flag→clear 闭环有效**(第16轮开强制账、第17轮精确兑现并代码层复验)。
- **④ 待契约化账(更新)**:`renderAgentCmds` ✅ **已清**(本轮 renderAppChips);仍开 = 开场白 + i18n 表 jobseek 文案归属(3.y 以 manifest.greeting + i18n 命名空间清)。
- **⑤ 后续**:序4-d(jobseek 数据大择取,非红线)→ **序5(profile 通道 persistProfileField/hydrateProfile + initShell,全程最硬刀)**,届时逐行 + 构造场景严审。

## 第 18 轮 — ✅ 通过 · 序4-d 数据大择取:持久化条件/onboarding → 平台 + jobseek 数据层 → apps(`83986fe..3f6996e`)

> 序4-d(数据框架剩余,非红线):1 平台归位(持久化条件 + 壳 onboarding)+ 2 jobseek 数据择取(持久化/水合 + 演示/种子)。**归属裁定(onboarding → 平台)+ rt-ready 时序不变式**请评审。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 4-d-1 `96cc0db` | jobsPersistOn + onboarded + markOnboarded | platform/shell/data-store.js | 平台归位(归属裁定) |
| 4-d-2 `c0240a0` | jobseek 数据持久化/水合(jobs/resumes + hydrateBizColls,含 2 rt-ready) | apps/jobseek/logic/**persistence.js**(新) | 纯择取(★rt-ready 时序 + resumes red-line) |
| 4-d-3 `3f6996e` | jobseek 演示/种子(SEED/captureSeed/demoMode/setDemoMode/seedDemoData/syncDemoBanner) | apps/jobseek/logic/**demo-seed.js**(新) | 纯择取 |

**★ 4-d-1 归属裁定(请评审确认):onboarding(markOnboarded/onboarded)→ 平台(data-store.js)**。理据:data-store.js 的**通用集合引擎 `hydrateColl`**(line 27)按"有数据→已上手"调 `markOnboarded()` —— 即 **shell 级 onboarding**(任意集合有数据即算上手),非 jobseek 专属;留平台使"平台 hydrateColl 调 markOnboarded"为**平台→平台**(否则平台→apps 反向依赖)。`jobsPersistOn`(桌面+SeekerRT,通用持久化条件)同理归平台,解 序4-b 遗留过渡依赖。**对比**:`demoMode/setDemoMode/SEED/captureSeed`(演示态,仅 jobseek 用)→ apps。`'jh-seeded-jobs'` 旧迁移键逐字保留。

**★ 4-d-2 rt-ready 时序不变式(评审后续关注项,须验)**:persistence.js 含 2 处 `window.addEventListener('seeker-rt-ready', hydrateJobs|hydrateBizColls)`。**不变式守法**:persistence.js 是 **classic `<script src>`(解析期同步执行)**,而 dispatch 在 `<script type="module">`(deferred,line 881)—— 故监听器在解析期注册、**先于** deferred module 的 dispatch(同第5轮时序法);相对序不变(hydrateProfile@991 仍首、hydrateJobs 先于 hydrateBizColls、widgets/shellPushAiReadable 仍后)。**冒烟证**:captureSeed 于 INIT 抓 SEED(12 jobs)、hydrateJobs/hydrateBizColls 触发无错(web jobsPersistOn=false → 优雅 no-op)、0 console 错。

**★ 4-d-2 resumes red-line(profile 隔离)逐字保留**:persistResume 只 upsert `{id,jobId,template,modules}`——**联系方式绝不入 resumes 集合**(走独立 profile)→ `query_data('resumes')` 天然不含联系方式;hydrateResumes 主简历哨兵 → MASTER(专业模块,无 profile 内容)。红线注释随迁 persistence.js。

**零回归实证**:
- 各符号全局唯一定义(4-d-1:jobsPersistOn/onboarded/markOnboarded=1;4-d-2:8 fn=1;4-d-3:SEED/demoMode/setDemoMode/captureSeed/seedDemoData/syncDemoBanner=1);
- 逐字节:4-d-1 3 fn 体一致、4-d-2 removed 62 行⊂persistence.js、4-d-3 removed 35 行⊂demo-seed.js(全 verbatim,非纯剪切仅模块头/breadcrumb);
- node/内联 8 块/tsc(+persistence.js/+demo-seed.js,现 30 外链)净;
- **红线核心空 diff**(capability D3/secret/data.rs profile/CSP/invariants/runtime 本批未触);
- 冒烟(fresh server):16 符号全定义、SEED 抓取、nextJobId=13、seedDemoData 端到端(种子+示例条)、0 console 错、总览渲染正常;index.html 1974→1876(阶段3 起 **−60%**)。

**序4-d 剩余判断**:jobseek 数据大择取本批完成(jobs/resumes/种子/编排 + 持久化条件/onboarding 归位)。**hydrateBizColls 已随 4-d-2**(原挂"随序3-d 或后续"→已落)。→ 转 **序5(profile 通道 + initShell + renderSettings 壳部分,全程最硬双红线刀)**。

**评审裁定(第 18 轮 · 通过 · 无阻断/应改)**:
- **① 序4-d-1/2/3 通过** —— 三刀纯剪切(persistence.js/demo-seed.js 100% 逐字节、data-store.js 仅归属注释、各符号 0 重复定义);平台核心空 diff;cargo83/clippy/fmt/tsc/node 净;index.html 1974→1876(阶段3 起 **−60%**)。
- **② ★ onboarding → 平台 = 认可** —— **依赖方向是决定性判据**:`hydrateColl`(平台通用引擎)调 `markOnboarded` → 若 markOnboarded 在 apps 则平台→apps 反向依赖(违 §1),归平台使调用为**平台→平台**;onboarding 状态("有数据→已上手"、jh-onboarded/jh-seeded-jobs 通用键)是**壳级 UX 概念**(决定首启落地 vs 已用)非 jobseek 业务;消费者 overview.js 读 `onboarded()`=apps→平台(允许);对比 `demoMode/SEED/captureSeed`(演示态、仅 jobseek)→ apps 正确。合"归属驱动"纪律。
- **③ resumes profile 红线 + rt-ready 时序守法(逐字保留 · 代码层验)**:persistResume 只存 `{id,jobId,template,modules}`——联系方式绝不入 resumes → `query_data('resumes')` 天然无联系方式;persistence.js@classic `<script src>` 解析期注册监听器 → 先于 deferred module dispatch@881(相对序不变,同第5轮时序模型)。
- **④ ⚠ 前瞻归属债(INIT 分解 · 非阻塞 · 记后续)**:index.html 的 INIT(原单体启动序列,原序照抄)仍**直调 apps `captureSeed()`/`syncDemoBanner()`**。判定 = **过渡态非违规**:INIT 是 index.html 的过渡 bootstrap 胶水(**非平台模块**),混调平台(buildNav/copInit)+ apps(captureSeed/syncDemoBanner)是尚未分解的单体 bootstrap;§1 约束的是**平台模块不依赖 apps**,index.html 不是平台模块;逐字节原序照抄、非本刀新增。**出口**:INIT/bootstrap 分解时(随序5 shell-boot/initShell 归属,或专门 INIT 分解刀),jobseek 专属 INIT 调用移入 jobseek 自己的 init(`manifest.init()` 钩子 / rt-ready 绑定),使 shell-boot 只调平台函数 + manifest.init 契约。→ 已挂 index.html INIT inline 出口注释。
- **⑤ 归属/待契约化账(更新)**:`renderAgentCmds` ✅ 已清(第17轮);仍开 = **① INIT 分解**(captureSeed/syncDemoBanner INIT 调用 + initShell 归属 → `manifest.init` 钩子 / shell-boot,随序5)+ **② 开场白/i18n/agentGreet 文案归属**(3.y 以 manifest.greeting + i18n 命名空间清)。

## 第 19 轮 — ✅ 通过(双红线核心达标 · 带 1 项序5-完成前必清) · 序5-a profile 通道 → platform/shell/profile.js(`d79f4db..6377889`)

> 序5(设置框架 · 全程最硬刀)首刀:profile 通道 persistProfileField/hydrateProfile → **新独立模块 profile.js(模块边界即红线边界)**。**双红线代码层 + 构造场景双验**,请评审逐行严审。序5 剩余(settings 框架 / renderSettings 拆 + manifest.settings 契约 / initShell / INIT 分解)本批续做。

| 刀 | 内容 | 去向 | 红线 |
|---|---|---|---|
| 5-a `6377889` | profile 通道 persistProfileField/hydrateProfile(+rt-ready) | platform/shell/**profile.js**(新) | ★★双红线 |

**★★ 红线①(profile 硬隔离)· 代码层 + 构造场景双验**:
- **代码层**:profile.js 代码零 `SeekerRT.db`(grep=0);仅 `persistProfileField`→`rt.profile.set(k,String(v))`、`hydrateProfile`→`rt.profile.getAll()`。2 处 `rt.db` 命中全在注释(解释隔离)。
- **构造场景(runtime 实证)**:rt.db 挂 Proxy 捕获任意访问 + 强制 settingsPersistOn=true,调 `persistProfileField('phone','13800000000')` → **rt.profile.set 命中 1 次、rt.db Proxy 命中 0 次**(`RL_never_touched_rt_db=true`)——profile 绝不串 rt.db。
- **模块边界即红线边界**:profile.js(rt.profile)与 data-store.js(rt.db 通用集合引擎)**物理分离**;后端 capability.rs QUERYABLE 不含 profile(结构性隔离,本批空 diff)。
**★★ 红线②(设置不可经对话改)**:profile 只经设置页 data-pf 输入改(renderSettings,序5-c 待拆)、Agent 只引导去设置页(copReply 拦截,未改)。

**归属(用户裁定)**:PROFILE 数据对象留 jobseek(intake-action.js · 过渡,hydrateProfile 运行时引用);settingsPersistOn 留 index.html(过渡)。

**零回归**:persistProfileField/hydrateProfile 各全局唯一定义、8 行逐字节;rt-ready 时序守法(profile.js classic head、解析期注册 hydrateProfile → 先于 deferred dispatch@881,相对序不变);node/内联 8 块/tsc(31 外链)净;**后端红线核心(capability QUERYABLE / data.rs profile / invariants / CSP)空 diff**;冒烟 0 console 错。

**序5 剩余(本批续做)**:5-b `settingsPersistOn`/`saveSettings`/`hydrateSettings`(混合平台外观 + jobseek goals/weights)归属定;5-c **renderSettings 拆壳部分(theme/lang/density/model → platform)+ jobseek 段(goals/weights/主简历 → apps)· 第 7 契约 `manifest.settings`**(用户裁定本批拆);5-d `initShell` → platform;5-e INIT 分解(captureSeed/syncDemoBanner → jobseek `manifest.init`,第18轮债)。

**评审裁定(第 19 轮 · 通过 · 双红线核心达标 · 带 1 项序5-完成前必清)**:
- **① 序5-a 通过** —— **红线① profile 硬隔离 · 代码层 + 后端双证**:profile.js 代码**零 rt.db**(2 处 rt.db 命中全在注释=红线文档,代码只 `rt.profile.set`/`rt.profile.getAll`)+ 后端 `capability`(QUERYABLE 不含 profile)/`data.rs`(table_for)/`invariants`/CSP **空 diff**(即便前端异常,后端 AI 仍读不到/写不到 profile);**模块边界=红线边界**(profile.js 与 data-store.js rt.db 引擎物理分离=好设计);构造场景(rt.db Proxy 计数)与代码结论一致。**红线② 设置不可经对话改**:profile 只经设置页 data-pf 改;AI 非 QUERYABLE 读不到 + `profile_set` 是 Tauri 命令非 capability、模型工具循环写不到。8 行 100% 逐字节纯剪切、0 重复、载序守法(@868 classic 先于 module dispatch@881);cargo83/clippy/fmt/tsc/node 净。
- **② ★ PROFILE 数据对象归属 = 应移平台(序5-完成前必清 · 非本刀阻断 · 对安全无损)** —— PROFILE 定义在 jobseek(`intake-action.js:127`),profile.js(**正经平台模块**)line 12 `PROFILE[k]=p[k]` 具名引用它 = **真平台→apps §1 债**(异于第18轮 captureSeed——那调用者是 index.html 过渡胶水非平台模块;此处 jobseek 删则 hydrateProfile 抛)。**澄清**:评审记录**无**"PROFILE 留 jobseek"裁定(那是主循环 AskUserQuestion 时用户选的"过渡"项、非评审裁定);据分析 PROFILE(name/phone/email=用户身份,对应 `rt.profile` **单一共享仓库**、非 per-app)本质是**壳级身份、应归平台** → profile.js 引用变平台→平台。**对安全无损**(PROFILE 只是内存镜像、隔离在 rt.profile + 后端,本刀双红线仍成立);纯 §1 架构洁净度债。对比 data-store.js 泛型(`persistColl(name,arr)` 不具名引用 JOBS)故 app-agnostic;profile.js 具名引用 PROFILE→app 耦合,移 PROFILE→平台消此不对称。→ **并入 5-b/c 归属批**(5-a 过渡留 jobseek 与"完成前必清"兼容)。
- **③ 序5 剩余(认可方向)**:**PROFILE→平台(新增必清)** + settingsPersistOn 归属 + renderSettings 拆(第 7 契约 manifest.settings)+ initShell + INIT 分解。

## 第 20 轮 — ✅ 通过 · 序5-b PROFILE→平台(落地第19轮 §1 必清项)(`0547ffd..af80e1d`)

> 落地第19轮裁定的序5-完成前必清项:PROFILE 数据对象 jobseek→platform,清 profile.js 的平台→apps §1 债。与 5-a 的 PROFILE 归属一并送审。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 5-b `af80e1d` | PROFILE 数据对象(个人信息=壳级用户身份) | jobseek intake-action.js → platform/shell/profile.js | 归属归位(清第19轮 §1 债) |

**★ §1 债已清(第19轮裁定落地)**:PROFILE(name/phone/email/city/intent/exp)从 jobseek `intake-action.js:127` **逐字节纯剪切** → profile.js。**profile.js 现自持 PROFILE、不再具名引用 jobseek 全局**(之前 hydrateProfile 的 `PROFILE[k]=p[k]` = 平台模块→apps §1 债 → 现平台→平台);jobseek 消费者(resumes.js×8 读联系方式渲简历 / index.html renderSettings data-pf)读 PROFILE = **apps→平台(允许)**。**对安全无损**:profile 隔离仍在 rt.profile + 后端(未变),PROFILE 只是内存镜像。

**零回归**:PROFILE 全局唯一定义(profile.js:10,grep 核实);PROFILE 定义逐字节一致;载序 profile.js@868(head classic)先于消费者 intake-action@1550/resumes@1563(const 全局词法绑定、classic 间共享);node/内联 8 块/tsc(31 外链)净;**红线核心(capability/secret/data.rs profile/CSP/invariants)空 diff**。
**冒烟**:PROFILE 从 profile.js **live**(`city=北京`/`name=(在数据设置填写)`)、persistProfileField/hydrateProfile 在。**⚠ cache 缺口(测试环境 · 同序3-d-5 / 第12轮裁断)**:webview 强缓存旧 intake-action.js(含 `const PROFILE`)与新 profile.js `const PROFILE` 撞 → 缓存态该文件加载失败(console redeclaration);**磁盘正确**(`served_intake_hasPROFILE=false` / `served_profile_hasPROFILE=true` = PROFILE 全局唯一),桌面 asset:// / 清缓存无冲突、非代码缺陷。

**序5 剩余(过审后续做)**:5-c renderSettings 拆(壳部分 theme/lang/density/model → platform + jobseek 段 goals/weights/主简历 → apps · **第 7 契约 manifest.settings**)+ 5-d initShell + 5-e INIT 分解 + settingsPersistOn/saveSettings/hydrateSettings 归属。

**评审裁定(第 20 轮 · 通过 · 无阻断/应改)**:
- **① ★★ §1 债已清(第19轮裁定精确落地)** —— PROFILE 定义从 jobseek `intake-action.js:127` 逐字节纯剪切 → `profile.js:10`;profile.js 现自持 PROFILE(定义 + `PROFILE[k]=p[k]` 引用本模块)= **平台→平台**;jobseek 消费者(resumes.js / renderSettings)读 = apps→平台(允许)。**平台模块→apps 债消除**。
- **② const PROFILE 全仓唯一定义**:grep 全仓仅 profile.js:10 一处(旧 intake-action.js const PROFILE 删净、126/129 只剩注释)→ 磁盘无重复声明/无 redeclaration;载序/TDZ 安全(profile.js@868 head 先于消费者@1550/1563,消费皆运行时函数内)。
- **③ 对安全无损**:profile 隔离仍在 rt.profile 通道 + 后端(capability/data.rs profile/invariants/CSP 空 diff);PROFILE 只是内存镜像,搬家不影响隔离。cargo83/clippy/fmt/tsc/node 净。
- **④ cache 缺口 = 复用第12/19轮裁断:接受(附开发提示)** —— redeclaration 仅发生在浏览器同供旧缓存 intake + 新 profile 时;磁盘 const PROFILE 全仓唯一(grep=1);桌面 asset:// / 硬刷新无冲突、非代码缺陷。⚠ **开发提示(非代码问题)**:const 跨文件搬迁的缓存缺口比"单函数 undefined"更绊人(redeclaration = SyntaxError → 整个 profile.js 失败);**搬迁刀开发时硬刷新/禁缓存**避免误判回归。**纯剪切用 const(而非 window.X)是零回归正确选择,不为缓存扭曲代码**。
- **⑤ flag→clear 闭环(再次有效)**:第19轮裁定 PROFILE→平台、第20轮精确兑现并复验。**待清账更新**:已清 = renderAgentCmds(17)/PROFILE→平台(20);仍开(序5 剩余)= settingsPersistOn 归属 / renderSettings 拆(第7契约 manifest.settings)/ initShell / INIT 分解 / 文案归属(3.y)。

## 第 21 轮 — ✅ 通过 · 序5-c renderSettings 拆分:第 7 契约 `SeekerShell.appSettings`(`ce3b215..40b734e`)

> **本刀是序5、也是整个平台化搬迁里最大、最不"纯剪切"的一刀**——不是逐字节搬运,而是把一个混着 平台/jobseek/profile红线 三类内容的 ~140 行 `renderSettings` 函数**拆分 + 加第 7 契约**。零回归靠**逐条偏离披露 + 穷尽功能冒烟**,不是机械 diff。请评审逐行 + 构造场景严审(用户在此刀前已就"renderSettings 拆分方式 + PROFILE 归属"两处征询我并拍板,详见文末决策记录)。

### 三刀

| 刀 | 内容 | 性质 |
|---|---|---|
| 5-c-1 `da37a79` | `SeekerShell.appSettings()` 契约脚手架(types+registry) | 契约扩展,**尚无消费者**,inert |
| 5-c-2 `741b0cd` | jobseek 设置贡献 → **新文件** `apps/jobseek/logic/settings-jobseek.js` + manifest 注册 | 纯附加(additive-only,与 index.html 原内联并存不冲突) |
| 5-c-3 `40b734e` | `renderSettings` 拆分 → **新文件** `platform/shell/settings.js`,消费契约,index.html 原内联删除 | **非纯剪切**(拆分+契约消费,"flip" 提交) |

### ★ 归属判断(用户已拍板,请评审复核)
- **`SeekerShell.appSettings()` 语义 = 汇总型(同 `cards()`/`appCommands()`)**:`tabs`(新增 tab,并集)+ `extend`(追加进壳既有 tab 尾部,如 profile tab 追加主简历资料、data tab 追加简历行)。**非选择型**(不是首个非空)。
- **平台 5 tab**:basic(外观)/profile(个人信息核心字段,红线)/model(AI 接入)/data(备份+隐私+MCP)/about。
- **jobseek 2 tab(经 appSettings().tabs)**:goals(求职目标)/weights(评分权重)。
- **jobseek extend(经 appSettings().extend)**:`profile` tab 尾部 = 主简历资料(`masterSectionHTML()`,已在 intake-action.js,未新写);`data` tab 尾部 = "我的简历"行(含 `RESUME.filename`)。
- **判据**(用户在两处 AskUserQuestion 拍板):① profile 通道(persistProfileField/hydrateProfile)进独立 `profile.js`、PROFILE 数据对象暂留 jobseek 过渡(后经第19轮裁定+序5-b 移平台,已过审);② renderSettings **本批一并拆**(不留到后续)。

### ⚠ 逐条披露(非纯剪切偏离,请逐条核实)
1. **`sections.profile`/`data` 的 jobseek 内容改经 extend 拼接** —— 原 `${masterSectionHTML()}`/`${RESUME.filename}` 内联调用 → `${extendHTML('profile')}`/`${extendHTML('data')}`(`extendHTML = tabId => appSpecs.flatMap(s=>s.extend?.[tabId]?[s.extend[tabId].render()]:[]).join('')`)。**内容逐字节未变**(浏览器验证 `master_hasContent`/`resumeRow_hasFilename` 均 true),只是间接层从直调变契约委派。
2. **`sections.goals`/`weights` 改经 `appTabs.forEach(t=>sections[t.id]=t.render())`** —— 内容来自 `settings-jobseek.js` 的 `goalsSectionHTML()`/`weightsSectionHTML()`,与旧 `sections.goals=`/`sections.weights=` 内联体**逐字节一致**(5-c-2 已 diff 核实)。
3. **`SET_TABS` 裁剪为平台 5 项 + app tabs 契约插入同一视觉位置** —— `tabDefs = [basic,profile,model].concat(appTabs).concat([data,about])`,非同一数组字面量,但**浏览器验证最终 7 tab 顺序逐字节等于原序**(`tab_order` = `[basic,profile,model,goals,weights,data,about]`)。
4. **★ `data-tc`(训练计入能力成长)wiring 的 `renderSkills()` 直调 → `rerenderPages()`** —— 唯一的行为性改动。原代码 `renderSkills()` 是 platform→apps 具名符号引用(若 jobseek 禁用会抛);`rerenderPages()` 是**已有平台通用机制**(`PAGES.forEach(p=>p.render&&p.render())`,nav.js,序1 起就有),行为等价(重渲所有已挂载页面,含 skills)但更广(重渲全部页非仅 skills)。**浏览器构造场景验证**:spy `window.renderSkills`,点击 trainCounts 开关,确认 `rerenderPages()` 确实级联到 `renderSkills` 被调用(`rerenderPages_reachedRenderSkills=true`)——behaviorally 等价证实,非仅理论推断。

### §1 核实
- `settings.js` 代码 **零** `JOBS`/`SKILLS`/`ACTIONS`/`MASTER`/`RESUME`/`WEIGHTS`/`masterSectionHTML`/`openResumeModal`/`renderSkills`/`setDemoMode` 具名引用(grep 命中仅头注释披露 + `rerenderPages` 替换行本身)。
- ★双红线延续:profile 字段部分(`persistProfileField`/`PROFILE`)仍走独立 `platform/shell/profile.js`(序5-a/b 已过审),`settings.js` 只拼版式、不碰 `rt.profile`;设置不可经对话改(`settings.js` 是唯一改设置入口)。

### ⚠ 明确未纳入本刀(过渡态,同 `setState`/`current` 先例,请评审确认是否可接受留待后续)
- `setState`/`settingsPersistOn`/`saveSettings`/`hydrateSettings`/`WEIGHTS` 仍在 index.html——**混合平台(fontsize/density/motion)+ jobseek(goal/period/salary/weights)字段于一体**,归属定另刀(与序4-d 挂过的"settingsPersistOn 归属"同一项)。
- `clearAllDataFlow`/`clearAllCollections`/`CLEARABLE_COLLS` 仍在 index.html——内部**混 jobseek `setDemoMode()` 调用 + 硬编码集合名数组**(`['jobs','skills','actions','resumes','iv_records','messages']`),归属定另刀;**执行 Agent 建议**:届时改用既有 `SeekerShell.collections()` 契约替代硬编码列表(消除维护负担 + 自动跟随新应用注册,而非新增第 8 个契约)。

### 零回归验证(非机械可验、逐项披露 + 穷尽功能冒烟)
- node --check(settings.js 526 行 + 33 外链)/内联 8 块/tsc 净;**0 重复定义**(15 个移动符号逐一 grep=1);**红线核心空 diff**(capability/secret/data.rs profile/CSP/invariants)。
- **浏览器冒烟穷尽 7 tab**(no-cache server,规避此前反复出现的 webview 缓存缺口):tab 顺序逐字节复现;各 tab 元素齐全(profile pfInputs=10 + master 段、model mdProto/mdModelList、goals goalRange/setPeriod、weights 4 滑杆+wReset、data resume 行/dataExport/clearAllData、about 版本号)。
- **交互验证**(非仅渲染,含状态变更往返):weights 滑杆拖动→WEIGHTS 数组更新+总计重算(115%)→reset 复原默认([40,30,20,10]);profile 姓名字段编辑→`persistProfileField`确实调 `rt.profile.set('name','Test Name')`(构造 spy 验);master 资料自由文本编辑(data-mx)→`MASTER` 对象确实更新;model mode byo↔managed 双向切换正确;**trainCounts→rerenderPages 级联验证**(见披露④)。全程 **0 console 错误**,截图确认视觉与原设计一致。

### 请评审重点核实
1. `appSettings()` 契约的 tabs/extend 双模式设计是否合理(vs 其余 6 契约的既有分类:选择型首个非空 / 汇总型并集)。
2. 披露④(`renderSkills()→rerenderPages()`)的行为等价论证是否站得住——是本刀唯一真正的"逻辑改变"(其余都是纯位置/间接层变化)。
3. 两项明确排除在外的过渡债(`setState` 系 + `clearAllDataFlow` 系)是否可接受留待后续,不阻塞本刀。
4. profile 红线(persistProfileField/PROFILE)在 `settings.js` 拼版式过程中是否有任何削弱(核实点:`settings.js` 是否有任何路径绕过 `profile.js` 直接碰 `rt.profile`/`rt.db`)。

**评审裁定(第 21 轮 · 通过 · 无阻断/应改)**:
- **① 序5-c 通过** —— **第 7 契约 `appSettings` 设计正当**:registry 汇总型聚合(遍历应用收 `AppSettingsSpec` 并集,同 cards())、`{tabs?, extend?}` 类型清晰、**组合逻辑在消费者 settings.js(平台)而 registry 只聚合 = 分离正当**;契约体系自然延伸(汇总型第 5 个)。**§1 干净**:settings.js 零直调 jobseek 函数、jobseek 设置只经 `SeekerShell.appSettings()`;**披露④(data-tc `renderSkills()`→`rerenderPages()`)= 消除拆分后唯一的平台→apps 直调**,行为等价(rerenderPages 级联 skills 页,spy 已证)。**profile/resumes 红线保留**:data-pf → `persistProfileField`(隔离 rt.profile 通道)+ 值引号转义;master 编辑 → persistMaster → resumes 专业层无联系方式。4 条偏离逐条核实(1–3 内容逐字节未变仅间接层变;4 代码层 + spy 双证)。红线核心空 diff(capability/data profile/invariants/CSP);0 重复定义;cargo83/clippy/fmt/tsc/node 净;index.html −530 行。
- **② 过渡债评估(执行 Agent 主动披露的两条 · 认可方向)**:(1)`setState`/`saveSettings`/`hydrateSettings`/`WEIGHTS` 混合归属 = 老问题、**本刀未扩大**,随后续 settingsPersistOn 归属刀处理,可接受;(2)`clearAllDataFlow` 混 jobseek `setDemoMode` + 硬编码集合名 = **认可方向:后续改用既有 `SeekerShell.collections()` 契约**取集合列表(不新增第 8 契约)+ 解 setDemoMode 归属,记入归属待清账。**注**:settings.js line 48 硬编码 `'messages'` 是**壳自持集合**、非 jobseek 耦合,那处 OK。
- **③ 待清账(更新)**:已清 = renderAgentCmds(17)/PROFILE→平台(20)/**renderSettings 拆(本轮,第 7 契约)**;仍开 = settingsPersistOn/saveSettings/WEIGHTS 混合归属、**clearAllDataFlow 分解**(→ SeekerShell.collections() + setDemoMode 归属)、initShell、INIT 分解、文案归属(3.y)。

## 第 22 轮 — ✅ 通过 · 序5 收官:5-d initShell(shell-boot)+ 5-e INIT 分解(第 8 契约 `manifest.init`)· 🏁抽壳搬迁收官(`edcef78..d9fee71`)

> **序5 最后两刀 = 抽壳搬迁(序1–5)收官**:initShell 落第17轮裁定的独立 shell-boot 刀;INIT 分解清第18轮归属债(第 8 个契约)。5-e 含两条**披露的行为语义变化**(时点 + enabled-gating),请评审逐条裁。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 5-d `3b2bc91` | 壳启动 initShell(23 行) | platform/shell/**shell-boot.js**(新) | 纯抽壳(第17轮裁定落地) |
| 5-e `d9fee71` | **第 8 契约 `initApps`(manifest.init 钩子)+ INIT 重写** | types/registry/manifest/账本/index.html INIT | **契约扩展(必审)**;清第18轮债 |

**5-d initShell**:拖放守卫/侧栏+Agent栏宽度恢复/语言恢复/hydrateSettings/侧栏接线/setLang,逐字节纯剪切 → 新独立模块 shell-boot.js(**第17轮裁定精确落地**:壳启动非 chrome、独立 shell-boot 刀,不并入 chrome/settings)。依赖 `$`/`setLang`(平台)+ `setState`/`hydrateSettings`/`toggleSidebar`(index.html 过渡全局,第21轮已挂账)。

**★ 5-e 第 8 契约 `initApps`(评审必审)**:`AppManifest.init?: () => void` + `SeekerShellApi.initApps(): void`;registry **汇总型副作用**(遍历启用应用全调 `a.init()`、无返回,同 renderAppChips);manifest 注册 `init: () => { captureSeed(); syncDemoBanner(); }`;INIT 删两处 jobseek 直调 → `go('overview')` 后一处 `window.SeekerShell.initApps()`。**★第18轮 INIT 分解债已清**:INIT 代码零 captureSeed/syncDemoBanner 直调(grep 仅 breadcrumb 注释)——INIT 只调平台函数 + 契约。

**⚠ 5-e 两条披露的行为语义(请评审裁)**:
1. **captureSeed 时点**:从 copInit 前 → go('overview') 后(与 syncDemoBanner 合一钩子)。安全论证:期间(copInit/agentInit/initShell/initKeys/go)全是 chrome 接线 + 渲染、**零数据数组变异**;hydration 在 rt-ready(deferred module,全部 classic INIT 之后)→"趁 mock 字面量抓种子"性质保持(冒烟 `SEED=12 jobs` 证);syncDemoBanner 位置精确保持(原本就在 go 后)。
2. **enabled-gating**:init 只对**启用**应用调(同全部 7 个既有契约)。旧 INIT 直调 = jobseek 禁用时 captureSeed/syncDemoBanner **仍会跑**(禁用态还可能挂出 jobseek 的示例提示条——原行为更像 bug);新行为 = **D2 语义对齐**(关 = 下架 UI+AI)。**构造场景验**:禁用 jobseek → initApps 跳过其 init(called=0);重新启用 → 调(called=1)。

**零回归实证**:5-d 23 行逐字节(git diff 删除==搬入)、initShell 全局唯一;5-e registry.initApps 纯委派(零 jobseek 符号);node/内联 8 块/tsc(34 外链)净;**红线核心空 diff**;冒烟(no-cache server):initShell 从新家生效(侧栏接线/langBtn)、SEED 于 INIT 抓取(12 jobs)、demoMode off 无 banner、seedDemoData 端到端 banner 仍出、0 console 错。**index.html 1354→1330(阶段3 起 −72%)**。

**🏁 序5 / 抽壳搬迁收官盘点**:序1(基础工具)→2(AI 引擎)→3(chrome)→4(数据框架)→5(设置框架:profile 通道/PROFILE/renderSettings 拆/initShell/INIT 分解)全部完成;**8 个 `SeekerShell.*` 契约**(frameQuery/appReply/appSuggs/appCommands/collId/renderAppChips/appSettings/**initApps**;选择型首个非空 · 汇总型并集/副作用);platform/shell 15 模块。**仍开归属债(不阻塞收官,后续刀)**:settingsPersistOn/saveSettings/hydrateSettings/WEIGHTS/setState 混合归属、clearAllDataFlow 分解(→SeekerShell.collections() 替硬编码 + setDemoMode 归属)、toggleSidebar/syncSbToggleTitle 等壳杂项、开场白/i18n 文案归属(3.y)、3.y 类型化(单列里程碑)。

**评审裁定(第 22 轮 · 通过 · 无阻断/无应改 · 🏁抽壳搬迁 arc 收官成立)**:
- **① 验收全过**:5-d 逐字节纯剪切(旧 vs shell-boot.js diff 空、全仓唯一);5-e **第8契约 §1 干净**(registry `enabledApps().forEach(a=>typeof a.init==='function'&&a.init())` 纯委派零 jobseek 符号);**第18轮 INIT 分解债清**(INIT 只调平台函数 + `SeekerShell.initApps()`,captureSeed/syncDemoBanner 全仓仅注释零直调);载序正确(registry@858 → shell-boot@870 → INIT,依赖 $/setLang 已在前);红线核心全 0 行;**契约体系 8 就位 = 4 选择型 + 4 汇总型**;类型/账本齐(C4);cargo83/clippy/fmt/tsc/node 净。
- **② ★两条披露语义 = 均认可**:(1)**captureSeed 时点(→go 后)= 行为等价,三证**——快照源四数组在新旧位置间零变异(chrome 接线 + renderOverview 只读)、仍先于 hydration(rt-ready 在 INIT 同步块后)、**无消费者被饿死**(SEED 全仓唯一读者 = seedDemoData 且自带 captureSeed 兜底,`if(SEED)return` 幂等再兜一层);(2)**enabled-gating = D2 对齐 + 零回归**——`enabledApps()` 与全部 7 契约同闸,jobseek 默认启用与旧逐调等价;旧无条件直调在禁用时**给已下架应用注示例条(.main UI 泄漏)**,新行为跳过更正确;SEED 是 jobseek 私有、平台不读,禁用不抓无副作用。
- **③ 🏁 arc 收官盘点**:序1→5 全落;**index.html 4602→1330(−71%)**;platform/shell **14 个运行时 .js**(+types.d.ts 契约定义;送审"15 模块"含 types 口径、非缺陷);8 契约成熟。
- **④ ★[建议](前瞻 · 非本刀 · 有时限)**:**clearAllDataFlow → SeekerShell.collections() 宜排在阶段4「第二应用」之前或同刀,勿无限延后** —— 现债是硬编码集合名,jobseek 独存时仅口径问题;但**阶段4 第二应用一落,「清空全部数据」会静默漏掉第二应用的集合 → 破坏「破坏性操作完整可撤销」红线(§4-3 反焦虑)**。契约 collections() 已就位、替换成本低。其余归属债(settingsPersistOn 系/setState/文案)可随 3.y 收。→ **已落显式出口**:clearAllDataFlow inline 注释 + CLAUDE.md §5 阶段4 行前置条件标注。

## 第 23 轮 — ⏳ 待审(送审中) · 阶段4「第二应用 · 数据资产管理」:前置账 + 白名单红线刀 + assets 应用(`86c422e..02eb388`)

> **阶段4 = 平台化前提的最终验证**(D6:新增应用成本≈manifest+页面)。三刀:阶段4-0 前置账(第22轮[建议]落地,含 **collections() 语义修 + 第9契约 onDataCleared**,必审)→ 阶段4-1 **红线刀**(后端集合白名单三处追加,本迁移首次**有意**触碰红线文件,必严审)→ 阶段4-2 assets 应用(全新代码 @ts-check)。**文末附成本盘点 = 阶段4 验收结论**。

| 刀 | commit | 内容 | 性质 |
|---|---|---|---|
| 阶段4-0 | `55a3823` | clearAllDataFlow 契约化:collections() 存在性修 + **第9契约 onDataCleared** + 硬编码集合/setDemoMode 直调删除 | 前置账(契约扩展必审) |
| 阶段4-1 | `f7ee9c0` | assets_* 三端白名单:data.rs(迁移 v5 + table_for×2)/ capability.rs(QUERYABLE+2)/ web.js(COLLECTIONS+2、DB v2) | **★红线刀(白名单追加)** |
| 阶段4-2 | `02eb388` | apps/assets/(manifest + prompts/notes 两页,@ts-check strict 净)+ index.html 3 script 标签 | 新应用(新代码 C5 必检) |

**★ 阶段4-0(必审 · 两个语义点)**:
1. **collections() 语义修**:`enabledApps()` → `apps`(全部已注册,含禁用)。理据:其自身文档写"数据归属不随开关变(存在性)"而实现却按启用过滤 = 文档与实现矛盾(彼时无消费者,第5轮曾记"collections() 无消费方");首个真实消费者是「清空全部数据」这种**必须完整枚举**的破坏性操作 —— 禁用应用的数据也须被"清空所有"覆盖(否则用户以为清了、实际残留 = 隐私相邻的惊吓;D2 的数据保留由应用管理页 per-app 清数据独立承担)。AI 可读集另走 aiReadableCollections(启用∩授权)**未动**。
2. **第9契约 `onDataCleared`/`notifyDataCleared`**(汇总型副作用):清空确认后通知**全部已注册应用**(含禁用 —— 数据被清是事实,app-local 状态须一致)复位本地状态;jobseek 注册 `onDataCleared:()=>setDemoMode(false)` → **平台代码零 setDemoMode 直调**(解第21轮归属债)。**关于第21轮"不新增第8契约"**:该语句限定的是**集合清单的获取机制**(用既有 collections(),已照办);setDemoMode 评审只要求"解归属"未定机制 —— 本项目先例(第16轮强制把 typeof 守卫契约化为 renderAppChips)一贯偏好显式契约而非推断式自愈,故以第9契约落。**构造场景验**:禁用 jobseek 后 collections() 仍含 jobs、notifyDataCleared 在禁用态仍清 jh-demo、clearAllCollections spy 枚举 == 旧 CLEARABLE_COLLS 六集合(**今日零回归**)、profile 永不在枚举面。对话框 detail 文案同刀改通用(动态集合数,原文案硬编码 jobseek 名词、二应用后失真)。
3. 附带:旧「★★待清账」inline 标记删除(债清)。

**★ 阶段4-1 红线刀(必严审 · 本迁移首次有意触碰红线文件,全部为白名单追加、零逻辑改)**:
- `data.rs`:迁移 **v5**(CREATE TABLE assets_prompts/assets_notes,骨架列+data_json 同既有;迁移前自动快照机制既有)+ `table_for` 两 arm。**profile/secrets/meta/settings 仍不在白名单**(隔离结构不变)。
- `capability.rs`:`QUERYABLE` 静态常量 += 两集合 —— **仍是静态常量硬底**(⚠第6轮钉死勿改动态,本刀只加条目不改形态);**profile/messages/settings/secrets 仍永不在内**;实际可读仍 = 静态底 ∩ D3 运行时集。d3 门单测为相对断言(`default_readable().len()==QUERYABLE.len()`)自然覆盖新条目;**cargo test 83/0**。
- `web.js`:COLLECTIONS += 两集合、DB_VERSION 1→2(onupgradeneeded 增量建 store,既有数据不动);与桌面 table_for 一致。
- **此三处 ≈10 行追加 = D3「静态硬底」安全设计下新增应用的固有平台成本**(参见成本盘点)。CSP/secret.rs/invariants/guardrail 未触。

**阶段4-2 assets 应用(全新代码)**:manifest(id assets、集合 D1 前缀、**aiReadable 'default-on'**[Prompt/笔记=用户主动沉淀给 AI 的语料,D3 per-app 授权仍可关 —— 请评审确认此默认档]、资产组+2页)+ prompts/notes 页(@ts-check strict 净):空启动(无静默演示数据)、CRUD 走平台通用引擎(persistColl/hydrateColl/rt.db.remove)、rt-ready 水合(classic 解析期注册,时序法)、**★红线:用户输入进 DOM 前一律转义(构造 `<b>`/`<script>` 注入:无元素落地、innerHTML=&lt;b&gt; 字面显示,截图存证)**、删除 toastUndo 可撤销(§4-3)、设计语言复用既有 token。

**冒烟(fresh reload · no-cache server)**:2 应用 11 页、资产组入 nav;**collections() 含 assets_*(= 前置账 payoff:清空全部数据自动覆盖新应用)**;D3 三层闸全链(default-on 入可读集/撤权退出/关应用退出且存在性保留);应用管理页自动列出 assets(开关/授权/per-app 清数据走既有 clearAppData=按 manifest.collections);关 assets→9 页壳好用/开→恢复;i18n EN;**jobseek 全页零回归**;0 console 错。
**⚠ 披露**:① web 持久化=内存 mock(pre-existing:collPersistOn 需桌面;桌面真持久化经迁移 v5 + cargo 验,R1 真机顺带目测);② Mod+9 从设置页移到 prompts 页(快捷键随 PAGES 注册序 = 既有设计,设置仍有 Mod+,)。

### 🏁 成本盘点(阶段4 验收:D6「新增应用成本≈manifest+页面」)
| 触碰面 | 量 | 性质 |
|---|---|---|
| `apps/assets/`(新目录) | 3 文件(manifest+2页) | **应用本体** |
| index.html | +3 `<script>` 标签 | 装载 |
| 后端白名单(data.rs/capability.rs/web.js) | ≈10 行追加 | **D3 静态硬底的固有代价**(安全设计使然,非架构缺陷) |
| platform/shell/*.js | **0 改动** | ✅ 契约体系工作:nav/卡/D3/应用管理/清空数据全自动纳入 |
| 新契约 | **0**(阶段4-2 本身) | 全走既有 9 契约 + 通用引擎 |

**验收结论(请评审确认)**:平台化成立 —— 新增应用 = manifest + 页面 + 白名单三处;proposal「平台零改动」的理想形态被 D3 静态硬底(第6轮安全裁定)修正为「平台零**逻辑**改动 + 白名单登记」,是有意的安全代价。

### 第23轮评审回执 —— 通过 + 1 [应改] + 2 [建议](均已修复,复审待过 · commit `5b5041a`)
**评审结论**:平台化前提验证**成立(通过)**;A(QUERYABLE 静态硬底守住)/B(collections() 不泄漏 D3)/C(第9契约 §1 干净)/D(成本盘点=D6 答案)/E(assets 基本达标)五焦点核实。**1 [应改] + 2 [建议] 已修复**:
- **★[应改] toastUndo 消息未转义 → 潜在 XSS(已修 3 处)**:`toastUndo(msg)`→`el(innerHTML)`,CSP `unsafe-inline` 不拦内联事件处理器 → 转义是唯一防线。① **prompts.js:45**(本刀新实例)`snap.title`→`apEsc`;② **copilot-actions.js:28**(pre-existing 同根)`job.co`→`jesc`;③ **★copilot-actions.js:27**(复审补冒烟坐实的**第二 sink**)——`agentChat` 亦经 `el/innerHTML`,同函数 `job.co`/`job.role` 未转义,只堵 toast(28)漏相邻 agentChat(27)是空修 → 一并 jesc。**构造场景复验**:`<img onerror>`/`<b onclick>` 三路 payload(prompt title / job.co-agentChat / job.co-toast)均字面显示、无元素落地、`__pwned` 不置位。
- **[建议]① types.d.ts collections() 注释校正**:删过时"阶段2 AI 三层闸消费"(会误导接进 D3)→"全部注册/非 AI 可读/D3 见 aiReadableCollections"。
- **[建议]② assets `default-off`(采纳)**:notes 自由文本兜底可能承载敏感信息 + D3 授权 per-app 单档 → **整应用 default-off**(隐私·反焦虑;blurb 本写"授权后";应用管理页一键授权即开)。复验:未授权 AI 可读集无 assets_*、授权后入。
- **⚠ 诚实披露(更广 §4-4 面 · 复审须裁范围)**:本刀完整复验发现 `job.co`(JD 抽取=§4-4 Untrusted)另经 **copReply 约 7 处 cCard/cBtn 模板未转义**(部分注入 onclick JS 串,须引号/属性级转义,非仅 `<`)。此为**第12轮"copReply 嵌业务数据非用户输入 XSS"裁定接受的 pre-existing 面**、非本刀新增、超本[应改]范围 → **未在本刀静默扩改**(7 模板 + onclick 串处理有回归面,值当独立审)。**建议专门 copReply/agentChat §4-4 转义审计刀**;请评审裁此范围(现修 or 排后续)。
cargo83/tsc/node/内联净;红线核心空 diff。**复审过后转正「通过」+ 记裁定 + 同步 memory。**

---

## P1 §4-4 copReply 转义审计刀(第23轮复审分出)—— 🏁 第24轮通过

### P1 · copReply/cCard/cBtn §4-4 XSS 收口(commit `5142ee1`)
**由来**:第23轮复审「诚实披露」分出的专门刀。`job.co`/`job.role`/`sk.name`/`gaps` 等 = AI 对 JD 的抽取 = **§4-4 Untrusted**;经 `copReply` 的 `cCard`/`cBtn` 未转义进 DOM(`el(innerHTML)` 渲染)= XSS 面。**推翻第12轮**「copReply 嵌业务数据非用户输入、XSS 接受」裁定 —— 其前提(业务数据非外部)已证伪:`job.co` 是 JD 抽取的外部内容。CSP `script-src 'self' 'unsafe-inline'`(tauri.conf.json:27)**不拦内联事件处理器** → 转义/结构化是唯一防线。

**两类 sink,两种修法**:
1. **HTML 文本 sink**(`<b>${j.co}</b>`、`cCard` body、gap/skill/action 名):进 DOM 前过 **`cEsc`**(新增于 copilot-chrome.js;转义 `& < > "` 四字符,文本+属性上下文通用)。
2. **★onclick JS 串 sink(更严重·任意 JS 执行)**:旧 `cBtn(label, oc)` 把 `oc` 直插 `onclick="${oc}"`,而 `copReply` 把外部数据拼进 `oc` 的 JS 字符串字面量 —— `copPlan('...','+j.co+')`(:64 `j.co` 外部!)、`copPlan('+sk.name+')`(:76)。含单引号即 breakout → 任意 JS。**修法=结构性(优于逃逸)**:新增 **`cAB(label, fn, args, acc)`** —— `fn`=window 上函数名(静态、开发者控制),`args`=参数数组(可含外部数据)→ `JSON.stringify` 存 `data-cargs`(属性经 `cEsc`),**文档级事件委派** `[data-cact]→window[fn](...JSON.parse(cargs))` **按值传参**调用。外部数据**永不拼进 JS/HTML 串** → **从根消除 onclick 注入类**,而非脆弱引号转义。

**改动清单(2 文件,+29/−13)**:
- `platform/shell/copilot-chrome.js`:+`cEsc`/+`cAB`/`cSuggs` 改 `data-csugg`+委派(消除 `copSend('${s}')` 内联注入 + 撇号规避 footgun,`aiSuggs` EN 避撇号注释可后续清)/+文档级 click 委派([data-cact]/[data-csugg])/`cBtn` 保留但加"仅静态 oc、外部数据用 cAB"警示注释。
- `apps/jobseek/logic/copilot-actions.js`:`copReply` 全部外部/用户文本 sink 过 `cEsc`(j.co/j.role/sk.name/gaps/a.title/a.goal/g.name/best.co/p.res);带外部数据的 `cBtn` 迁 `cAB`(agentDeleteJob/copResume/copMatch/copPlan/copInterview/copDoneAct);**静态 `cBtn`(copGo/copMarket/copNewJob/navMap id 等)不动**(oc 零外部数据)。**`copPlan` toast 补 `cEsc(skill)`** —— cAB 把外部数据作**值**传入 copPlan,若 toast 不转义则注入点只是从 onclick 移到此 toast(否则 cAB 是空修)。
- **`agentDeleteJob` 的 `jesc`(第23轮 `5b5041a` 已修、`<`-only、文本上下文足够)保留不动** —— 已过审、正确;不为消一个 helper 名而重编已审红线码(两 helper 并存已注,`cEsc`⊇`jesc`)。

**冒烟(fresh reload · no-cache server · force-revalidate 38 脚本)**:
| 测 | payload | 结果 |
|---|---|---|
| 文本 sink(case0 删除) | `<img src=x onerror=…>` | imgLanded **false** · 文本字面显示 true · 删除按钮=cAB |
| ★onclick JS 串(case3 copPlan arg) | `');window.__xssJs=…//` | cargs=JSON 值 `"[\"K8s\",\"');…//\"]"`(非 JS 串)· imgLanded false · 委派**已触发** · copPlan 收 args=`["K8s","');…//"]`(**值**)· 点击后 `__xssJs`=**0** |
| copPlan toast(skill 位 payload) | `<img onerror=…>` | toast imgLanded false · 字面显示 · `__xssToast`=0 · actions 无污染 |
| cSuggs 委派 | 正常建议 | 4 chip 无 onclick · 点击→`copSend(值)` 正常 |
| 汇总 | | `__xssImg`/`__xssJs`/`__xssToast` 全 0 · 0 console 错 |
证:①旧 `copPlan('...','+j.co+')` 遇 `'`-breakout 会执行、新 cAB 作值传→不执行(结构性消除坐实);②按钮仍工作(委派派发正确函数+正确 args,无功能回归)。

**红线/契约**:`§1` 契约(SeekerShell.*)未触、未新增契约;`profile`/`D3`/`QUERYABLE` 未触;`cEsc`/`cAB` 为平台 chrome 内基元(非跨层 call)。`data-cact`/`data-csugg` 全仓仅本刀用(grep 证,无既有委派属性冲突)。index.html 零改。node/tsc(exit0)/cargo(exit0)净。

**⚠ 诚实披露(sweep 发现的同类 sink · 本刀命名范围外)**:全量 grep `toast(`/`agentChat(`/`append(` 后,发现**同 §4-4/用户输入类** DOM sink 在本刀"只治 copReply/agentChat/cCard/cBtn"命名范围之外:
- `pages/jobs.js:104` `toast('…补齐 '+gapSkill)` 与 `:115` `toast('已生成「'+gapSkill+'」…')` —— `gapSkill` JD 派生(§4-4),**与本刀已修的 copPlan toast 同模式**,但属岗位页弹窗流(非 copReply 下游)。
- `logic/resumes.js:149` `toast('已添加模块「'+name+'」')` —— `name` = 用户输入(`#nmName`)。
- 多处 `toast(String((e&&e.message)||e))`(resumes/intake-job/cards)—— 错误消息文本(可能服务端/网络控制)。
**未静默扩改**(遵"范围克制:只治 copReply/agentChat/cCard/cBtn");`copPlan` toast 之所以修=它是 copReply cAB 的**直接下游 sink**(否则本刀空修)。**建议 P2「toast/错误消息 §4-4 转义刀」**统一收口(可复用 `cEsc`);请评审裁范围(现折入 or 排后续)。

**请评审确认**:①cAB 结构性修法(data-* + 委派 vs 引号转义)取向;②copPlan toast 折入本刀的边界判断;③P2 toast 面范围裁定。**过审后转正 + 记裁定 + 同步 memory。**

---

## P2 §4-4 render 面系统性转义 + 委派白名单(第24轮复审分出)—— 🏁 第25轮通过([应改]复验过 · commit `484a618`)

> **§4-4 转义线(P1+P2)收官**:copReply 结构性消除 onclick 注入(cAB data-*+委派)+ 全 render 面 cEsc(144 处/11 文件)+ 错误 toast errText(22 处/4 文件)+ 委派白名单(CACT_ALLOWED)。**非阻塞账**:①CACT_ALLOWED §1 契约化(app manifest 声明 cAB 处理器名 → 白名单=启用应用并集,恢复「新增应用平台零改动」前提)—— 第二个用 cAB 的应用或 3.y 清;②归属债(settingsPersistOn 系 / 文案 3.y)。

### P2 · render 面系统性收口 + data-cact 委派白名单(commit `b0aaf44`,接续 P1 `5142ee1`)
**由来**:P1 收口 copReply/cCard/cBtn/cSuggs 后,本刀**系统性覆盖其余所有 render 面**里外部(JD 抽取 job.co/role/jd/skill=§4-4 Untrusted)与用户输入未转义进 DOM 的 sink。红线同 P1:CSP `unsafe-inline` 不拦内联处理器、`el()`=template.innerHTML(dom.js:10)+ toast → 转义是唯一防线。

**两条战线(第24轮任务框定:关注入源 + 关放大器)**:
- **关放大器 · platform/shell/copilot-chrome.js**:`data-cact` 委派 dispatcher 加白名单 `CACT_ALLOWED=new Set([agentDeleteJob/copDoneAct/copInterview/copMatch/copPlan/copResume])`(= 6 个 cAB 处理器,grep 全仓枚举)。理据:`window[name](...)` 是 gadget,未修注入面若落 `<button data-cact="…">` 不设防可派发任意 window 函数 → 把 HTML 注入升级为 JS/二次 innerHTML。**★关键裁断:前缀判定(如 `^cop`)不够** —— `copAppend`/`agentAppend` 本身即 innerHTML sink、也匹配前缀 → 必须**精确名单**。冒烟坐实:`data-cact="eval"`/`"copAppend"` 均**不派发**(0 执行、0 注入),白名单内 `copPlan` 正常派发。
- **关注入源 · 144 处 cEsc(11 文件)**:全量 sweep 经 **4 个 catalog agent**(jobs/actions/overview **37** + skills/analysis/match **33** + resumes/interview/intake **40** + cards/settings/widgets **0**)+ 我逐 diff 复核。**转义纪律**:一律在 **DOM sink 处** cEsc、**数据/存储点保持原值**(`genPlanFromGap`/`persist*`/`push` 的参数不转义,避免存储态双重转义)。
  - **jobs.js**(最高危):JOBS 表 `co/role/city/pay/need` + 详情 `co/role`/**`jd`(原始 JD 直进 innerHTML=本刀头号面)**/`years/edu/src/evidence/gapSkill`。
  - **actions.js**:`title/goal/cap/note/due/est/milestone/session/reflection`(`</textarea>` breakout)。
  - **skills/analysis/match**:`s.name`(含 `data-skill`/`data-plan`/`data-pj` **属性面**,cEsc 覆盖 `"`)/`state/evidence`、`j.co`、`gaps`。
  - **resumes/interview**:`q.text/r.qText/r.answer/r.job/good/improve`、模块 `content/bullets/modLabel`、`RESUME.*`、搜索框 `value=""`。**注:fixer 因会话额度中断只完成前半(简历编辑),面试段(275–422 全部 q/r sink + 两搜索框 + RESUME.filename/uploaded)由我手工补齐。**
  - **overview.js**:`g.name/a.title/ns.title/ns.desc`。 **index.html**:widget action(不可信 iframe §4)toast `<`-转义。

**假阳性(核实后**不**转义,避免引 bug)**:①guardrail `detail`/`changes` 经 **textContent** 渲染(guardrail/index.js:71,转义反成可见 `&lt;`);②overview `ns.ctaGo` 恒静态字面量(`'actions'`/`'jobs'`/`'match'`),其 `onclick="go('…')"` 安全;③resumes 导出 `title` 只进 markdown(`# ${model.title}`)非 DOM。

**冒烟(fresh reload · no-cache · force-revalidate 38 脚本)· 四上下文 + 白名单 + 零回归**:
| 面 | payload | 结果 |
|---|---|---|
| 文本 sink(jobs 表 co) | `<img onerror>` | 0 元素 · 字面显示 |
| **原始 JD**(详情 innerHTML) | `<img onerror>`+`<script>` | 0 img · **0 script** · 字面显示 |
| **属性面**(skills `data-skill`) | `"><img onerror>` | 0 元素 · 属性**原样持值**(cEsc 转 `"`) |
| **textarea**(actions reflection) | `</textarea><img onerror>` | 0 元素 · 字面留在 textarea 内 |
| **白名单**(放大器) | `data-cact="eval"`/`"copAppend"` | **均不派发**(0 执行/0 注入)· `copPlan` 正常派发 |
| 零回归 | 正常演示数据 | 8 页 render 无 `&lt;`/`&amp;`/`&quot;` 双重转义 artifact · 截图存证 · 0 console 错 |
汇总:`__xss*` 全 0。**证**:原始 JD 面(stored-XSS 教科书面)+ 属性 breakout + `</textarea>` breakout + onclick-gadget 升级面**全封**;演示数据零视觉回归。

**红线/契约/范围**:只加转义/白名单,**不改业务逻辑、不新增契约、不动 §1/profile/D3/QUERYABLE**。`cEsc` 为平台 chrome 基元(apps 按全局名引用,同 el/$/tt/esc 先例,非跨层 call);白名单为平台安全控制(名单内为 app 处理器名 = 防御性 allowlist,已注"新增 cAB 须登记")。`node --check`×11 净、`tsc` exit0、`cargo` 未触、**无双重转义**(grep)、**无残留 raw sink**(grep)。

**⚠ 诚实披露(核实后本刀不动 · 请评审裁)**:`settings.js` 的 `value="${MODEL.apiKey}"`/`sttKey`/`ttsKey`(L345/355/358)在 `value=""` **未转义** —— 但为**用户自有密钥**(自数据、非攻击者可达→仅自 XSS)且属**密钥渲染红线相邻面**,XSS 刀不宜动(同批兄弟 URL 字段已 `.replace(/"/)`,keys 独漏 = pre-existing 不一致);另**密钥入 `value` 本身**是「前端只见 configured/empty」红线的既有问题(桌面走钥匙串,web 态 mock),超本 XSS 刀 → **建议独立「settings 密钥渲染一致性/红线」小审**。`PROFILE` value(L333)已转 `"`(足够防属性 breakout)。

**请评审确认**:①白名单取向(精确 Set vs 前缀,及 app 名单入平台的 §1 判断);②144 处转义的 sink/数据点边界纪律;③settings 密钥面裁定(独立审 or 忽略)。**过审后转正 + 记裁定 + 同步 memory。**

### 第25轮评审回执 —— P2 通过(核心达标·代码层核实)+ 1 [应改](已修复,复验待过 · commit `484a618`)
**结论**:P2 **通过**;白名单(关放大器)/jd stored-XSS/属性面/textarea/**数据点无双重转义纪律**/假阳性识别/面试段手工补齐无缺口/残留扫描空/cargo83·tsc0·node×11 —— 全代码层核实。**三待裁**:
- **① 白名单 = 精确 Set 认可 + §1 过渡认可 + ★强制契约化账**:前缀判定不够(copAppend/agentAppend 本身 innerHTML sink 且匹配 cop/agent 前缀)→ 精确名单正确。**但 `CACT_ALLOWED` 硬编码 6 个 jobseek 函数名 = 平台依赖 app 符号,破坏第23轮验证的「新增应用=平台零改动」前提**(第二个用 cAB 的应用会被迫改此平台 Set)。**裁定=过渡认可(安全收益实、过渡态 window 全局)+ 强制契约化账(同第16轮 renderAgentCmds 先例)**:app 经 **manifest 声明自己的 cAB 处理器名**、`CACT_ALLOWED` = 启用应用声明之并集 → 平台不再硬编码 jobseek 符号、恢复阶段4 前提、与 appCommands/collId 同款委派。**与 QUERYABLE 语义不同**(后端安全硬底=有意静态不可 app 扩;cAB 白名单**应**随 app 增长→ manifest 声明才是对的形)。**清账时机:第二个应用用 cAB 时 或 3.y。**
- **② sink/数据点边界纪律 = 认可**(存 raw、渲染 cEsc 已核;假阳性识别正确;无残留)——唯错误 toast 例外(见 [应改])。
- **③ settings 密钥面 = 忽略可接受(非红线违规,评审已深挖核实)**:`key.onblur→rt.secret.set(钥匙串)` 成功后清 `key.value`+`MODEL.apiKey`;grep 证 MODEL 全仓无落盘;hydrate 显 configured/empty。**§4「密钥只进钥匙串、前端只见 configured/empty」守住**,MODEL.apiKey 纯内存瞬态;XSS 上是用户自有密钥(self-data、type=password)可忽略。

**★[应改] 错误消息 toast 未转义(P2 scope 内漏项,catalog 误判 settings"0 sinks")—— 已修 commit `484a618`**:`toast(String((e&&e.message)||e))` 经 el(innerHTML),`e.message` 可含 `rt.mcp`(§4-4 明列 Untrusted)/`rt.ai`(BYO 端点)返回外部内容。修:**toast.js 加 `errText(e)` 助手**(文本转义 & < >,自持)、**21 处错误 toast 统一过 errText**(settings 17 + resumes 2 + cards 1 + intake-job 1)。**★纪律自查**:机械替换误伤 intake-job.js:128/164 `sEl.textContent=String(...)`(textContent 上下文安全、转义反显字面 &lt;)→ **已还原 raw**,确认所有 errText(e) 仅在 toast() 内(grep 证)。**同批(第25轮 optional 采纳)**:MODEL.apiKey/sttKey/ttsKey 的 value="" 补 `(…||'').replace(/"/g,'&quot;')`(兄弟 URL 字段一致 + 修 undefined 渲染)。**复验冒烟**:`errText({message:'<img onerror><script>'})`→ toast 0 元素/0 script/字面显示/__xss=0;node×5·tsc0·无残留 raw 错误 toast·无 textContent 过度转义。**复审过后转正「通过」+ 记裁定(含白名单契约化强制账)+ 同步 memory。**

---

## R1 真机冒烟 —— 🏁 通过(desktop · Tauri + WKWebView · Seeker.app release 构建)

**由来**:历轮(简历导出/发现 agent/远程 MCP/钥匙串/assets/§4-4 安全修)均只在网页预览(Chromium)验过,真机系统 WebView 从未冒烟;开发机 Windows→Mac 刚解锁([[mac-unblocks-r1]])→ §4-4 收官后首验。

**准备**:①`node_modules` 是 Windows 装的、缺 darwin-arm64 的 `@tauri-apps/cli` 二进制 → `npm install` 拉齐(tauri-cli 2.11.2);②`tauri build --bundles app` → `Seeker.app`(release 1m12s;**未签名**——本地冒烟够跑,分发签名/公证=#6 另议);③computer-use 授权 `dev.zhapar.seeker`(裸 `target/debug/app` 无 bundle 无法按名授权 → 必须 `.app`;native 截图过滤=仅 Seeker 可见,隐私保)。

**冒烟(真机 WKWebView · 逐面截图存证)**:
1. **总览页完整渲染** —— 左导航含 **jobseek + assets 两应用**的页(核心/研究/成长/资产/系统分组)、AI 建议卡、统计(5/20 jobs · 6.4 · 5.6 · 26)、TOP GAPS。
2. **目标岗位表**(§4-4 重转义面 co/role/need/pay)+ **真实持久化数据**(SQLite:DeepSeek/月之暗面/百度,非演示数据)—— **无 `&lt;` 双重转义 artifact**,确认数据层 + 转义在真机跑通。
3. **岗位详情模态 + 原始 JD 段 `cEsc(j.jd)`(§4-4 最高危 sink)** —— 完整 JD 全文渲染干净、转义对正常内容透明。
4. **Copilot chrome + `data-csugg` 委派 → copSend → 用户气泡**(P1 改的委派面在真机生效)。
5. **★AI 全链真机跑通**:`frameQuery → streamReply → query_data`(读 JOBS+SKILLS、D3 三层闸)→ **aiHTML Markdown 渲染**(粗体/内联码 `match 7/interest 8`/编号列表)→ 完整回复「最该投 DeepSeek(id:5)」+ 四项能力缺口分析。**能力层 + AI 网关流式 + Markdown 安全渲染在 WKWebView 全部正常**。
6. **assets 应用页(Prompt 库)渲染** —— 多应用平台在桌面工作。

**结论**:整条桌面栈端到端跑通 —— Rust 核 + WKWebView 启动 + `asset://` 载全部 38 脚本 + CSP(script-src unsafe-inline)放行 + SQLite 数据层 + 能力层 `query_data` + AI 网关流式 + 多应用平台;**§4-4 转义在真实 WebView 下渲染正常、零回归**。R1(多功能长期挂账)落地。
**遗留(非阻塞)**:①`.app` 未签名 —— 分发前须 #6 签名/公证(dmg 打包本刀用 `--bundles app` 跳过);②Copilot 建议 chip 首点被面板开场动画吃掉、二次点生效(UX 微调可选,非缺陷)。

---

## 阶段3.y 类型化(单列里程碑)· 首刀 spike —— 待审

**决策(已对齐)**:走**原生 ES module**(合 docs「真 ES module」+ 零构建取向,非 esbuild bundler)。目标:30 个 `@ts-nocheck` classic 全局文件 → 真 module + 显式 import + 账本(monolith-globals.d.ts)清空 + 适配器删;顺带清 CACT_ALLOWED 契约化 + 文案债。

**scout 关键发现(重塑策略)**:①平台 runtime/capability/guardrail/markdown 层**已是 ES module**(index.html:873 module import),3.y 只治 shell+jobseek 30 个 classic 文件;②**INIT(index.html:1318-1333)在 parse-time 跑**且重度用 base 工具(`$`/`el`/`IC`/`tt` 经 buildNav/go/copInit/initShell)→ base 工具**不能**直接转 deferred module(INIT 会先崩)——「自底向上先转 base」的朴素计划撞墙;③好消息:module 可引用 classic 全局词法 const(共享全局词法环境),故已转 module 可继续用未转 classic 全局(过渡可行)。

**首刀 spike(commit `0a736ad`):modal.js**(平台、小、仅用户交互时开=不碰 INIT 时序)→ 真 ES module。
- **模式验证**:`openModal/closeModal/focusableIn` → `export`,逻辑逐字节保留;`<script>`→`type=module`;依赖 $/el/tt 过渡仍 classic(module bare 引用经全局词法解析)。
- **★过渡双桥(零回归的关键机制)**:①**运行时 window 桥**(modal.js 尾)→ classic 消费者(INIT + jobseek 11 文件)按全局名调不变;②**tsc 桥**(新增 `platform/shell/shell-globals.d.ts` ambient decl)→ @ts-check 消费者(assets prompts/notes)零类型回归。**首刀发现**:转 module 会移除该基元对 tsc 的 ambient-global 身份 → @ts-check 消费者必须配 tsc 桥或改 import(否则 TS2304)。双桥随消费者逐个改 import 而逐条销。
- **验**:node --check(type:module 下 export 合法)、tsc exit0、web 冒烟(app 启动 INIT 未破、window 桥 openModal/closeModal 生效、模态开合正常、0 console 错)。

**下刀候选(请评审定序)**:①**INIT 迁入 module**(base 工具解锁的前提;须保 hydration/rt-ready 时序——INIT 现渲空壳、rt-ready 再水合,迁移勿倒序);②或继续转"仅运行时用"的平台叶子(toast/ai-render 等)扩大双桥样本、暂不碰 INIT。**建议**:先②多攒几个安全叶子稳固双桥模式,再啃①INIT 迁移这块硬骨头。**请评审确认双桥取向 + 下刀定序。**

### 方向裁定回执(评审)+ 采纳 + 一处更正 + 第二刀
**评审裁定**:①双桥 + 逐条销 **认可**,附**影子绑定/有状态原子性红线**——有状态符号(`setState`/`JOBS`/`ACTIONS`/`MODEL`/`PROFILE`/`SEED`/`IV_RECORDS`)双发布=分裂状态=静默 bug,须**同一 commit 内所有消费者原子翻转**(纯函数叶子 dual-publish 宽松);逐条销三约束(两桥同步收口 / 每销 grep 单路径 / 有状态原子);措辞正名「classic 词法/window 兼容桥 → ES import」(过渡是**新增** window.X,非拆现有)。②定序 **先攒叶子(自底向上)、INIT 作收口刀**(不先啃 INIT——第1/5轮时序模型:INIT 解析期同步消费,先啃=第一刀撞全依赖图+最硬时序、牺牲增量零回归)。**全部采纳。**
**★一处更正(已核实、评审 pick 的具体文件撞时序墙)**:评审建议首刀挑 `dom $/$$/el`、`icons IC` —— 但 **INIT(index.html:1320)在 parse-time 直接用 `$` 与 `IC`**(`$('#themeBtn2').innerHTML=…IC.sun`)+ buildNav@1318(内用 $/tt/IC)+ `$('#appMgrBtn')`@1333 → dom/icons/i18n **被 parse-time INIT 钉住**,转 deferred module 会先崩 INIT。故 base 工具**不是自由叶子**,须留到 **INIT 收口刀**(INIT 迁 module 后)才解锁;真正的"自由叶子"是**仅运行时用**的(modal✅/toast/ai-render…)。此更正**强化**评审的「叶子先、INIT 后」——只是厘清"哪些叶子自由"。
**第二刀(commit `b9c211b`)· import 方向验证**:`resume-modals.js`(最小 runtime-only modal 消费者,45 行,零模块态)→ ES module,`import { openModal } from '../../../platform/shell/modal.js'`(**首个消费者改 import**,建 modal.js 首刀之上)。closeModal 仅内联 onclick 串→仍 window 桥;openModal 纯函数双路径(import + 其余 10 消费者 window)= 合"纯函数宽松"。自身 exports window 桥。**验**:node/tsc/web 冒烟(import 解析成功=openResumeUpload 调 imported openModal 开模态、app 启动、0 err)。**双桥 + import 方向机制两刀验毕。**
**下刀**:按裁定继续攒 runtime-only 安全叶子(toast[注:`lastUndo` 有状态、被 Mod+Z 读→原子处理]/ai-render[aiHTML 无态]…),稳固后啃 INIT 收口刀解锁 base 工具。

### 第三刀 + 地形勘定(安全叶子将尽 → 下一步定序请评审)
**第三刀(commit `5b5c105`)· ai-render.js**(★含红线 aiErrHTML):`aiHTML/displayText/toolStatusText/aiErrHTML` → ES module + window 桥,**逻辑逐字节保留**。四函数**无模块态**(纯)→ dual-publish 安全。**★红线 aiErrHTML(第11/15轮)冒烟证安全属性存续**:err `<img>`→`&lt;img`(无元素)、onclick 仅 copClose+go('settings')。无 @ts-check 消费者 → 本刀无需 tsc 桥。时序:消费点(hydrateMessages)在 rt-ready runtime 非 parse-time。node/tsc/web 冒烟净。
**★地形勘定(三刀验完机制,发现安全叶子将尽)**:modal✅ + ai-render✅ 已把「纯函数叶子 export+桥」跑通,resume-modals✅ 把「消费者改 import」跑通。**剩余 shell 文件大多不是自由叶子**:
- **parse-time INIT 钉死**(须留 INIT 收口刀):`dom`/`icons`/`i18n`(§前述)、`nav`(buildNav/go/render@INIT)、`registry`(SeekerShell@initApps + 全 manifest)、`keys`(initKeys@INIT)、`shell-boot`(initShell@INIT)、`copilot-chrome`(copInit/agentInit@INIT)。
- **有状态**(须原子翻转):`toast`(`lastUndo`←Mod+Z)、`settings`(`setState`/`MODEL`)、`data-store`(集合态)。
- **红线 + runtime**(可转但须双审):`ai-engine`(extractSeekerBlock/streamReply;且它消费 aiHTML→可作「平台 mid 改 import aiHTML」样本)、`profile`(persistProfileField 双红线)。
**故安全"纯叶子"基本用尽。下一步二选一,请评审定序**:①`toast`(有状态 lastUndo,首个「原子翻转」样本——把 Mod+Z 消费者同刀翻);②`ai-engine`(红线,首个「平台 mid 文件改 import 已 ESM 化的 aiHTML」样本,证 import 链上移);③或就此转入 **INIT 收口刀规划**(解锁 parse-time 钉死的 base 工具/nav/registry 一大批)。**我倾向先①toast**(把"有状态原子翻转"这个最关键的红线机制也验一遍,再进 INIT),但 INIT 收口是绕不开的大头,可并行规划。

### 第四刀:toast.js —— ★首个有状态原子翻转(evaluator 定序选 ①)
**commit `21eb38c`**:toast.js → ES module。`toast/toastUndo/errText` 纯函数 export+桥;**★`lastUndo` 有状态 → 不 dual-publish**(window 快照会分裂),收进 `runLastUndo()` 访问器(只调不外露 mutable 值)+ **同刀原子翻转唯一消费者**(index.html Mod+Z:`if(lastUndo)lastUndo()`→`if(!runLastUndo())…`)。tsc 桥 +toast/toastUndo(assets @ts-check 用)。
**★冒烟坐实原子机制**:`lastUndo` **不在 window**(封装、单实例、无分裂);跨模块有状态路径正确(toastUndo 登记 → runLastUndo 触发 restoreFn=restored:1 → 自清 → 二次 false)。node/tsc/web 净、逐字节(runLastUndo 新增访问器、行为等价)。

### 🏁 四刀阶段小结:3.y 全部机制已验,下一步 = INIT 收口刀(大头,请评审拍规划)
四刀把 3.y 会用到的**全部迁移机制**跑通了,可作后续批量迁移的模板:
| 机制 | 验证刀 |
|---|---|
| classic→module + export + 运行时 window 桥 | modal / ai-render / toast |
| tsc ambient 桥(@ts-check 消费者零回归)+ 逐条销 | modal(openModal/closeModal)、toast(+toast/toastUndo) |
| 消费者改 import(import 方向) | resume-modals(import openModal) |
| ★红线基元逐字节保留(安全属性冒烟证) | ai-render(aiErrHTML) |
| ★有状态符号原子翻转(封装+同刀翻消费者、不 dual-publish) | toast(lastUndo→runLastUndo) |

**剩余大头 = INIT 收口刀**:parse-time INIT(index.html:1316-1333)现同步用 `$`/`IC`/`tt`/buildNav/copInit/initShell/initKeys/initApps/go —— 把它迁进 module 是**解锁 base 工具(dom/icons/i18n)+ nav/registry/keys/shell-boot/copilot-chrome 一大批 parse-time 钉死文件**的前提。**时序红线(第1/5轮)**:INIT 现在 rt-ready(873 module dispatch)**之前**跑(渲空壳 → rt-ready 再水合);迁进 module 后须保此序不倒置(否则 hydration 找不到容器)。**建议 INIT 收口刀单独起规划(下一步)**,不与叶子刀混。**请评审:是否转入 INIT 收口刀规划?**

### 🏁 第26轮评审回执 —— 前四刀通过(无阻断/应改)
**结论**:`54713ac..f9790cd` 四刀**通过**,机制全部代码层核实无暗改。①modal export+双桥(焦点陷阱状态模块私有=单实例)②resume-modals import 方向 ③**ai-render 红线 aiErrHTML 与第11/15轮逐字一致(diff 仅加 export)**④**toast 有状态原子:`lastUndo` grep 全仓仅 toast.js 内部、零外部消费者=无分裂,唯一消费者 Mod+Z 同刀翻转**。**两命门独立验**:时序(四刀"仅运行时叶子"前提成立——copInit/agentInit/renderOverview 体内无同步消费、aiErrHTML 唯一调用在 ai-engine onError 运行时)、有状态原子(=后续 setState/JOBS/MODEL/PROFILE 地雷的迁移模板)。**评审领错**:上轮建议 dom/$/IC 首刀是其疏漏,我 scout 出 parse-time 墙并改挑运行时叶子=正确,强化「叶子先/INIT 后」。**INIT 收口刀三红线(评审预钉)**:①保「渲空壳→rt-ready 水合」时序(首屏同步渲染、数据异步水合不破)②它=`$/IC/tt` 解锁点 + 末批 window 桥拆除点 ③账本(monolith-globals 27 + shell-globals)收口时向零收敛=适配器可删。**下一步:产出 INIT 收口刀规划送审(不动手)。**

---

## 3.y · INIT 收口刀 —— 规划(待审,不动手)

### A. 当前 boot 时序图(scout 实测)
```
【parse-time · classic 文档序】
 head classic: keys/registry/dom/icons/i18n/nav/ai-engine/data-store/profile/settings/shell-boot/copilot-chrome
   └ 注册 rt-ready 监听:profile.js:18 hydrateProfile(解析期)
 body classic: data/data-helpers/pages*/logic*/cards/manifest/assets* + 内联 glue
   └ 注册 rt-ready 监听:persistence.js:20 hydrateJobs / :73 hydrateBizColls、notes/prompts、index.html:1332
 body 内联 INIT 块(1316-1333):buildNav/buildPages/$('#themeBtn2')…IC.sun/copInit/agentInit/initShell/initKeys/go('overview')/initApps
   → ★渲"空壳"(rt 未就绪,用 demo/空数据)
【post-parse · deferred module 标签序】
 toast(862)/modal(863)/ai-render(864) module → 设 window 桥
 873 module: import rt/guardrail/… → 设 window.SeekerRT → ★dispatch 'seeker-rt-ready'
   → 所有解析期注册的监听器触发 → ★水合(真实数据重渲)
```
**时序不变式(第1/5轮)**:①INIT 渲空壳(parse)**早于** rt-ready 水合(dispatch);②所有水合监听在 classic 解析期注册 **早于** deferred dispatch。

### B. 核心耦合(规划要害)
rt-ready **dispatch(873 module 内)** ↔ **水合监听注册(classic 解析期,散落 profile/persistence/notes/prompts/index.html)**。**把注册文件转 module → 注册变 deferred**:若其标签晚于 873(如 persistence@1053 > 873)→ **错过 dispatch → 该集合永不水合(静默)**。**故 INIT 收口不是单文件刀,是 boot 编排重构**:INIT 迁移 + dispatch 与水合注册的相对序必须一起管。

### C. 目标态
单一 entry module 显式编排:`import 全图(base→上)` → INIT 渲空壳 → (各模块 rt-ready 水合注册)→ **dispatch(最后)** → 水合。**顺序由 import 图 + 显式序保证,两条时序不变式 by construction 守住**(不再靠"classic 解析期"隐式保证)。

### D. 分步(增量零回归 · 每步一 commit + C2 验 · 时序步重点冒烟 hydration)
1. **【enabler】INIT 块 → module,置于 873 dispatch 之前**:1316-1333 迁新 module(调 window.buildNav/copInit/…仍 classic 全局)。**效果**:INIT 不再 parse-time → dom/icons/i18n/nav/registry/keys/shell-boot/copilot-chrome **解除 parse-time 钉死**。**行为等价**:INIT-module 仍早于 873(shell 早于 rt-ready);INIT 不用 toast/modal/aiHTML(已核)故与叶子 module 的相对序无关。**验**:8 页/Copilot/rt-ready 后 hydration(jobs/profile/assets)全对。
2. **【解耦】dispatch 迁末位 module**:`seeker-rt-ready` dispatch 从 873 拆到**最后一个 module**(所有水合注册之后)。**效果**:水合注册文件(profile/persistence/notes/prompts)转 module 后不再受"注册须早于 dispatch"约束(只要早于末位 dispatch)。rt-setup(window.SeekerRT)留 873、dispatch 后移。**验**:hydration 全对(dispatch 时机后移不影响,监听齐备)。
3. **【解锁批】base + 中层转 module**(1/2 后可安全):dom/icons/i18n(纯,双桥)→ nav/registry/keys/shell-boot/copilot-chrome(部分有状态如 registry 的启用态、copilot 的 appMode → 按④原子模板)+ 水合注册文件 profile(★双红线)/persistence 转 module。每刀双桥/原子 + tsc 桥逐条销。
4. **【收口】**:INIT-module + 各消费者改从 **import** 消费(不再 window)→ 拆末批 window 桥 + `shell-globals.d.ts`/`monolith-globals.d.ts`(27 条)**清零** → **适配器 manifest 转真 import + 删账本**。可选整合单一 `main.js` entry。

### E. 风险 + 回滚
- **最险=步1/2(时序)**:重点冒烟 rt-ready 后的**数据水合**(jobs 从空→真实、profile 隐私字段、assets 集合、Copilot 历史 hydrateMessages)+ 首屏不闪空。桌面(WKWebView)复冒烟一次(R1 手法)。
- 每步独立 commit,坏了 revert 单步;账本/桥只增不减直到步4 收口,过程任何时刻 classic+module 混合态可运行。
- **不变式守恒证**:步1 后 INIT-module 早于 873;步2 后 dispatch 是最后 module → 前述两不变式在每个中间态都成立。

### F. 首刀 = 步1(INIT 块 → module)
**请评审过此规划(尤其 C 的耦合判断 + D 步1/2 的时序编排 by construction 正确性)再开步1。** 不动手。

### 🏁 第27轮评审回执 —— 规划认可 + 1 必修 + 3 精化(动手前折入)
**结论**:规划**认可**(核心发现 rt-ready 耦合时序系统=真洞察、评审独立核证属实:dispatch@884∈873 module、水合监听全 classic 解析期注册、persistence@1053 晚于 873;转 module 不迁 dispatch=静默不水合)。定序自洽,按此推进。**动手前硬前提**:
- **★必修·步2=「拆分」非「整块迁」**:873 module 一身二职——`window.SeekerRT/Guardrail/Widgets/Markdown` **桥建立(须早于同步消费者)** + `dispatchEvent`(须晚于水合注册)。整块搬末位会崩早期访问桥的代码。**只迁 `dispatchEvent` 一行、桥建立留早位**;动手前 grep 全仓"dispatch 前、非 rt-ready handler 内"同步访问这 4 桥的点,有则拆、无则整块搬亦可但留痕此判断。
- **★精化·有状态 litmus(细化步3「按 toast 模板」)**:判据=该绑定是否出现 `X = …`(整体重赋)?**是→封装/访问器/不 dual-publish**(`SEED` demo-seed.js:9 `let SEED=null`→`SEED={…}`、`lastUndo` 已做);**否(只 `X.k=`/`X.push`)→ `window.X=X` 同引用、dual-publish 安全、勿套无谓访问器**(`PROFILE` const+`[k]=`、`JOBS/ACTIONS` `.length=0`/`.push`)。
- **★精化·`setState` 最高危待查**(index.html:964 `let setState={…}`,跨 shell-boot/settings/i18n/nav 重度消费):转它前**先定 hydrate 是重赋值 `setState={…}` 还是只 mutate `setState.x=`**——前者地雷(访问器+原子翻全部消费者)、后者安全。
- **★精化·PROFILE 红线最小暴露**:虽引用安全,但隐私红线符号→消费者**直接 import、不给 `window.PROFILE` 桥**(纵深防御、少一全局面;红线符号 import-first 非 window-bridge)。
- **澄清**:实为**四步**(步4 尾"可选 main.js 单入口"若单列则步5,不单列即四步——按四步推进);**冒烟补两条**:步1/2 后 ①profile 双红线仍隔离(module 化不漏 PROFILE 进 AI 路径、rt.profile 通道不变)②D3/CACT_ALLOWED 边界仍生效(boot 序变不影响 set_ai_readable 推送时点)。
**推进**:每步 commit+C2,步1/2 时序刀 + 步3 有状态刀逐刀送审。**下一步:开步1(INIT 块→module)。**

### 步1(commit `9d7103e`)· INIT 执行序→module + ★发现并修复 cut2 潜伏回归(待审)
**步1 本体**:parse-time INIT 块(1316-1333)→ 新 `<script type=module>`,置 873 rt-setup module **之前**。函数定义留 classic 块、仅执行序迁出。INIT 本就 pre-rt(parse-time 早于 deferred 873)→ 迁 module 后仍早于 873、行为等价;appReady 写 copilot-chrome global-lexical `let`(strict 正常);引用经全局词法/window(同 modal 刀验)。**效果**:INIT 不再 parse-time → dom/icons/i18n/nav/registry/keys/shell-boot/copilot-chrome 解除 parse-time 钉死。
**★诚实披露 · cut2 潜伏回归(影响第26轮 pass 前提,步1 完整 INIT 冒烟才暴露)**:
- **根因**:`renderTopActions`(nav.js:51;`initShell→setLang` 早期构建 topActions map)**裸引用** `openResumeModal`。**cut2** 把 resume-modals 转 deferred module 后,`openResumeModal` 变 window 桥、**载入晚于 INIT** → 构建 map 时 **ReferenceError** → `initShell` 抛 → **INIT 未跑完**(go/appReady/subscribe/appMgr 均未执行)。
- **为何潜伏三刀**:cut2–4 冒烟只查 `appBooted`(=buildNav,在 initShell **之前**)+ 各刀自身功能,**漏查完整 INIT 完成** → cut2 起 initShell 实已抛、但表象(nav 在、hydration 后页面在)掩盖。**我的 cut2–4 冒烟不充分**,第26轮 pass 基于此不充分证据。
- **修**:`renderTopActions` handler 一律**惰性闭包** `fn:()=>X()`(点击时解析、与 module 载序解耦):openResumeModal(已中招)+ openNewJob/openMarketValue/openNewAction(尚 classic、将中招)四处一并 lazy 化=防复发。**此修 retroactively 修好 cut2**,当前 HEAD 正确。
- **验(修后 · fresh)**:★完整 INIT 完成(appMgrBtn 接线=末行跑到)、9 页全 render+正确 top-action 数、match 顶栏点击→openResumeModal 惰性开模态、appMgr 开、D3/profile 隔离不变、tsc0。
- **★流程纠偏(纳入后续每刀)**:冒烟必查**完整 INIT 完成**(appMgrBtn.onclick 已接 或 __INIT done 哨兵),非仅 appBooted。**建议评审复核:第26轮四刀在此修后是否需补一次"完整 INIT"回归确认**(我判断 cut3/4 逻辑本身无暗改、仅冒烟盲区,此修已覆盖;但请评审定夺)。

### 步2(commit `c2a7af9`)· dispatch 拆分迁末位(评审第27轮必修落地)· 待审
- **必修 grep 落实**:全仓 4 桥(SeekerRT/Guardrail/Widgets/Markdown)访问**全在函数内**(persist/hydrate/render/handlers/streamReply/aiHTML=runtime 或 rt-ready handler)、**无 dispatch 前同步桥访问** → 整块迁本亦安全;但按评审首选走**拆分**(更保险 + 解耦),留痕此判断。
- **拆分**:873 module 保留桥建立(`window.SeekerRT=rt`+Guardrail/Widgets/Markdown+initMcpConfirm)于 head 早位;**仅 `dispatchEvent('seeker-rt-ready')` 一行**迁至 body 末位新 module。
- **发现另一 rt-ready 监听**:index.html:1169(classic 解析期)`SeekerWidgets.onAction=wgtAction` —— 亦早于末位 dispatch,冒烟用它作 rt-ready 已 fire 的证据。
- **验(web fresh)**:完整 INIT、★**rt-ready 已 fire**(SeekerWidgets.onAction=wgtAction 置位=1169 监听跑了)、手动 re-dispatch 探针捕获、桥早建、D3/profile 隔离不变、0 err。
- **★桌面 WKWebView 真机复冒烟(步1+2 · 真实 SQLite 数据水合路径)= 过**:重建 Seeker.app → computer-use 逐面验:①启动 render(app 状态持久化:jobseek 关/assets 开)②**App Manager 开**(=appMgrBtn.onclick 已接=INIT 末行跑到 + openAppManager/renderAppMgr 工作)③**开 jobseek → shellReassemble**(subscribe 已接)→ nav 即刻装配 jobseek 页 + **目标岗位 5/20 真实数据**(DeepSeek/月之暗面/百度,rt-ready 已从 SQLite 水合、UI 关时亦水合)④关 jobseek → nav 即刻移除。**boot 重构在真机保住「渲空壳→rt-ready→真实数据水合」+ 无闪空 + §4-4 转义不变**。(⚠ 我为验 jobseek 水合临时开了 jobseek、验毕**已复位为关**=leave-as-found。)
- **效果**:水合注册文件(profile/persistence/notes/prompts)转 module 的"注册须早于 dispatch"约束已解除 → 步3 base+中层解锁。

### 🏁 第28轮评审回执 —— 步1+2 + cut2 回归修 通过
**结论**:`9d7103e`(步1+nav 修)+`c2a7af9`(步2)**通过**、cut2 回归**闭合**。**评审独立完整-INIT 双向扫描**:13 个 module 化符号在整条 INIT 链(buildNav/initShell/setLang/renderTopActions/copInit/agentInit/go/renderOverview)的 bare eager 引用**仅 nav.js:86 closeModal**(overlay click 闭包内、本就 lazy)→ **cut3/4 无同类 bug**,cut2 那处唯一、已被 nav 惰性修覆盖。**评审认领第26轮扫描盲区**:其只扫「四刀 import 的符号无 parse-time 消费者」、漏「resume-modals **export 给 classic** 的 openResumeModal 的 parse-time 消费者(renderTopActions)」= 单向;+ 我(exec)冒烟只查 appBooted(在 initShell 之前)= 双盲。**连带**:R1 `138cf6a` 称 App Manager 工作与回归矛盾 → 那道真机冒烟亦踩同盲区(step2 修后 build 真机复验 App Manager 已可靠确认)。**两裁点**:①第26轮四刀补完整-INIT 确认=需要且已满足(评审双向扫描+exec 步1完整-INIT冒烟+步2修后真机);②**nav 惰性 handler=行为等价认可**,评审**立为规范**:handler map 引用「将 ESM 化的符号」一律惰性闭包。**流程纠偏(双方各补一条)**:exec=冒烟必查完整 INIT 完成;评审=代码层 parse-time 扫描须覆盖 module **双向**符号(import 面 + export-给-classic 面)。**★步3 前置(评审钉)**:`setState`/`SEED` 转前**先查重赋值性**(litmus:出现 `X={...}` 整体重赋→封装/访问器;只 `X.k=`→dual-publish)。开步3(base+中层)。

### 步3-a/b(commit `683a788`/`e702fe7`)· base 工具层(dom/icons/i18n)→ ES module · 🏁 第29轮通过([阻断]修后,评审亲跑功能测复验)
**前置双向 parse-time 扫描(第28轮纠偏落地)**:`.js` 顶层扫描空;index.html 命中(880-881 IC.sun/$ 在 **INIT-module 内**=deferred、1021+ tt 在 `clearAllDataFlow` 等**函数体内**=runtime)→ **无 classic 顶层消费 $/el/tt/IC**(INIT 已 module)→ base 安全转。
- **3-a dom.js**($/$$/el,纯 const 箭头无重赋值):export + window 桥(`/** @type {any} */(window)` 保 @ts-check 净)。tsc 桥 +$/$$/el 类型化 ambient(消费者 assets;顺带消 TS7006 级联)。
- **3-b icons.js**(IC=const 对象)+ **i18n.js**(tt/L/T 读 setState.lang;I18N 内部私有不上桥):export + 桥。tsc 桥 +IC(Record<string,string>)+tt。
- **载序要点**:base module tag(859/860/861)**早于 INIT-module(874)** → INIT 的 `$`/`IC.sun`/`tt()` 经 window 桥可用;classic 消费者按全局名调不变。三者纯/const → dual-publish 同引用安全(非有状态,不触原子红线)。
- **验(web fresh · 均含★完整 INIT)**:完整 INIT 完成、9 页 render、themeBtn IC.sun + 模态 IC.x 图标渲染、tt/lang 工作、App Manager 模态开(用 $/el)、D3/profile 隔离不变、node/tsc0/0 err。逐字节。
- **@ts-check base 工具转换模式确立**:export + `(any)`-cast window 桥 + shell-globals.d.ts **类型化** ambient(异于 @ts-nocheck 刀的无类型 declare)。
**下一步 = 步3 中层**(nav/registry/keys/shell-boot/copilot-chrome + 水合注册 profile/persistence)—— **含有状态 + 红线**:registry 启用态、copilot `appMode`/`appReady`、**`setState`(★转前先查重赋值性)**、**`PROFILE`(红线,import-first 不上桥)**、`SEED`(demo-seed `let SEED=null`→重赋值=封装)。按有状态 litmus 逐刀,红线双审。

### ★ 第29轮 [阻断] · step3-a 破 overlay-click-关闭 —— 🏁 已修复 + 评审亲跑功能测复验通过(commit `412508f`)
**评审 preview 功能测抓出真回归**(非 render/console,是**交互功能测**):step3-a dom.js→module 后,**nav.js:86 `$('#overlay').addEventListener(...)` 是 classic 顶层 parse-time 裸用 `$`** → dom deferred module 晚于 nav classic parse → `$` 未就绪 → 绑定抛 ReferenceError、监听没挂 → **点 overlay 不关闭模态 + 每加载一条 uncaught**。**归属 step3-a**(683a788~1 dom=classic 时 nav:86 正常)。
- **修**:overlay 绑定收进 nav.js `wireOverlay()`、由 INIT-module(deferred,晚于 dom module)调 → `$` 就绪(同 cut2 惰性修一类)。
- **★我的扫描缺陷(认领)**:第28轮我们刚立"双向扫描须抓 classic 顶层 eager 消费",这轮我的 grep 仍**漏 nav.js:86**——过滤器 `-vE '=>'` 把**含箭头回调的顶层语句**(overlay 绑定 `e=>{…}`)排掉了 = 扫描器自身缺陷。**纠正**:改「列 classic column-0 非声明语句 + 手工查 base 符号」独立复扫 → 证 **nav.js:86 是唯一** classic 顶层 eager 消费 `$/el/tt/IC`(其余 column-0:registry@12/nav initTheme@76 IIFE + profile@18/copilot-chrome@29 addEventListener **仅用 document/window**,不碰 base 工具)→ blast radius 收敛=仅此一处、icons/i18n(3-b)无同类。
- **★验(含评审要求的功能测)**:web fresh —— **点 overlay→模态关闭(overlayClickClosed:true)** + 点模态内不关(e.target≠overlay,行为保)+ 完整 INIT + 9 页 render + **0 uncaught**。node/tsc0。
- **★流程再纠偏(评审 + 我)**:①冒烟必含**受影响交互的功能验证**(不只 render 存在性 + console);②双向扫描的**工具本身**要能抓含 `=>` 回调的顶层 eager 语句(用"列顶层非声明语句手工过"而非"grep 带 `=>` 过滤")。**[阻断] 修复,请评审复验(flag→clear)。**

### 步3 中层-a(commit `921bc61`)· persistence.js → ES module · ★验证步2 payoff · 🏁 第30轮通过
jobseek 持久化/水合层 → module。8 函数 export + window 桥(逐字节;★red-line:resumes 只存 {id,jobId,template,modules}、无联系方式,保留)。**0 模块态 → dual-publish 安全**。修正扫描(第29轮方法):导出符号无 classic 顶层 eager 消费者。
- **★步2 payoff 兑现**:两处 `addEventListener('seeker-rt-ready', hydrateJobs/hydrateBizColls)` 现在 **module-load(deferred)注册** —— 因步2 dispatch 迁末位(在本 module 之后)、注册仍早于 dispatch → 水合照常。**这正是步2 拆分要解锁的能力(水合注册文件可转 module),第一次实证。**
- **验**:web(fresh · 功能测)——完整 INIT、8 桥、rt-ready re-dispatch 无错、hydrateBizColls 直调无错、9 页、0 err。**★桌面 WKWebView 真机(真实 SQLite)= 过**:重建 Seeker.app 启动 → **持久化的 Agent 对话被 hydrateMessages 渲染出来**(hydrateMessages ← hydrateBizColls ← 本 module 注册的 rt-ready 监听)→ **module 注册的 rt-ready 监听在真机 fire 并水合了真实数据**=步2 payoff 真机实证。

### ★ setState 重赋值性调查(评审最高危前提)= **mutated-property,dual-publish 安全**
grep 全仓:`setState=` **仅 index.html:986 初始声明** `let setState={...}`(无 hydrate 后整体重赋);其余全是 **`setState.X=` 属性 mutate**(`.lang=`×11、`.theme/fontsize/goal/density/motion/salary/period/autobackup/trainCounts=` 各1)。**litmus 判定:引用稳定、从不整体重赋 → `window.setState=setState` 同引用 dual-publish 安全**(消费者读 `setState.lang` 与被 mutate 的是同一对象、无分裂)、**无需封装/访问器**。⚠ setState 是 index.html 内联壳全局(非 shell/ 文件),其"转 module"是后续独立子刀;中层文件现读/mutate 它经 classic 全局(i18n module 已读 setState.lang 正常)。**结论:setState 转换时按 mutated-property 处理(异于 SEED/lastUndo 的 reassigned=封装)。**

### 步3 中层-b(commit `4041d7d`)· shell-boot.js(initShell)→ ES module · 🏁 第30轮通过
壳启动 `initShell`(拖放守卫 + 侧栏/Agent 栏宽度恢复 + 语言恢复 + `hydrateSettings` + 侧栏收展/拖拽接线 + `setLang`)→ export + window 桥。**单函数、无模块态**(litmus:非有状态 → 无封装,dual-publish 桥安全)。逐字节(diff 仅函数头 `+export`、尾 `+桥` 行、注释)。
- **载序**:shell-boot module@870 **早于** INIT-module@874;`initShell()` 唯一调点 = index.html:885(**INIT-module 内、deferred**)→ 桥就绪。依赖 `$/setLang/setState/hydrateSettings/toggleSidebar` 经全局词法/window,运行时(initShell 跑在 INIT)解析。
- **修正扫描(第29轮方法 · 列 classic column-0 非声明语句手工过)**:`initShell()` 全仓唯一调点 index.html:885(deferred module)→ **无 classic 顶层 eager 消费者**(blast radius=仅 INIT-module)。
- **验**:node/tsc0 + web fresh 功能测 —— 完整 INIT(`appMgrBtn.onclick` 挂 = INIT 跑到末行、晚于 initShell@885)、initShell 接线生效(sbCollapse/langBtn/sbResize onclick 挂上)、点侧栏收起功能生效、0 err。

### 步3 中层-c(commit `1c9186a`)· data-store.js(通用集合引擎 + persistMsg)→ ES module · 🏁 第30轮通过
10 函数(jobsPersistOn/onboarded/markOnboarded/collPersistOn/seededColl/markSeededColl/withCollId/persistColl/hydrateColl/persistMsg)classic 全局 → export + window 桥。**函数体逐字节零改动**(diff:每行 `-function X`/`+export function X` 仅前缀 export,体无变)。
- **★红线逐字保留(数据框架红线基元,加倍审)**:引擎只处理**通用集合**(`rt.db.upsert/list`),**profile 永不经此**(走独立 `rt.profile`)→ persist 永不把 profile 写通用 AI 可读集(合 D3 / profile 硬隔离);persistMsg 存 messages 已移出后端 `QUERYABLE` → AI 不可 `query_data('messages')`。红线注释原样。
- **有状态 litmus**:`__msgSeq`(persistMsg 内 `++`)= 模块内私有、**外部无消费者** → **不上桥**(既无外部读者、reassign 也仅模块内 → 无分裂)。异于 dual-publish 的 10 桥函数(纯函数,仅读 localStorage/`rt` + mutate 传入 arr)。
- **tsc 桥**:shell-globals.d.ts +`persistColl/collPersistOn/hydrateColl` ambient(@ts-check apps 消费者 assets prompts/notes 的 tsc 净;其余导出无 @ts-check 消费者不入账)。
- **修正扫描(第29轮方法 · 双向)**:data-store module@867 **早于** INIT-module@874 及全部 classic 消费者;10 符号在 classic 文件的用法**全在函数体内**(demo-seed `markOnboarded/persistColl`@seedDemoData 体、resumes/intake-action/actions 的 `persistColl`@各函数体、余为注释)→ **无 classic column-0 parse-time eager 消费者**(blast radius 收敛)。
- **★stale-console 甄别(方法论留痕)**:转换初 web 冒烟见 `onboarded is not defined`/`hydrateColl is not defined` —— 经诊断标记(`DS_RAN_AFTER_INIT:false` + `onboarded_at_INIT_start:"function"`)证 **data-store 桥在 INIT 开跑前就绪**、错误是 **force-revalidate 中间态遗留(preview console 跨 reload 累积)非真回归**;**重启 server → fresh 首载 = 0 console error**(定论)。**固化:force-revalidate + 快速改-reload 会留假错;fresh-server 首载才是 console 判据**(标记已全数清除、无残留)。
- **验**:node --check OK;tsc exit 0(0 行);web fresh-server 功能测 —— 10/10 桥就绪、完整 INIT、9 页全渲(overview 经 `onboarded`、assets 经 `hydrateColl` 水合)、overlay-close 未回归、**0 console error**。

> **本批送审(3 刀 · 步3 中层非红线/红线各一)**:persistence `921bc61`(中层-a)+ shell-boot `4041d7d`(中层-b)+ data-store `1c9186a`(中层-c)。共性:逐字节 export+桥、修正扫描无 classic 顶层 eager 消费、fresh-server 功能测净。data-store 是数据框架红线基元(profile 硬隔离 + messages 非 AI 可读)请加倍审。

### ★ 第30轮裁定(`76681ec..HEAD` · 921bc61/4041d7d/1c9186a)= **通过**
评审结论:**data-store 红线加倍审达标 + 三刀逐字节 + 综合可靠扫描干净**。逐条:
- **profile 永不经引擎**:data-store 代码只 `rt.db.upsert/list`、**零 `rt.profile`**(仅注释)→ 隐私表走独立 rt.profile(profile.js)、D3/profile 硬隔离逐字保持。✓
- **messages 非 QUERYABLE**:persistMsg 经 `rt.db.upsert('messages')` 存,但 capability.rs 本刀未改、messages 不在静态 QUERYABLE(profile/messages/settings/secrets 永不在内)→ AI 不可 `query_data('messages')`。✓
- **`__msgSeq` 有状态 litmus 正确**:`let __msgSeq=0` + `++`(重赋值绑定)→ **不上桥**(dual-publish 会分裂)、模块内私有(grep 证无 window.__msgSeq)→ 无分裂。与第27轮 litmus 一致。✓
- **★综合可靠扫描 = decisive**:三刀 20 符号(persistence 8 + initShell + data-store 10)用修正法(含箭头回调行)扫 → **无 classic 顶层 eager 消费者** → onboarded/hydrateColl "not defined" 非 nav:86 类真回归。
- **步2 payoff 时序坐实**:data-store@867 < INIT-module@874(桥先于消费者);persistence@1076 注册 rt-ready 早于 dispatch@1349(末位)→ 转 module 仍水合(第27轮 dispatch-末位裁定兑现)。
- **"假错"判断认可 + 方法论精化**:onboarded/hydrateColl "not defined" = force-revalidate 缓存中间态假错(同第12/15/19/20轮裁断一脉)。**精化(评审)**:真正判据是**可靠扫描**(真回归会被扫到如 nav:86;假错扫描空如本轮)= **主证**,fresh-server console = 佐证。
- node×3/tsc exit0。

**★ belt-and-suspenders 补冒烟(评审非阻塞建议 · exec 侧已闭环)**:评审这轮端口 8123 被**本会话 server 占用**(同第5轮情形,评审 preview 工具控不了别会话的 server)故未亲跑功能测——**但占用 8123 的正是 exec 本会话的 fresh server**,exec 补跑评审点名三项全绿:**overlay-close 未回归**(`overlayClose_ok:true`)+ **onboarded 消费**(overview 渲染 `overview_ok:true`)+ **hydrateColl 消费**(assets 导航 `assets_nav_ok:true`)+ **0 console error**(fresh 首载未 reload)。评审"码层证据已足(异于第29轮:本轮可靠扫描 + 红线 grep + 时序 + 逐字节 + **真机 WKWebView SQLite 水合金标准**)"认可,补冒烟作双保险闭环。

**步3 中层(a/b/c)🏁 全过审。** 下一步步3 剩余(nav 有状态 `current`/registry/keys/copilot-chrome 有状态 `appMode`·`appReady` + PROFILE 消费链 → **profile.js 收尾:PROFILE import-first 不上 window 桥 + 双红线双审**)。

### 步3 中层-d(commit `5d31b42`)· nav.js → ES module(★首个有状态符号封装刀)· 🏁 第31轮通过
壳导航装配 11 函数 classic 全局 → export + 过渡 window 桥,函数体逐字节零改动(sed 仅 `^function `→`export function `,机械、不触体)。**本刀是步3 首个「有状态符号」转换(评审最高危类别),按第27轮 litmus 处理 `current`。**
- **★`current` litmus = 重赋值 + 外部消费者 → 封装访问器、不 dual-publish**:
  - `let current='overview'`,**唯一写者 = nav.js**(声明 + go:`current=id` 整体重赋值;全仓 grep `current=` 仅此二处)。
  - **8 个外部消费者**读它:index.html×3(contextNew `m[current]` / Mod+F `pageSearchInput(current)` / shellReassemble `p.id===current`+`go(current)`)、profile.js:15、settings.js:408、persistence.js:63、prompts.js:69、notes.js:59。
  - litmus 判定:**重赋值 + 有外部消费者 → 若 `window.current=current` dual-publish,go 重赋值后 window 快照分裂**(消费者读到过时值)→ **封装 `export function currentPage(){return current}` 访问器(每调返回最新)、current 不上桥**;**同刀原子翻转** 8 消费者裸 `current`→`currentPage()`。样板同 `lastUndo`→`runLastUndo()`(index.html:1225 先例)。
- **★无快照分裂 = 功能测实证**(评审"有状态原子翻转红线"的关键验证):fresh-server —— `window.current` **undefined**(不 dual-publish 红线)+ `window.currentPage` 访问器桥;**`go(x)`→`currentPage()` 立即=x**(jobs/skills/settings/overview 四页逐验 `x→x`、`split_ok:true`)→ 外部消费者读对、无分裂。
- **修正扫描(第29轮法 · 双向)**:nav 11 导出函数消费者全运行时(INIT-module@874 deferred 调 buildNav/buildPages/wireOverlay/go、shell-boot@870 调 setLang、apps render 调 syncNavCounts、nav 内部互调)→ **无 classic 顶层 parse-time eager 消费者**;`current` 消费者全运行时(contextNew/Mod+F 回调、shellReassemble 体、rt-ready 水合)→ 桥就绪。nav.js module top-level eval 仅 initTheme IIFE(document/localStorage)+ 桥赋值,不依赖他桥。
- **tsc 桥**:shell-globals.d.ts +`currentPage`(★访问器)+`frontis`/`signFoot`(nav 转 module 后不再是 ambient 全局,assets @ts-check prompts/notes 消费 → 需 decl;初次 tsc 暴露、已补)。
- **验**:node --check×6 OK;tsc exit 0;fresh-server 功能测——完整 INIT(appMgrBtn 接线)+ 9 页全渲 + currentPage 跟踪每页 + contextNew/shellReassemble/assets 消费路径解析 + overlay-close 未回归 + 12/12 桥 + **0 console error**(fresh 首载)。**★评审可复验点**:`window.current===undefined` + `go('settings');currentPage()==='settings'`。

### ★ 第31轮裁定 = 通过 + 访问器模板**适用范围**厘清(评审纠正 · 影响后续 4-5 符号)
评审确认 current litmus + 原子翻转正确(写者唯一 nav.js:go、外部 8 消费者全翻 currentPage() 零残留裸 current、current 不上桥→`window.current===undefined`、访问器 live 读无分裂);逐字节(函数体 diff 空)+ 双向扫描空(12 符号无 classic 顶层消费者)+ node×6/tsc0。**= lastUndo→runLastUndo 同款 reassigned 类正确样板。**
- **★我领受表述纠正**:送审说"setState/JOBS/MODEL/PROFILE 都复用访问器模板"**不精确** —— 访问器**只适用 reassigned 绑定**,那 5 个是 mutated-property、应 dual-publish、**不该套访问器**。真正可复用的是 **litmus 本身**(判 binding 是否 `X=…` 整体重赋),current 只立了 **reassigned 分支**样板。

| 类别 | 判据 | 处理 | 符号 |
|---|---|---|---|
| **reassigned** | binding 出现 `X=…` 整体重赋(快照会过时) | module-private + 访问器 `getX(){return X}`、**不上 X 桥** | current✓/lastUndo✓/SEED/**appMode·appReady**(copilot-chrome) |
| **mutated-property** | 只 `X.k=`/`X.push`,引用稳定从不整体重赋 | **`window.X=X` dual-publish 同引用即安全、免访问器**(套访问器=无谓 indirection、`getJobs(){return JOBS}` 返同一引用白加一层) | setState/JOBS/ACTIONS/MODEL/PROFILE |
| **PROFILE 额外** | mutated(dual-publish 本安全)但隐私红线 | **import-first、不给 window 桥**(最小暴露,第27/30轮已裁) | PROFILE |

**一句话**:reassigned→访问器;mutated-property→dual-publish 同引用(免访问器);PROFILE→import 不上桥。别把 current 的访问器无差别套到 setState/JOBS/MODEL/PROFILE。
- **belt-and-suspenders**:评审 preview 工具锁死 8123(本会话 66cf9a30 server 占)、旁路端口撞工具转发层绕不过 —— 但本轮命门是**纯结构问题**(原子翻转完整 + 访问器正确,grep+读定义即决定,异于第29轮运行时时序需功能测),3 可复验点由代码结构**保证**;且 exec 已在 66cf9a30 fresh server 亲跑功能测(window.current undefined + go(x)→currentPage()===x 四页 + 9 页全渲 + 0 err)= 闭环。

### ★ 步3 剩余批调整裁定(registry 锁死 · exec 与用户对齐)
原计划 registry+keys+copilot-chrome 一批。**调查发现三者差异大**,用户裁定「只做 copilot-chrome」:
- **registry.js = 结构性锁死**:`SeekerShell` 有整条 **classic parse-time 注册流**先于它消费——`manifest.js`×2 的 `register()`(index.html:1246/1249 classic `<script src>`)+ inline boot 的 `setShell()`/`PAGES.push(pages())`/`GROUPS assign`(1253-1262 classic 顶层)。registry 转 deferred module → 这些 parse-time 语句先跑、`SeekerShell` 未定义 → 全抛(nav:86 类)。registry.js 注释 line4-5 本就说明它 classic 是**故意的**。转它 = 大协调刀(registry+2manifest+2assets页+inline boot 全 module 化,且 manifest 依赖 index.html 业务单体)→ **推迟到注册单体 module 化/INIT 收口批**。
- **keys.js**:消费者仅 `initKeys()`@886(INIT-module 运行时)+ `keysHelpHTML()` 体 → 技术可转,但已 @ts-check 干净 IIFE、现在转只是薄 tag-flip(真 export/import 同样卡在 classic inline 消费者)→ 与 registry 同批推迟。
- **copilot-chrome.js**:@ts-nocheck + 有状态 = 唯一真正受益的刀 → 本轮做。

### 步3 中层-e(commit `28f7db0`)· copilot-chrome.js → ES module(★第二个有状态刀 · getter+setter 双子)· 🏁 第32轮通过
Copilot/Agent 面板机制 **30 函数 + 6 卡模板 const**(cEsc/cCard/cAct/cBtn/cAB/cSuggs)classic 全局 → export + 过渡 window 桥,函数体逐字节零改动(sed `^function `→`export function `+`^const c`→`export const c`;async hydrateMessages 手补;diff 无函数体行)。
- **★两个有状态符号方向相反,验证第31轮分支 litmus 覆盖两向**:
  - **`appMode`**(`let appMode='editor'`,内部写 `setAppMode`@93 唯一写者、外部读 index keys 1214/1215/1240)= **reassigned + 外部读者** → `getAppMode()` **getter**(同 current);同刀翻转 3 外部读者 `appMode==='agent'`→`getAppMode()==='agent'`;不上 appMode 桥。
  - **`appReady`**(`let appReady=false`,**外部写** index INIT:889 `appReady=true`、内部读 `agentShowCanvas`@100)= **reassigned + 外部写者(新子模式)** → `setAppReady(v)` **setter**;翻转 index:889 → `setAppReady(true)`;不上 appReady 桥。→ **getter/setter 按数据流向定,方向相反各一半**。
  - `cmdActive`/`cmdFiltered`(内部私有)、`CACT_ALLOWED`(§4-4 委派白名单,内部私有)→ 不上桥(grep 证外部零消费)。
- **§4-4 红线随迁保留**:cEsc/cAB 委派机制逐字节(delegation listener @module-eval 挂上、CACT_ALLOWED 白名单不变、cEsc 转义不变);6 卡模板 const 是 apps copReply 消费的导出、随迁桥。
- **双向扫描空**:copInit@883/agentInit@884/setAppReady@889 全在 INIT-module(deferred),无 classic 顶层 parse-time 调用者(与 registry 相反=copilot-chrome 可转的关键)。
- **★浏览器缓存踩坑(重要方法论留痕)**:初次冒烟**全桥 undefined + INIT 断在 copInit**,但 dynamic-import 探针证 module 有效(38 exports)、node/tsc 净 → 根因 = **浏览器缓存旧 classic copilot-chrome 当 module 跑**(classic 版无 export/桥、函数 module-scoped → window 桥空 → INIT copInit 抛 → 级联);**fresh-server 重启不清浏览器缓存**(仅清 server + console buffer)、**force-revalidate(fetch cache:'reload' 全 script)才清** → 清后全绿。stale console(cEsc/current "not defined")亦同源。**固化:桥 undefined 先排缓存(dynamic-import 探针 + force-revalidate),再疑代码**。
- **验(fresh-server + force-revalidate 后 · 0 console error)**:完整 INIT(appMgrBtn 接线)+ **window.appMode/appReady/cmdActive undefined**(红线不 dual-publish)+ getAppMode/setAppReady 桥;**appMode 无快照分裂**(setAppMode(x)→getAppMode()===x)、**appReady setter 生效**(agent 模式 agentShowCanvas 置 split=读内部 appReady=true)、Copilot 面板开关、命令面板 13 cmds、cEsc 转义、cAB 委派模板、9 页全渲(render 经 window.cEsc 桥无抛)、current 前刀未回归。node --check OK、tsc exit 0。
- **★评审可复验点**:`typeof window.appMode==='undefined'` + `setAppMode('agent');getAppMode()==='agent'` + `setAppMode('editor');getAppMode()==='editor'`。**⚠复验前先 force-revalidate**(fetch 全 script cache:'reload' + reload),否则浏览器缓存旧 classic 版会假失败。

### ★ 第32轮裁定 = 通过 + 访问器模板**两向深化**(getter/setter 按数据流向)
评审确认:§4-4 红线逐字节、appMode/appReady getter/setter 正确、原子翻转完整、可靠扫描证"INIT 断 copInit"为缓存假错、registry 推迟合理。
- **§4-4 红线加倍审逐字节达标**(copilot-chrome 是 §4-4 转义/委派/白名单的家):cEsc(escaping `&<>"`)/cAB(`data-cargs="${cEsc(JSON.stringify)}"`+委派)/cBtn/cSuggs 仅加 export、**体逐字节**(与第24/25轮 P1/P2 一致);**CACT_ALLOWED 保持 private const 不上桥**、委派门 `if(CACT_ALLOWED.has(name))window[name](...)` 逐字节 → **放大器防护未松动**;P1 消 onclick + P2 白名单 + cEsc 三层逐字保留。
- **★访问器模板两向深化(第31轮延伸)**:reassigned 绑定**按数据流向分两向**——**外部读→getter**(appMode:`getAppMode()` live 读)、**外部写→setter**(appReady:`setAppReady()` 单一写入口),**都避免 dual-publish 裸绑定**(会分裂)。exec"按数据流向定、不无脑套访问器"判断正确。**这是剩余 reassigned 符号(SEED 等)的完整模板**(第31轮立单向、本轮补两向)。
- **"INIT 断 copInit" = 缓存假错**:可靠扫描(第29/30轮法)证 copilot-chrome 全符号无 classic 顶层 eager 消费者(copInit 由 INIT-module deferred 调、fresh 加载新版有桥则正常)→ 非真回归、同第12/15/19/20/30轮缓存缺口。方法论认可(桥 undefined 先排缓存);**精化重申:可靠扫描是主证(真回归会被扫到、缓存假错扫空)、dynamic-import 探针+node/tsc 是佐证**。
- **registry 锁死→推迟合理**:核实 index.html:1253 setShell()+:1261 PAGES.push(...pages()) 是 classic parse-time 消费 SeekerShell → registry 转 deferred 会抛(nav:86 类);须与注册单体(manifest.register/setShell/PAGES.push)一起 module 化=大协调刀,推迟正确(风险自轻到重)。
- **preview 连续第三轮用不了**(8123 被本会话 0217de5b server 锁),结构性判据决定性(原子翻转完整 grep+§4-4 逐字节+可靠扫描空+node/tsc,均 grep/读定义即决);**exec 已在 0217de5b force-revalidate 后补跑 belt-and-suspenders 全绿**(window.appMode/appReady undefined + no-split + appReady setter 置 split + cEsc 转义 + 13 cmds + INIT done)= 闭环。

**步3 中层-e 通过。** 下一步 **profile.js(★★双红线:profile 硬隔离 + 设置不可经对话改;PROFILE import-first 不上 window 桥)收尾中层**,然后 registry+keys 注册单体 module 化批。

---

## 3.y · classic 单体 module 化(子阶段)· 依赖调查 + 批 A 落地

**四路只读调查(4 agent 并行)结论**:抽壳 arc 已把绝大多数符号搬走,**index.html inline classic 只剩 4 个状态符号**(PAGES/GROUPS/setState/WEIGHTS,**全 mutated-property → dual-publish 安全免访问器**)+ 函数块。剩余阻塞收敛成**两条链**:
- **链① 注册链(解锁 registry+keys)= 自足**:唯一硬阻塞 = registry 的 **5 个 parse-time 消费**(setShell@1253/PAGES.push@1261/GROUPS@1262 + jobseek/assets manifest 的 register IIFE)。不牵扯业务层(manifest 引用的业务全局几乎全 lazy、runtime 经全局词法解析;唯一 eager 的 SEEKER_CARDS 也 module-eval 读全局词法)。
- **链② PROFILE 链(解锁 profile)= 贵**:profile→module 要 PROFILE export-不上-window → settings/resumes 须 import PROFILE → 拖上 data/intake-action/interview(resumes parse-time 读 JOBS[0].id + ivRec reassigned 跨文件写 interview)= 5-6 刀。**用户裁定:只做链①(批 A),链② 单独择期**。

### 批 A(commit `c02dec5`)· 注册链 module 化 + INIT 重排 · 🏁 第33轮通过
**性质=原子协调刀**(parse-time 注册链不能拆:registry→module ⟹ manifest→module ⟹ SHELL BOOT→module ⟹ INIT 重排,一动全动)。**仅改 index.html**;registry/keys/manifest.js 的 IIFE 内容**零改**(IIFE 自挂 window.SeekerShell/SeekerKeys,转 module 只改执行时机 parse-time→deferred)。
- **改动**:keys@856 / registry@858 / jobseek-manifest@1246 / assets-manifest@1249 → `type=module`;SHELL BOOT@1250 → `type=module`(setShell/PAGES.push/GROUPS 改 deferred 执行)+ **3 函数上桥**(shellReassemble/shellPushAiReadable/openAppManager 供 INIT 消费;shellReconcilePages/clearAppData/renderAppMgr 仅本 module 内部、grep 证零外部消费 → 不上桥);**INIT 执行序从 head@原873 迁至 SHELL BOOT module 之后**。
- **★新载序(全 deferred,文档 tag 序)**:registry@858 → base 工具 modules → rt-bridge(head)→〔业务 classic parse-time 更早,定义 PAGES/render*/SEEKER_CARDS〕→ manifest×2 → SHELL BOOT → INIT → dispatch(末位)。**时序不变式 by construction**:注册(registry 定义 + manifest register)先于 setShell/PAGES.push 先于 INIT buildNav(读填好的 PAGES)先于 dispatch('seeker-rt-ready')水合。
- **★parse-time 重排=第29轮[阻断]同类风险,故重功能测**(fresh-server + force-revalidate、0 console error):**SeekerShell 定义 + 2 应用注册**(manifest module register 成功)+ **11 nav 项**(PAGES 填好=SHELL BOOT 先于 INIT buildNav 跑了,注册链未断)+ 完整 INIT(appMgrBtn 接线)+ 9 页全渲 + **App Manager 开+列 2 应用**(openAppManager 桥)+ **真 toggle**(关 assets→9 项→开→11 项复原,shellReassemble 桥)+ **D3 aiReadableCollections 正常**(启用∩授权,assets default-off 不入)。node --check×4 OK、tsc exit 0。
- **★评审可复验点**(⚠先 force-revalidate 清浏览器缓存):`window.SeekerShell.list().length===2` + `document.querySelectorAll('#nav .nav-item').length===11` + `typeof document.querySelector('#appMgrBtn').onclick==='function'`。
- **归属说明**:批 A 解锁 registry/keys 的 module 化(parse-time 阻塞解除);IIFE→export/import 的纯净化归后续账本清空(与所有过渡 window 桥一起摘)。**profile(链②)仍卡、单独择期**。

### ★ 第33轮裁定 = 通过(结构性判据决定性)+ ★硬流程账:独立功能测缺口
评审确认:**parse-time 重排的正确结构检查**——找 classic 文件顶层/parse-time 消费 deferred 符号(SeekerShell/SeekerKeys)的点,**可靠扫描空**(register/setShell/PAGES.push/K.register/buildNav 全在 deferred module 或函数体 runtime;`SeekerShell.collections()` 消费全在 clearAllCollections/clearAllDataFlow 函数体)→ 时序不变式成立;IIFE 零改(commit 仅 index.html)、node×4/tsc0。**用修正可靠方法、覆盖 classic .js + index.html 双面**(异于第29轮扫描不可靠)。**批调整认可**:注册链 parse-time 必须一起 module 化=原子协调 commit(不能一基元一 commit)是唯一正确。
- **★硬流程账(连续第4轮 · 必须闭合)**:评审 preview 端口 8123 被**本会话 server 锁**(第4轮)、claude-in-chrome 无连接浏览器、桌面是 Tauri 非 web preview → **评审跑不了任何独立功能测**,只能采信 exec 的 fresh-server force-revalidate 留痕。**本轮判通过**因结构性判据对 parse-time 重排决定性(可靠扫描空 + 注册全 deferred + IIFE 零改,均 grep/读定义即决)+ exec 留痕(2 应用注册/11 nav/App Manager/toggle/D3/0 err)。**但 parse-time 重排 + 大 blast radius 正是第29轮[阻断]类别,理想须独立功能测兜底**。**★下一个更大的原子刀(profile 链②/账本清空)前必须闭合此缺口**:① 空出 8123 / 连浏览器给评审亲跑,**或** ② exec 在该 build 上跑**真机 WKWebView 冒烟**(桌面 asset:// 免 web 缓存坑,同 R1 金标准)作独立确认。
- **★exec 应对**:①已**停本会话 preview server 释放 8123**(根治"占端口挡评审"根因,评审下轮可独立跑 web);②下一刀前主动跑真机 WKWebView 冒烟 或 让评审亲跑,**不再只靠自测+扫描**。

**批 A 通过。** 下一步:profile(链②,双红线双审)或账本清空——**任一大刀前先闭合独立功能测**(停 server 已释放 8123 = 第一步)。

### ★ 批 A 真机 WKWebView 冒烟(独立功能测缺口闭合 · 金标准)
应第33轮硬流程账,exec 跑**真机桌面冒烟**(桌面 asset:// 嵌入前端、**免 web 缓存坑**,同 R1 金标准):
- **构建证含批 A**:`cargo run` **重编译 7.59s**(非缓存)、binary mtime(08:26)> index.html(07:39)→ 嵌入的是批 A 前端;`Finished dev` + 仅一条 `IMKCFRunLoopWakeUpReliable`(macOS IME 无害警告)、无 panic。
- **★注册链真机证**:WKWebView 渲染完整壳 —— **assets 应用在 nav**(Prompt 库/笔记)= assets manifest **module** register 成功;**「数据设置」是壳自持页(SHELL BOOT `setShell` 注册)在 nav** = SHELL BOOT **module 的 deferred `setShell` 跑了**;nav 渲染 = INIT **module** `buildNav` 跑了 → **注册链 registry→manifest→SHELL BOOT→INIT 在真机按序执行**(任一断则壳空/无 assets)。
- **★交互真机证**:点「数据设置」→ 导航 + `renderSettings` **全渲**(5 tab 基本/个人/模型/数据/关于 + 外观控件主题·字号·语言·密度·动效)= INIT 接线 nav 点击(`buildNav` `b.onclick=go`)+ `go` + 设置框架 functional;Copilot launcher「问问 AI·⌘K」+ 模式切换 + 主题/语言/v0.1.0 皆在 = copInit/agentInit/initShell 跑了。
- **jobseek 不在 nav + overview 空 = 桌面持久禁用态**(非批 A 回归):nav=`enabledApps().flatMap(pages)`,jobseek 缺失 ⟺ jobseek 在桌面 localStorage `seeker-apps` 被禁用(assets 走同一 register/enabledApps 路径却正常渲染 → 链路没断,只是 jobseek 被关);恰证 D2「关应用=UI 下架、数据保留」。App Manager ⊞ 未从该图标开(⊞ 疑非 `#appMgrBtn`;openAppManager/shellReassemble 桥 web 冒烟已证)——不影响 boot 确认。
- **★结论**:批 A 的 parse-time 注册链重排在**真机 WKWebView(asset:// 免缓存)decisively 跑通** = 评审要的金标准独立确认,**连续 4 轮功能测缺口就此闭合**。web 冒烟(App Manager/toggle/shellReassemble/openAppManager/D3)+ 真机(boot 链/渲染/导航/设置框架)双证。

## 3.y · 账本清空 · 调查 + 僵尸桥清扫(commit `0d6f45e`)
**盘点**:过渡 window 桥 **82 个**、shell-globals.d.ts **15** 条、monolith-globals.d.ts **27** 条,服务 **19 个仍 classic 的业务文件**(data/intake-action/interview/resumes/settings-jobseek/cards/copilot-actions/demo-seed/frame-query/match/… + assets prompts/notes)。
- **★账本清空大头卡 classic 业务层**:桥是给 classic 消费者的过渡兼容,消费者没 module 化就摘不了桥 → **完整账本清空 = 业务层 module 化(profile 链②)之后的收尾,不能独立完成**(与 profile 同源阻塞)。
- **独立可做部分 = 僵尸桥清扫(已做)**:抽壳叶子刀期防御性过度上桥,**12 个桥全仓 0 外部消费者**(内部函数仍经模块作用域工作)→ 安全删:copilot-chrome 7(copOpen/copAppend/agentAppend/agentScroll/cmdOpen/cmdRender/cmdRun)+ modal(focusableIn)+ persistence(hydrateResumes)+ data-store(seededColl/markSeededColl/withCollId)。桥 82→70。
- **★踩坑诚实披露**:初判 shell-globals `$`/`$$` 为僵尸(grep `\b$\b` 被正则 `$`=行尾锚骗、误报 0 消费)→ 删其 ambient → **tsc 抓出** assets prompts/notes 实际用 $/$$(TS2592/2304)→ **已复原**。教训:含正则特殊字符的符号(`$`)不能用 grep 词边界验消费,tsc/node 是兜底。
- **验**:node×4/tsc exit0、fresh-server 冒烟——INIT done + 7/7 僵尸摘 window + Copilot 面板(copToggle/copSend 内部 copOpen/copAppend 仍工作)+ agentSend + 9 页 + 0 console error。
- **★3.y 收尾再定位**:profile 链② + 账本清空大头 = **同一件事**(classic 业务层 module 化:data/intake-action/interview/resumes/settings/cards/…+assets+index.html inline);做完则 profile 解锁 + 账本自然清空。僵尸清扫是这之前唯一能独立做的账本项。

## 3.y · 业务层 module 化(大块 · 逐刀)· 方案 `docs/proposal-business-layer-modularization.md`
**7 路只读 agent 调查凑齐依赖图**。10 批顺序(叶子先/provider 后/红线后):1 页面层 → 2 数据叶子 → 3 intake-action → 4 逻辑叶子 → 5★interview+resumes 协调 → 6★data+match 协调(核心时序刀)→ 7 settings+assets(删 shell-globals.d.ts)→ 8★profile 收尾(双红线)→ 9 index.html inline → 10 账本清空。**有状态几乎全 mutated(dual-publish 免访问器);仅 SEED(私有)+ ivRec(移 resumes)reassigned。硬时序坑=match/interview/resumes:4 parse-time 读 JOBS[0]→data.js 同批。红线=profile/frame-query/copilot-actions/intake-action。**

### 批1(commit `ee77d44`)· 页面层 overview/jobs/skills/actions/analysis → ES module · 🏁 第34轮通过
5 页 classic → module:各 `export function renderX` + 尾部过渡 window 桥(唯一外部消费=render*,manifest 箭头 `render:()=>renderX()` + 运行时 cards/persistence/其他页/index.html 按全局名调)。**函数体逐字节零改**(sed 仅加 export 前缀)。
- **状态符号 module-private 不上桥**:jobFilter/skillFilter(mutated)、actTab(reassigned)、selectedJob(死写)全**文件本地**(调查证零跨文件消费)→ 转 module 直接私有、无需桥/访问器。
- **内部辅助不上桥**:openJobDetail/jobTimelineRows/capCard/trainingFor/openSkillDetail/sessMins/recalcProgress/toggleAction/openActionDetail —— JS 接线(非内联 onclick)、仅文件内消费 → module-private。内联 onclick 目标(go/openResumeModal/openMarketValue)是**他文件**符号、桥仍在,不受影响。
- **无 parse-time 坑**:5 页顶层仅状态字面量初始化 + 函数声明,零外部符号 parse-time 读。载序:页 module@960-964 早于 INIT-module(批A后@~1325)→ buildPages 调 manifest 箭头时 window.renderX 桥就绪。
- **验**:node×5/tsc exit0;fresh-server+force-revalidate 冒烟——INIT done + **5/5 render 桥** + **9 页全渲** + jobs 页互调 renderActions/renderOverview(经桥)+ skills 页渲染 + **0 console error**。

### 批2(commit `89e5107`)· 数据叶子 data-helpers/intake-job/cards → ES module · 🏁 第34轮通过
3 文件 export 外部消费符号 + 桥,函数体逐字节零改。每符号外部消费者数 grep 核实(jobLabel 3 命中=同名形参 copPlan/genPlanFromGap、非真调用 → 私有)。
- **data-helpers**:skillByName(const)/distBy/distinctNeedSkills/keywordsReal/pipelineReal/topGapsReal 桥;fmtScore/jobsByStatus/SOFT_WORDS 私有。
- **intake-job**:aiMetaHtml/openNewJob 桥(★openNewJob §4-4 JD/URL 摄入转义在函数体逐字保留);extractJdSkills/frameJobExtract/TECH_VOCAB 私有。
- **cards**:SEEKER_CARDS(const)/nextStep/calmDigest 桥;show/render 卡函数私有。**★SEEKER_CARDS 被 manifest.js:61 module-eval 急读** → cards@1059 早于 manifest@1226 eval(doc 序)→ 桥就绪;★简历红线(跳过 basic/locked)+ 外链经 rt.web 不进 DOM 在函数体逐字保留。
- **★踩坑**:cards 桥注释含 `show*` `render*` 的 `*/` 提前闭合块注释 → **node --check 抓出**、已修。
- **验**:node×3/tsc0;冒烟——**SeekerShell.cards()=11 卡(SEEKER_CARDS eval 序证)** + 11/11 桥 + 私有不上桥 + 9 页 + analysis(distBy)/overview(nextStep)渲染 + 0 err。

### 批3(commit `51a1139`)· intake-action.js → ES module(★红线简历层)· 🏁 第34轮通过
大文件 28 符号 export + 桥,函数体逐字节零改。**状态 IV_BANK/IV_RECORDS/MASTER/RESUME_TAILORED 皆 mutated-property**(grep 证无整体重赋、hydration in-place)→ dual-publish 免访问器;7 const 桥;私有 IV_STYLE/PLAN_LIB/aiGenQuestions/master*HTML。
- **★红线逐字保留(在函数体)**:MASTER/RESUME_TAILORED = AI 可读专业简历层、**绝不含联系方式**(姓名/电话/邮箱在 PROFILE 隐私层);persistMaster 只写 resumes 哨兵 `r__master__`、**永不写 profile** → 隔离不变。
- **★踩坑**:`sed -i '' 循环+变量` 在本文件 export 未生效(dry-run 匹配、in-place 不改,原因未明)→ **改 perl -i 一遍过**、export=28 落定(教训:大批量 export 用 perl 更稳)。
- **验**:node/tsc0;冒烟——15/15 桥 + 私有不上桥 + **MASTER/RESUME_TAILORED dual-publish 同引用对象** + 9 页 + match/resumes/interview(经桥消费 intake-action)渲染 + 0 err。

### 批4(commit `f51ef66`)· 逻辑叶子 frame-query/copilot-actions/demo-seed/settings-jobseek → ES module(★2 红线)· 🏁 第34轮通过
4 文件 perl 一遍过 export + 桥,函数体逐字节零改。
- **frame-query**:frameQuery 桥。**★红线**:框定 prompt 的联系方式隔离措辞在函数体逐字保留(profile/contact framing)。
- **copilot-actions**:12 fn + AGENT_CMDS 桥。**★CACT_ALLOWED 6**(copMatch/copDoneAct/copInterview/copPlan/copResume/agentDeleteJob)**硬上 window**(cAB dispatcher `window[name]`);**copNewJob/copNewAction 内联 onclick 目标**(cBtn 串按 window 解析)→ 补桥(count 因 onclick 在本文件而漏);findJob/findSkill/findAction 私有。**★红线**:§4-4 转义 cEsc/jesc(job.co 等 JD 外部内容)+ 设置不可经对话改 在函数体逐字保留。
- **demo-seed**:captureSeed/syncDemoBanner/setDemoMode/seedDemoData 桥。**★SEED(let reassigned)+ demoMode(函数)= 文件私有、不上桥不访问器**(SEED/demoMode 外部命中经核实=data-store 注释非代码)。
- **settings-jobseek**:6 段函数桥(manifest.settings 契约)。**★红线**:wireMasterSection 编辑 MASTER 走 persistMaster、绝不写 profile。
- **验**:node×4/tsc0;冒烟——INIT done(initApps→captureSeed via manifest.init)+ 19/19 桥 + 私有不上桥 + **契约全通**(SeekerShell.frameQuery/appReply/appSuggs/appCommands=13/appSettings 经 manifest 箭头解析 module 函数)+ **CACT_ALLOWED 6 dispatch 目标皆函数** + 设置页渲染 + 9 页 + 0 err。

> **本组送审(批1-4 · 低风险机械叶子刀)**:`ee77d44`(页面)+ `89e5107`(数据叶子)+ `51a1139`(intake-action 红线简历层)+ `f51ef66`(逻辑叶子 · frame-query/copilot-actions 红线)。共性:export + 过渡 window 桥、函数体逐字节零改(sed/perl 仅加 export 前缀)、每符号外部消费者 grep 核实、node/tsc/fresh 冒烟净。**红线文件 intake-action/frame-query/copilot-actions 请加倍审**(隔离/转义在函数体、逐字保留)。剩批5(interview+resumes 协调)/批6(data+match 核心时序)/批8(profile 双红线)= 高风险协调/红线刀,后续单送 + 真机金标准。

### ★ 第34轮裁定 = 通过(结构性 + 首次亲跑 preview 功能测 双清)
评审 **8123 释放后首次亲跑 preview 功能测(连续 4 轮来首次)**,LIVE 验证结构扫描推不出的东西:
- **3 红线加倍审 = 逐字保留 + LIVE 证**:intake-action **全文件零 rt.profile**、persistMaster 只写 resumes 哨兵、**preview LIVE MASTER 无 phone/email/contact 字段**;copilot-actions cEsc/jesc + cAB 委派逐字节、**preview LIVE cAB 白名单派发 copPlan 挡 eval**(P2 gadget 防护转 module 后仍生效);frame-query 框定隔离措辞逐字。
- **结构核实**:CACT_ALLOWED 6 + copNewJob/copNewAction 全上 window(委派/onclick 需要)、CACT_ALLOWED 本身仍 private const;**SEEKER_CARDS 急读载序**(cards@1059 桥 < manifest@1226 → preview LIVE cards()=11 种);SEED/demoMode 私有(grep+preview 双证 undefined);可靠扫描空(剩余 classic data/match/interview/resumes 顶层无消费 module 业务符号);node×9/tsc 净。
- **preview 功能测(force-revalidate · 0 err)**:契约全通(2 应用/cards 11/frameQuery→string/appCommands 13/appSettings 1)+ 9 页全渲 + nav 11 + App Manager + currentPage() 访问器 + cAB 白名单 LIVE + 私有不上桥 + overlay-close 未回归 = 干净启动确证。
- **踩坑均正确**:①cards 注释 `*/` 提前闭合 → node --check 抓出已修;②sed 循环未生效 → perl 一遍过。**诚实披露 + node --check 兜底 = 好纪律。**
- **★权威再印证(第29轮教训)**:parse-time/契约/安全类改动,**功能测是结构判据的必要补充**——本轮 LIVE 验的 cAB 挡 eval / SEEKER_CARDS 急读满足 / 9 页真渲,结构扫描推不出。
- **★流程闭环**:评审谢 exec 释放 8123(连续 4 轮诉求)→ 高风险批 5/6/8 **exec 亲跑 preview + 真机金标准 + 评审也亲跑 preview(端口保持可用)叠加**。

**批1-4 🏁 通过。** 下一步批5(interview+resumes 协调刀:ivRec 移 resumes + 循环 import + parse-time)。

### 批5(commit `c794ea2`)· interview+resumes 协调刀 → ES module(★高风险)· 🏁 第35轮通过
**第一个高风险协调批**:2 文件同批转 module(循环耦合 + ivRec 跨文件所有权移动 + parse-time JOBS[0])。函数体逐字节零改。
- **★ivRec 所有权 interview.js:5 → resumes.js**:核实其生命周期全在 resumes(ivToggleVoice/ivStopVoice/ivVoiceDemo 的 `ivRec=new SR()`/`=null`/`='demo'`、9 处读写全在 resumes),**interview.js 从不引用**(仅第5行声明)→ 移后 resumes 内**私有**(reassigned 但文件本地、不上桥不访问器)、**消除跨文件 reassigned 纠缠**(否则需 setter 原子翻转)。这是"reassigned+跨文件"的最优解=归位为文件私有。
- **interview.js**:export ivState(mutated dual-publish,含 resumes 跨文件 `.k=` mutate 同引用安全)+ renderInterview 桥;ivResumeRef 私有。
- **resumes.js**:export resumeState(mutated dual-publish,含 interview 内联 onclick `resumeState.jobId=X` 跨文件写)+ renderResumes/resumeGenerate + **10 iv***(ivBankHTML/ivRecordsHTML/ivStopVoice/ivStartRound/ivGenerate/ivAddQuestion/ivBindBank/ivBindRecords/ivPractice/ivRenderSummary,供 interview.renderInterview 循环消费)桥;ivRec + ~27 resume 编辑/导出内部函数私有。
- **★循环耦合**:interview.renderInterview 调 resumes 的 10 iv*、resumes 调 renderInterview + 读写 ivState —— 全运行时经桥、安全(无 parse-time 循环)。
- **★parse-time JOBS[0]@interview:4/resumes:4**:data.js 仍 classic → JOBS 全局词法就绪、module-eval 读安全(批6 data.js 转时改 `import {JOBS}`)。
- **★红线逐字保留(函数体)**:resumes 只存专业模块结构、**联系方式绝不入 resumes 集合**(走独立 PROFILE 实时渲染)→ query_data('resumes') 天然无联系方式;PROFILE 现经**全局词法读 classic profile.js**(批8 profile 转 module 时 resumes 改 `import {PROFILE}`)。
- **★踩坑(方法论)**:初次冒烟 console 报 `renderInterview/renderResumes not defined @buildPages` → 判**浏览器缓存旧 classic 版当 module 跑(无 window 桥)**;**重启 server + force-revalidate 后 fresh clean 载 = 0 console error**(同 copilot-chrome;第29轮"功能测须 clean 载、桥 undefined 先排缓存"教训)。
- **验(fresh clean 载 · 0 console error)**:INIT done + **15/15 桥** + ivRec/ivToggleVoice/内部函数私有不上桥 + **★INIT buildPages 直接渲 interview/resumes(非 rerenderPages 兜底,clean 载页有内容)** + 循环耦合切页(interview 含 INTERVIEW/resumes 渲染)+ **resumeState dual-publish 跨文件 mutate 同引用可见** + **ivStopVoice(用移入的 ivRec)OK 不抛** + 9 页全渲。node×2/tsc0。
- **★真机金标准**:jobseek 业务批的真机验受限(桌面 localStorage jobseek 持久禁用 → interview/resumes 页不在桌面 nav;**preview fresh〔jobseek 启用〕反而是更佳业务测环境**);故 jobseek 业务批(5)靠 clean preview,批6(data+match、影响 boot+全页)做真机金标准。**8123 已释放,评审可亲跑 preview。**

### ★ 第35轮裁定 = 通过(结构性 + 亲跑 preview 功能测 双清)+ ★litmus 精化
评审确认 + preview LIVE 双证。**★权威 litmus 精化(第31/32轮延伸,standing)**:
> **reassigned + 跨文件消费**:先看能否**归位到唯一消费文件**(→ 变文件私有 reassigned、零机制,同 SEED 先例);**真·多文件消费**才 getter/setter 访问器。ivRec/SEED = 归位样板,优于给跨文件 reassigned 套 setter。
- **ivRec 归位裁定认可**:interview.js 零 ivRec 代码引用(仅注释)= 声明放错文件 → 归位 resumes(唯一消费文件)变私有;preview LIVE `window.ivRec===undefined` + ivStopVoice(用移入 ivRec)不抛。
- **循环耦合 = 安全(runtime-only)**:interview↔resumes 双向调用全在函数体经桥、**两文件 top-level 互不 eager 引用 → 无 module-eval 循环依赖**;preview LIVE 双向渲染 + resumeState dual-publish 跨文件 mutate。
- **resumes PROFILE 红线保持**:PROFILE 只**读**渲染简历预览(联系方式显示、函数体 runtime);`persistResume` **只存 {id,jobId,template,modules}、联系方式绝不入集合**(:116)→ resumes 集合 AI 可读无联系方式;preview LIVE 证预览渲染 PROFILE。
- **★批6 前瞻(评审提示,须重验)**:`JOBS[0]@:4` 是 **eager 跨模块读**(resumeState/ivState/matchState module-eval 急读 JOBS[0])——本轮 data.js@929 classic parse-time < resumes@1053 module deferred → 就绪、安全。**批6 data→module 后 JOBS 变 deferred**:须保 ① data module tag 早于 match/interview/resumes(现 929<1041/1052/1053 ✓)② JOBS[0] 非空(mock 12 保证);**此 eager 跨模块读是脆弱点、批6 重验**。可选清理=lazy init(`jobId:null` 首渲设),但非零回归、本轮不要求。
- **"not defined @buildPages" = 缓存假错**:可靠扫描证 renderInterview/renderResumes 无 classic 顶层消费者、buildPages 在 INIT module(deferred);force-revalidate clean 载 0 err。
- **真机金标准定序认可**:桌面 jobseek 持久禁用 → preview fresh(jobseek 启用)是更佳业务测环境;批6(影响 boot+全页)做真机。

**批5 通过。** 下一步批6(data.js+match.js 核心时序刀:JOBS[0] parse-time → import {JOBS},同批A型 import 图定序;★真机金标准)。

### 批6(commit `b1676bc`)· data.js + match.js 核心时序刀 → ES module(★高风险 parse-time)· 🏁 第36轮通过
**批6 核心协调刀**:data.js(JOBS/SKILLS/ACTIONS provider,被 77 处消费 JOBS)转 module,解 parse-time JOBS[0] 时序。函数体逐字节零改。
- **data.js**:export JOBS/SKILLS/ACTIONS(mutated-property:`.push`/`.length=0`/`.splice`/hydration in-place → dual-publish 同引用即安全、免访问器)+ 9 const(STATUS/ACCRUAL/PRI/CAT_LABEL/TOP_GAPS/KEYWORDS/PIPELINE/GENERAL/META)桥;CITY_DIST/KIND_DIST/TECH_META 私有。**自包含叶子**(零外部符号依赖;module-eval 的 `SKILLS.forEach`/`GENERAL.forEach`/`META.forEach` 全自包含、无外部时序风险)。
- **match.js**:export matchState(mutated dual-publish,cards/copilot-actions 跨文件 `.k=` 同引用安全)+ renderMatch/runMatch 桥;matchReadout/bindReadout 私有。红线:renderMatch 渲 RESUME.filename/derivedSkills 元数据、无联系方式。
- **★载序命门(评审第35轮前瞻的脆弱点、本轮重验)**:`data.js module@929` 早于 `match@1041`/`interview@1052`/`resumes@1053` —— 它们顶层 `let state={jobId:JOBS[0].id}` 于 **module-eval 急读 window.JOBS**;doc 序 929<1041<1052<1053 保 **data 先 eval、JOBS 桥就绪**(JOBS[0] 非空由 mock 12 保证)。= 批A型 import 图定序的 **tag-order 变体**;评审第35轮已裁 tag-order 可接受、本轮重验。
- **验(fresh clean 载 preview 冒烟 · 0 console error)**:INIT done + **window.JOBS=12 jobs** + **★eager JOBS[0] 读全初始化**(`matchState.jobId===JOBS[0].id` + `ivState.jobId===JOBS[0].id` + `resumeState.jobId===JOBS[0].id`——**评审前瞻的脆弱点验证通过**)+ JOBS dual-publish `.push` mutate 同引用 + data 桥 10/10 + 私有(CITY_DIST/KIND_DIST/TECH_META/matchReadout)不上桥 + 9 页全渲 + match 渲染。node×2/tsc0。
- **★真机 WKWebView 金标准(asset:// 免缓存)**:`cargo run` 重编译 **6.63s**(含批6、binary mtime > index.html)、**启动 + 壳渲染无崩**(dark 主题、JOBHUNT/资产/系统 nav、总览、v0.1.0)——**data.js module + 全业务模块 module-eval 不崩 boot**(若 data 未先 eval、eager 读会 throw)。⚠桌面 localStorage jobseek 持久禁用 → match/interview/resumes 页不在桌面 nav、eager-read 精确值靠 **preview clean 冒烟证**(jobseek 启用环境)。
- **★方法论固化**:批6 起沿用「fresh restart + force-revalidate 后 clean 载才是 console 判据」(批5 stale-cache 教训)——本轮 clean 载 0 err。**8123 已释放,评审可亲跑 preview。**

### ★ 第36轮裁定 = 通过(结构 + 亲跑 preview + 真机金标准 三证)
评审确认:整个业务层核心协调刀(data 被 77 处消费),第35轮标的 JOBS[0] 脆弱点本轮 **LIVE 兑现**。
- **★JOBS[0] module-eval 时序 = tag-order 解、LIVE 成立**:data.js `window.JOBS=JOBS` 在 module-eval 设桥(非箭头);tag-order data@929 < match@1041 < interview@1052 < resumes@1053(deferred doc 序=eval 序)→ data 先 eval 设桥、3 reader 读到。**preview LIVE(决定性)**:`JOBS.length===12` + 3 eager 跨模块读全对(matchState/ivState/resumeState.jobId 全 ===JOBS[0].id)——若 data 没先 eval 这 3 个 module-eval 急读会 undefined/throw、模块崩;全 true = tag-order 真工作、脆弱点站得住。
- **★权威模式固化(评审 · standing)**:**跨模块 eager module-eval 读**(JOBS[0]/SEEKER_CARDS 类)需 **tag-order(provider 先于 consumer)+ provider 在 module-eval 设桥**。**批2(cards SEEKER_CARDS)+ 批6(data JOBS)双证此模式**。(异于 runtime 函数体读——那个只需桥就绪、无 tag-order 约束。)
- **双证**:可靠扫描空(剩余 classic 仅 assets prompts/notes,顶层零读 JOBS/SKILLS/ACTIONS)+ dual-publish 同引用(preview 证跨模块 mutate)+ preview clean 0 err + **真机 WKWebView 金标准采信(同 R1;asset:// 免缓存证 module-eval 序正确、data module+全业务 module-eval 不崩 boot)**。web+真机双证。
- **[建议] 已采纳(doc-staleness)**:interview:4/resumes:4 注释"data.js 仍 classic、全局词法就绪"已过时(批6 data 转 module)→ **改为"data.js 已 module@929、tag-order 先 eval 设 JOBS 桥"** 反映真 WHY(免未来读者误解时序前提)。match:4 的 WHY 已在其桥注释正确表述。

**批6 通过 —— parse-time 时序坑全清(JOBS[0] 是最后一个)。** 下一步:批7(settings+assets → 删 shell-globals.d.ts)+ 批8 **profile 双红线**(链②收尾:PROFILE import-first 不上 window 桥;PROFILE 读在函数体 runtime 非 eager,焦点红线非时序)。

---

### 批7(commit `8242471`)· settings.js + assets(prompts/notes/manifest)→ module/import · 🏁 第37轮通过
**批7 双段**:7a 壳设置页转 module;7b assets 转 import-native(平台基元 import + 页 render 经 manifest import)。函数体逐字节零改。

**【7a】platform/shell/settings.js**:`renderSettings` → **export + 过渡 window 桥**;MODEL/settingsState/SET_TABS_SHELL + 各 manager/model-UI/wireDataIO **零外部消费 → module-private**。@ts-nocheck 保持(抽壳序5-c-3 过渡态)。
- ★**批8 前置**:本文件读 PROFILE(:333/:407),现经**全局词法读 classic profile.js**;profile 转 module(批8)后须改 `import {PROFILE}`。

**【7b】assets/pages/{prompts,notes}.js**:14 平台基元(`$/$$/tt/IC/openModal/closeModal/toast/toastUndo/persistColl/collPersistOn/hydrateColl/currentPage/frontis/signFoot`)**改 import**(不再依赖 window ambient);`renderPrompts/renderNotes` → **export**。
- ★**Option B(架构裁定)**:`assets/manifest.js` **import 两页 render**(经 grep 证唯一外部消费者:manifest:41/42 `render:()=>renderPrompts()`)→ **页不再上 window 桥**。**同 app 内 pages↔manifest 走 import,跨层仅 `window.SeekerShell` 契约保持全局**——比"给 assets render 名塞进壳 ambient 账本"(Option A,类目错置)干净、且收缩全局耦合而非扩张。
- 内联 `onclick="closeModal()"`(prompts:66/notes:56)仍按 window 解析——modal.js 运行时桥仍在;import 供页内直调 + tsc。

**【账本收敛】shell-globals.d.ts:15→1 条(★偏离原计划"整删",附 tsc 铁证)**
- 原计划(第9轮抽壳序 + 第36轮"批7 删 shell-globals.d.ts")**假设 prompts/notes 是唯一消费者**——**tsc 整删测证伪**:删全文件仅 `tt` 报错(`jobseek/manifest.js:58` liveCount 箭头裸全局读 tt),其余 13 基元零报错=prompts/notes 转 import 后**无消费者**。
- 故**收敛而非整删**:销 13 条(`el` 从无消费者)+ `renderPrompts/renderNotes` 经 manifest import 不入账本;**仅存 `tt`**(jobseek/manifest.js 裸全局,该 manifest 尚未改 import)。**tsc exit 0 证保留量精确**(缩到仅 tt 仍净=必要且充分)。整删待**批10 账本清空**(manifest 改 import tt 后)。

**验证(结构 + ★亲跑 preview 功能测)**:
- node --check ×3 OK;`tsc --noEmit` **exit 0**(缩账本后仍净)。
- ★**preview 功能测(fresh server 换实例 + 平直 reload,no-store)**:**0 console 错**;`window.__ord` 探针证**模块 eval 序 `[settings,prompts,manifest,INIT-buildPages]` 正确**(manifest eval 时 `typeof renderPrompts===function`=import 绑定成立);9 页全渲(prompts 539/notes 510/settings 2522/overview 1528,经 import 链);`window.renderPrompts===undefined`(Option B 无桥、render 经 manifest import 解析)。
- ★**CRUD 全通(exercise 全 import 基元)**:新建 prompt → openModal/fill/apEsc/persistColl/closeModal/renderPrompts/toast 全 import;删除 → **toastUndo 可撤销(反焦虑红线 LIVE)**。
- ★**转义红线 LIVE 证**:标题注入 `<script>alert(1)</script>` + 正文 `<b>bold</b>` → DOM 中转义为**字面文本**(`&lt;script&gt;`)、`querySelector('script')===null`、无 live 注入(截图证卡面显示字面标签)。

**★方法论订正(standing 候选)**:`force-revalidate`(`fetch` 全脚本 `{cache:'reload'}` + `location.reload()`)**在本 module 密集页(38 脚本)扰动模块载序**、制造**假 `renderPrompts/renderNotes/renderSettings not defined @buildPages`**(INIT inline-module 抢跑于外部 module)——**非真回归**。`__ord` 探针 + fresh-server 平直 reload 双证真序正确、0 err。**no-store server 已保证新鲜 → 平直 reload / 换服务实例才是净载判据;force-revalidate 对 module 密集页有害**(反转第29轮"桥 undefined 先 force-revalidate"的习惯:那是 classic-桥场景;module-import 场景 force-revalidate 本身即噪声源)。

**剩**:批8(profile 双红线收尾:PROFILE import-first 不上 window、flip settings/resumes 的 PROFILE→import;★高风险真机金标准)· 批9(index.html inline → module)· 批10(账本清空:余桥 + monolith-globals 27 条 + shell-globals tt 末条)。**8123 已释放,评审可亲跑 preview。**

### ★ 第37轮裁定 = 通过(结构 + 亲跑 preview 净方法)+ 方法论订正共担
评审三处裁定全认可、均独立复核:
- **① shell-globals.d.ts 15→1 = 认可(评审独立 tsc 整删测)**:评审自跑删测——仅 `jobseek/manifest.js:58 tt` 报错、13 基元零报错 → prompts/notes 转 import 后无 @ts-check 消费者、只剩 tt(jobseek liveCount 裸读未 import)。**数据驱动的诚实决策(tsc 证伪"整删"原假设)**,整删顺延批10。
- **② Option B = §1 取向正确**:manifest.js:9/10 import 两页 render、grep 证唯一外部消费者 → 页不上 window 桥;app 内 pages↔manifest 走 import(内聚)、跨层仅 SeekerShell 契约全局。优于 Option A(壳侧 ambient 账本长 app 符号=§1 味)。
- **③ ★方法论订正 = 成立、评审采纳并共担**:force-revalidate(fetch 全脚本 cache:reload + reload)对 **module-import 场景有害**(扰载序、INIT inline-module 抢跑外部 module)。评审独立核实:nocache-server.py:18 确 `no-store` → 平直 reload 本就新鲜、force-revalidate **冗余**;评审本轮即按净方法亲跑(平直 reload)→ 10 页全渲 + CRUD + 0 error 无扰动。**精化裁定③**:force-revalidate 只适 **classic-桥 stale 场景**;**module-import 场景 = no-store + 平直 reload / 换实例才是净判据**。前几轮(34/35/36)换 fresh server 掩盖了冗余、本轮 module-import 密集踩到——**"审查方也该被纠的一处,我领"**(评审共担)。
- **preview 功能测(评审净方法·0 error)**:10 页全渲(settings export / prompts/notes import 链);MODEL/settingsState/renderPrompts/openPromptModal **私有/import-native 不上桥**(比声称更彻底);**★转义红线 LIVE**:标题注 `<img src=x onerror=…>` → 字面转义、xssFired=0、无 img/script 落地;CRUD 全 import 路径工作;删除 undo 可撤销(反焦虑)。node×4/tsc 净。
- **[建议] 已采纳(doc-staleness)**:`index.html:1225` 注释"prompts/notes 留 classic(供 manifest 全局词法读)"过时 → 改为反映批1-6 业务全局已 module(经 window 桥 runtime 解析)+ 批7 assets prompts/notes module、render 由 manifest **import 直取**(Option B、不再上 window 桥)。

**批7 通过。** 下一步:批8(profile 双红线 · 链②收尾:PROFILE import-first 不上 window、flip settings/resumes 的 PROFILE→import;runtime 函数体读非时序、焦点红线;★单送 + 亲跑 preview〔净方法:平直 reload + no-store〕+ 真机金标准叠加)· 批9(index.html inline→module)· 批10(账本清空 · shell-globals tt 末条)。

---

### 批8(commit `65e7860`)· profile.js → module · 双红线收尾(★PROFILE 不上 window)· 🏁 第38轮通过
**批8 = classic 业务层 module 化收尾的隐私红线刀**。profile.js classic→module,函数体逐字节零改(PROFILE 值 + persistProfileField/hydrateProfile 体不变)。

**★双红线之结构强化(本刀核心)**:PROFILE/persistProfileField `export` 但**绝不上 window**(隐私最小暴露)。消费者 settings.js/resumes.js 从「裸全局读 classic PROFILE」→ `import { PROFILE }`。
- 效果:**window/AI 结构性不可达 PROFILE**(grep 证 0 `window.PROFILE`)——比 classic 全局时代更严(classic PROFILE 是 window 全局、理论可被任意脚本读;module import 后只有显式 importer 可达)。与红线①(rt.profile 硬隔离)、后端 QUERYABLE 不含 profile **三层叠加**。
- 红线②(设置不可经对话改):settings.js 另 import persistProfileField,仍是唯一改 PROFILE 入口(data-pf 输入、Agent 不可达)。
- hydrateProfile **私有**(仅本文件自注册 seeker-rt-ready 监听器、无外部消费者 → 不 export、不上桥)。

**红线逐字保留**:persistProfileField 只经 `rt.profile.set`、hydrateProfile 只经 `rt.profile.getAll`(绝不串 rt.db);resumes 的 PROFILE 只在函数体渲染简历预览联系方式、persistResume 绝不入 resumes 集合。

**时序(比批6 简单)**:PROFILE **无 eager module-eval 读**(settings :334/:408、resumes 8 处全在函数体 runtime)→ **无 tag-order 约束**,import 图自定序(profile.js 被 settings/resumes import → 先 eval)。profile.js module-eval 注册 rt-ready 监听器仍先于末位 dispatch(同 prompts/notes 先例)。

**验证**:
- 结构:node×3 / `tsc --noEmit` exit 0;grep 证 **0 window.PROFILE**(红线结构性)。
- **preview(净方法)**:PROFILE off window、canonical import=`[PROFILE,persistProfileField]`、settings/resumes/interview/prompts/overview 全渲、profile tab 10 字段带值(北京/138****8888…)、**★shared-instance 证**(settings oninput 改 PROFILE.city='深圳测试' → module singleton `m.PROFILE.city` 可见 = settings/resumes/profile.js 同一实例)、**0 console error**。
- **★真机金标准(cargo asset:// 免 HTTP 缓存)**:重编译 5.89s 重嵌、**boot 无崩**(进程稳 2.5min/RSS 134MB、窗口 "Seeker" 1880×964 visible、无 panic;唯一日志=macOS IMK 系统消息、非 app 错)——**asset:// 无缓存 → classic→module 转换在此净载 = definitive 证代码正确**(排除下述 preview 缓存陷阱)。

**★方法论新发现(preview 缓存陷阱 · 批7 订正的补充)**:初次 preview 冒烟 console 报 `renderSettings/renderResumes/ivBankHTML not defined @buildPages`——判定 = **preview 代理(8123)剥离 no-store 头**(`fetch` 证 `cache-control===null`)→ 浏览器按 URL 缓存脚本;profile.js 批7 曾以 **classic** 载入缓存,批8 classic→module **同 URL 内容变、缓存未失效** → 浏览器供 stale classic(module 解释下**空 exports**)→ settings/resumes 的 `import {PROFILE}` 抛"no export named PROFILE"→ 两文件 module-eval 失败 → 其尾部 window 桥(renderSettings/renderResumes/iv*)未设。**证据链**:served 文件有 export(fetch ?raw)+ cache-busted import(`?bust=`)得 `[PROFILE,persistProfileField]` + node/tsc 净 → 代码正确、纯缓存假错。**修**=单文件定向 `fetch('/…/profile.js',{cache:'reload'})`+reload(更新该缓存条目、**非全量 force-revalidate**——避免批7 载序扰动);修后 canonical import 得 exports、全页渲、0 err。**批7 订正之补充**:no-store 净判据**前提是 no-store 头真到浏览器**;preview 代理剥离时,**classic→module 同 URL 转换会踩 stale**,需定向单文件重验;asset:// 真机无此陷阱(免 HTTP 缓存)=更可信判据。

**剩**:批9(index.html inline PAGES/GROUPS/setState/WEIGHTS + inline 函数 → module)· 批10(账本清空:余 window 桥 + monolith-globals.d.ts 27 条 + shell-globals.d.ts tt 末条 → 全删)。**8123 已释放,评审可亲跑 preview**(注:若评审也遇 profile.js stale,同法定向重验、或真机 asset:// 验)。

### ★ 第38轮裁定 = 通过(结构逐行双审 + 亲跑 preview 净方法 + 真机金标准)· 全程最硬刀
评审逐行双审 + 独立复核三事,认可双红线**结构强化**(非仅零回归):
- **★红线① 从"零回归"升级为"结构强化"**:PROFILE + persistProfileField export 但 **0 window**(grep 空 + preview LIVE `typeof window.PROFILE/persistProfileField==='undefined'`)→ **window/AI 结构性不可达 PROFILE**;classic 时代 PROFILE 是 window 全局(理论任意脚本可读)、module 后**只有显式 importer(settings/resumes)可达 = 比抽壳前更严**。profile.js 零 rt.db、只 rt.profile.set/getAll;+ 后端 QUERYABLE 不含 profile = **三层叠加**。评审明确"这是真安全提升、不只搬迁"。
- **红线② 设置不可经对话改**:settings.js import persistProfileField = 唯一改入口、**写入口不在 window**(Agent 经 window 不可达)、hydrateProfile 私有不 export(自注册 rt-ready)。
- **★shared-instance 端到端 LIVE(import 语义命门)**:评审经 canonical import 改 `PROFILE.city='深圳SHARED'` → settings profile tab 渲染读到(`settingsSharesInstance:true`)+ 两次 canonical import 同引用(singletonSameRef=true)→ **settings/resumes/评审的 import = 同一 PROFILE singleton**(非 dual-publish 拷贝、是 import 同一实例)→ 红线消费者读同一隐私对象、无分裂。9 页全渲、0 err。
- **★方法论新发现 = 评审独立坐实 + 采纳**:`fetch profile.js` 的 **`cache-control===null`** → preview 代理剥离 no-store → 浏览器按 URL 缓存;profile.js 批7 classic 入缓存、批8 classic→module 同 URL 内容变但缓存未失效 → 平直 reload 供 stale classic(空 exports)→ import 抛 no-export。**cache-busted `?bust=` import 证 served 文件真有 2 exports** + node/tsc = 纯缓存假错。评审本轮亦用净修法(定向 cache-bust 批8 改的 3 文件、非全量、不扰序)→ 0 err。**精化裁定③**:force-revalidate 全量有害(批7);classic→module 同 URL 转换 + 代理剥 no-store → **定向单文件 cache-bust 必要**;**asset:// 真机无此陷阱 = 最可信**。
- **真机金标准采信**:cargo asset:// 重编译 5.89s + boot 无崩(进程稳 2.5min/134MB、窗口 Seeker 1880×964 visible、无 panic)= data/profile module + 全业务 module-eval 不崩 boot、asset:// 免缓存 = definitive 证代码正确(同 R1 留痕采信)+ preview 净方法双证。

**批8 通过 —— PROFILE 现对 window/AI 结构性不可达,隐私红线从抽壳前"全局可读"收紧到"仅显式 importer"、实打实强化安全。** 剩批9(index.html inline→module)+ 批10(账本清空 · shell-globals tt 末条)= classic 业务层 module 化 + 账本全收尾。

---

### 批9a(commit `93b1386`)· 壳核心状态 + 设置/数据框架 index.html inline → shell-state.js · 🏁 第39轮通过
**批9(index.html inline → module)拆 3 子批(第38轮后与用户对齐:真实体量 6 块 ~370 行 ~24 符号、boot-critical → 拆 9a 壳状态 / 9b 键盘+chrome+widget / 9c jobseek 业务)。9a = 第一刀**。9 符号从 index.html classic inline **逐字节零改**抽出为 `platform/shell/shell-state.js`:
- 壳状态:**PAGES/GROUPS**(mutated-property;SHELL BOOT@1243/1244 module-eval 急读 `PAGES.push`/`Object.assign(GROUPS)`)+ **setState/WEIGHTS**。
- 设置/数据框架:settingsPersistOn/saveSettings/hydrateSettings + **clearAllCollections/clearAllDataFlow**(破坏性红线:预览+确认+可撤销+清前备份,逐字保留)。
- 全 export + 过渡 window 桥;消费者(SHELL BOOT/nav/settings/profile/settings-jobseek/demo-seed/index.html initKeys/shellReassemble)裸全局读不变。9c 符号(renderFirstRun/showEmptyState)仍留 inline。

**★载序(命门)**:shell-state.js tag 置于 nav.js 后、SHELL BOOT 前 → PAGES/GROUPS 于 module-eval 即设桥,供 SHELL BOOT 急读。无 classic parse-time 读者(原 inline 亦无顶层读、消费全在函数体或 SHELL BOOT deferred module)→ 抽到 deferred module 安全(同批6 JOBS tag-order 型,但 provider=shell-state 早置)。

**验证**:node --check OK;tsc exit 0(monolith-globals.d.ts:46 `setState` ambient 不变 → 消费者仍解析)。
- **preview 净方法(fresh server + 平直 reload)**:0 console 错、**★window.PAGES.length===11**(SHELL BOOT 急读 push 到抽出的 PAGES 跨模块生效=命门验证)、GROUPS 5 键、setState.lang='zh'、WEIGHTS 4、nav 建好(5076)、overview/settings/skills/analysis 全渲、9 桥 typeof 就绪;截图证壳全渲(11 页 nav + 首启落地)。
- **★真机金标准(cargo asset:// 免 HTTP 缓存)**:重编译 5.96s、boot 无崩(进程稳、窗口 Seeker 1880×964 visible、RSS 141MB、无 panic)=抽出 PAGES/GROUPS 跨模块急读在真 WKWebView 生效。
- **★方法论(自纠)**:验证中一度 `import('shell-state.js?probe=')` 制造第二实例、其顶层 `window.PAGES=PAGES` 空数组**回填覆盖**了 canonical 桥(读到 len=0 假象)→ **带 window 副作用的 module 绝不可 cache-bust import**(会 clobber 桥);平直 reload 后 canonical PAGES.length===11。

**剩 9b**(键盘系统 initKeys/isDesktop/toggleSidebar/contextNew/pageSearchInput/keysHelpHTML/syncSbToggleTitle + widget wgtAction + openMarketValue → 新 platform/shell 文件)· **9c**(jobseek 业务 dotsHTML/renderFirstRun/showEmptyState/aiResumeForJob/goInterview → apps/jobseek)· **批10**(账本清空)。**8123 已释放,评审可亲跑 preview。**

### ★ 第39轮裁定 = 通过(结构 + 亲跑 preview 净方法 + 真机)
- **★载序命门 = tag-order 解、LIVE 坐实**:shell-state.js@866 早于 SHELL BOOT@875(deferred doc 序)→ shell-state 先 eval 设 window.PAGES(同一数组)、SHELL BOOT 后 eval 急读 push/Object.assign、INIT 读填好的。**preview LIVE**:index.html 新鲜 + **window.PAGES.length===11** + GROUPS 5 + nav 11 + 9 页全渲 + 桥全就绪。同批6 JOBS tag-order 型(provider 早置)。
- **破坏性红线逐字保留核实**:clearAllDataFlow = confirmDestructive(预览+确认)+ rt.db.backup(清前备份)+ SeekerShell.collections()(契约枚举)+ notifyDataCleared(第9契约)+ reload;saveSettings 体逐字(jh-settings + WEIGHTS.map);mutated-property 4 符号 dual-publish 同引用安全;可靠扫描空;node/tsc 净。
- **★方法论自纠 = 评审采纳(cache-bust import 适用边界补全,精化裁定③)**:**off-window module(批8 profile.js,无 window 副作用)→ `?bust=` import 安全验 exports;on-window module(批9a shell-state.js,顶层 window.X=)→ `?bust=` 造第二实例 clobber canonical 桥(空数组回填覆盖、假 len=0)→ 只能平直 reload + 直读 canonical 桥**。评审本轮即按此法(平直 reload + 直读 window.PAGES、未 cache-bust import shell-state)。asset:// 真机始终最可信。
- **真机金标准采信**:cargo asset:// 重编 5.96s + boot 无崩(窗口 Seeker 1880×964 visible、RSS 141MB、无 panic)= shell-state module + SHELL BOOT 急读不崩 boot。

**批9a 通过。** 剩 9b(键盘系统 + widget wgtAction + openMarketValue)· 9c(jobseek 业务 renderFirstRun 等)· 批10(账本清空)。9b/9c 继续亲跑净方法 + 真机叠加。

---

### 批9b(commit `0519667`)· 键盘系统 + widget-action 回流 → shell-keys.js / widget-actions.js · 🏁 第40轮通过
批9 第二刀,逐字节零改抽出两个新 platform/shell module:
- **shell-keys.js**(壳键盘注册 A 层 + 侧栏 chrome):export+桥 ×4 = initKeys(INIT-module 运行时调)/toggleSidebar(shell-boot 接线 #sbCollapse)/syncSbToggleTitle(nav.setLang typeof 守卫)/**isDesktop**(shell-state/data-store/settings/copilot-chrome 4 模块 typeof 守卫读);私有 ×3 = pageSearchInput/contextNew/keysHelpHTML(grep 证仅 initKeys 内消费)。**§1 归属债标注**(pre-existing):contextNew 硬编码 jobseek openNewJob/openNewAction → 随 CACT_ALLOWED 契约化账清。
- **widget-actions.js**(#2 W3):wgtAction + rt-ready 挂 SeekerWidgets.onAction。**零外部消费者(grep 证)→ 全 module-private 自注册、不 export 不上桥**(同 hydrateProfile 先例)。红线逐字:widgetId 平台传入不信任 iframe、破坏性一律 guardrail 预览+确认+可撤销、toast 前 action `<` 转义。**§1 归属债标注**:delete-job 分支硬编码 jobseek 符号。
- **验**:node×2/tsc 0;preview 净方法 0 错——initKeys LIVE(SeekerKeys **5 组 24 项**)、**★真实 KeyboardEvent Mod+B 切侧栏**(''→rail 经抽出链)、**Mod+/ 开快捷键帮助**(私有 keysHelpHTML LIVE)+ **Esc 逐层链关模态**、wgtAction 挂上 onAction(function)且 window.wgtAction===undefined(私有)、isDesktop 桥 false(web 正确)。

### 批9c(commit `8e02fd7`)· jobseek 业务 inline 归位(★index.html classic inline 实码清零)· 🏁 第40轮通过
批9 第三刀,6 符号逐字节零改归位 apps/jobseek:
- **logic/job-actions.js(新)**:openMarketValue + dotsHTML + aiResumeForJob/goInterview。**★ownership 订正**(偏离"9b 含 openMarketValue"框定、grep 证据落地):openMarketValue 读 YOU_VALUE/aiRun(皆 intake-action.js)= jobseek 业务归 apps;analysis:75/skills:68 **内联 onclick 消费 → 保 window 桥**。
- **logic/demo-seed.js(追加)**:renderFirstRun + showEmptyState(首启落地页;首启/演示同 surface、frDemo 直调同文件 seedDemoData);showEmptyState 被 settings.js:384 内联 onclick 消费 → 保 window 桥。
- **★里程碑:index.html classic inline 块实码清零**(仅注释存根;活跃 JS = 4 个 module 块:head rt桥/SHELL BOOT/INIT/末位 dispatch)。1330(批9 前)→ **1181** 行。
- **验**:node×2/tsc 0;preview 净方法 0 错——6 桥 function、showEmptyState() LIVE 渲首启落地、analysis dotsHTML×10、openMarketValue() LIVE 开 MARKET VALUE 模态。**★裁定③(b) 二次实证**:demo-seed.js 同 URL 内容变 → stale(showEmptyState not a function)、served 文件证有 export → **定向单文件 fetch(cache:reload)+reload** → 全通(按裁定修、非全量)。
- **真机金标准(9b+9c 合并跑)**:见下批注。**8123 已释放,评审可亲跑 preview**(若遇 demo-seed/shell-keys stale,同③(b) 定向重验)。

**批9b+9c 真机金标准(合并跑,cargo asset:// 免 HTTP 缓存)**:重编译 6.58s 重嵌、boot 无崩(窗口 Seeker 1880×964 visible、无 panic)——shell-keys/widget-actions/job-actions/demo-seed 追加全部 module-eval 不崩 boot;asset:// 无缓存陷阱 = definitive。

### ★ 第40轮裁定 = 通过(批9b+9c · 每条独立核验)· 抽壳 arc 真里程碑
- **widget-actions.js §4-4 红线逐字保留(读全文比对)**:widgetId 平台按端口传入不信任 iframe 自报(双标)、破坏性一律 confirmDestructive(delete-job 预览可读 `公司 · 岗位` 非裸 id=威胁 T5 预览腿、onConfirm/onUndo 成对快照回滚)、不可信 action toast 前 `<`-转义(text-content sink 充分)、wgtAction 私有不上桥(LIVE `window.wgtAction===undefined` 且 `SeekerWidgets.onAction.name==='wgtAction'`)。
- **shell-keys.js 分层**:4 export 上桥(LIVE 全 function=内联/INIT 消费者按 window 解析需要)、3 私有不上桥(LIVE 全 undefined)。
- **§1 两裁**:① contextNew 硬编码 jobseek openNewJob/openNewAction = §1 债**认可标注**(与 CACT_ALLOWED/wgtAction delete-job 同类,既有债零逻辑搬移非新增);② **openMarketValue 归属订正正确认可**(grep 坐实读 YOU_VALUE:47/aiRun:241=jobseek → 归 apps,符合第8轮归属驱动)。
- **★内联 onclick 消费者保 window 桥 = 硬约束核验**:showEmptyState(settings:384)/openMarketValue(analysis:75+skills:68)/renderFirstRun(overview:6 裸读)LIVE 全 function、openMarketValue 真开模态(读 YOU_VALUE=48)、dotsHTML 真返回标记。
- **★里程碑核验**:index.html 1330→1181(自 monolith 4602 −74%);awk 扫 classic inline 顶层实码=**空**;唯一剩 classic 外链=ai-engine.js(批10 收尾);活跃 JS 全 type=module。**可靠扫描(裁定④主证)**:9 个新 deferred 符号的 classic 顶层 eager 消费者=0 → 无 parse-time 断点。
- **亲跑 preview(fresh server 净方法)**:0 错;真实 KeyboardEvent Mod+B 切侧栏(unset→rail→复位=initKeys 实跑键映射 live、避第29轮 hoisting 陷阱)、Mod+/ 帮助+Esc 关、onAction 挂 wgtAction 且私有、PAGES=11 全应用渲染(截图)。node×4+tsc 净。
- **[建议](记账)**:两处 §1 平台硬编码 jobseek(contextNew、wgtAction delete-job)已随 CACT_ALLOWED 契约化账挂号——**批10 收尾时一并核对是否落契约分发,勿遗漏**。

**批9 三刀(9a/9b/9c)全过审。** 剩批10 = 账本清空终局刀(余桥 + monolith-globals 27 条 + shell-globals tt 末条 + ai-engine.js classic→module + 内联 onclick 绑定处置)——先出账本清点方案再动。

---

### 批10 方案(commit `4ee75f6`)+ 批10a(`67b8037`)死桥清扫 + 批10b(`6e6c00c`)manifest 枢纽/双账本整删 · 🏁 第41轮通过
**批10 = 账本清空终局刀,方案先行**(docs/proposal-batch10-ledger-cleanup.md;用户已批:①纯机械、(d)+§1 留批11 ②接受 i18n⇄shell-state 运行时环)。三路并行清点实测 **198 桥符号**(订正旧"70 桥"=按语句行估;platform 82/jobseek 113/index.html 3、assets 0)分类 a死10/b可flip136/b+classic阻6/c=BOOT-INIT块23/d=window强制25;§1 债 ~10 符号走契约(批11)。完成态目标:198→~35 白名单桥。

**批10a · 死桥 ×10 + tsconfig stale**(每个先亲验 grep,命中仅注释/HTML id/I18N 键/字符串标签):
- data.js KEYWORDS/PIPELINE/GENERAL/META(pages 用 *Real() 派生;GENERAL/META 仍被本文件顶层 forEach 用→const 留桥删)· demo-seed seedDemoData(批9c 归位后 frDemo 同文件词法)· persistence hydrateBizColls(自注册 rt-ready)· copilot-chrome copSend/agentGreet/cmdFilterList(全内部词法)· shell-state clearAllCollections(唯一消费者=同文件 clearAllDataFlow)。tsconfig 删 stale web/domain/** ×2。
- **验**:node×5/tsc 0;preview 净方法(先证 served 新鲜防假阴性)0 错、9/10 死符号 undefined、**★window.copSend typeof object = DOM 具名访问**(index.html:929 id="copSend" 按钮自动暴露、旧桥曾遮蔽;零消费者读→无行为差异)、**★最险路径 LIVE**:showEmptyState→点 frDemo→seedDemoData 模块词法调通(demo 横幅+overview 重渲+JOBS 种 12)。

**批10b · manifest → import 枢纽 + 双 d.ts 整删 + 16 唯一消费桥同刀销**:
- jobseek/manifest.js 28 裸全局 → 17 条 import(26 jobseek + 平台 tt/setState=apps→platform 方向 §1 允许);SEEKER_CARDS eager 读由 **import 图自定序**(强于原 tag-order);docstring 重写(阶段1 适配器表述过时)。
- **i18n.js setState flip = 跨层泄漏解**:原经 apps 侧 monolith-globals.d.ts 供 platform 文件 ambient;⚠运行时环(i18n⇄shell-state)已裁接受(全函数体读、零 eager 互读)。
- **双账本整删**:monolith-globals.d.ts(27)+ shell-globals.d.ts(tt)git rm;**tsc exit 0 = import 完全接管**。★1 处诚实类型改进:AGENT_CMDS 定义处补 `@type CommandSpec[]`(账本删后 @ts-nocheck 源推断 label 降级 string[] 被 tsc 契约面抓住——源头标注、类型随 import 传导,优于用点 cast)。
- **16 桥销**(先逐一亲验:除 manifest 外命中仅注释/契约方法名):settings-jobseek 6 + frameQuery + SEEKER_CARDS + demo-seed 3 + copilot-actions 4 + masterSectionHTML。
- **验**:node×8/tsc 0;preview 净方法 0 错——16 删桥全 undefined(**★③(b) 如期复现三次方**:6 桥文件同 URL 内容变→运行时 stale 有桥假象、served 证已删→定向 8 文件 cache:reload+reload 全净)、契约面全通(11 页/cards 11/appCommands 13/appSuggs 4/frameQuery)、liveCount 真值、**★真实双向语言切换**(setLang('en')→"7 to-do"→复原)=i18n/manifest 的 setState import 同一单例;**测试自纠**:bare setLang() 误赋 lang=undefined+污染 jh-lang="undefined"(setLang(l) 带参签名)——测试 bug 非代码回归、已清并复测。

**账本清空进度**:198 → 172 桥(死 10 + 唯一消费 16);d.ts 0 本。**剩 10c**(ai-engine→module 红线单送)**10d**(全网 flip ~136+23,+真机)。**8123 已释放,评审可亲跑 preview**(6+ 文件同 URL 内容变,若遇 stale 按③(b) 定向重验)。

### ★ 第41轮裁定 = 通过(10a+10b · 无阻断/应改,5 [建议] 其一为送审词实质订正)
- **删桥面五向扫描全零(评审独立)**:逐文件符号集差算出删桥=26(吻合);26 符号对内联 on*=/显式 window.X/`window[name]`(CACT 6 与 26 零交集)/**cBtn·cAct onclick 串(函数名藏字符串、前两类扫描必漏)**/eval·new Function 五向全零;再以 node 扫描器(剥注释+字符串、保模板 ${})证 26 符号仅 [DEF]/[IMPORT]、零裸读;false positive 逐条辨明(agentGreet=I18N 键、registry frameQuery=契约方法、copSend=id 属性)。
- **manifest 枢纽 §1 净**:17 import/28 符号,零 platform→apps、零跨应用;index.html 零改动 ⇒ tag 序不变;SEEKER_CARDS import 图自定序 LIVE(cards() 11 键)。
- **★★送审词实质订正([建议]① 采纳)**:「已批的运行时环生效」**不成立**——shell-state.js import 行=0,本轮只有单向边 i18n→shell-state,环待 10d;**flip 真正引入且送审词漏报的是:import 边把 shell-state 的 module-eval 从 tag@866 提前到 i18n@861 依赖位**(body 跑在 i18n body 之前;亲验其顶层只剩两行桥赋值零 eager 读 ✓、PAGES 桥更早于 SHELL BOOT@875=第39轮不变式被加强)。**裁定②补:import 边 = 第二种载序移动机制(provider 的 module-eval 被提前到 consumer 的 tag 位),与 tag-order 并列**。前瞻(10d 成环):先求值方=shell-state,i18n `const I18N` TDZ、`export function tt/L/T` 提升 ⇒ 顶层可调 tt() 但**禁调 T()/L()**;最稳=维持零 eager 互读。
- **AGENT_CMDS 两次真反证**:整删标注→tsc 报 label:string[] 不匹配(exec 陈述原因逐字复现=必要);改 number[]→tsc 在 manifest:83 契约面抓(受契约约束非自由断言);残留=@ts-nocheck 吞「字面量 vs 标注」漂移 → **[建议]② 10d flip @ts-check 时复验字面量满足 CommandSpec[]**。tsc 真退出码 0(评审指出 `…|tail;echo $?` 取 tail 退出码不作数、已不经管道复测)。
- **亲跑 preview 净方法**:0 console;25 删桥 undefined + 9 window-强制桥在;appReply() 返 452 字符卡 HTML(copReply 删桥后只能经 manifest import 到达=契约链坐实);setLang('en'/'zh') 正确签名无 jh-lang 污染;tt 随 setState.lang 即时反映=同一对象;最险路径因果对照(清 jh-demo→frDemo→复置+横幅=三删桥词法/import 链全通)。
- **★裁定新([建议]③ 死桥核验方法论补丁)**:`typeof window.X!=='undefined'` **不足证桥在**——`id="X"` 元素经 DOM 具名访问占据 window.X(copSend 即是、评审新鲜度探针亦误报一次);判据须加 `instanceof HTMLElement`/`===getElementById(X)`;反向隐患=未来模块裸读 copSend 得按钮元素非 ReferenceError(静默错值)→ 后续解耦 id 与函数名(挂批11/后续账)。
- **[建议]④ 覆盖边界**:本轮未跑真机;web 预览 isDesktop()=false → desktop-gated persist 写路径未执行(唯一涉及的 hydrateBizColls 以函数引用注册、结构不受影响)→ **10d 真机金标准须覆盖 i18n→shell-state 载序前移**。
- **[建议]⑤**:.claude/launch.json 换行重排=preview 工具噪声勿误提交(已排除在外);评审按符号去重数 171 vs 报 172=计数口径差非缺陷。

**10a+10b 通过(198→172 桥、d.ts 0 本)。** 剩 10c(ai-engine→module 红线单送)+ 10d(全网 flip;checklist:①copilot-actions @ts-check 时复验 AGENT_CMDS 字面量 ②真机覆盖 i18n→shell-state 载序前移 ③shell-state flip tt 后维持零 eager 互读[禁顶层 T/L])。

---

### 批10c(commit `c36dabe`)· ai-engine.js → module(★最后一个 classic 外链清零 · 红线刀)· 🏁 第42轮通过(+1 [应改] 已修)
**红线单送**(约束③ 加倍审)。ai-engine.js classic → type=module,函数体逐字节零改(diff 仅 2 个 export 前缀 + 头注释 + import 块):
- export extractSeekerBlock/streamReply;**aiLangHint 私有**(零外部消费者);自身 7 裸依赖全 import(tt/setState/aiHTML/displayText/toolStatusText/aiErrHTML/persistMsg)。
- **零 window 桥收官**:两消费者同刀 flip——copilot-chrome(streamReply)+ intake-job(extractSeekerBlock,apps→platform);ai-render 3 solo 桥随刀销(displayText/toolStatusText/aiErrHTML 唯一消费者=ai-engine;先亲验 grep 除定义/ai-engine 外零命中),aiHTML 桥留(copilot-chrome hydrateMessages 裸读、10d)。
- **红线四属性逐字**:①卡剥离走 SeekerShell.cards() 契约、prose 经 aiHTML、AI 原始 HTML 不进 DOM、持久卡 persist 过滤 ②JSON 经 CARDS[kind].valid 后才 push/show ③Untrusted 当数据非指令 ④grep 证 cards()×2/valid×2/aiHTML×3/persist 逐字在。
- **载序(裁定②核对)**:依赖 tag(i18n@861/ai-render@864/shell-state@866/data-store@867)皆早于 @869 → **import 边零提升**;顶层零语句零 eager 读;消费者全 runtime。
- **★里程碑:index.html classic 外链 = 0**(活跃 JS 全 type=module;classic 时代终结)。
- **验**:node×4/tsc 0;preview 净方法(③(b) 最高危形=classic→module 同 URL、定向 4 文件重验):0 错;**extractSeekerBlock LIVE 逐字语义**(合法块解析+剥离、broken JSON→data null+prose 不剥=第14行语义);**ai-engine off-window → `?bust=` import 安全验 exports**(裁定③ on/off-window 分野的正用);3 solo 桥 undefined+aiHTML 在;**★copSend 全链 LIVE**(点击→3 条消息=copilot-chrome import 解析成功);11 页。**★真机金标准**(cargo asset:// 免缓存):重编 6.26s、boot 无崩、零 panic = definitive。
- **账本进度**:172 → 169 桥(3 solo 销;ai-engine 自身零桥入账)。**剩 10d**(全网 flip ~133+23,+真机,checklist ×3:AGENT_CMDS 字面量复验/真机覆盖 i18n→shell-state 载序前移/shell-state flip tt 后零 eager 互读)。**8123 已释放。**

### ★ 第42轮裁定 = 通过 + 1 [应改](仅注释与推理,已即修)
- **逐字节零改机械验**:剥头注释/import/export 前缀后 old body 3161 字节 == new body 3161 字节。
- **红线加倍审(评审读码 + LIVE 驱动,stub SeekerRT.ai.stream 四回调、零改码)**:①onToken 注入 `<img onerror>`+`<script>` → 无元素落地、__xss=0、原文转义呈现;持久卡 persist **fail-closed**(resume-edit 无 persist 字段→排除;match-card true→入选);②valid 闸双分支(`{"garbage":1}`→拒+prose 不剥+原样转义;`{"jobId":…}`→过+剥离+卡渲染 75/100);extractSeekerBlock 逐字语义(broken→data:null+不剥);③**Untrusted 结构根据 = `for(const kind in CARDS)`:kind 来自平台组合注册表、AI 造不出卡型**;onError 注入转义+「打开数据设置」引导(设置不可经对话改)。aiLangHint 私有坐实(stub window.persistMsg 拦不到=走 import 非桥)。
- **消费者面**:6 消失符号真实码位仅 [DEF]/[IMPORT];无同名 id=(第41轮 DOM 具名访问判据首次应用);零 cBtn 串/内联 on*;aiHTML 桥正确留(copilot-chrome:176 hydrateMessages 裸读未 import);off-window `?bust=` 正用(exports 恰 2、aiLangHint 不在);§1 零 platform→apps;桥 delta=3 精确吻合。
- **★[应改](已修,commit 同刀)**:载序证据错误(结论对、推理错)——头注释称 data-store@867 早于 869 故「零提升」;**实测 data-store@870 晚于 869 ⇒ 确有一次提升**,安全成立但理由=**提升惰性**(data-store 零 import、顶层仅 __msgSeq+桥、零 eager 读、区间只夹空 body)。同类:copilot-chrome 注释 @871 实为 @874。**已按第41轮判据订正两处注释:import 边把 provider 的 module-eval 提前到 consumer 的 tag 位 ⇒ 查「提前区间内有无 eager 读/被跳过副作用」,非「依赖 tag 更早⇒无提升」**。定 [应改] 因这是红线文件安全背书+10d 将复用的判据本身。
- **里程碑钉入裁定②**:classic 外链=0 + classic inline 实码=0 ⇒ **「classic 顶层 eager 消费 deferred 符号」双向扫描退化为空集;10d 起载序风险只剩 (a) tag-order 与 (b) import 边提升两种**。
- **[建议]①(10d 地雷,已入方案)**:aiErrHTML 生成串含 `onclick="…copClose();go('settings')"` = cBtn 同类 window-解析暗道;copClose 有 typeof 守卫、**`go` 没有** ⇒ **`go` 必须入 (d) window-强制白名单**,否则摘桥后 AI 错误卡按钮静默抛错。**[建议]②**:10d 仍需一次真机(覆盖 i18n→shell-state 载序前移)。
- node×4/tsc 真退出码 0/preview 0 console/11 页;真机 exec 自报按既往采信。

**批10c 通过(172→169 桥、classic 0、d.ts 0)。** 剩 10d(全网 flip;checklist×4:AGENT_CMDS 字面量复验/真机覆盖载序前移/shell-state flip 后零 eager 互读[禁顶层 T/L]/★go 入 (d) 白名单)。

---

### 批10d(commit `fc79de7`)· 全网 import 化收官 —— 133 桥删、账本终态 36 白名单桥 · 🏁 第43轮通过
**批10 终局刀**。scanner+applier(token-aware:剥注释/字符串/regex-literal、保模板 ${})生成并应用:30 个 .js 注入 ~430 符号 import(provider 分组)+ BOOT/INIT 内联块各 12 符号 import;**133 桥删**;白名单 **33+3 桥**就地注解——(d) window-解析强制 26(内联 onclick/cBtn 串/CACT `window[name]`/aiErrHTML 的 **go**=第42轮[建议]①)+ **§1 平台裸读计算得出**(nav 7/shell-keys 2/widget-actions 3/**settings 2=hydrateJobs+showEmptyState 为清点外多抓**)+ HTML 跨内联块 3。**§1 硬规则内建**:platform 消费者 × apps provider → 不注入(保桥),杜绝反向 import。

**★功能测抓出 3 类真缺口(node/tsc 均盲——@ts-nocheck 间 export 存在性仅 runtime link 可判)**:
① resume-modals.js `openResumeModal/openResumeUpload` **有桥无 export**(批3 时代遗留)→ 全仓"桥而未 export"扫描仅此 2 处、补 export;
② **spread 盲区**:检测 lookbehind `(?<![.\w$])` 把 `...X` 第三点当属性访问 → `...SKILLS` 三处漏 import(copilot-actions/intake-job/analysis,LIVE 症状=analysis 页空)→ 全量 133 符号 spread 复扫仅此 3 处、补;
③ **自伤诚实披露**:调试中 `import('./apply10d.mjs')` 无 argv 把应用器**当副作用真跑第二遍**、HTML 块扫描无 import-tracking 不幂等 → BOOT 重注 go/toast、INIT 重注 go → **重复声明 SyntaxError 双块静默死** → 去重 + node 逐块 parse 终检(4 块零重复)。

**★方法论新判据(裁定④补)**:preview console 工具**不捕获未处理 module 级异常**(uncaught import 链错/SyntaxError 零显示——批10b jobseek 整应用消失时亦零 console)——块级静默死用 **Blob-module 重放**(textContent→blob URL import)使错误可捕获定位;本轮以此揪出重复声明。

**验证**:node ×38 / tsc 0;全量 spread 复扫净;白名单桥 **HTMLElement 判据**(第41轮补丁首轮全面应用);preview 净方法(fresh 实例+42 URL 定向重验):**0 console、11 页全渲**(analysis TOP SKILLS=修复 LIVE)、eager 态 ivState/resumeState.jobId===JOBS[0].id(import 图定序)、14 死桥抽查 undefined、9 白名单在、**Mod+B/copilot 发送/Esc 逐层/语言双向(7 to-do)/市场价值模态/wgtAction** 全链 LIVE。**checklist**:②真机 asset:// boot 无崩(6.10s、窗口稳、零 panic=覆盖 i18n⇄shell-state 环+全新 import 图)③shell-state 顶层零执行语句、环双向 runtime-only ④go 白名单 LIVE;①AGENT_CMDS @ts-check 复验=header flip 非本批范围(@type 注解已立,挂后续)。

**账本终态:169 → 36 桥(33 白名单 + 3 HTML 跨块);classic 0;d.ts 0;活跃 JS 全 module 全 import 化。** 批10(方案+a/b/c/d)全落。剩批11(绑定改造 [data-close]/[data-go] 委派 + §1 契约化四处)单列。**8123 已释放。**

### ★ 第43轮裁定 = 通过(批10d · 4 [建议] 其一为送审覆盖面实质订正、其一为评审自我订正)· ★批10 全落
- **删桥面评审重算**:逐文件符号集差 = **126 唯一符号删桥** + 36 白名单(exec"133"=169−36 减法、口径差非缺陷);126 × **七向扫描全零**(内联 on*[index.html 现 0 个]/window.X/window[name][CACT 6 零交集]/cBtn·cAct 串/eval 串/**裸读无 import[spread-aware]**/**import↔export link 面 0 缺 export**);LIVE 126 全 undefined(唯一 `agentSend`=id 属性 DOM 具名访问,第41轮判据挡误判)。
- **★★覆盖面实质订正:环规模远大于送审词**——checklist③ 只提 i18n⇄shell-state,**实测 3 个 SCC**(platform 9 环/settings⇄profile/jobseek 15 环),exec 只验了 26 个环成员之 1。评审 **TS AST 全量判定**(阳性对照抓已知 JOBS[0] 急读、补顶层 IIFE 盲区 nav:86 initTheme):**全仓顶层急读 import 绑定共 3 处**(match/resumes/interview 读 JOBS[0].id,provider data.js 在环外先求值)、**环内×非函数声明顶层急读=0 ⇒ 三环 TDZ 安全**。**载序模型升级:tag-order 人工维护 → import 图自定序**。
- **★★评审自我订正(裁定④补独立确认)**:注入 SyntaxError module + 死 link module,体不跑而 **preview console 0 条** ⇒ **「0 console」必要非充分**(第34-42轮列主证措辞偏强);**自本轮起主证=正向断言**(契约面+内联块跑完证据+功能链 LIVE),console 仅辅证;Blob-module 重放采纳为定位手段。
- **3 缺口独立复核**:①link 面净 ②评审自己扫描器**有同一 spread 盲区**→换法再扫=0 ③4 内联块 node 净、零重复 import。**红线**:构造 `data-cact="alert"` 被 CACT_ALLOWED 挡(__evil=0)=删 133 桥后 §4-4 仍成立;**第42轮[建议]① LIVE 闭环**(aiErrHTML 的 go('settings') 按钮真跳设置页)。
- **[建议]① 已即修(commit 同刀)**:`renderFirstRun` 多留死桥(overview 已 import、零 window 消费者)→ 删,**必要白名单 35**;preview 复验(off window + showEmptyState→落地页 import 链 LIVE + 0 console)。
- **[建议]②(裁定入账)**:环不变式写死——「**任一 SCC 内成员顶层(含 IIFE)不得急读同环成员的非函数声明绑定**」,TS AST+阳性对照可机械复跑;批11 加 import 边时按此校验。**[建议]③(批11 地雷)**:resumes.js:332 内联 onclick **经 window 桥直接写模块状态**(ivState.q=null;…;renderInterview())——绑定改造时与纯调用型分开处理。**[建议]④(批11 工作面)**:§1 债确切清单=平台裸读 apps 符号 **14 处/12 符号**(nav 7/widget-actions 3/shell-keys 2/settings 2)+ CACT_ALLOWED 6 个 jobseek 名。
- node×35/tsc 真 0/11 页/Mod+B·Mod+/·Esc·模态·copSend 全链(回匹配卡 75/100);真机按留痕采信。

**★批10 全落(方案+10a/b/c/d,第41/42/43轮全过)。账本终态:169 → 35 必要白名单桥(+3 HTML 跨块);classic 0;d.ts 0;活跃 JS 全 module 全 import 化 —— 3.y「账本清空」收官。** 剩批11(绑定改造 [data-close]/[data-go] + §1 契约化四处 + CACT 并集,先出方案)。

---

### 批11A(commit `2cb3491`)· 绑定改造收官 —— ★字面 onclick 清零 · 桥 35→28 · 🏁 第44轮通过(+1 [应改] 已修 commit `7c269f6`)
**批11 方案已批(4ee75f6 后 6a58f81;①纯机械留批11 ②运行时环已接受)之 11A(行为面,零契约)**。改绑不改逻辑,每站点语义逐字等价:
- **两委派清大头**:modal `[data-close]`(14 站点)+ nav `[data-go]`(9 站点+复合钮双属性,modal tag 先注册→先关后跳同原序;page id 全静态、未知 id 行为同旧 throw)。
- **散点程序绑定**:toast mock ×4 / openResumeModal ×4(含 settings-jobseek 经 **manifest extend.data.wire=wireDataResumeRow**,settings 框架既有全调机制 :446)/ openMarketValue ×2 / openNewJob+runMatch / showEmptyState(§1:平台 window+typeof 守卫读=现状保持,契约化 11B)。
- **[建议]③ 状态写 handler 单列**:interview data-goresume(resumeState.jobId 经 import 词法写)+ resumes #ivToRecords(ivState 三写+renderInterview 经 import,原 after 回调加绑)——window 途径全消。
- **cBtn→cAB ×18 + 模板删**:全部 oc-串改白名单委派;复合串→copResumeUpload() 包装;**CACT_ALLOWED 6→13**(chrome 自有 3 + jobseek 4,§1 名单债 11B cActions 清);**cBtn 模板删**(零消费者);**aiErrHTML onclick 串→cAB('copGo',['settings'])**(第42轮[建议]① go 暗道清除;语义=copGo 第42轮评审注;按钮 6px 内联边距随模板略去=视觉近似,如需可后补)。
- **桥 35→28**:删 8(closeModal/go/toast/runMatch/ivState/renderInterview/copClose/openResumeUpload)+加 1(copResumeUpload);新 import 边(ai-render⇄copilot-chrome 成环)按第43轮 SCC 不变式核=双侧顶层零急读 ✓。
- **验**:node 全量/tsc 0;preview 净方法 0 console、**★DOM [onclick] 属性=0**、11 页、删桥/白名单核;**全链 LIVE**:data-close 开关模态/data-go 跳页/data-goresume 状态写+跳/cAB copGo 关面板+跳 settings/**负向 data-cact="alert" 仍被挡(__evil=0)**/data-omv 市场价值模态/data-orm 简历模态/mocktoast/setDemoEmpty 落地页;真机 asset:// 无崩。**8123 已释放。**

**剩批11B(§1 契约化四契约:pageActions/pageNew/widgetActions/cActions + settings 残留;完成态 0 业务桥)——每契约一 commit、一轮送审。**

### ★ 第44轮裁定 = 通过 + 1 [应改](§4-4 红线,PoC 实证 · 已修 commit `7c269f6`)
- **评审 PoC 实证的放大面**:11A 把 cBtn 串迁 cAB 时,`agentChat` 一并进了 CACT_ALLOWED。但 `agentChat(html)=copAppend/agentAppend('ai','<span…>'+html)` 是**不转义**的 innerHTML sink(设计上收 HTML);文档级委派按值把 `data-cargs` 传入 → 13 白名单**唯此一项**把外部串反射进 innerHTML,恰是白名单存在的唯一理由(P2 注释:防「HTML 注入升级为 JS 执行 / 二次 innerHTML」)所要堵的放大面。**PoC**:`<button data-cact="agentChat" data-cargs='["<img src=x onerror=window.__xss=1>"]'>` 点击 → `__xss=1`、img[onerror] 进 DOM(白名单外 alert/__pwn 均挡)。
- **判 [应改] 非 [阻断] 的依据(评审注)**:纵深防御层——主防线(cAB 结构化 + 全站 cEsc,24/25 轮已验)仍在,端到端 live 击穿还需一个独立 HTML 注入点(当前码未证存在);但 PoC 已击穿此一层且有文档红线 backstop,必须修。执行方视白名单为硬红线者可按 [阻断] 处理。
- **修复(commit `7c269f6`,~3 行·零行为改动)**:①copilot-actions.js 唯一 cAB 调用点本传固定串 → 仿现成 `agentCancel` 先例加**无参包装** `agentBackupContinue()`(内部 `agentChat('(演示)清空已拦截 …')`),调用点改 `cAB('我已备份,继续','agentBackupContinue',[])`;②copilot-chrome.js `CACT_ALLOWED` **移除 agentChat**(仍 13 项:−agentChat +agentBackupContinue)、删 `window.agentChat` 桥、加不变式注释「白名单里不得有把 data-cargs 反射进 innerHTML 的处理器」;③agentChat 内部调用者(agentCancel/agentDeleteJob)走词法/import 不受影响。
- **修复复验(exec 亲跑 preview + 真机)**:**PoC 已闭**——`data-cact="agentChat"` 被白名单挡 → `__xss=0`、`img[onerror]=0`(对照 agentBackupContinue 白名单内通过);**正向控制**——`data-cact="agentBackupContinue"` 点击 → `.who +1`、末条正是固定串「Agent(演示)清空已拦截 …」= 白名单路径通、"我已备份,继续"按钮可见行为逐字等价(零回归);**桥删坐实(第41轮 DOM 具名访问判据)**——`window.agentChat===getElementById('agentChat')`、`instanceof HTMLElement`、tag=ASIDE、非 function ⇒ `"object"` 是 `id=agentChat` 的 aside、非函数桥残留;0 console(all)/11 页/**真机 asset:// boot 重编 5.56s、进程存活、零 panic**。
- **★不变式钉入(§4-4)**:CACT_ALLOWED 内不得有任何处理器把 `data-cargs` 反射进 innerHTML / eval / Function / setTimeout(串);新增白名单项前须自检(源码注释已就地固化)。11A 迁移对其余 12 处理器均满足(取 id 或 cEsc),唯 agentChat 例外、本轮消除。
- **评审独立复核(第44轮 report 追加、非我上报)**:①**新包装抗注入**——给 `agentBackupContinue` 塞同款 payload → `__xss2=0`(无参函数忽略 data-cargs、到不了 innerHTML=修复彻底的关键:新白名单项本身不放大);②**删 `window.agentChat` 桥的回归面独立验清**——`agentDeleteJob`(copilot-actions:17)`import { agentChat }` 非裸读、`agentCancel`(copilot-chrome:91)同文件词法、`shell-boot` 的 `agentChat`=`$('#agentChat')` 是 aside 非函数;裸读无 import 扫描空;**LIVE 两步护栏全通**(确认卡带 `data-cact="agentDeleteJob"`→执行不抛→岗位 12→11→出「已删除」→toastUndo 撤销恢复 12=证 import 的 agentChat 删桥后仍可达)。

**批11A 通过(第44轮;字面 onclick 清零 · CACT 6→13 · 桥 35→28;[应改] agentChat 放大面已修=白名单仍 13 项、结构不变)。** 剩批11B(§1 契约化四契约 pageActions/pageNew/widgetActions/cActions + settings 残留;完成态 0 业务桥)——每契约一 commit、一轮送审;**地雷** resumes.js:332 内联写模块状态 handler 单列(第43轮[建议]③)。

---

### 批11B · pageNew 契约(§1 契约化 1/4,commit `f1eb02b`)· 🏁 第45轮通过(无阻断/应改)
**批11B 四契约首刀**(每契约一 commit、一轮送审;约束② SeekerShell 扩展必审)。消除平台 `shell-keys.contextNew` 对 jobseek 符号(openNewJob/openNewAction)的裸全局读,改经新增 `SeekerShell.pageNew` 契约(**镜像既有 collId 选择型**)。**排序理由**:pageNew 最小面(2 符号 / keys 层 / 零红线 / 零桥删)→ 先立可复用「manifest 声明 per-page 动作 → 平台经契约取」模式,pageActions/widgetActions/cActions 承之(cActions 依赖 11A cBtn→cAB、殿后)。
- **契约扩展(约束②)**:registry.js `pageNew(pageId)` 选择型——`enabledApps()` 依序、首个 `a.pageNew(pageId)` 返回函数生效、否则 undefined(与 collId 逐字同构)+ api 注册;types.d.ts 双声明(`AppManifest.pageNew?` 应用面 + `SeekerShellApi.pageNew` 消费面)。
- **应用声明**:manifest.js +import openNewJob/openNewAction + `pageNew:(pageId)=>({jobs:()=>openNewJob(),actions:()=>openNewAction()}[pageId])`。**无参箭头包装**=契约 `()=>void`(openNewJob(editId) 的 editId=undefined 即「新建」,与原 contextNew 的 openNewJob() 逐字等价;@ts-check 下 `(editId)=>void` 不能直接充当 `()=>void`,故包装——这是唯一的形变、零行为)。**惰性**(体在调用时求值)→ manifest eval 不 eager 读→无载序前移(区别 cards:SEEKER_CARDS eager)。
- **平台改绑**:contextNew `{jobs:openNewJob,actions:openNewAction}[currentPage()]` → `SeekerShell.pageNew(currentPage())`,命中 fn()/未命中 toast 逐字等价;§1 债注释更新为「已清」。
- **桥/账**:桥数**不变**——openNewJob/openNewAction 的 window 桥仍由 nav.renderTopActions 消费(唯二全局消费者已核实:shell-keys[本刀清] + nav[pageActions 2/4 清]),故 pageActions 时才删这 2 桥。§1 债:shell-keys 2 处清零(14 处/12 符号 → 12 处剩)。
- **验**:node×3 / **tsc 真退出码 0**(pageNew 类型在 @ts-check 的 registry/manifest 面通过、包装消形变);preview 净方法(③(b) 定向重验三改文件+reload,先遇 classic registry.js 同 URL 缓存假象=pageNew 未定义→定向 fetch{cache:reload} 后正):**契约面**(pageNew 是函数、('jobs')/('actions')→函数、('overview')/('interview')/('nope')→undefined)+**功能端到端**(pageNew('jobs')()→录入岗位模态、('actions')()→添加行动模态、overview→undefined→toast 兜底)+**★金标准驱动改动函数本身**(stub __TAURI__ 过 when:isDesktop → 真 [data-go] 委派导航 jobs → 真实 Mod+N keydown → SeekerKeys → contextNew → 新岗位模态开;__TAURI__ 复原);0 console/11 页/截图 clean/桥仍在;**真机 asset:// boot 重编 5.87s、进程存活、零 panic**(新 manifest→intake-job import 边定序无碍)。

### ★ 第45轮裁定 = 通过(无 [阻断]、无 [应改];四契约可复用模式立住)
- **① 契约同构(约束②)**:registry `pageNew` 与选择型基准 `collId` **结构逐字同构**(同 `for(a of enabledApps())` 依序、首个命中返回、否则 undefined);唯一差异判据 `typeof fn==='function'`(vs collId `id!=null`)= 对「函数返回 vs 字符串返回」的正确适配、非偏差。types.d.ts 双声明齐备。
- **② §1 方向铁证**:shell-keys **剥注释后零 openNewJob/openNewAction 引用**(grep 命中全是解释性注释),平台跨层只读 `SeekerKeys`/`SeekerShell` 两契约全局;contextNew 裸读被契约取代。
- **③ 桥账独立核实(不采信送审词)**:逐文件判 import-vs-裸读 → openNewJob/openNewAction 的 window 桥**唯一剩余裸读者=nav.js**(`fn:()=>openNewJob()` 未 import),match/demo-seed/copilot-actions/manifest 全 `import+调用`(非桥消费者)⇒ 本刀前 shell-keys+nav 两裸读、现只剩 nav、**桥数正确不变**、§1 债 14→12 处。账对。
- **④ 无参包装零顾虑**:`openNewJob(editId)` 的 `editId!=null?编辑:新建`;旧 contextNew 本就无参调 `openNewJob()`(=新建),新包装 `()=>openNewJob()` 同样 `openNewJob()` ⇒ 逐字等价、**editId 顾虑其实多余**;惰性 + provider `export function`(hoisted、TDZ 安全)、新 import 未引入新环。
- **⑤ 金标准(评审亲验驱动改动函数本身)**:导航 jobs 页 → 真实 Mod+N keydown → SeekerKeys → contextNew → currentPage='jobs' → 契约 → fn() → 新岗位模态开;overview 页 Mod+N → undefined → toast 兜底不抛、无模态。0 console/11 页/字面 onclick 仍 0/桥仍在;契约面 pageNew 新增而 collId/cards/appCommands 不变;node×3/tsc 真 0;真机按我留痕采信(未独立复现)。
- **评审诚实记录**:一次探针假象(`fresh_shellkeys_no_bareread` 把注释里"原硬编码 `{jobs:openNewJob`"当代码命中),剥注释复核后确认代码净——与我送审的 ③(b) 缓存假象同类「先假象后查清」。

**pageNew 通过(第45轮;§1 契约化 1/4;桥不变 28、§1 债 14→12 处;契约面 +pageNew)。** 下一刀 = pageActions(2/4)。

**下一刀:pageActions(§1 契约化 2/4)** —— nav.renderTopActions 7 符号(openResumeModal/resumeGenerate/resumeState/renderResumes/openNewJob/openMarketValue/openNewAction)→ 汇总型 per-page 顶栏动作契约;此刀删 openNewJob/openNewAction 2 桥(最后全局消费者去)。

---

### 批11B · pageActions 契约(§1 契约化 2/4,commit `45b5a50`)· 🏁 第46轮通过(无阻断/应改)
**四契约之二**(约束② 必审)。消除 nav.renderTopActions 对 jobseek **7 符号**裸读,改经新增 `SeekerShell.pageActions` **汇总型**契约(镜像 cards/appCommands 并集);nav 是这 7 符号的最后平台裸读者 → **7 个 window 桥随之删(28→21)**——比 pageNew 大一档(红线面=顶栏动作装配、桥删 7)。
- **契约扩展(约束②)**:registry.js `pageActions(pageId)` 汇总型(enabledApps 遍历、各 `a.pageActions(pageId)` 并集,同 cards)+ api;types.d.ts +PageAction 接口(`{t,a?,fn}`)+ AppManifest/SeekerShellApi 双声明。
- **应用声明**:manifest.js +6 import(openResumeModal/openMarketValue/resumeGenerate/resumeState + **go/toast**=apps→platform 允许)+ `pageActions:(pageId)=>({overview/match/resumes/jobs/analysis/skills/actions:[...]}[pageId]||[])`=原 nav map **逐字迁入**;惰性(fn 闭包点击求值、tt 每次调用重求值=语言切换即时、顶层零 eager 读)。
- **平台改绑**:nav.renderTopActions 硬编码 map 删,改 `SeekerShell.pageActions(id).forEach(...)`;渲染循环逐字不变;interview/settings→[]。
- **删 7 桥(28→21)· 每消费者已 import 核实**:openNewJob/openNewAction(nav=最后裸读者,shell-keys 已 pageNew 清)、openResumeModal/openMarketValue/resumeState+renderResumes+resumeGenerate(唯一裸读者=nav)。**七向全树扫描**:7 符号每个非-manifest 消费者均 `import`(cards/copilot-actions/persistence/job-actions/settings-jobseek/demo-seed/jobs)或 resumes.js 内部使用;**index.html 零引用**、platform 零裸读 → 删桥零 ReferenceError。5 处"过渡桥"注释同步更新为「已摘」。
- **§1 债**:nav 7 处清零(pageNew 后 12 → 5 处剩:widget-actions 3 + settings 2)。
- **验**:node×8 / **tsc 真退出码 0**;preview 净方法(③(b) 定向重验 8 改文件):契约面(pageActions 是函数、7 页标签逐字匹配原 map、interview/settings→[])+ **7 桥全 undefined**(第41轮判据:无一为元素 id)+ 功能端到端(skills「市场价值报告」→ 市场价值模态[openMarketValue import];**resumes「+ 生成针对性简历」→ AI 生成模态**=resumeGenerate(resumeState.jobId, renderResumes) 3 删桥符号全经 import、resumeState import 即同对象;语言切换 jobs「+ 录入岗位」↔「+ Add job」↔ 复位=契约重求值 tt);0 console/11 页/截图 clean;**真机 asset:// boot 重编 6.04s、进程存活、零 panic**(7 删桥 + 新 import 边定序无碍)。

### ★ 第46轮裁定 = 通过(无 [阻断]、无 [应改];真删 7 桥,账目严密)
- **① 删 7 桥的消费者面(本刀最要害一关)· 评审独立全树扫描**:桥集差独立算出精确 **7 删、零加**;再对每符号做 **tokenizer 全树扫描**(剥注释/字符串/regex、spread-aware)→ **7 符号的每一个消费者都是 `[DEF]` 或 `[IMPORT]`,零裸读无 import** ⇒ 零 ReferenceError(第28轮 cut2 / 第29轮 nav:86 那类静默回归的判据)。配合:**7 符号均无同名 `id=` 元素**(排除 DOM 具名访问掩盖删桥的反向隐患)、LIVE 证 7 桥运行时全 undefined。
- **② §1 方向**:nav 剥注释后**零引用这 7 符号**、跨层 apps `window.X` 读全空 ⇒ nav 从此不再裸读任何 apps 符号;§1 债 12 → **5 处剩**(widget-actions 3 + settings 2)。
- **③ 契约同构(约束②)**:pageActions ≅ cards/appCommands 汇总型——`enabledApps().forEach` 遍历、各应用结果并集(cards 用 `Object.assign` 并对象、pageActions 用 `push(...list)` 并数组,与 appCommands 并数组同型);`typeof a.pageActions==='function'` + `Array.isArray(list)` **双守卫**防无契约应用;types.d.ts 三声明(PageAction 接口 + 应用面 + 消费面)齐备。
- **④ 逐字迁入 + 惰性**:renderTopActions 硬编码 map 原样搬进 manifest.pageActions,`[pageId]||[]` 兜底、nav 渲染循环不变 = 零行为;manifest 新增 import(+go/toast=apps→platform 允许)顶层零 eager 调用(全在嵌套箭头、resumeState 仅闭包内读)、provider 皆 hoisted ⇒ TDZ 安全。
- **⑤ 金标准(评审经真实顶栏按钮驱动 renderTopActions 本身)**:skills「市场价值报告」→ openMarketValue 模态;**resumes「+ 生成针对性简历」→ AI RESUME 模态开(`字节跳动 · 后端高级工程师`)不抛** —— `resumeGenerate(resumeState.jobId, renderResumes)` 三删桥符号全经 import、**模态显示的正是 resumeState.jobId 指向的岗位 = import 读同一对象坐实**;jobs「+ 录入岗位」→ openNewJob 模态;语言切换 ↔ 复位(闭包 tt 每次重求值)。0 console/11 页/字面 onclick 仍 0/剩余桥在;node×8/tsc 真 0;真机按我留痕采信。
- **⑥ 桥计数吻合**:评审按 `window.X=X` 去重独立数得 27 window 符号 − 6 运行时命名空间 = **21**,与我一致(**无 ±1 差异**)。

**pageActions 通过(第46轮;§1 契约化 2/4;★真删 7 桥 28→21;§1 债 12→5 处;契约面 +pageActions/+PageAction)。** 四契约模式已两刀立稳。

**下一刀:widgetActions(§1 契约化 3/4)** —— widget-actions delete-job 分支 3 符号(JOBS/renderJobs/renderOverview)整段回迁 jobseek + 平台留通用 destructive 闸;**红线加倍审**(§4-3/§4-4:破坏性一律 confirmDestructive、widgetId 平台按端口传入不信任 iframe 自报、payload 仅当数据、不可信 action toast 前 `<`-转义 —— 逐字保留)。

---

### 批11B · widgetActions 契约(§1 契约化 3/4 · 红线刀,commit `7b52b1e`)· 🏁 第47轮通过(无阻断/应改)
**四契约之三**(约束② 契约必审 + **约束③ 红线加倍审**)。平台 wgtAction 的 delete-job 分支硬编码 jobseek 的 JOBS/renderJobs/renderOverview,整段回迁 apps/jobseek;平台只留「通用 destructive 闸 + guardrail 调用」。**删 3 桥(21→18)**。

- **★契约的红线设计 = 收规格、不收执行**:契约**不是**「应用给 handler 由平台调」,而是「应用返回 `confirmDestructive` **规格数据**,平台**自己**调 guardrail」⇒ ①应用无法绕过护栏(预览+确认+可撤销一律平台驱动);②`WidgetActionSpec` **故意不含 `source`**,平台 `{ ...spec, source:'widget '+widgetId }` **source 置于 spread 之后** ⇒ 应用即便声明也被覆盖、**无法伪造来源**(§4-4 零信任;widgetId 由 render.js 按端口归属传入,本刀未动);③`if(!G) return` fail-closed **在咨询契约之前** ⇒ 无护栏时连应用代码都不被调到;④registry `typeof spec.onConfirm==='function'` 守卫,缺执行体视为未认领 → 落通用分支(仍过护栏)。
- **契约扩展(约束②)**:types.d.ts +`WidgetActionSpec`(无 source)+ AppManifest/SeekerShellApi 双声明;registry.js +`widgetActions(action,payload)` 选择型(同 pageNew)+ api。
- **回迁**:新增 `apps/jobseek/logic/widget-actions-jobseek.js`(@ts-nocheck,同 settings-jobseek 约定)。`jobseekWidgetAction` = 原分支**逐字迁入**(8 行 byte-verbatim 机械验:snap 闭包/JOBS.find/_label/title/detail/confirmLabel/onConfirm/onUndo/undoText);认领条件 = 原 `action==='delete-job' && payload.id!=null && jobsPersistOn()` 的**德摩根取反**,不认领→undefined→平台通用分支(逐字等价)。manifest 声明 `widgetActions`。
- **平台侧 9 处红线逐字未变(vs HEAD 机械验)**:破坏性正则 / 非破坏 toast `<`-转义 / `if(!G) return` / 通用分支四项 / rt-ready 注册。移除 jobsPersistOn import(条件随分支回迁)。
- **删 3 桥**:剥注释后全树扫描 —— 3 符号每个 CODE 引用皆 `[IMPORT/DEF]`、**零裸读**;index.html 零引用;3 符号无同名 `id=` 元素。**平台侧剥注释后零 jobseek 符号(§1 铁证)**。
- **顺带订正 4 处失效注释**(data/resumes/interview/match):原称「JOBS[0] 急读 window.JOBS + tag-order 保障桥就绪」,桥删后该说法失效且误导 → 订正为第43轮判据(急读 **import 绑定**、载序由 **import 图自定序**、data.js 在 SCC 之外先求值)。
- **§1 债**:widget-actions 3 处清零(5 → **2 处剩**:settings 的 showEmptyState/hydrateJobs)。
- **验**:node×10 / **tsc 真退出码 0**;preview 净方法 · **经真实入口 `SeekerWidgets.onAction` 驱动 wgtAction 本身**(`onAction.name==='wgtAction'`):
  ①**非破坏动作**`<img src=x onerror=…>` → 仅 toast、零 guardrail、`__wxss=0`、`img[onerror]=0`(toast 显示转义后的字面文本);
  ②**fail-closed**:删 SeekerGuardrail → delete-job 零弹窗零执行;
  ③**分支语义**:网页态 jobsPersistOn()=false → 不认领 → 通用「确认操作」分支;stub 桌面态 → jobseek 认领,规格 title='删除岗位?'、detail='将删除岗位:字节跳动 · 后端高级工程师'、onConfirm/onUndo 为函数、**`'source' in spec === false`**;
  ④**★来源不可伪造 PoC**:stub 应用返回 `source:'SYSTEM · 可信来源'` → 弹窗实显「来源 · widget wgt-99」(平台 widgetId 胜出);其 onConfirm 在**确认前 / 取消后均未执行** ⇒ 应用不能绕过护栏;
  ⑤**★预览+确认+可撤销全链**(stub db、不动真实数据):12 岗位 → 弹窗(确认前 JOBS 仍 12 = 未执行)→「删除」→ `remove(jobs,1)`+`list(jobs)` → 撤销 toast「已删除岗位」→「撤销」→ **`upsert(jobs,SNAPSHOT)`**(证 onConfirm/onUndo 共享的 `let snap` 闭包迁移后完好)+`list(jobs)`;JOBS 经 **import 绑定**读写(桥已删)、`length=0`/`push(...)` 同对象。
  复位后 0 console(all)/11 页/12 岗位/契约 5 齐/无残留弹窗。**真机 asset:// boot 重编 6.49s、进程存活、零 panic**(桌面态 jobsPersistOn()=true ⇒ 新 import 链正是其实际路径)。

### ★ 第47轮裁定 = 通过(无 [阻断]、无 [应改];红线刀 · 约束③ 加倍审)
- **① 契约红线结构(评审读码坐实 4 不变式)**:①应用不能绕过护栏——新模块 `jobseekWidgetAction` **`return {…spec…}`**、不调 confirmDestructive,平台拿到后自己驱动 guardrail;②应用不能伪造来源——`WidgetActionSpec` **类型层无 `source` 字段** + 平台 `{ ...spec, source:'widget '+widgetId }` **source 置于 spread 之后** = **双重防护**;③fail-closed——`const G=window.SeekerGuardrail; if(!G) return;` **在咨询契约之前**;④残缺规格不放行——registry `spec && typeof spec.onConfirm==='function'` 才认领,否则落通用分支(仍过护栏)。
- **② 机械验(约束③)**:迁移体 byte-verbatim(`let snap` 闭包 / `_job` / `_label` / 6 字段),**唯一差异 = `await G.confirmDestructive({…})` → `return {…}` 且 spec 内删去 `source`**;平台通用破坏性分支 + rt-ready 注册 vs HEAD **diff 空**;认领条件 = 原条件的德摩根取反、逐字等价。
- **③ 删 3 桥 + §1**:桥集差精确 3 删 → **18 业务桥**;3 符号全树消费者面**全 [IMPORT/DEF]、零裸读无 import**(JOBS 有 ~18 消费者全 import),无同名 id → LIVE 全 undefined;**平台 widget-actions.js 剥注释零 jobseek 符号**。§1 债 5→2 处。
- **④ 4 处注释订正核实**:data.js 是删桥 + 注释;resumes/interview/match 的 `export let state={jobId:JOBS[0].id}` **代码逐字不变、仅尾注释改**。评审判「订正内容准确且值得肯定」——把删桥后失效的「急读 window.JOBS + tag-order」改为第43轮判据,**消除了误导性文档**。
- **⑤ 红线 LIVE 驱动(评审经真实入口 `SeekerWidgets.onAction`,`onAction.name==='wgtAction'`)**:①非破坏 `<img onerror>` → 仅 toast、零 guardrail、`__wxss=0`、toast 转义 ②fail-closed 删 G → 零弹窗零执行 ③分支语义(网页不认领→通用;桌面 stub→认领,可读 label) ④**★来源不可伪造 PoC**:应用返 `source:'SYSTEM · 可信来源'` → 平台实传 `source==='widget wgt-99'`(端口归属胜出)、onConfirm 确认前未执行 ⑤**★全链**(stub db):确认前未跑 → 确认 `remove+list` → 撤销 `upsert+list` 且**快照恢复**(`let snap` 闭包完好:onConfirm 设、onUndo 读)。0 console/11 页/字面 onclick 仍 0/契约 6 齐;node×10/tsc 真 0;真机按我留痕采信。
- **诚实记录(评审同录)**:全链测的 onConfirm/onUndo 用 stub 列表驱动了真实 JOBS 绑定的 `JOBS.length=0; push(...)`,**污染内存 JOBS** —— 测试副作用非代码 bug(真实持久层已 stub 未动),reload 重估 data.js 后 **JOBS 复原 12** 已验证无真实损坏。

**widgetActions 通过(第47轮;§1 契约化 3/4;删 3 桥 21→18;§1 债 5→2 处;契约面 +widgetActions/+WidgetActionSpec)。**

**下一刀:cActions(§1 契约化 4/4 · 收官)** —— CACT_ALLOWED 里 10 个 jobseek 名(copNewJob/copNewAction/copMarket/copResumeUpload/copDoneAct/copInterview/copMatch/copPlan/copResume/agentDeleteJob)改由各 manifest 声明之**并集**;分发器 `window[name]` → 注册 Map ⇒ **杀掉最后一批 window-强制桥**。§4-4 不变式(白名单不得含把 data-cargs 反射进 innerHTML/eval/Function/setTimeout(串) 者)须随契约一并搬进契约面。另:settings 2 处残留(showEmptyState/hydrateJobs)。

---

### 批11B · cActions 契约(§1 契约化 4/4 · 收官,commit `58f8f05`)· 🏁 第48轮通过(+1 [建议] 措辞精确化 已即修 commit `61b9cdb`)
**四契约收官**(约束② 契约必审)。Copilot cAB 委派的最后一段 §1 债:CACT_ALLOWED 硬编码 jobseek 名 + 分发器 `window[name]`。改为「**注册表即白名单**」:平台自有 `CACT_OWN`(copGo/agentCancel)∪ `SeekerShell.cActions()`(各 manifest 声明之**并集**)。**删 13 桥(18→5)**。**注:实际 11 个 jobseek 名**(送审词的 10 漏了第44轮新增的 `agentBackupContinue`)。
- **★契约红线:注册表即白名单(§4-4,不再 window[name])**:委派 `CACT_ALLOWED.has(name) && window[name]` → `cactHandler(name)`(查 CACT_OWN 再查 cActions())。①**gadget 面从根消除**——只能命中已登记处理器,未修 HTML 注入面即便落 `<button data-cact="eval">` 也取不到 eval(旧 window[name] 路径可以);②**免疫 DOM 具名访问遮蔽(第41轮判据)**——`id="copMatch"` 元素不再顶替处理器;③**防原型污染**——CACT_OWN + registry.cActions() 均 `Object.create(null)` + 只收 own-enumerable function 值 ⇒ `data-cact="toString"/"constructor"/"valueOf"` 取不到;④**§4-4 不变式随契约面固化**——types.d.ts/registry.cActions/manifest.cActions 三处注明「登记项任一参数不得流进 innerHTML/eval/Function/setTimeout(串)」,`agentChat`(不转义 innerHTML sink)**不登记**、固定串走无参包装 agentBackupContinue(第44轮先例)。
- **契约扩展(约束②)**:types.d.ts +AppManifest.cActions?()=>Record<名,处理器> + SeekerShellApi.cActions()(注 null 原型);registry.js +cActions() 汇总型(并集/Object.create(null)/只收 function 值)+ api。
- **应用声明**:manifest.js +import 11 处理器 + `cActions:()=>({…11…})`。**平台改绑**:copilot-chrome.js CACT_ALLOWED Set 删 → CACT_OWN + cactHandler(name)。
- **删 13 桥(18→5)**:copGo/agentCancel(平台 2)+ 11 jobseek 名 —— 两文件 window 桥清零。tokenizer 全树扫描(剥注释+字符串字面量):13 名每个 CODE 引用皆 [DEF]/[IMPORT]、**零裸读、零显式 window.X 读**;唯一到达路径 = 委派查表。
- **cAB 三角闭合**:13 个 cAB('…',name,…) 调用点 = 2 CACT_OWN + 11 app cActions,零调用点未登记、零登记项无调用点。
- **终态**:业务桥 **18→5**;5 = showEmptyState/hydrateJobs(§1 settings 残留,末件)+ shellReassemble/shellPushAiReadable/openAppManager(**HTML 跨内联块、结构性不可 import,非业务桥**)。§1 债 5→**2 处**(仅 settings 残留)。
- **验**:node×4 / **tsc 真退出码 0**;preview 净方法(定向重验 4 文件)· 经真实委派驱动:契约面(cActions() 返 11 处理器、**null 原型** `'toString' in m===false`、13 桥全 undefined);**★委派全链**(copGo 平台 OWN→关面板跳 settings;copMarket app→市场价值模态;agentDeleteJob 破坏性→派发到 app 处理器;**copReply→cAB HTML→真实点击→查表调用** '上传简历'→`data-cact="copResumeUpload"`→上传模态);**★负向**(gadget 关闭:`data-cact="alert"/"eval"/"Function"` 全 inert、alert 未调、__pwn 未定义;`"toString"/"constructor"/"valueOf"` inert=null 原型;**agentChat 仍被挡**=不在登记表、__xss 未定义、img[onerror]=0=第44轮不变式经契约面延续)。0 console/11 页;**真机 asset:// boot 重编 5.74s、进程存活、零 panic**。

**下一刀(末件):settings 2 残留** —— showEmptyState(settings:446 `typeof window.showEmptyState` 落地页空态)→ 经 jobseek 既有 appSettings 契约段内自绑;hydrateJobs(settings:480 数据导入后重水合)→ 复用/新增存在性广播契约。做完 = **§1 债清零 + 0 业务桥终态**(仅剩 3 个平台 HTML 跨块桥,非业务)。批11B(四契约 + settings 残留)收官。

### ★ 第48轮裁定 = 通过 + 1 [建议](changelog/注释措辞精确化,不涉逻辑 · 已即修)
- **① 委派机制(读码 + LIVE)**:`cactHandler(name)` 查 CACT_OWN(`Object.create(null)`+{copGo,agentCancel})→ SeekerShell.cActions(),**完全不再 window[name]**;registry `cActions()` = `Object.create(null)` + `Object.keys`(own-enumerable)+ 只收 function 值。LIVE 全验:负向全挡(alert/eval/Function gadget、toString/constructor/valueOf/__proto__/hasOwnProperty 原型污染、agentChat 二次 innerHTML → `__pwn=undefined`/`__xss=0`/img=0);正向双路(copGo=CACT_OWN 跳页;copMatch=app cActions 查表跳 match[window.copMatch 已无桥];copResumeUpload 上传模态;agentBackupContinue 固定串);cActions()=11 处理器 null 原型;第44轮不变式经契约面延续。
- **★② [建议] · changelog/注释「四面表」略过度声称(已即修 · 评审精确化)**:旧 `CACT_ALLOWED.has(name)` 是 **`Set.has()`**,对 `'eval'`/`'toString'` **本就返回 false**(Set 成员判定不走原型链)⇒ gadget 与原型污染两面**旧代码已挡**、非本刀「新关」。本刀**真实**改进三点:①**DOM 具名访问遮蔽的健壮性**——删桥后 `window.copMatch` 若被同名元素顶替则 `window[name]` 派发失效,改查表免疫;**且正因如此 copMatch 的桥才能安全删除**=查表设计的**必要性**而非仅增强;②删掉 `window[name]` 派发机制=纵深防御;③不变式结构性固化。另:`Object.create(null)` 是对**新的对象查表**的必要防护(`{}` 会让 `cActions()['toString']` 命中 `Object.prototype.toString`;旧 Set.has 无此面)。**已即修**:copilot-chrome.js 委派注释按此精确化(gadget/原型名旧 Set 本就挡、本刀价值=§1+删 window[name] 原语+DOM 遮蔽免疫[删桥前提]+null 原型对新对象查表的必要性),changelog 表述同步。**评审自订正**:核查中一度以为 `id="copMatch"` 有真实元素(grep 命中),复查发现**两处命中都在注释里**(举例用),当前无真实同名元素——DOM 遮蔽改进是防未来碰撞的纵深防御,`b_copMatch_elem===null` 已 LIVE 确认。
- **③ 删 13 桥 + cAB 三角 + §1**:桥集差精确 13 删零加(2 平台 + 11 jobseek),终态 11 window 符号;13 符号全树消费者面全 [DEF]/[IMPORT]、零裸读、零显式 window.X 读(agentCancel 仅 [DEF] 只经委派到达;copGo [DEF]+import)—— 唯一到达=委派查表。cAB 三角完美闭合(13 调用点=13 登记项=2 OWN+11 app,零缺零冗);copilot-chrome 平台侧零 jobseek 名。
- **④ 终态(§1 契约化收官)**:业务桥 **18→5** 分类核实准确 —— 2 §1 债末件(showEmptyState/hydrateJobs,settings.js 平台裸读 apps 带 typeof 守卫)+ 3 结构性非业务债(shellReassemble/shellPushAiReadable/openAppManager,index.html SHELL/INIT **跨内联块**消费,内联块间不能 import → 结构性 window 桥)。node×4/tsc 真 0/0 console/11 页;真机按我留痕采信。
- **★§1 第一性原理实质达成(评审语)**:平台层(shell-keys/nav/widget-actions/copilot-chrome)对 apps 符号的裸读**全部经四契约(pageNew/pageActions/widgetActions/cActions)收口**,仅剩 settings.js 2 处;四契约模式贯穿始终、类型层收口。

**cActions 通过(第48轮;§1 契约化 4/4 收官;删 13 桥 18→5;§1 债 5→2 处;契约面 +cActions)。四契约模式贯穿始终。**

---

### 批11B 末件 · settings 2 残留契约化(commit `b3400e7`)· 🏁 第49轮通过(+2 [建议],其一即修)· ★0 业务桥终态 + §1 债清零
**批11B 收官**(四契约后最后 2 处平台裸读 apps 符号)。做完:平台层对 apps 符号裸读**全部收口**、业务桥归零。
- **① hydrateJobs → notifyDataImported 契约(约束② · 与 notifyDataCleared 对称)**:registry +notifyDataImported() 汇总型副作用(遍历**全部已注册应用**含禁用=存在性口径、调 onDataImported、try/catch)逐字镜像 notifyDataCleared;types.d.ts 双声明;manifest `onDataImported:()=>hydrateJobs()`(惰性、export async function 无 eager 读);settings.js 导入回调 `hydrateJobs()` → `SeekerShell.notifyDataImported()`。**零行为**(hydrateJobs 自带 `if(!jobsPersistOn())return`,web no-op、桌面经契约仍调)。
- **② showEmptyState → jobseek data extend 自绑(复用既有 appSettings 契约,无新契约)**:「演示空状态」行原在**平台** settings.js:392 硬编码 showEmptyState → 迁入 jobseek data extend(dataResumeRowHTML 追加该行 + wireDataResumeRow 内 `#setDemoEmpty`→showEmptyState import 词法调用);平台删该行 HTML + 删 `typeof window.showEmptyState` 绑定。**★位置微移**:随 ownership 从平台 data 段中部迁到 jobseek extend 渲染位(与「我的简历」行同块相邻),行为逐字不变、仅 DOM 位置变。
- **删 2 桥(5→3)**:showEmptyState(settings-jobseek import)/hydrateJobs(manifest import + 自身 rt-ready 监听),消费者全 [DEF]/[IMPORT]、平台零裸读。终态 3 桥 = shellReassemble/shellPushAiReadable/openAppManager(index.html SHELL/INIT **跨内联块**、结构性不可 import、**非业务桥**)。
- **★★终态:0 业务桥 + §1 债清零**:apps 桥 **0**;§1 债 2→**0**——全树扫描证 platform/ 下**零 jobseek 业务符号裸读**(shell-keys/nav/widget-actions/copilot-chrome/settings 全经四契约 + 本末件收口)。**§1「platform 与 apps 物理分离、只靠契约通信」第一性原理实质达成。**
- **验**:node×6 / **tsc 真退出码 0**;preview 净方法:契约面(notifyDataImported 是函数、2 桥 undefined);**★showEmptyState**(settings→数据管理 tab→`#setDemoEmpty` 存在且已绑 + 与「我的简历」同块;点击→jobseek 引导态显示);**★notifyDataImported 全链**(stub __TAURI__ 过 jobsPersistOn+stub db:notifyDataImported()→onDataImported→hydrateJobs→list(jobs)→JOBS 重载为导入哨兵;存在性口径证 assets 已注册无 onDataImported→不抛);复位 12 岗位/0 console/11 页/0 残留业务桥;**真机 asset:// boot 重编 5.78s、进程存活、零 panic**(桌面态 jobsPersistOn()=true ⇒ manifest→persistence import + hydrateJobs 为实际路径)。

**★批11B 收官(四契约 pageNew/pageActions/widgetActions/cActions[第45-48轮全过] + settings 残留[本轮]):桥 35→3(业务桥 0)、§1 债清零、契约面 +6(pageNew/pageActions/widgetActions/cActions/notifyDataImported + PageAction/WidgetActionSpec 型)、四契约模式贯穿。** 3.y 账本清空 + §1 契约化全线收官。剩 10d checklist(AGENT_CMDS @ts-check header flip)+ i18n 文案归属债(agentGreet→manifest.greeting)+ 阶段5 + #6 签名公证。

### ★ 第49轮裁定 = 通过 + 2 [建议](均不涉功能,其一即修 commit `6f26775`)· ★§1 第一性原理实质达成
- **① §1 payoff 全面独立核实(整个批11 arc 的收官声称)· 双向阳性对照**:评审用两扫描 × 阳性对照(58f8f05 修复前)验——裸标识符读(tokenizer)+ `window.X` 属性读(grep):当前 platform/ 均 **0**,阳性对照对 58f8f05 分别抓到 `hydrateJobs`@settings:480 与 `window.showEmptyState`@settings:446。**评审诚实记录**:其第一次自写 tokenizer 的 `stripCS` 正则**有 bug 吃掉了 window.showEmptyState**、阳性对照对 58f8f05 没抓到 → 当场暴露盲点,换 grep 可靠法 + 双向阳性对照重做才下结论。合并:platform/ 对 **118 个 jobseek 导出符号零裸读 + 零 window.X 读 + 零反向 import**、index.html 内联块零 jobseek window 读 ⇒ **§1「platform/apps 物理分离、只靠契约」达成**。
- **② 契约 + 迁移**:notifyDataImported ≅ notifyDataCleared 结构同构(both 遍历 `apps` 全部已注册含禁用=存在性口径、非 enabledApps + try/catch);showEmptyState 位置微移**诚实且验证**——LIVE 证「演示空状态」行是「我的简历」行的 `nextElementSibling`(同块相邻)、行为逐字不变。
- **③ 删 2 桥 + 终态**:桥集差精确 2 删、消费者全 [DEF/IMPORT];终态 9 window 符号 = 6 运行时命名空间 + **3 平台结构桥**(评审核实 shellReassemble/shellPushAiReadable/openAppManager **是平台符号、不在 jobseek 导出集**、index.html 跨内联块 → 结构性)。**业务桥 = 0、§1 债 = 0。**
- **④ LIVE**:notifyDataImported 全链(stub __TAURI__+db → onDataImported → hydrateJobs → list(jobs) → JOBS 重载哨兵;存在性口径不抛)+ showEmptyState 路径(#setDemoEmpty 存在已绑+同块相邻→点击引导态)+ 0 console/11 页/字面 onclick 0/复原 12/node×7/tsc 真 0;真机按我留痕采信。
- **★[建议]1(已即修 `6f26775`)· copilot-chrome.js 重复注释块**:第48轮 [建议] 即修(gadget/原型污染表述精确化,**评审判"订正很好、采纳到位"**)时复制粘贴致 `★★不变式(第44轮…` 注释块**逐字出现两次**(40-44+45-49 行)——纯注释、node/tsc 过、零功能影响。**已删重复块**(grep count 2→1、node/tsc 复验)。
- **[建议]2 · 披露完整性**:第48轮 [建议] 顺带在 copilot-chrome.js 应用(第48轮 61b9cdb),送审词宜点明改动面——采纳(以后送审词列全改动文件)。

**★★批11B 收官 · §1 契约化完成 · 第一性原理实质达成(第49轮)。** 平台层对 apps 符号裸读全经契约收口、业务桥归零。

---

### 3.y 尾 · AGENT_CMDS 抽出单列 @ts-check(10d checklist①,commit `8606a70`)· 🏁 第50轮通过
**10d checklist① 收尾**(3.y 类型化最后一项)。AGENT_CMDS 原在 @ts-nocheck 的 copilot-actions.js,`@type {CommandSpec[]}` 只**断言**类型、字面量不受校验 → 漂移被吞(**实证**:删 run / label 元组改单串,tsc 均不报)。
- **为何不整文件 flip**:copilot-actions.js flip @ts-check surface 18 error(全业务逻辑:隐式 any 参数 / SeekerRT/onclick/dataset 运行时全局)= 该文件头注释「类型化留 3.y」所指的业务层大块,非本尾项。**最小**做法 = 纯数据 AGENT_CMDS 抽独立 @ts-check 文件,业务逻辑不动。
- **抽出**:新增 `apps/jobseek/logic/agent-commands.js`(@ts-check 纯数据):13 条 CommandSpec 字面量逐字迁 + `@type`;run 闭包引用 agentSend/copGo(chrome)/copNewJob(copilot-actions)/tt(i18n)全 import 惰性、顶层零 eager 读;**无环**(copilot-actions 移出后不再引用 AGENT_CMDS、不 import agent-commands;agent-commands→copilot-actions 单向)。copilot-actions 删 AGENT_CMDS + 更新注释;manifest 改 import 源;index.html 注释订正。
- **★校验真生效(抽出后 @ts-check 实测漂移)**:漏 run→TS2741；label 元组→单串→TS2322；cmd:number→TS2322(原 @ts-nocheck 全吞)。恢复 tsc 0。
- **验**:node×3/tsc 真 0;preview 净方法:appCommands() 仍 13 条+shape_ok+**same_instance**(manifest 用新模块 export 单实例);**命令 run 全链 LIVE**(/jobs→copGo 跳页；**/add→copNewJob 开录入岗位模态**=唯一 copilot-actions-local 依赖跨模块 import 通、无环破坏；/match→agentSend(tt)→frameQuery→appReply「美团…最该优先」、hasMatchQuery 证 tt 解析);0 console/11 页；真机 asset:// boot 6.14s、进程存活、零 panic。**3.y 类型化尾巴收干净。**

---

### i18n 文案归属债 · greeting 契约(第14轮账,commit `641a7ff`)· 🏁 第50轮通过(+1 [建议] 已即修 `4944586`)
**第14轮文案债收尾**。copilot-chrome 的 agentGreet(`T('agentGreet')`)+ copInit 开场白硬编码 jobseek 味文案(「求职 Agent/Copilot」「匹配岗位、改简历、出面试题」)→ 改经 `SeekerShell.greeting(mode)` 选择型契约归属应用。
- **契约扩展(约束②,选择型 同 appReply/appSuggs)**:types.d.ts +AppManifest.greeting?/SeekerShellApi.greeting;registry +greeting(mode)(enabledApps 首个非空、否则 '')+ api。★信任级:返回**应用自持可信文案**(与旧平台硬编码同级)经 innerHTML 渲染、非用户/AI/不可信输入、无新注入面。
- **迁移**:jobseek copilot-actions.js +jobseekGreeting(mode)(两条求职味开场白逐字迁 tt 双语);manifest `greeting:(mode)=>jobseekGreeting(mode)`。平台 copilot-chrome copInit/agentGreet 改 `SeekerShell.greeting(mode)||T(中性回退)`;平台 i18n agentGreet **改中性**(「嗨,我是你的助手…」不名应用功能)+ 新增 copGreet 中性串(仅作回退);debt 注释更新为「已清」;agentSub/agentPh/cmdLabel 通用助手 UI 串留平台。
- **验**:node×5/tsc 真 0;preview 净方法:契约面 greeting('agent'/'copilot')=jobseek 求职文案;**双面板 LIVE**(copInit=求职 Copilot、切 Agent 模式→agentGreet=求职 Agent 均经契约);**回退 LIVE**(setEnabled('jobseek',false)→greeting('agent')=''→平台落 T('agentGreet') 中性「助手」串、neutral_noJobseek 证平台 i18n 值无求职味);0 console/11 页/真机 boot 5.64s 零 panic。**平台 i18n 只留中性/通用串、jobseek 味随 manifest.greeting。**

### ★ 第50轮裁定 = 两刀均通过(greeting +1 [建议] 已即修 `4944586`)
- **刀一 AGENT_CMDS 通过**:评审**复跑三反证**(漏 run→TS2741@:17 / label 元组→单串→TS2322@:16 / cmd:number→TS2322@:16 全捕),`CommandSpec.run` 确为必填。**评审诚实记录**:其第一次反证 A 替换串没匹配到实际文本(run 没真删)、一度看似"漏 run 未抓",修正后 tsc 确报 TS2741——测试错非代码错(**与我送审时的 drift-1 perl 未匹配同款**)。**★无环独立核实**:agent-commands **仅被 manifest import**(copilot-actions 两处提及是注释非代码),`agent-commands→copilot-actions(copNewJob)` 单向、SCC 内无成员 import agent-commands ⇒ 不成新环;字面量顶层 run 箭头 eval 期不调 import 符号(惰性)→ 零 eager 读 TDZ 安全。LIVE:appCommands 13+shape_ok+same_instance;/jobs→copGo、**/add→copNewJob 开模态不抛**=无环破坏坐实。认可"不整文件 flip"(18 业务 error = 类型化留 3.y 大块、非本尾项)。
- **刀二 greeting 通过**:选择型 ≅ appReply;**回退 LIVE 坐实**(`setEnabled('jobseek',false)`→greeting('agent')===''且('copilot')===''→平台落 T 中性串「你的助手…」、**neutral_noJobseek=true** 证平台 i18n 值零求职/匹配岗位/改简历/面试题;复原求职味回)。信任级认可(应用自持开发者文案走 tt、经 innerHTML、与旧硬编码同级、无新注入面)。
- **★[建议](前瞻,已即修 `4944586`)**:greeting 返回值进 innerHTML;当前 jobseekGreeting 是开发者可信文案安全,但将来若应用把用户/AI 派生内容塞进 greeting 即成注入点 → **把「须应用自持可信文案、不得含用户/AI 派生内容」固化到 `AppManifest.greeting` 类型注释**(同 widgetActions 把红线搬进 types.d.ts 的做法)。**已即修**:types.d.ts greeting 两处注释加 §4-4 契约不变式(innerHTML 无转义、绝不得含用户/AI/RAG/JD 派生内容、需动态先 cEsc);tsc 0。

**★3.y 收尾两刀通过(第50轮)· 3.y 全线收官(第1–50 轮全过审)。** 剩:10d② 真机 desktop-gated persist 写路径;#6 签名公证(用户 Apple 证书=手动);阶段5(已入 ROADMAP、暂不开发)。

---

## 方案评审 · AI-Native 转向(`proposal-agent-native.md`)· 新评审 Agent 首审 · [应改]×1 已采纳 → v2

**定位级方案评审**(非代码刀;新评审 Agent 入职首审,见 docs/reviewer-onboarding.md)。评审代码坐实、抓出结构性 [应改]:
- **★[应改](已采纳,v2 改 B 先行)· 契约 A 开 profile+D3 破口**:v1 §4 称红线映射「全部已有机制、不新造」——**对路线 A(前端工具桥)不成立**。profile 硬隔离/D3 三层闸的强制点是 Rust 结构性闸口(profile 不在 QUERYABLE、query_data.invoke 拿不到 profile、D3 invoke 内二次校验 capability.rs:456);但 A 的 `manifest.tools[].run(input)` 在**前端 JS 执行**、结果直接喂回模型、**绕过 invoke_raw/query_data**,而前端能读 `rt.profile.getAll()`(profile.js:18)→ 存在「app run() 读 profile 或 D3 未授权集 → 回灌模型」新链路。**路线 B(工具=Rust Capability)走同一 invoke_raw、CallCx 无 profile、纳入 QUERYABLE/Permission 纪律,无此破口。** → **裁定 B 先行/混合,A 缓**(A 届时须配前端工具红线:受限无 profile 上下文 + 结果经平台校验,且 ai_chat 扩展/往返原语/profile-D3 前端强制各自独立加倍审)。破坏性部分「收规格不收执行、复用 widgetActions」A/B 均成立。
- **事实订正(v2 已改)**:①aiRun **6 处非 8 处**(match/job-actions/resume-modals/resumes×3);②`Kind` 实为 Tool/Context/Sink、**`Destructive` 是 `Permission` 不是 `Kind`**(capability.rs:26/59);③assets「零连接」限定为 **UI 面**(数据面 assets_prompts/notes 已在 QUERYABLE + aiReadable default-off、D3 通路已铺);④**前端分叉**:自由问答**已接真循环**(streamReply→ai.stream→ai_chat、onTool/onWidget/mcp_confirm 均已接、widget 三墙沙箱已渲染 = v1 低估、P0 近完成)vs **manifest.tools(A)是新造跨界协议**(ai_chat 无 frontend tools 参数、循环内非 MCP 一律 Rust invoke_raw、无「派发前端 run() 喂回」机制 = v1 低估成本)。
- **P0 重排(v2 采纳)**:P0 = 窗口收敛 + show_widget 投画布(当前内联 thinkBubble.parentElement、需改投 data-agent='split' 画布)+ **用 B 落 1–2 真工具打样**;Q&A 真循环不单列、manifest.tools 移出 P0。
- **§7 预裁(v2 记入)**:窗口收敛/删「编辑器」并列模式(appMode 默认 editor=页面工作台视图非富文本)= 可先行;A/B=B 先行;**assets 归属拆两半**(能力管理 UI 归 platform 壳管理面非 app[否则违 §1] + notes/prompts 数据迁平台能力 + assets 退役)= 建议 P1 起单出小方案。
- **P1 绿地订正**:Connector(MCP mcp.rs 已建)先落;Skills/Project/Scheduled **后端零基础=全绿地**(Kind 仅 Tool/Context/Sink、Sink dead_code),勿套「已建」光环。

**方案 v2 已修订提交(评审 [应改] 采纳);待用户拍板 §7 四点后 P0 起刀。** 评审留两个可展开子方案(A 前端工具红线强制 / 能力中心 platform-vs-app 归属)——均 P1 可延,不阻塞 P0 拍板。

**用户拍板(2026-07-08)**:按预裁拍 P0 · B 先行 · 起刀窗口收敛;三细节(默认 centered 对话居中/画布按需 · Copilot 浮窗彻底删 ⌘K→Agent · 旧 cop 历史弃用统一到 agent)全选推荐。窗口收敛拆两刀(1a Agent 默认框 / 1b 删浮窗)。

---

## P0 · AI-Native 主线 · 窗口收敛

### Cut 1a · Agent 成默认唯一框 + 删「编辑器」模式(commit `1b849b1`)· ⏳ 待审
**P0 首刀**(reviewer §7.3 预裁低危)。让 Agent 窗口成默认唯一 AI 框、删并列的「编辑器/页面工作台」模式。
- **改动(3 文件 +9/−6)**:index.html 删 `#modeSwitch` DOM(renderModeSwitch 因 `if(!ms)return` 自动 no-op);copilot-chrome `appMode` 默认 editor→**agent** + agentInit boot 直接进 **agent+centered**(设 data-appmode/data-agent + agentGreet、不再读写 jh-mode、不经 setAppMode);shell-keys ⌘K 直接聚焦 Agent 输入(去 copToggle 分支)+ 删 Mod+\「切换 Agent/编辑器」键。
- **布局(CSS 两态本就存在、不新造)**:boot=agent+centered=全屏对话(#content 隐、cop-launch 隐);导航→go→agentShowCanvas→**split**(左对话+右 #content 页面即画布);⤜收起画布→agentCollapse→centered。
- **收敛后残留(1b 清)**:Copilot 浮窗(copLaunch/copPanel)物理仍在但 agent 模式 `display:none` + 无 editor 入口 = 不可达死元素;setAppMode/renderModeSwitch/copInit/copSend/copOpen/copClose/copAppend 成死导出。
- **验**:node×2/tsc 真 0;preview 净方法 LIVE **boot 态**(appmode=agent/agent=centered/agentChat flex/content none/copLaunch none/modeSwitch 不存在/**恰 1 条求职 Agent 招呼语**/11 页)+ **功能链**(导航 jobs→data-agent=split+content block+page-jobs active 12 行=页面成右画布+chat 仍左;⤜收起→centered;agentInput 发送→追加);0 console;**真机 asset:// boot 6.14s、进程存活、零 panic**。**下一刀 1b:删 Copilot 浮窗 DOM + 收敛发送/历史/死导出到 agent。**

### Cut 1b · 删 Copilot 浮窗 + 收敛发送/历史/死导出到 Agent(commit `6df8ac2`)· ⏳ 待审
**窗口收敛第二刀**(用户拍板:浮窗彻底删、⌘K→Agent、旧 cop 历史弃用)。删 Copilot 浮窗(1a 后已不可达死元素)+ 彻底收敛到 Agent = 单一 AI 面。
- **改动(4 文件 +22/−67 净删 45 行)**:index.html 删 cop-launch+cop-panel DOM + copInit 调用/import;copilot-chrome 删 copEl/copOpen/copToggle/copAppend/copSend/copInit + **死导出 renderModeSwitch/setAppMode**(1a 后零消费者)、copClose 神经元化 no-op + copScroll 改滚 #agentMsgs(保这两薄导出免改 jobseek 8+1 调用点)、copGo 去 copClose 只 go、agentChat 恒 agentAppend、cSuggs 委派 copSend→**agentSend**、hydrateMessages 只恢复 agent 历史;shell-keys 删 Esc 浮窗腿 + split 收起腿去 getAppMode + import 精简;nav 删 renderModeSwitch import+调用。
- **★import↔export 完整性(ruling④ module link 死判据)**:20 个从 copilot-chrome import 的符号全部仍 export、**缺失 0**;8 删除函数全树 CODE 引用 **0**(剥注释/字符串扫描)。
- **验**:node×3/tsc 真 0;preview 净方法(定向重验 4 文件)· **正向断言主证(证 module 全跑完无 link 死)**:11 页 + 契约面 6 齐 + 11 卡 + boot 态(appmode=agent/agent=centered/**恰 1 求职 Agent 招呼语**/Copilot 浮窗+启动器+模式切换 DOM 全无);**功能链 LIVE**(agentInput 发送 / #agentCmds 技能 chip[data-cmd→agentSend] / cSuggs 委派[data-csugg→agentSend] / copGo[CACT→go→split] / **copMatch**[CACT→copClose no-op+go('match')+renderMatch 页面渲染] / ⤜收起→centered);0 console;**真机 asset:// boot 6.76s、进程存活、零 panic**。
- **残留(后续 P0)**:greeting('copilot')/copGreet 现无消费者(留契约完整性、可后清);.cop-panel/.cop-launch CSS 类未删(死样式无害)。

**★P0 窗口收敛收官(Cut 1a+1b)**:两个 AI 面板 + 模式切换 → **单一 Agent 窗口**(左对话 + 右画布按需)。下一步 P0:show_widget 输出从对话内联改投画布 + 用 B 落 1–2 真工具打样。

### Cut 2 · show_widget 输出投画布(commit `ab47bc2`)· ⏳ 待审
**P0 第三刀**。窗口收敛后,show_widget 沙箱组件从对话内联(`thinkBubble.parentElement`=#agentMsgs)改投**右画布**(#agentCanvas)。
- **改动(4 文件 +24/−2)**:index.html 加 #agentCanvas 宿主(acv-head「回到页面」+ #agentCanvasBody)+ CSS(`data-canvas=widget` 显画布替代 #content 页面 / `page` 让位 / centered 皆隐);ai-engine.js `streamReply.onWidget`:renderWidget→#agentCanvasBody + 设 `data-canvas=widget`+`data-agent=split`(**直设 dataset 免 import agentShowCanvas 造 ai-engine⇄copilot-chrome 环**),兜底无画布容器仍内联;nav.js `go` 设 `data-canvas=page`(导航回页面视图);copilot-chrome agentInit 接线 #acvBackToPage→page。
- **★红线不变**:renderWidget 未动 → **三墙沙箱保留**(iframe sandbox=allow-scripts + srcDoc CSP default-src none + 端口零信任);LIVE 证 iframe sandbox='allow-scripts' + widget 卡 SANDBOXED 标注。
- **验**:node×3/tsc 真 0;preview 净方法 · **★模拟 widget(renderWidget→append canvasBody+设 dataset,等价 onWidget 逻辑)**:widget 在**画布**(#agentCanvasBody .widget-card)、**不在对话**(#agentMsgs 0 widget)、画布显 #content 隐、iframe sandbox=allow-scripts;导航→data-canvas=page+#content 显+画布隐;「回到页面」→page 复显;boot #agentCanvas 隐(centered);截图证左对话+右画布沙箱 widget;0 console;真机 asset:// boot 6.37s、进程存活、零 panic。（注:web 态 aiChatAvailable=false、真 onWidget 不自然触发 → 以等价模拟 + DOM/CSS 切换验;真 onWidget 路径待桌面接真模型时覆盖。）

**★P0 窗口收敛 arc(1a+1b+2)**:单一 Agent 窗口 · 左对话 + 右画布(页面/widget 按需切)。**剩 P0 末件:用 B(Rust Capability)落 1–2 真工具打样**(让「一句话完成一件事」经真工具循环跑出结果)。

### P0 末件 · jobseek 真工具打样(路线 B:工具=Rust Capability · commit `15f11eb`)· ⏳ 待审
**P0 收官件**(reviewer 抓的结构性 [应改] 落地:工具走 Rust 而非前端桥,红线净)。让 jobseek「市场价值估算」从 intake-action 的 `aiRun` 演出(脚本步 + 罐头结果),变成一枚经**真工具循环**跑出结果的 Rust Capability——模型请求 → `invoke_raw` → `Output::Widget` → 投画布(接 Cut 2)。
- **新增 src-tauri/src/jobseek.rs · MarketValue(`Kind::Tool`,`Permission::Db` 只读、无 Destructive)**:
  - **D3 三层闸双点复用(能力层强制、非仅提示)**:`available` 与 `invoke` 各自 `readable_set(cx).contains("skills")`——schema 上架只是给模型的提示,`invoke` 二次硬校验(即便模型越界发串仍被独立硬拦,与 DataQuery 同纪律)。
  - **profile 结构性不可达**:走 `CallCx`(无 profile 字段)+ `with_db` 只读 skills 集合;对比路线 A(前端 `manifest.tools[].run()` 能读 `rt.profile.getAll()`)**无 profile/D3 破口**——正是 reviewer [应改] 的落点。
  - **数据驱动**(非罐头):读 skills → `mid = 20 + Σ(lvl×1.6)`、low=mid×0.88、high=mid×1.16、top-5 技能 chips(打样公式,非真实定价模型)。
  - **§4-4 纵深防御**:技能名(用户数据)进 HTML 前逐字 `html_escape`(&<>");终渲染仍在 Cut 2 的三墙沙箱。
- **capability.rs**:注册 MarketValue;`gen_widget_id`/`readable_set` 提 `pub(crate)` 供本能力复用;装配测试 4→5 caps + 断言 `jobseek_market_value` schema.name/kind。**lib.rs**:`mod jobseek`。
- **★§1 权衡记账(打样级,已拍板 2026-07-09)**:jobseek 业务进平台 Rust 与 §1「platform 业务无关」有张力。**换来红线净**(同一 invoke_raw 统一闸 / CallCx 无 profile / 纳 D3+Permission 纪律);Rust 侧无 apps 概念,暂以 `jobseek_` 前缀显式标注归属。**正式 app-tool 契约**(apps 声明工具 · 隔离上下文执行 · 结果经平台校验)待 P0 之后设计,届时本模块迁走(模块头已记)。
- **验**:`cargo test` **84 passed / 0 failed**(新单测:估算随技能数据变 + 注入面 `<img onerror>`→`&lt;img` 转义;5-caps 装配 + schema/kind 断言);`cargo clippy` 净;`cargo fmt` 净;**真机 WKWebView 3.56s boot 零 panic**(能力注册不破启动、进程存活)。**端到端(模型请求本工具 → invoke → 画布)需桌面 + 用户 BYO 模型**——web 态 `aiChatAvailable=false`、`rt.capability.invoke`=NotImplemented,故本轮验 = Rust 单测(逻辑+转义)+ 装配测(5 caps)+ 全绿 84 + 真机 boot;**模型驱动路径留用户桌面覆盖**(与 Cut 2 同款诚实边界)。

**★P0 arc 收官(窗口收敛 1a+1b+2 + 真工具打样)**:单一 Agent 窗口 · 一句话经真工具循环出结果投画布 · 红线走 Rust 结构性闸。**下一步 P1(评审留两子方案可展开)**:能力中心(Skills/Connector/Project/Scheduled 管理,Connector-MCP 最薄先落)+ jobseek 真化(6 处 aiRun→真工具)+ notes→记忆/知识库 + prompts→Skills。

### ★ 第51轮独立复核 = 🏁 通过 + 3 [建议](已逐条落地 commit `4348121`)
**复核 Agent 未采信送审词、自跑核实**:`cargo fmt --check` exit 0 · `cargo test` 84/0(点名复跑 `market_value_is_data_driven_and_escapes` + `capabilities_expose_expected_tool_schemas` 确非静默缺席)· `cargo clippy -D warnings` 无告警。三处「请盯」逐条通过:①§1 权衡账属实 + 出口标记充分(模块头 + `jobseek_` 前缀 + `pub(crate)` 未越权公开)+ 用户已拍板;②D3 **实为三重**(`tool_schemas` 按 available 过滤上架 capability.rs:198 + `invoke_raw` 执行前再验 :234 + `invoke` 体内验;送审「双点」低报)+ `parameters:{}` 无 enum 软肋(比 DataQuery 更收紧);③profile **结构性不可达**(`CallCx` 只有 `app` 字段 :121 + `invoke` 硬编码 `list_records("skills")` 忽略 `_input` → 模型导不向别集合、够不到 profile = 上轮 [应改] 核心兑现)。复核另确认无虞:转义完备(`html_escape` 略 `'` 但技能名落**文本位**非属性,`<&>` 足;终渲三墙沙箱)· 信任模型不破(MarketValue 绕 ShowWidget 的 `sanitize_widget_html`,但 `renderWidget` 对**所有来源**一律 iframe sandbox + CSP,不因来源放松)· 无 panic 面(空技能→基线 18–23、`take(5)` 空安全、用户数据全 `and_then/unwrap_or`)。验证边界(端到端待桌面+BYO 模型)采信,契约面结构闭合。

**exec 独立回核评审两处载重论断(不采信送审词、代码坐实)**:①**三重闸属实**——capability.rs:198 tool_schemas 过滤 + :234 `if !cap.available(cx).is_ready()` 执行前再验,双证;②**信任模型不破属实**——[render.js:180/186](web/platform/capability/widgets/render.js#L180) `renderWidget` 无条件 `sandbox='allow-scripts'` + `srcdoc=buildSrcDoc`(CSP default-src none)、标题 `textContent`,**无可信来源旁路**;③**locale 确为前端态**——`localStorage 'jh-lang'`([shell-boot.js:13](web/platform/shell/shell-boot.js#L13) / [settings.js:419](web/platform/shell/settings.js#L419)),Rust 结构上够不到 ⇒ [建议]1 的正解只能是 P1(呈现移回前端 / 传 locale),Rust 侧硬塞 i18n 会深化 §1 债 → 佐证「defer + 记债」是对的落法、非偷懒。

**三条 [建议] 落地(commit `4348121`,无逻辑改动)**:
- **[建议]1(红线#6 i18n 债,打样带、产品化前必消)** —— `build_market_value_html` UI 文案硬编码中文、无英文路径,与全 app `tt()/L()/T()` 双语纪律不一致。**根因 locale 前端态、Rust 够不到 → 打样阶段无法自本地化**。**落法:显式记债**(jobseek.rs `build_market_value_html` fn 文档注释 + 本条 + proposal §4 + memory),**正解 = app-tool 契约把呈现移回前端(工具只回结构化数据、前端 tt 渲染)或经 CallCx 传 locale**,二者皆 P1;**不在 Rust 侧硬塞 i18n**(会深化 §1/呈现债,与 [建议]2 相悖)。与「路线 B 封顶」同一出口:契约落地即消。
- **[建议]2(防打样蔓延)** —— **路线 B 封顶一枚**:jobseek.rs 模块头 + proposal §4 明记「app-tool 契约落地前,不新增 `src-tauri/src/<app>.rs` 应用工具;第二枚起必须等契约」,免打样静默变事实模式、§1 债累积。
- **[建议]3(估值产品诚实,轻)** —— 卡片「综合估算 · 年包」→「参考区间 · 年包(示意)」;正文加「示意性参考(打样公式,非真实定价模型;仅供参考、勿作决策依据)」,不把打样公式的具体区间呈现为权威定价(暖橙非红、不破反焦虑)。
- **验**:cargo test 84/0(jobseek 单测新文案下仍绿,`<b>{n}</b>`/`万 / 年`/`&lt;img`/`Go · L4` 断言全在)· clippy 净 · fmt 净 · 真机 3.50s boot 零 panic。**待复核 Agent 验收闭环(尤其 #6 记债充分性)。**

### ★ 第52轮复核验收 = 🏁 三条 [建议] 全闭环通过 · P0 arc 末件收官
复核 Agent 独立再跑(代码变=必重跑):fmt exit 0 · test 84/0(点名 `market_value_is_data_driven_and_escapes` 新文案下仍绿)· clippy 无告警。**[建议]1 裁定「defer + 显式记债是对的落法」**——复核坐实 locale 前端态(grep `lang`/`locale` 于 ai.rs/config.rs/capability.rs **零命中**、`ai_chat` 签名无 locale、`CallCx` 只有 app)⇒ Rust 侧硬修 #6 需新 plumbing(=P1)或建 Rust tt 表(=深化「呈现进 Rust」债),**「当场修」是拿已追踪 i18n 债换更糟架构债 = 坏交易**;#6 以两点守住(本工具端到端未验/未进出货路径 + 债记在 proposal §4 决策durable处锚定 P1 出口)。[建议]2 封顶措辞够硬(三要素齐,未来 PR 加 `app2.rs` 会正面撞条);[建议]3 去权威化清晰、反焦虑不破。**注**:复核确认 jobseek 注册在 capability.rs:181 使原 197/233 后移一行→198/234(exec 与复核行号均对、读的是移位前后)。**★P0 arc(窗口收敛 1a+1b+2 + 真工具打样 + 三 [建议])全线闭环。**

---

## P1 主线 · 能力中心方案(`proposal-p1-capability-center.md`)· 第53轮方案评审 · 有条件通过 → v2

**定位/方案级评审**(非代码刀;承 agent-native §7.4「P1 起单出小方案再拍」)。评审代码坐实、抓出你 #2「读路径暴露边界」软肋 = 真实结构缺口(类比但轻于 route-A profile 破口)。**裁定=有条件通过**,拍板前须补 1 红线 + 订正 1 成本表述。exec 已 v2 整合四点(commit 见下)。
- **★[应改]A(载重,已采纳)· 读路径暴露边界未定义 → 会把 MCP 端点/本地命令泄给模型**:`mcp_list` 今天**零模型消费者**(仅 settings.js:174/197 前端 + desktop.js:193 绑定);其返回体含 **`url`/`command`/`args`**([mcp.rs:890-892](src-tauri/src/mcp.rs#L890),exec 已坐实)。P1-a 若读路径图省事复用 `mcp_list` 喂模型 → 用户 MCP 端点 + 本地 stdio 命令进(多为远程第三方)BYO 模型上下文 = 拓扑泄露、违本地优先 §4-1。**严重度低于 route-A**(auth/env 已状态-only `configured/empty` mcp.rs:886、非密钥值,exec 已坐实)但结构缺口须**编码读路径前**钉死。**修法(同 D3 静态硬底纪律)**:模型侧读路径只走**静态最小投影** `name+status+工具名/描述`(镜像 `tool_descriptors` 已见面 [ai.rs:432-435](src-tauri/src/ai.rs#L432),exec 坐实模型已免费持工具名)、**显式排除 url/command/args/auth/env/配置**;§7 增该红线。→ v2 并入 §2 新 bullet + §7 新红线 + §6 P1-a「读投影先行」。
- **★[应改]B(已采纳)· 「零新后端」对读路径低报**:管理视图复用 mcp_list=零新后端✓;但模型侧「Agent 直接列举」隐含数据进模型上下文 → (a) 新增列举能力=新后端(矛盾)或 (b) 纯前端=模型没参与(与措辞矛盾)。**honest 拆法**:模型**已免费持工具清单**(tool_descriptors)→「我能做什么」零后端零暴露;**仅** connector 级状态(工具清单外)需新面(投影 or 前端,二选一)。→ v2 §3 成本三分,不一把「零新后端」盖。
- **[建议]C(已采纳)· 列工具会显 `jobseek_market_value`(route-B 打样债外溢、非新破)**:列工具=读 cap_list/registry=**平台读平台无 import**(exec #1 判断坐实正确);但 registry 含 route-B 打样工具(capability.rs:181)→ 显为平台能力(第52轮已记债)。→ v2 §3 注:工具枚举永经 registry/契约、**app-tool 契约迁移时「列工具」须同步更新**(否则列不全或被迫 import app)。
- **[建议]D(已采纳)· assets 退役卡 Skills 绿地(拆分隐藏耦合)**:notes 可迁(后端已建),prompts→Skills 迁不走(Skills 零后端)⇒ assets 无法一次性退役。→ v2 §5 注排序耦合:完整退役(P2)须等 Skills 后端,P2 勿假设一次性退役。
- **评审确认扎实(非发现)**:#4 绿地诚实=HONEST(Kind 仅 Tool/Context/Sink、Sink dead_code、Scheduled/Skills/Project grep 空、未套已建光环)· #1 归属正确(平台壳、cap_list 是前端命令非模型工具、5 caps 无列举 connector 者)· 写路径红线复用不新造(auth/env 状态-only、密钥进钥匙串、MCP Untrusted 专路 ai.rs:548)· profile 不受影响。
- **§8 四待拍板 · 评审裁决建议**:①P1=a+b+c **认同**(附条件 P1-a 先落 [应改]A、不纳 Skills 雏形);②Connector 先落 **认同**(落码序按后端存否、列表序是欲求优先级);③读/写界 **认同是对的平衡**(以 [应改]A 有界投影为前提、写侧不放宽);④已外审。
- **exec 独立坐实评审两载重事实(不采信送审词)**:`mcp_list` 返回体确含 url/command/args([mcp.rs:890-892](src-tauri/src/mcp.rs#L890));`tool_descriptors` 确已把工具名/server/描述/schema 喂模型([ai.rs:432-435](src-tauri/src/ai.rs#L432))但**不含** url/command/args ⇒ [应改]A 的投影边界正是「模型已见面」、[应改]B 的「免费持工具清单」成立。**报告两 [应改] 均属实,已 v2 全整合。**

**★方案 v2 已提交(评审 [应改]A/B + [建议]C/D 全采纳);待用户拍板 §8 三点 → 起 P1-a(读投影先行、复核比照 D3)。**

**用户拍板(2026-07-09)**:P1 = a+b+c(能力中心框 + Connector 先落 + 记忆/知识库薄视图);Connector 先落(有后端的先);读/写界严守 §4-2。起 P1-a。

### P1-a · 能力中心平台壳视图(只读总览 + 归属 + 入口)· commit `e8f1973` · ⏳ 待审
**P1 首刀**。能力中心 = 平台壳导航页(**非 app**,§1),照**设置页 setShell 先例**(非 app-manager modal)注册,显示在 Agent 窗口右画布(P0 收敛保留)。
- **改动(2 文件,新增 1 模块 + index.html +6/−1)**:新增 `web/platform/shell/capability-center.js` 的 `renderCapabilityCenter()`——聚合「给人看」五域(Connector/工具·能力/长期记忆/知识库/绿地占位);逐域异步 `rt.*.list()`、一域失败只降级本域(try/catch)。index.html:import + setShell `pages` 加 `capability` 条(system 组、置设置前);`buildNav/buildPages/go` 泛化消费**零改动**、`go` 天然 `data-canvas='page'` 显于 `#content`。
- **★读/写界守界(§4-2 + [应改]A · 本刀落点)**:本页是**前端「给人看」视图**——读 `rt.*.list()` 渲染进 DOM、**永不喂模型**;端点/命令/密钥只在此 UI 呈现给用户、**绝不进模型上下文**。**故本刀不触发 [应改]A 的投影**(无模型侧读路径;模型侧读若将来做须走 §7 新红线的静态最小投影)。写(配置/密钥/启停)走管理面、不经对话;页顶 lock-note 向用户显式声明此界。**[建议]C 落**:工具枚举读 `cap_list`=平台读平台无 import(registry 含 route-B 打样 `jobseek_market_value`、如实显示)。深度管理(Connector 提一等公民、记忆/知识库查删)= P1-b/c。
- **红线#6**:全文案走 `tt()` 双语——**与 jobseek Rust 打样的 CN-only 对照**(前端有 tt()、locale 前端态可达)。
- **验**:node --check 净;preview 净方法**正向断言 LIVE**——nav 项(能/能力中心/Capabilities)+ 页注册 + 导航 `data-canvas=page` + frontis + lock-note + 五域正确渲染(web 降级:连接器/记忆/知识库空态、工具「桌面端可用」经 notImpl try/catch、绿地规划中);**EN 全切换无 CN 残留(#6 坐实)**;截图证 Agent 窗口左对话+右能力中心页、house 设计(衬线斜体标题+暖橙句号、mono eyebrow);真机 WKWebView 6.36s boot 零 panic、进程存活。**桌面真数据(5 caps 含 jobseek_market_value / 真连接器 / 记忆文档计数)经同一 rt→command plumbing,web 验结构+降级、真数据待桌面覆盖。**
- **下一步 P1-b**:Connector-MCP 从 settings.js 抽出、提为能力中心一等公民(复用 mcp_*;若加模型侧 connector 状态读,须落 [应改]A 静态投影 + 复核比照 D3)。

### ★ 第54轮独立复核 = 🏁 通过 + 1 [建议](轻,已落 commit `8392534`)
- **★★#2 读/写界裁决(本轮核心 · standing)**:评审逐条追踪五个 `rt.*.list()`([capability-center.js:68/84/95/101/108](web/platform/shell/capability-center.js#L68))**全部只流向 `box.innerHTML`**([:59](web/platform/shell/capability-center.js#L59));模块 import 仅 `$/tt/frontis/signFoot`——**无 rt.ai、无 stream、无 ai_chat、无工具注册、无系统提示 ⇒ 结构上无路可达模型**。裁定:**「P1-a 不做模型侧读、把 [应改]A 推迟到 P1-b」是守界不是回避** —— [应改]A 约束的是**模型侧**读路径的投影,P1-a 根本没建该路径,**触发条件未出现**;这是「零模型暴露靠**结构性缺席**达成」= **最强形态的守界**(同 profile 经 `CallCx` 结构不可达的守法),而非「欠一个必修的修复」。
- **★★follow-through 义务(P1-b 到期项 · 勿忘)**:页顶 lock-note([:37-40](web/platform/shell/capability-center.js#L37))把边界**印成用户可见承诺**(「AI 只能看到有哪些工具、各自做什么,连接端点、命令、密钥永不进入 AI」)。评审核实此承诺**今天为真**(模型经 `tool_descriptors` 只见 server 名+工具名+描述+schema,无 url/command/key)。**⇒ 这把 [应改]A 升格为「印刷承诺」:P1-b 的静态最小投影绝不得含端点/命令/密钥,否则打脸此承诺。**
- **逐条坐实(评审)**:①**§1 归属正确**——import 零 app、setShell 注册同设置页先例、`buildNav/buildPages/go` 零改动泛化消费;②**[建议]C 处置妥**——`capability.list()`→`cap_list` 平台读平台无 import,`cEsc(c.id)` 如实显示 `jobseek_market_value` 为平台能力 = **透明化(债可见、契约迁移即解)**,非新破;③**#6 守住**——CJK-outside-tt 扫描只命中注释行,eyebrows(`CONNECTOR · MCP`/`TOOLS`…)是 §4-5 Mono 大写设计标签、跨语恒定非漏译;④**import/载序净**——`frontis`/`signFoot` 均 export、`renderCapabilityCenter` 是惰性 render thunk(setShell 只 push 不 call)、`rt=()=>window.SeekerRT` 惰性 ⇒ 无 parse-time/TDZ;叶子模块无环;⑤**★评审对抗性检查(exec 未做,补上了真空)**——`try/catch` 可能**掩盖桌面 namespace typo**(exec 只验 web、这类错本不会暴露),故专查四个运行时命名空间:`capability.list`→cap_list([desktop.js:165](web/platform/runtime/desktop.js#L165))/ `memory.list`→memory_list(:174)/ `docs.list`→doc_list(:183)/ `mcp.list`→mcp_list(:193)**全部对得上、无拼写错被降级掩盖**;⑥**附带好防御**——连接失败只渲染泛化「连接失败/Failed」([:73-74](web/platform/shell/capability-center.js#L73))、**不渲染 `s.error` 文本**,避免 MCP server 错误体(可能含 Untrusted 内容/敏感细节)进 DOM。
- **[建议](轻,前瞻非活缺口)· bespoke `esc` → 平台 `cEsc`(已落 `8392534`)**:本地 `esc` 只转 `&<>`、**漏 `"`**,是继平台 `cEsc`(`&<>"`)、jobseek.rs `html_escape`(`&<>"`)之后**第三个各异的转义器**。今天安全(两处均落**文本内容位**、非属性),失败场景=将来挪进双引号属性即成注入缺口。**落法**:删本地 `esc`,import 平台 `cEsc`([copilot-chrome.js:21](web/platform/shell/copilot-chrome.js#L21)),两调用点改 `cEsc`。
  - **★exec 载序核实(standing ruling ②:import 边=第二种载序移动机制)**:copilot-chrome **已在 capability-center 传递图内**(`nav.js:6` import 它、capability-center import nav)⇒ 新增直接边**零求值序移动**;且 copilot-chrome 确有 eager 顶层副作用(`document.addEventListener`@:51)——正因如此必须核实,结论零风险。无环;且 10 个 jobseek 模块本就如此 import cEsc = 既有惯例。
  - **验**:node 净、bespoke `esc` 调用点 0;preview **正向断言**(nav 项/页注册/data-canvas=page/lock-note/五域齐/`#agentMsgs` 在=copilot-chrome chrome 未被打乱/appmode=agent ⇒ **无 import link 死**);**对抗性核实**:①注入恶意连接器名 `<img src=x onerror=…>"evil` → **无 img 元素、无 raw `<img`、未执行**、渲染为字面文本;②**真模块 cEsc 直测**(同 URL 动态 import 取 memoize 实例、无 `?bust=` 免第二实例)—— 转 `"`→`&quot;` 与 `<>&`,且其输出置入 `title="…"` **不越狱**(无注入属性、未执行、title 精确回环)= **[建议] 所指前瞻场景已闭合**;真机 8.43s boot 零 panic。
  - **exec 自我订正**:首版一条断言设计有误(读回 `innerHTML` 查 `&quot;`)——**文本节点序列化本就不转义 `"`,该断言证不了转义器**;已改为直测 cEsc + 属性位越狱测试。

**★P1-a 收官(通过 + [建议] 已落)。下一步 P1-b:Connector-MCP 提一等公民** —— 若引入模型侧 connector 状态读,**[应改]A 静态最小投影即到期**(须挡住 url/command/env,兑现 lock-note 印刷承诺);评审届时比照 D3:拿投影函数做正向断言 + 对抗性核实模型上下文里到底有什么。

**用户拍板(2026-07-09)**:**P1-b 只做搬迁、不碰模型侧** ⇒ 零模型暴露继续靠结构性缺席守住,[应改]A **不到期**,lock-note 印刷承诺不被打脸。

### P1-b · Connector(MCP)从设置模态搬迁、提为一等公民内联视图 · commit `9641945` · ⏳ 待审
**红线承载刀**(密钥→钥匙串 / guardrail 删除 / 知情同意 / 属性位转义)。连接器管理不再埋在设置页深处的模态,成为能力中心里的一等公民视图。**零新后端**(复用 `rt.mcp.*`)。
- **改动(3 文件,+13/−198 净删 185 行)**:新增 `connectors.js` 的 `renderConnectors(box)`——由 `settings.js` 的 module-private 模态 `openMcpManager`(146-322)搬迁,**模态外壳 → 内联宿主,逻辑逐字保留**(增删启停/令牌/env/测试连接/传输模式切换);`capability-center.js` 的 Connector 段:只读总览 → 调 `renderConnectors`;`settings.js` 删 `openMcpManager`(**179 行,含其 2 个 bespoke 转义器 `esc`/`escA`;escA 9 处全在块内,已断言核实**),「扩展 · MCP 工具」→「扩展 · 连接器」**指路行**(`#mgrMcp`→`go('capability')`,保知情同意文案 + 老用户发现性)。
- **★红线逐字保留**:①**密钥(§4-2)**——令牌/env 值只经 `rt.mcp.setAuth`/`setEnv` **直送系统钥匙串**,前端只见 `configured/empty`、绝不持明文(列表只渲染 `authConfigured` 与 `envConfigured[].status`;token 输入 `password`+`autocomplete=off`);②**破坏性(§4-3)**——删除走 `platform/guardrail` `confirmDestructive`;③**知情同意(§4-4)**——本地=在本机跑程序/远程=连你填的端点、只加可信来源、AI 每次调用先问你、返回内容当不可信数据;④**转义**——两个 bespoke `esc`/`escA` → **平台唯一 `cEsc`(`&<>"`)**,含 `data-*` **属性位**(承第54轮 [建议];原 escA 正是为属性位而设,cEsc 是其超集)。
- **★读/写界不变**:本视图仍是「给人看」前端面 —— 端点/命令/密钥状态只呈现给**用户**、**永不进模型上下文** ⇒ **[应改]A 静态最小投影仍不到期**,零模型暴露继续靠**结构性缺席**守住(兑现 lock-note 印刷承诺)。
- **★请评审裁的一处判断(exec 主动提请)· `s.error` 呈现**:第54轮评审曾把「capability-center **不**渲染 `s.error`」列为「附带发现的好防御」(避免 MCP 错误体=外部不可信内容进 DOM)。但**原设置页模态本就渲染 `esc(s.error)`**(便于用户排错)。本刀作为**忠实搬迁**,**保留了该呈现**(改用 `cEsc` 转义)。取舍:转义后无 XSS(已对抗验证 `<script>` 惰性)、永不进模型、且删掉会**静默劣化用户排错能力**(非零逻辑改动)。**请裁**:保留(现状)是否妥?还是应按 §4-4「外部内容标注 Untrusted」再加视觉标注?(后者是逻辑改动,故未自行扩范围。)
- **验**:node×3 净;**import/export 完整性(ruling④)**全解析、`openMcpManager`/`escA` 残留 0、`IC`/`openModal` 仍在用(非死 import)。preview 净方法 · **正向断言**(管理表单 + 模式切换×2 + 知情同意 lock-note + 列表容器 + token=password/autocomplete=off + **其余四域仍在=无 import link 死**;设置页删 179 行后**仍渲染**、指路行→`go('capability')` 落地即见管理面、**无旧模态**);**★对抗性核实**:①恶意 server 名**同落 text 位与 `data-*` 属性位** → **无 `[onmouseover]` 越狱**、`data-mcpdel`/`data-cn`/`data-cv` **精确回环**(证 cEsc 替换 escA 忠实且安全)、command 的 `<img onerror>` 与 error 的 `<script>` **全惰性**、无 img/script 元素;②**删除红线** → guardrail **被咨询**、确认前 `rt.mcp.remove` **未被调用**、`onConfirm` 后才调。0 console;截图证一等公民管理面 + 注入载荷渲染为惰性字面文本;**真机 WKWebView 6.13s boot 零 panic**。
- **诚实边界**:web 端 `rt.mcp.*` 降级(list→[]、add/probe→notImpl),故**真连接器增删/钥匙串写入路径待桌面覆盖**;本轮红线以「桩 + 对抗性断言」验证契约面(guardrail 咨询序、密钥不回显、转义),真钥匙串落地由既有 `mcp_set_auth` 后端保证(未改)。
- **下一步 P1-c**:记忆 + 知识库薄视图(已有后端 `memory_*`/`doc_*`)。

### ★ 第55轮独立复核 = 有条件通过 → [应改] 已落 `1844293` → 收官
- **★[应改](本刀唯一实质项,已落)· toast 三处把原始用户数据喂 HTML sink,证伪 cut 自述的安全不变式**:
  - **链路(exec 独立坐实)**:`toast(msg)` → ``el(`<div class="toast">${msg}</div>`)``([toast.js:9](web/platform/shell/toast.js#L9))→ `el(h){template.innerHTML=h}`([dom.js:9](web/platform/shell/dom.js#L9))⇒ **解析 HTML、无内部转义**(`errText` 之所以存在 = 第25轮 [应改])。三处拼裸值:`:199 toast('已添加 '+name)` / `:169`·`:175 toast(…+varName)`。
  - **失败场景**:连接器名 `<img src=x onerror=…>` → toast 解析 → `onerror` 在**顶层应用上下文**执行(可及 `rt` / 钥匙串命令 / DOM)= **自 XSS**。
  - **★定级(评审诚实,exec 认同)**:**非回归** —— 父提交 `openMcpManager` 逐字同款(旧 :150/:123/:129),忠实搬迁把旧缺口一并搬来,「零逻辑改动」mandate 未破;**但 cut 在模块头自述了一条被这 3 行证伪的安全不变式**(「用户数据**一律**经 cEsc 进 DOM」)。**安全刀声明假不变式会误导后续作者在其上加码 —— 纠正过度声称正是外审职责**,故必须收口而非以「非回归」搪塞。自 XSS 边界:连接器名只来自本表单(AI 不能加连接器 = 设置不可经对话改;`db_import` 只导 collections+kv、MCP 配置走独立 `load_servers` 不在其内),列表渲染已 cEsc、无存储型;但本地优先 app 持钥匙串 + 破坏性命令,自 XSS 仍是「粘贴这个连接器名」社工向量。
  - **exec 顺带独立发现:该纪律本就在仓内成文** —— [copilot-actions.js:38](web/apps/jobseek/logic/copilot-actions.js#L38) `toast('已生成「'+cEsc(skill)+'」…')` 注明「**否则只是把注入点从 onclick 移到此 toast**」;[widget-actions.js:20](web/platform/shell/widget-actions.js#L20) 同理转义。本刀原代码属**纪律确立之前的遗留**。其余 `toast+拼接` 站点(settings `data-fs`/`data-density`/`data-ab`、actions `mins`)均为**平台自持值**非用户数据,安全。
  - **落法**:三处包 `cEsc`;**模块头不变式改写为真** —— 覆盖**两条 sink**(① innerHTML 渲染含 `data-*` 属性位 ② `toast()` 路径),并显式标注**唯一有意免转义处**:`guardrail.confirmDestructive` 的 `detail` 走 `textContent`([guardrail/index.js:71](web/platform/guardrail/index.js#L71),exec 已坐实),传裸名安全、**勿「顺手」加转义**(否则把 `&amp;` 显给用户)。
  - **★验(双向对照,不只测修后)**:**阳性对照(修前)**——桩 `rt.mcp.add`、加名为 `<img src=x onerror=…>` 的连接器 → `__toastPwn===true` + toast 内 `<img>` 元素成型 ⇒ **漏洞真实、测试确能捕获**;**阴性对照(修后)**——同一攻击对**三处 sink 全跑**(add / envsave / envclear)→ pwn 全 false、无 img 元素、payload 渲染为字面文本、`data-cv` 属性仍**精确回环**(属性位转义未动);**功能回归**——合法名 `my&server` → toast `textContent` 正确显示 `my&server`、`innerHTML` 为 `my&amp;server` ⇒ **无双重转义**。0 console;真机 6.48s boot 零 panic。
- **★#4 裁决(exec 提请,评审明确裁定)· `s.error` 保留 + cEsc = 妥,与第54轮不矛盾**:**surface 区分** —— capability-center 是**总览**(塞原始错误体=噪音无管理价值,不渲染对);connectors 是**管理面**(用户正加/调连接器,错误文本是排错必需:command not found / 401 / refused,删掉=静默劣化排错)。**§4-4「防注入」由 `cEsc` 达成**(`<script>` 已验惰性)且**永不进模型**;「标注 Untrusted」在此是 UX 提示,错误串在连接器行下、语境已明确是诊断输出,被误当指令风险低(不同于 RAG/JD 流入 Agent 推理)⇒ **视觉标注 = 合理 [建议]、非必需**,留作后续可选增强。**评审并认可 exec「未自行扩范围去加(那是逻辑改动)= 范围克制正确」。**
- **第54轮 [建议] esc→cEsc 已闭环**(评审复核确认 capability-center 亦已换用 cEsc 并注明出处)。
- **评审逐条坐实**:#1 搬迁忠实(模式切换/令牌展开收起/env 清除 ×/add 令牌二段写/probe http-vs-stdio,**7 个 data-* handler 全在、无静默丢分支**);#2 红线三条逐字存活(令牌/env 只经 setAuth·setEnv 送钥匙串、值永不回显、token input=password+autocomplete=off;删除**结构性**只在 `onConfirm` 内调 `rt.mcp.remove`、`!G` fail-closed 早返;知情同意五要素双语全);#3 属性位严密(`cEsc` 与旧 `escA` **charset 全等**,8 处属性位全 cEsc,`"` 封 `" onmouseover=` 越狱、`<>` 封标签越狱,`data-cn/cv` 经 dataset 读回非 innerHTML、无再注入);#5 删除面干净(`escA` 全消、`esc`/`IC`/`openModal`/`go` 仍被用非死 import、`settings→nav` 边本就存在**无新环**);#6 载序净(connectors 仅被 capability-center import、copilot-chrome 不反向 import ⇒ **无环**;顶层只 `parseArgs` const + 导出 async fn、`cEsc` 惰性用 ⇒ **无 parse-time/TDZ**)。

**★P1-b 收官([应改] 已落、#4 已裁)。下一步 P1-c:记忆 + 知识库薄视图** —— 评审预告重点复核:**删除同样走 guardrail(预览+确认+撤销)**、记忆/文档内容(**可能含用户 PII / 外部不可信**)进 DOM 全 `cEsc`、**不进模型**。

**用户拍板(2026-07-09)**:P1-b [应改] 修复的双向对照证据自足 → **直接起 P1-c,与 P1-b 闭环一并送审**(省一轮往返)。

### P1-c · 长期记忆 + 知识库从设置模态搬迁、提为一等公民视图(P1 a+b+c 收齐)· commit `2644af2` · ⏳ 待审
**破坏性 + PII 承载刀**(评审第55轮已预告重点)。**零新后端**(复用 `rt.memory.*` / `rt.docs.*`)。
- **改动(3 文件,新增 1 模块 + 净删 80 行)**:新增 `memory-docs.js` 的 `renderMemory(box)`/`renderDocs(box)`——由 `settings.js` 的 `openMemoryManager`(62-88)+ `openDocsManager`(89-143)搬迁,模态外壳 → 内联宿主;capability-center 记忆/知识库段:计数总览 → 真管理面;settings 删两模态(82 行)+ **摘已无消费者的 `toastUndo` import**,两行改指路 → `go('capability')`,lock-note 指向能力中心。**会话历史仍留设置**(非能力中心域;`_mgrEsc`/`_mgrTime`/`openModal`/`IC` 因它存活、非死 import,已断言核实)。
- **★破坏性红线(§4-3)逐字保留**:记忆**逐条删 = 即时删 + `toastUndo` 撤销**(原设计:单条低风险、即时可撤销、不弹模态);记忆清空 / 文档删 / 文档清空 = `guardrail.confirmDestructive`(预览 + 确认 + `onUndo` 撤销),且 `!G` **fail-closed 早返**。
- **★转义(§4-4)· 顺手修掉两处搬迁前既存缺陷**:
  1. **修复自 XSS**:原 `settings.js:129` 把**用户填的文档名裸拼进 toast**;`toast`→`el`→`template.innerHTML` 是 HTML sink ⇒ 文档名 `<img onerror=…>` 可在**顶层上下文**执行。本刀 `cEsc` 收口(同第55轮 [应改] 纪律)。
  2. **收敛属性位转义**:原 `_mgrEsc`(:29)与 docs 局部 `esc`(:106)**只转 `&<>`、漏 `"`**,却用于 `data-memdel`/`data-docdel` **属性位**(今日 id 由后端生成故未爆,但正是第54轮 [建议] 警告的漂移)。全改平台唯一 `cEsc`(`&<>"`)。
  3. 记忆内容可能含**用户 PII**、文档名可能是**外部语料标题** → 进 DOM 全 `cEsc`;`guardrail` 的 `detail` 走 `textContent`,故传裸名安全(已在模块头标注、并警告勿"顺手"加转义)。
- **★lock-note 措辞订正(exec 自查,承第55轮「勿声明假不变式」教训)**:页顶原文「AI **只能**看到「有哪些工具、各自做什么」」—— 记忆/知识库成为本页真实视图后,该句**过度声称**:**长期记忆与 RAG 文档本就是 Agent 的上下文、AI 会读取它们**(`LongTermMemory`/`DocContext` 能力),这是设计意图非泄露。改为精确表述:AI 能看到工具及其用途 + 你写入的记忆与知识库(**本就是 Agent 上下文、可在此查删**);AI **永远看不到**连接端点、启动命令、任何密钥。**「印刷承诺」由此与事实对齐**(P1-b 的端点/命令/密钥承诺不受影响、仍为真)。
- **验**:node×4 净;import/export 完整性全解析;settings 残留 0、`toastUndo` 死 import 已摘、`_mgrEsc`/`_mgrTime`/`openModal`/`IC`/`errText` 仍在用;`memory-docs` **仅被 capability-center import、copilot-chrome 不反向 import ⇒ 无环**。preview **正向断言**(记忆/文档均为管理视图:删/清/加表单齐;设置页删 82 行后仍渲染;两条指路行落地即见管理面;会话历史仍在设置;lock-note 已改精确措辞)。**★对抗性核实**:①PII/文档名含 `<img onerror>` + `data-*` 属性位含 `" onmouseover=` → **全惰性、无 img 元素、无属性越狱、`data-memdel`/`data-docdel` 精确回环**;②**破坏性时序**:记忆逐条删→`remove` 被调 + `toastUndo` 提供且点撤销**真调 `undo`**;记忆清空/文档删/文档清空 → guardrail **被咨询**、**确认前后端未被调用**、`onConfirm` 后才调、`onUndo` 存在且真调;③**toast sink 双向对照**——以**真模块导出** `m.toast` 做阳性对照(裸 payload → `onerror` 触发、img 成型 = **sink 属实、控制组有效**),`cEsc` 后同 payload 惰性;`docs.add` 路径修后不再执行。0 console;**真机 WKWebView 6.12s boot 零 panic**。
- **★exec 自我订正(近失,主动披露)**:首版阳性对照用 `window.toast` —— **该桥在 3.y 已摘**(`typeof window.toast === 'undefined'`),`|| (()=>{})` 兜底使控制组**空跑**、返回假阴性(`CTL=false`)。**一个不触发的控制组什么都证明不了**,若照单采信就等于"对着死靶验证"。已改用**真模块导出**重跑、确认控制组真触发后,才采信阴性结果。**教训入 standing:阳性对照必须先证明自己会失败。**
- **诚实边界**:web 端 `rt.docs.add` 等降级 ⇒ 真嵌入/落库路径待桌面覆盖;本轮以桩 + 对抗断言验契约面(guardrail 咨询序、撤销真调、转义、toast sink)。

**★P1 = a+b+c 收齐**(能力中心框 + Connector + 记忆/知识库,三者皆有后端)。设置页的三个管理模态已收敛为能力中心的统一管理面;绿地(Skills/Project/Scheduled)各自单出方案,未套「已建」光环。

### ★ 第56轮独立复核 = P1-b 🏁 闭环通过 · P1-c 有条件通过 → [应改] 已落 `2c9629e`
- **P1-b 闭环确认**:三处 sink 已 cEsc、模块头不变式改写为真(明列 innerHTML + toast 两条 sink + 唯一免转义处 guardrail `detail` 走 textContent)。**评审特别嘉许近失披露**:阳性对照误用 `window.toast`(3.y 已摘桥)→ `||(()=>{})` 兜底令控制组空跑 → 假阴性;exec 自查、换真模块导出重跑、确认控制组真触发才采信。**「一个不触发的控制组什么都证明不了」入方法论。**
- **★★[应改](P1-c · 真数据丢失,已落 `2c9629e`)· #1 裁决 = 记忆逐条删「不满足 §4-3」—— 但不是因为少了模态,而是因为「可撤销」是假的**:
  - **评审先为 exec 正名(两点属实)**:①**§4-3 安全内核完好** —— 模型**无法**删记忆(`memory` 工具 `op` enum 仅 `["remember","recall"]` [memory.rs:88](src-tauri/src/memory.rs#L88)、permissions `[Db,Net]` **无 `Destructive`** [:75](src-tauri/src/memory.rs#L75)),故「无论触发者是 Agent、widget」这条**未被触及**,删除纯用户 UI 发起;②**仓里本就两档**(`resumes.js:141`/`notes.js:48`/`prompts.js:56` 逐条删走 toastUndo;`jobs.js:127`/`connectors.js` 走 guardrail),且撤销窗口等价(guardrail `undoMs||6000` vs toastUndo `6500`)⇒「用户发起 + 低成本 + **可靠**可撤销」的逐条删免模态**本可满足 §4-3 实质**。
  - **但前提塌了(exec 独立坐实 + 在真 UI 复现)**:`MemTrash`/`DocTrash` 各自**单槽覆盖**——`*trash.0.lock().unwrap() = snap;`([data.rs:622](src-tauri/src/data.rs#L622) remove / [:593](src-tauri/src/data.rs#L593) clear),`memory_undo` 用 `std::mem::take` 取走清空([:628](src-tauri/src/data.rs#L628))。**后端注释本就写明「撤销最近一次销毁」**,而 UI 给每行一个滞留 6.5s 的撤销按钮。**失败场景(UI 正邀请)**:6.5s 内连删 A、B → A 快照被 B 覆盖(**A 永久丢失**)→ 点 A 的撤销 → **还原的是 B**、trash 清空、B 的撤销此后静默 no-op(`catch(_e){}` 吞掉)。⇒ 模块头「破坏性一律可撤销」**为假**;「单条低风险 + **即时可撤销**」**在自己的前提上失败** ⇒ 既无确认、又无可靠撤销。**定级 [应改](非回归、非阻断,但静默永久丢数据 + 还原错记录 + 又一条被证伪的自述不变式)。**
  - **★exec 阳性对照(真 UI 复现,非纸上推演)**:忠实模拟单槽后端 → 删 A → 删 B → **A 的 toast 仍在 DOM 且可点** → 点它 `BUG_restoredWrongRecord=true`、`BUG_A_permanentlyLost=true`。
  - **落法(评审 (a),不改共享原语)· 撤销世代守卫**:按 trash 域各自计数(memory/docs 独立,对应后端两个独立 State)——①新销毁前**摘掉本域尚存的撤销 toast**(不留会还原错记录的死按钮);②过期的撤销回调**诚实拒绝**并提示「只能撤销最近一次」;③**[建议]1 一并对齐 `DocTrash`**(文档删/清空的 `onUndo` 同守卫)。**⚠ 未改 `toast.js`/`guardrail`(git diff 证空)** —— notes/prompts/resumes 的撤销是**闭包快照、各自独立正确**,全局互斥反而改坏它们。
  - **阴性对照 + 附带损害检查(评审明令)**:A 的 toast 被摘、场上恰一个撤销;**强行调用 A 的过期闭包**(模拟 Mod+Z 竞态)→ **未调后端、db 未变、提示已过期**;当前撤销正确还原 B;文档域同款全绿(过期 onUndo 拒绝 / 当前 onUndo 正确还原)。**两个独立闭包快照 toastUndo 并存且各自独立执行 ⇒ notes/prompts/resumes 未被波及。** 真机 6.51s boot 零 panic。
  - **诚实残留**:A 仍回不来(后端单槽固有语义),但 UI **不再假装**它可撤销。**keyed trash / `memory_undo(id)` 是正解**(评审 (c)),属新后端 plumbing、**单出一刀**。
- **#3 裁决(`_mgrEsc`)= 无属性位缺口,exec 的克制正确**:评审独立核实 `_mgrEsc` 在 `openHistoryManager` 仅一处使用([settings.js:44](web/platform/shell/settings.js#L44))且落**文本内容位**,同行 `who`/`cls` 皆三元字面量、`_mgrTime` 走数值强制 ⇒ 文本位只需 `&<>`,漏 `"` 无害。**不需收敛、留独立刀**;[建议]3 已落:`_mgrEsc` 定义处钉注释「**仅限文本内容位**;挪进属性位须换 cEsc」(会话文本可含 AI 派生外部内容:文本位惰性、属性位不是)。
- **#4 lock-note 订正 = 与事实一致 ✓**:评审坐实 `LongTermMemory` 是 `Kind::Tool` 且 override `contribute` 供料、`DocContext` 是 `Kind::Context` 自动召回,二者经 `contribute_all`→`build_context_message` **进模型上下文**([ai.rs:410-420](src-tauri/src/ai.rs#L410))⇒ 旧措辞「AI 只能看到有哪些工具」**确是过度声称**,exec 自查改对;「AI 永远看不到端点/命令/密钥」**仍为真**(`url`/`command`/`args` 只在 `mcp_list` 零模型消费者;模型 MCP 面只有 `tool_descriptors`)⇒ **P1-b 印刷承诺未被打脸**。
- **#2/#5/#6 全净**:转义 sink 全扫零遗漏(含 exec 修的既存自 XSS `cEsc(shown)` 与 `data-docdel` 属性位);`toastUndo` 死 import 已摘、`_mgrEsc`/`_mgrTime`/`openModal`/`IC`/`errText` 非死 import;**会话历史留设置 = 妥**(记忆/文档是**能力层检索上下文**,会话历史是**隐私/数据管控**——`messages` 不在 `QUERYABLE`、AI 经 `History` state 拿而非查询,属不同范畴);`memory-docs` 无环、无 parse-time/TDZ。
- **[建议]2(待用户拍板 · 未自行改)· CLAUDE.md §4-3 本身是条假不变式**:它写「破坏性**一律**预览+确认+可撤销…**统一走 guardrail**」,但仓里 notes/prompts/resumes/jobs 的逐条删**早已**走 toastUndo 且历轮过审。评审建议**把两档写进红线**:*Agent/widget 触发的破坏性 = 永远 guardrail(安全内核,不可让步);用户发起、低恢复成本、**可靠**可撤销的逐条删 = 允许即时删 + undo*。否则每个新作者都要重问一遍(exec 本轮就问了),且「一律」会像 connectors.js 那条一样**被代码证伪**。**§4-3 是红线文档,exec 未自行改,已呈用户拍板。**

**用户拍板(2026-07-09)**:[建议]2 采纳 → **CLAUDE.md §4-3 改写为两档**(commit `91f3463`)。

### ★ 第57轮独立复核 = 原 [应改] 🏁闭环 · §4-3 改写 ✅准确 · **新 [应改](同缺陷类第二条路径)** → 已落 `cde47cc`
- **原 [应改] 闭环确认(评审独立复核、非采信)**:`git diff -- toast.js guardrail/index.js` **输出为空**(共享原语未动 ✓);`dropToast` 用**追踪的元素引用**而非对 `#toasts` 的宽泛扫描 ⇒ notes/prompts/resumes 并存 toast 不受波及(**正是评审警告的坑,已避开**);世代守卫在**任何 `rt.*` 调用之前**返回;两域独立、DocTrash 已对齐;清空路径 `detail` **事前**告知「仅能撤销最近一次销毁」。方法论到位(「一个不触发的控制组什么都证明不了」+ 真 UI 阳性对照)。
- **★★新 [应改](已落 `cde47cc`)· 重入 → 空快照覆盖 trash → 假「已撤销」**:
  - **exec 独立坐实三处根因**:①**后端** `memory_remove` 先 SELECT 快照、再 DELETE,**即使删 0 行(id 已不存在)也无条件 `*trash = snap`(snap=[])**([data.rs:600-623](src-tauri/src/data.rs#L600))⇒ 一次 no-op 删除把撤销槽**清空**;②**前端** 逐条删 onclick **无重入守卫**,按钮在 `await remove()` + `await refresh()` 期间仍在 DOM 可点;③**放大器** [toast.js:17](web/platform/shell/toast.js#L17) 的 `doUndo` **不 await `restoreFn`、无条件 `toast('已撤销')`**。
  - **失败场景(双击「删除」= 最常见操作)**:click1 `remove(A)`→trash=[A];click2 落在 await 窗口内 → `remove(A)` 命中 0 行 → trash=[] → 撤销 `mem::take([])` 还原 **0 条**,用户却看到「**已撤销**」⇒ **A 永久丢失 + 假成功提示**。**正中刚拍板的 §4-3 ★判据所禁止的「UI 撤销语义 ≠ 后端 trash 语义 / 静默永久丢数据」。**
  - **★评审锐评(记之)**:「这条红线立刻发挥了作用 —— **它抓住了写它的人**。这是好红线的标志。」
  - **exec 阳性对照(真 UI 复现)**:双击 → trash 清成 `[]`、场上 **2 个**撤销、点最新那个 `undoRestoredZero=true` ∧ `toastSaidSuccess=true`(「已撤销」)∧ A 永久丢失。
  - **落法(评审推荐的前端最小修,未动共享原语)**:**逻辑闸 `memBusy` + 物理闸 `disabled`** —— 删除期间禁用全部记忆删除按钮(disabled 按钮不触发 click),`finally` 复位;清空路径亦持 `memBusy` 与逐条删互斥。**一举关掉双击 clobber 与交错双 toast 两条路径。** **exec 补充坐实的不对称性**:guardrail 的确认按钮**先 `close()` 再 await `onConfirm`**([guardrail/index.js:122-124](web/platform/guardrail/index.js#L122)),DOM 同步移除 ⇒ **文档域天然不可重入**,故守卫只需加在记忆逐条删这条唯一的即时删除路径(`doc_remove` 后端虽同构,前端无重入面)。后端 `if !snap.is_empty()` = 正解,已归 keyed-trash 独立刀。
  - **阴性对照 + 补齐上轮遗漏**:①双击 → `remove` 只调 1 次、trash 保 `[A]`、恰 1 个撤销、撤销**真还原 A**;②三连击 → 仍只 1 次;③**★异步交错删两行(上轮测试遗漏、评审点出)** → B 的按钮在 A 的 await 窗口内确为 `disabled`、`remove` 只 1 次、**交错下 `exactlyOneUndoAffordance` 亦成立**、B 仍在、**无「已过期」+「已撤销」自相矛盾并存**;④顺序删两行 → 陈旧 toast 已摘、陈旧撤销仍被拒(世代守卫无回归)。真机 6.34s boot 零 panic。
- **§4-3 改写核实 = 准确、自洽、当前无代码可证伪 ✓**:安全内核结构性成立(`Permission::Destructive` + `invoke_raw` 直拒 capability.rs:237;模型无破坏性工具;widget/cards 一律 `confirmDestructive`;MCP 每次调用走确认专路);「可撤销必须是真的」定义精准 —— **正是它让评审判出上面那条新 [应改]**;现例清单核实(notes/prompts/resumes/jobs 的逐条删都是**闭包快照撤销**,与记忆委托后端单槽**不同类**,列在一起成立)。
- **[建议] §4-3「触发」定义歧义 → 已落 `cde47cc`**:原文未界定「触发」= **提议**还是**执行发起点**。反例 `agentDeleteJob`([copilot-actions.js:49](web/apps/jobseek/logic/copilot-actions.js#L49))由模型渲染确认卡、用户点 `cAB` 后执行,走 toastUndo 而非 guardrail —— 按「执行发起点=用户」合规,按字面「Agent 触发」像违规。**已在 §4-3 明确**:「触发」= **执行发起点**,模型只能提议,用户显式点击确认即属用户发起(与 widgetActions「收规格不收执行」同源);**并点名 `agentDeleteJob` 确认卡为已认可先例**(其撤销是闭包快照 `JOBS.splice(idx,0,job)` ⇒ 可靠)。**反之模型/widget 自行执行的破坏性一律不得绕过 guardrail。**
- **[建议] `exactlyOneUndoAffordance` 仅顺序点击成立(exec 测试盲区)** → 已补异步交错断言(见上 ③)。**[建议]3 `_mgrEsc` 注释 ✓**(条件/后果/触发点齐全)。
- **后端正解已开为独立刀**(chip `task_7ea25377`):① `if !snap.is_empty()` —— no-op 删除不得清空撤销槽(`memory_remove`/`doc_remove`);② keyed trash + `memory_undo(token)`/`doc_undo(token)`,TTL 对齐前端撤销窗口。**明令不得改 `toast.js`/`guardrail` 共享原语。**

### ★ 第58轮独立复核 = 🏁 通过(重入守卫闭环)· 1 裁决 + 3 [建议] → 已落 `41cc37d`
- **闭环确认(评审独立复核)**:**双闸时序无 TOCTOU** —— `if(memBusy)return; memBusy=true;` 与 `frozen.forEach(x=>x.disabled=true)` **全在第一个 await 之前同步执行**;双击命中 `disabled` 按钮**不派发 click**(物理闸),即便派发也被 `memBusy` 吞(逻辑闸);交错删另一行同样被 `frozen` 覆盖 ⇒ **上轮盲区已关**。**`finally` 释放考虑了失败路径**:`if(x.isConnected) x.disabled=false` —— refresh 成功后旧按钮已 detach(不误解禁)、refresh 失败时旧按钮仍连接被解禁 ⇒ **无永久锁死**。**★清空路径无死锁(评审专查)**:`memBusy=true` 设在 `onConfirm` **内部**,用户**取消**时 `onConfirm` 根本不执行 ⇒ memBusy 从未被取走 ⇒ 不会把逐条删永久锁死(**设在弹窗之前就会死锁,位置放对了**)。**exec 自查的不对称性属实**:`ok.onclick = async () => { close(); await opts.onConfirm(); …}`([guardrail:122-124](web/platform/guardrail/index.js#L122))—— `close()` **同步**移除 overlay、按钮 detach,第二次点击命中测试落不到它 ⇒ **文档域结构性不可重入**。共享原语零改动(`git diff` 为空)。
- **★裁决(exec 提请)· `toast.js:17` 的 `doUndo` = 单出一刀,且必须排在 keyed-trash 之前或同刀**:**不是因为现在有活 bug**(本刀堵死重入面后它够不到;现存四消费者 notes/prompts/resumes/jobs 的 `restoreFn` 都是**同步闭包快照、不会失败**),**而是因为 keyed-trash 会把它变成活 bug** —— TTL 对齐撤销窗口 ⇒ `memory_undo(token)` **会合法地失败**(过期),而 `doUndo` 仍无条件 `toast('已撤销')` ⇒ **假成功提示由设计重新引入**,直接违反刚拍板的 §4-3 ★判据。**故是 keyed-trash 的硬前置。** 建议形状(opt-in、零回归):`doUndo` 改 `await restoreFn()`,`undefined`→成功(现存四消费者行为逐字不变)、显式 `false`/`0` 或抛错→报失败;⚠ `if(lastUndo===doUndo)lastUndo=null;` 须**在 await 之前**同步执行(否则 await 期间 Mod+Z 可二次触发)。**已开为独立 chip(`task_e94bf3c5`),并标注为 keyed-trash chip(`task_9b4b646d`)的前置依赖。**
- **★[建议]A(同缺陷类最后一条支路,已落)· `catch(_e){}` 会为「没发生的删除」提供撤销**:原码吞掉 `rt.memory.remove` 的错误后仍 `++memGen` + 给 `toastUndo`。**失败场景**:后端报错(sqlite 锁/磁盘/IPC)→ trash **仍保留上一次删除的行** → 新 toast 的 `gen` 与 `memGen` 相符、守卫放行 → `memory_undo()` **还原上一条(错的)记录**,且 `toast.js` 报「已撤销」。可达性低(需后端报错;web 端无行 ⇒ 无按钮 ⇒ 不可达)、**无数据丢失**(多还原一条),故 [建议] 非 [应改]。**落法**:`let ok=true; try{await remove}catch(e){ok=false;toast(errText(e))}` → 仅在 `ok` 时推进世代 + 给撤销;失败则**浮出错误**而非静默吞。**新不变式:提供撤销 ⇔ 销毁确已发生。**
  - **★exec 坐实的坑(评审未提)**:guardrail 在 `onConfirm` 之后**无条件** `showUndo`([guardrail:125](web/platform/guardrail/index.js#L125)),故 `onConfirm` 失败时**仍会给出撤销按钮** ⇒ `onUndo` 必须自行拒绝。**且只靠世代不够**:失败时不推进世代会使 `gen(0) === docGen(0)` 被**误判为有效** ⇒ 必须有**显式 `ok` 标志**。四条破坏性路径(记忆逐条删 / 记忆清空 / 文档删 / 文档清空)全部收口。
  - **验(双向对照)**:删 A 成功(trash=[A])→ 删 B **失败** → B 仍在、trash 仍 `[A]`、**不给撤销按钮**、错误浮出(「sqlite is locked」)⇒ 还原错记录的路径**不可达**;guardrail 路径:清空**失败** → 错误浮出(「disk full」)→ guardrail 仍无条件给按钮 → **`onUndo` 自行拒绝**、未把 A 误还原、trash 仍 `[A]`;**回归**:成功路径仍给撤销且**真还原 A**。真机 6.07s boot 零 panic。
- **★[建议]B(堵伪造「用户确认」后门,已落 `41cc37d`)**:第57轮只写了「触发=执行发起点」,**漏写其成立的前提**。§4-3 补两道约束:①**动作必须来自白名单注册表 `cActions`**(`Object.create(null)` + own-enumerable + function-only,模型无法凭字符串调任意代码);②**按钮文案与动作语义须应用/平台自持(硬编码)**,绝不得由模型/RAG/MCP 派生内容决定「这个按钮是干什么的」。否则模型可造一张「点此继续查看结果」的卡、底下挂破坏性动作,把「用户显式点击确认」**伪造**出来。与 `greeting`(第50轮)、`widgetActions`(收规格不收执行)同源纪律。
  - **★exec 对评审措辞的精度订正(已坐实)**:评审原话「label/**detail** 不得含模型/RAG/MCP 派生内容」—— 但它点名的先例 `agentDeleteJob` 的 detail **本就嵌了 JD 抽取的公司名**([copilot-actions.js:73](web/apps/jobseek/logic/copilot-actions.js#L73) `确认删除岗位 <b>${cEsc(j.co)}…</b>`)。照此写法,红线**会被它自己点名的先例证伪**(第四次踩同一坑)。故精确化为:**不可信派生内容只能作为已转义的数据出现在描述里,绝不得决定动作是什么**;按钮文案与动作语义硬编码。
- **[建议]C(TTL 同源常量)已并入 keyed-trash chip**:当前前端两个撤销窗口 `toast.js:20` 的 `6500` 与 `guardrail:125` 的 `undoMs||6000` **硬编码且互不相同**;后端 TTL 若各自漂移会出现「UI 说可撤销、后端已过期」= 又一条 §4-3 ★违例。要求定义**单一来源**并写测试钉住;`doc_remove` 的 `if !snap.is_empty()` 亦一并覆盖。

**★P1-c 收官(第58轮通过 + 三 [建议] 全落)。P1 = a+b+c 全线收齐。** 后续两刀已开 chip 并标注依赖序:**`task_e94bf3c5`(toastUndo 契约化)→ `task_9b4b646d`(keyed trash + no-op 守卫 + TTL 同源)**。评审预告复核重点:TTL 与前端撤销窗口是否同源、四个现存消费者在新契约下**逐字零回归**(用真模块导出做双向阳性对照,别让控制组空跑)。

---

## 撤销债清偿(用户拍板 2026-07-09:P1 收齐后先清撤销债,再谈 P2 / 绿地)

### 刀1/2 · `toastUndo` 契约化 —— doUndo 不再谎报「已撤销」· commit `a0fe6c6` · ⏳ 待审
承评审第58轮**明确裁决**(toast.js 单出一刀、须排在 keyed-trash 之前或同刀)。**理由不是现在坏,而是 TTL 会让它坏**:keyed-trash 给 `memory_undo(token)` 加 TTL 后撤销会**合法地失败**(过期),而 `doUndo` 仍无条件 `toast('已撤销')` ⇒ **假成功提示由设计重新引入**,直接违反 §4-3 ★判据。
- **★新契约(opt-in · 现存 5 消费者逐字零回归)**:由 `restoreFn` 的解析值决定提示 —— `undefined`(块体箭头 `()=>{…}` 的返回值,**现存全部消费者**)→ 成功 → 报「已撤销」;显式 `false`/`0`(还原 0 条 / 已过期)→ **不报成功**且此处静默;同步抛错 / Promise reject → 报 `errText(e)`、**不报成功**。⚠ `lastUndo=null` **移到 await 之前同步执行**(评审点名):否则 restoreFn 挂起期间 Mod+Z 可二次触发。
- **★「失败因由由 restoreFn 自报」的设计缘由(exec 坐实的硬约束,非风格选择)**:`toast.js` 是 i18n **之下**的基础原语 —— `i18n.js:9 → shell-state.js:13 → toast.js` 已成链,**引入 `tt` 会成环**(违 SCC 不变式);而在 `toast.js` 新增 CN-only「撤销失败」串又**违反红线 #6**。故契约把「说明失败原因」的责任**上移给调用方**(它持有 `tt` 与上下文,能说清是过期还是出错)。`toast.js` 因此**零新串、零 i18n 依赖、零新环**。
- **★memory-docs.js 同刀 opt-in,并修掉本契约引入的一处陷阱**:原 `return expiredUndo();` 的值是 `undefined`(`toast()` 的返回值)⇒ **新契约会把它读成「成功」**。改为 `{ expiredUndo(); return false; }`;后端抛错 → `return false`;并接住 `memory_undo` 的返回值(`Result<usize>` = 还原行数):`n===0` → 报「没有可撤销的内容」+ `return false`(web 降级返回 `undefined` → 视为成功,不误判)。
- **验(★控制组必须真触发)**:第56轮教训 —— `window.toastUndo` 桥 3.y 已摘(`typeof undefined`),拿它做对照会**空跑成假阴性**;本轮用**真模块导出**并断言 `CTL_moduleIsFreshContract`(且首跑确实因浏览器缓存旧模块而**报错崩出**,证明控制组有效、非空跑)。
  - **契约面 7 例全绿**:`undefined`→已撤销 ∧ 闭包真执行;`false`→不报成功且调用方因由可见;`0`→不报成功;同步抛错→报 errText 不报成功;async reject→同;async undefined→成功;**★Mod+Z 在 restoreFn 挂起期间 `runLastUndo()===false` 且 restoreFn 只跑一次**。
  - **★真消费者端到端零回归**([notes.js:48](web/apps/assets/pages/notes.js#L48)):UI 新建笔记 → 逐条删 → 点撤销 → **笔记按原 id 还原、仍报「已撤销」**。附带损害检查:两个独立闭包快照 toast 并存且**各自独立执行**。
  - **memory 域**:过期撤销 → 报「已过期」且**绝不报「已撤销」**(本刀新增关键断言);成功路径 `n=1` → 报「已撤销」+ 真还原;`n=0` → 报「没有可撤销的内容」不报成功;后端抛错 → 报 errText 不报成功。
  - node×2 净;0 console;**guardrail 共享原语仍未动**(`git diff` 空);真机 WKWebView 6.26s boot 零 panic。
- **诚实边界**:`rt.memory.undo()` 的返回值在桌面端是 `usize`(还原行数)、web 端降级为 `undefined`;`n===0` 判据只在桌面端生效(web 端本无行、不可达)。真后端返回值路径待桌面覆盖。
- **下一刀(刀2/2)**:keyed trash + `if !snap.is_empty()` no-op 守卫 + **TTL 与前端撤销窗口同源常量**(`toast.js` 6500 / `guardrail` 6000 现硬编码且不同,评审 [建议]C)。

### ★ 第59轮独立复核 = 🏁 通过(契约获准)· 2 必落 + 2 记债 → 已落 `d6e3b78`
- **裁决:偏离可接受,且评审认为「比我给的形状更好」**:`toast.js` 结构上**不可能知道失败因由**(过期?后端报错?还原 0 条?),打通用的「撤销失败」信息量反低于 `restoreFn` 能给的具体因由 ⇒ **把「报因由」放在唯一知道因由的人手上是正确的职责划分**;且 exec 用 `Promise.resolve(r).then(...)` 保住 `doUndo` **同步返回** ⇒ `runLastUndo()` 仍同步返回 `true`、Mod+Z 语义零变,**比评审建议的 `async doUndo` 干净**,评审采纳。
- **★★[必落]① 我的送审理由里有一条假不变式(评审订正,exec 独立坐实确认自己错了)**:我原写「引入 `tt` 会成环 ⇒ **违 SCC 不变式**」。坐实:`i18n.js:9 → shell-state.js:11 → i18n.js` ⇒ **`i18n ⇄ shell-state` 环今天就已存在**;且 [i18n.js:4](web/platform/shell/i18n.js#L4) 的头注释**自己写着**「…构成 i18n⇄shell-state 运行时环——两侧读全在函数体、零 eager 互读,ESM 语义安全,**接受**」;`tt` 是 `export function`(hoisted),`toast` 若引它只在 `doUndo` **函数体内**惰性调用;**SCC 不变式禁的是「环内顶层急读非函数声明绑定」,不是环本身**。⇒ `toast→i18n` **成环(真)但不违不变式(假)**。已删该断言,改写为两条**真理由**:①**分层**(`toast` 在 i18n 之下,向上依赖是层级倒置)②**职责**(只有 `restoreFn` 知道因由);并保留一段 **retraction 注释**,免得下一个作者以假前提**锁死 [建议]2 的 #6 修法**。
  - **★评审锐评(记之)**:「这是本 arc **第四次**「勿声明假不变式」—— 前三次在代码里,这次在**送审理由**里。同一纪律。」
- **★[必落]② [建议]1 · `doUndo` 补 `done` 重入闸**:`close()` 只置 `opacity:0` 并在 **300ms 后**才 `remove()` ⇒ **透明元素照样可点**。300ms 内双击「撤销」→ `restoreFn` **跑两次**(闭包消费者 `splice(i,0,snap)` **重复插入**;memory 侧则「已撤销」与「没有可撤销的内容」**并存** —— 正是本刀立意要消灭的 UI 自相矛盾)。姊妹原语 [guardrail.showUndo:34-36](web/platform/guardrail/index.js#L34) **早有此闸**,此处补齐(一行,同步置位、先于 `close`/`restoreFn`/任何 await)。评审定级 [建议] 非 [应改] 的依据:本刀契约**每次调用各自如实上报、没有说谎**;重复插入是**先存**且**瞬态**(重载即复原),不构成契约证伪。
  - **★阳性对照用真代码(非纸上推演)**:把 **HEAD(`a0fe6c6`:有契约、无 done 闸)** 的 toast.js 落成临时对照件、与新模块**并存 import**,先断言 `CTL_oldHasNoDoneGate ∧ CTL_newHasDoneGate ∧ 两者不同实例`(**控制组是活靶**)。**阳性**:HEAD 版双击 → `restoreFn` 跑两次;且坐实使能条件(`close()` 后按钮 `isConnected=true`、`opacity==='0'` ⇒ 仍可点)。**阴性**:本刀三连击 → 只跑一次、恰一条「已撤销」;点过后 `runLastUndo()===false`(Mod+Z 未被 done 闸破坏)。**真消费者端到端**(notes.js:48):新建笔记 → 删 → **双击撤销** → **不重复插入、无重复 id、恰一条「已撤销」**。临时对照件已删、未入库。
- **[记债]③ [建议]2 · `toast.js` 存量 #6 债**:`撤销`(按钮 label)与 `已撤销` 是 **CN-only、无 i18n**,平台基元里的红线 #6 违例(**先存**,非本刀引入)。本刀以「不新增 CN-only 串」避开、未扩大 = 评审认可的克制。按第52轮 `jobseek.rs` 先例**显式记债 + 留出口**:把两 label 参数化 `toastUndo(msg, restoreFn, {undoLabel, doneLabel})` 带默认值,或由持有 i18n 的上层一次性 `setToastLabels(...)` 注入 —— **保分层、零环、不需 `tt`**(注:因 ①,此路结构上本就通)。
- **[记债]④ [建议]3 · 三处 `onUndo` 走 `guardrail.showUndo`**(它**从不报成功**、**返回值不被解释**)⇒ 本就不撒谎、无需 toast 契约,返回 `undefined` 无害。已各加**防漂移注释**:「若将来改走 `toastUndo`,失败路径**必须显式 `return false`**,否则默认 `undefined` 会被读成成功」。同 `_mgrEsc`「仅限文本位」纪律。
- **评审确认扎实**:契约实现正确(`succeeded=(v)=>v!==false&&v!==0`;同步抛错/异步 reject → `errText` 不报成功);`lastUndo=null` 在任何 await 之前同步执行(第58轮点名项,做到了);**六个消费者零回归 = 评审独立结构核实**(全为块体箭头,各 `restoreFn` 体内 grep `return` **无一处返回 falsy**)⇒ **「只 e2e 一个 notes 是相称的」**,契约唯一回归向量是 falsy 返回值而它不存在,**不必补跑另外四个**;memory 四态正确;第58轮 [建议]A 的 `ok` 标志(提供撤销 ⇔ 销毁确已发生)一并收了;**控制组纪律已内化**(首跑因缓存旧模块而崩 ⇒ 证明是活靶)。
- **★评审对残留风险的判词(记之)**:本契约的**默认值是「成功」** ⇒ 任何消费者在失败路径上**忘记 `return false` 就会静默说谎**。这是「零回归 opt-in」的**必然代价**(唯一不破坏现存消费者的设计),故接受;但它把重量压在 **JSDoc 义务 + 评审纪律**上。已写进 JSDoc 并在调用点加 ⚠。

**★刀1/2 收官(第59轮通过 + 2 必落已落 + 2 记债)。契约形状获准 ⇒ 可起刀2(keyed trash)。** 评审预告刀2 复核重点:① **TTL 与撤销窗口同源常量**(`toast.js:20` 的 `6500` 与 `guardrail:125` 的 `undoMs||6000` **硬编码且互不相同**;后端 TTL 若漂移 = 新 §4-3 ★违例,**且这次 `toast.js` 会静默、用户什么也看不到**);② `if !snap.is_empty()` 覆盖 `memory_remove` **与** `doc_remove`;③ keyed token 下 `memory_undo(token)` 的失败**必须走 `return false` + 自报**,别退回默认「成功」;④ 四个闭包消费者在新后端下**逐字零回归**(真模块导出 + 双向阳性对照)。

### 刀2a/2 · 后端根因之一:no-op 销毁不得清空撤销槽 · commit `b475325` · ⏳ 待审
评审第57轮定位、第58轮 [建议]C 要求「`memory_remove` **与** `doc_remove` 一并覆盖」,并指明**这是独立的最小修复、应先落并单测**。本刀落之(keyed trash + TTL = 刀2b)。
- **★根因**:四处销毁命令都**无条件** `*trash.0.lock().unwrap() = snap;`。当 `snap` 为空(重复删同一 id、或清空一个已空的库)时,**上一次销毁的快照被清成 `[]`** ⇒ `memory_undo`/`doc_undo` 用 `mem::take` 取到空集、还原 0 条,而前端旧 `doUndo` 还报「已撤销」= **静默永久丢数据 + 假成功提示**。
- **★修**:抽 `stash_if_destroyed(slot, snap)` 纯 helper —— **只有 `snap` 非空(确有行被销毁)才覆盖撤销槽**。**四处全覆盖**:评审只点名 `remove` 两处,**exec 判定 `clear` 两处同构**(清空一个已空的库同样是 no-op,照样摧毁上一次逐条删的撤销槽)⇒ 一并加固。判据用 `snap.is_empty()` 而非 DELETE 影响行数:**trash 的语义是「可供还原的行」**,存一个空快照既无意义、又摧毁前一次的可还原状态。**与前端不变式「提供撤销 ⇔ 销毁确已发生」严格对称。**
- **可测性**:命令取 Tauri `State`、不可直接单测 ⇒ 把**决策抽成纯 helper**;并把 `memory_remove` 内联的单行快照抽为 `memory_snapshot_one(conn, id)`(镜像既有 `doc_snapshot` 的形状),使单测走**真查询**而非重抄一遍 SQL。
- **验(★含阳性对照)**:`noop_destroy_must_not_clobber_undo_slot` —— **阳性**:复刻旧的无条件 `*slot = snap`,空快照确会把 A 的快照清空(永久丢失);**阴性**:`stash_if_destroyed` 挡住;真销毁仍正常覆盖(撤销语义 = 最近一次)。`repeated_memory_delete_keeps_first_snapshot_and_undo_restores_it`(**评审点名的复现**):建库插 A → 删 A(快照进槽)→ **再删 A(no-op,空快照)** → 槽仍保有 A → `mem::take` + `memory_restore_rows` 还原 1 行、fact 逐字相符。**两测试点名跑过、非从总数推断**;cargo test **86 passed / 0 failed**(84→86);clippy `-D warnings` 净;fmt 净;真机 3.52s boot 零 panic。
- **★诚实边界**:本刀只消除**根因之一**(no-op 覆盖)。**单槽语义仍在** —— 连删两条**不同**记录时,第一条快照仍被第二条**正当覆盖**(「撤销最近一次」),前端靠世代守卫诚实拒绝。根治 = **刀2b**(keyed trash + token + **TTL 与前端撤销窗口同源常量**)。

### ★ 第60轮独立复核 = 🏁 通过 + 3 [建议] → 全落 `fdad069`
- **评审确认**:扩大范围(四处)**正确**且 `clear` 两处**可证严格正确**(其快照函数 `memory_rows_full`/`doc_snapshot` 均传播错误 ⇒ `snap.is_empty() ⟺ SELECT 0 行 ⟺ DELETE 0 行`);抽取**确为零逻辑改动**(逐字一致,**连吞错也忠实搬了** —— 这正是它是先存缺陷的证明);**原子性前提成立**(`Db(Mutex<Connection>)` 单连接、命令体全程持锁,快照→DELETE 对其他命令原子)。刀1 收尾(假理由已删 + `done` 闸)亦确认。
- **★★[建议]2(最重,已落)· `memory_snapshot_one` 吞错 ⇒ 本刀把良性缺陷转化成「还原错记录」的通路**:
  - **坐实**:该函数用 `.filter_map(|x| x.ok())` **吞掉逐行映射错误**(先存缺陷,随 `memory_remove` 内联体忠实搬出);而 `DELETE` **不管映射成不成功都会删掉那行**。schema `created_at INTEGER DEFAULT 0` —— **DEFAULT ≠ NOT NULL**,NULL 可写入 ⇒ 行存在但映射失败。⇒ `snap.is_empty()` 实为「命中 0 行 **或** 命中的行全部映射失败」,**并不等价于「0 行被销毁」**。**它是四个快照函数里唯一吞错的异类**(3/4 已传播)。
  - **★harm 方向被本刀反转**:旧码 `*slot = snap`(空)**清空**槽 ⇒ 撤销什么也不还原(丢 A,**但不还原错的**);刀2a 的 `stash_if_destroyed` **跳过** ⇒ 槽里留着**上一次**的快照 ⇒ 命令仍 `Ok` ⇒ 前端推进世代、给撤销 ⇒ 点下去**还原错的记录**,且 `n>0` ⇒ toast 报「已撤销」= **§4-3 三连违例**。评审判 [建议](吞错先存、非本刀引入),**但后果是本刀赋予的** —— exec 如实记为「本刀引入的后果」。
  - **评审并指出「改用 DELETE 行数也不够」**:若 DELETE 影响 1 行而 snap 为 0(映射失败),你只是**知道**销毁了、却**无可还原之物**。**正解是 fail-closed:不能完整快照,就不销毁。**
  - **落法**:与三兄弟一致地传播错误 ⇒ 映射失败在 `DELETE` **之前** 返回 `Err`,什么也没销毁、槽未被动、前端 `ok=false` 不推进世代不给撤销。**此后 `snap.is_empty()` 才真正 ⟺「0 行被销毁」,`is_empty()` 判据才名副其实。**
  - **★并订正 exec 写的假注释**「行不存在 → 空 Vec(**= no-op 删除的信号**)」—— 空 Vec 也可能是「行存在但映射失败」。**这是本 arc 第五次「勿声明假不变式」。**
- **★[建议]3(已落)· 测试重抄了命令体 ⇒ 守不住 `memory_remove` 本身**:原测试自写「snapshot → DELETE → stash」序列,**断言的是测试自己的代码** —— 有人把命令改回 `*trash = snap`、或把 stash 挪到 DELETE 之前,测试照样绿。**落法**:抽 `memory_remove_inner(conn, slot, id)` / `doc_remove_inner(...)`,命令只取锁转调,测试**直调 inner ⇒ 覆盖真实命令体**。**同族纪律:重抄被测代码的测试,证明的是测试、不是代码**(与「不触发的控制组什么都证明不了」同源)。
- **★[建议]1(已落,并被 exec 扩到四条路径)· 「提供撤销 ⇔ 销毁确已发生」贯彻到条数**:评审只点名 `clear`(修后 clear-on-empty 会**保留** `trash=[A]`,而 guardrail 无条件给撤销 ⇒ 点下去还原一条 clear 根本没销毁的记录)。**exec 落地时发现更深的盲区**:`memory_remove` 返回 `()`,前端**无从判断销毁是否真发生**,该不变式在它身上**根本无法贯彻**。⇒ 把 `memory_remove` 返回值由 `()` 改为 `usize`(与 `doc_remove`/`memory_clear`/`doc_clear` 对齐),前端**四条路径**统一据 `n` 收口:`n===0` ⇒ 不推进世代、不给撤销、如实提示。web 端降级返回 `undefined` → 视为成功(那里本无行、不可达)。
- **验**:Rust 三测试**点名跑过**(含新增 `unmappable_row_fails_closed_and_never_clobbers_or_deletes` —— **先断言 `memory_snapshot_one(...).is_err()` 证明用例真的打到故障面、非空跑**,再断言 fail-closed:B 未被删除、撤销槽仍是 A 未被污染);`repeated_memory_delete...` 现**直调 inner、覆盖真命令体**。cargo test **87 passed / 0 failed**(86→87);clippy `-D warnings` 净;fmt 净;真机 3.98s boot 零 panic。**前端双向对照**:阳性前提(桩 trash 里躺着 `PREV`)→ no-op 删除(n=0)⇒ **不给撤销**、提示「没有可删除的内容」、**PREV 未被还原**;真删除(n=1)⇒ 给撤销且**真还原 A**、报「已撤销」;clear-on-empty(n=0)⇒ 提示「没有可清除的内容」、guardrail 仍给按钮但 **`onUndo` 拒绝**、PREV 未被还原。

### ★ TTL 裁决(评审第60轮 · **订正其自己第58轮的说法**)—— 刀2b 方向已改
- **评审自我订正**:第58轮它说「TTL 会让 `toast.js` 谎报」。**刀1 落地后这条不再成立** —— token 过期 → `memory_undo(token)` 返回 Err/0 → restoreFn `return false` + 自报「已过期」→ `toast.js` **静默** ⇒ **没有假成功**。⇒ **TTL 与前端窗口的漂移已从「红线正确性问题」降级为「UX 问题」。**
- **⇒ 别为同步 TTL 建开机下发通道**(为一个 UX 常量搭跨进程配置管道;更糟的是把「正确性」错误地寄托在**两侧时钟/常量一致**上)。**正确性绝不能依赖跨进程时钟一致** —— 唯一的正确性机制是「后端权威判过期 → restoreFn 如实上报」,刀1 已给。**exec 原拟的「后端权威 TTL + 开机下发 + 注入」方向作废。**
- **目标不是「同源相等」而是「前端窗口 ≪ 后端保留窗口」**:相等是竞态(6499ms 点击、IPC 6510ms 到达 > TTL ⇒ 可见的按钮却失败)。留足余量 ⇒ **可见即可用**。
- **★更优方案:干脆不要时间 TTL,改用有界环(按条数淘汰)**。①**没有时钟就没有时钟漂移**,整类问题消失;②真正要 bound 的是**内存**(快照含 embedding,`clear` 的快照可能是整表)—— **条数 + 总字节上限才是直接杠杆,时间不是**;③前端 6.5s 的 affordance 窗口天然限制实际使用;④「撤销最近一次」自然推广为「按 token 撤销尚在环内的那次」。
- **不要把 TTL 走 `setToastLabels` 注入路**:labels 是纯呈现、零正确性含义;把 `toast.js` 的 `setTimeout` 变成 runtime 配置会暗示「前端窗口是权威」—— 恰恰相反。**保持 `toast.js` 为纯 UI 原语。**
- **`6500` vs `6000` 卫生**:若要统一,新建**无依赖常量模块**(如 `platform/shell/undo-window.js` 只 export 常量),`toast.js` 与 `guardrail` 各自 import —— 叶子边、零环、零 runtime。**可做,非必须**;只要两者都 ≪ 后端保留窗口。
- **刀2b 复核预告**:① 四个闭包消费者逐字零回归(真模块导出 + 双向阳性对照);② token 失效路径 `return false` + 自报,绝不退回默认「成功」;③ `clear` 的整表快照有**字节上限**(别让一次 clear 把 N 环撑爆)。

### ★ 第61轮独立复核 = 🏁 闭环通过 · 裁决 A/B → 已落 `007ac24`
- **★评审记了一笔态度**:exec 发现 fail-closed 换来可用性 bug 后**没有自行改**,而是把选项摆出来问 —— 「正是第59轮那次『用假理由正当化偏离』之后该有的纪律」。
- **裁决 B(`()` → `usize` 范围扩大)= 正当,批准**:「提供撤销 ⇔ 销毁确已发生」这条不变式**与命令无关**;`memory_remove` 返回 `()` 使它在该命令上**结构性无法贯彻** ⇒ **不是范围蔓延,是把不变式补完**。评审独立核实:`n` 取自 `conn.execute(DELETE)` 的影响行数(非 `snap.len()`)= 「真被销毁的行数」的直接信号,选得对;单连接全程持锁下 `snap.is_empty() ⟺ n==0`,不会打架;无其他 Rust 调用者(`generate_handler!` 只要求 `Result<T: Serialize, E>`,`usize` 满足)。
- **★★裁决 A(可用性回归)· 采纳全域映射,但必须多处一起改**:
  - **原则(比「两者都想要」更硬)**:**全域映射只在 schema 自己定义了默认值的地方合法;其余一律 fail-closed。** `created_at INTEGER **DEFAULT 0**` ⇒ `NULL → 0` 是**忠实归一化**(非猜值),快照仍**完整表示**将被销毁的行、撤销能按 schema 原意还原 ⇒ **不变式不受损**。反之 `fact TEXT NOT NULL` / `id TEXT PRIMARY KEY` —— schema **没有**为「非文本的 fact」定义默认值,全域化 = **凭空造值** ⇒ 快照不再忠实表示被销毁的行 ⇒ **trash 的意义被掏空** ⇒ **fail-closed 必须保留**。
  - **★评审点名四处;exec 独立核实为五处**(少改一处则「坏行能删、整库不能清」的不对称原样长回来):① `memory_entries`(:518,`memory_list` 用)—— **评审未点名**,但一行坏时间戳会让**整个记忆列表读不出来**,用户连看都看不到,同一原则、同一危害层级;② `memory_rows_full`(:563);③ `memory_snapshot_one`(:633);④ `doc_list` 的 `MAX(created_at)`(:742,整组皆 NULL 时 MAX 返回 NULL);⑤ `map_doc_row`(:767,`doc_chunks` schema 同为 `DEFAULT 0`)。
  - **★阳性对照按评审要求做成「改回 `i64` 必须转红」(实跑,不是嘴上说)**:临时把 `memory_snapshot_one` 改回严格 `i64` → `null_created_at_is_normalized_...` **FAILED**(panicked at :1047);还原 → ok。⇒ **测试守住的是生产代码,不是它自己。**
  - **★并更换了另一测试的 fixture**:`unmappable_row_fails_closed_...` 原用 `created_at=NULL` —— **裁决 A 后 NULL 已可映射,该 fixture 会让测试空跑**。改用 `created_at='abc'`(INTEGER 亲和列存非数字文本会**保持 TEXT**,已在 SQL 层实证 `typeof → 'text'`)⇒ 连 `Option<i64>` 也映射不了 ⇒ 真·不可映射,fail-closed 仍成立。
- **[建议]2(web stub)已落 · ★并订正评审的一处事实**:评审称「即便可达也安全,因为 `rt.memory.undo()` 是 notImpl → throw」—— **不成立**。`web.js` 里 `undo: () => Promise.resolve(0)`,**不 throw**(preview 实测 `undoThrows=false`)。**真实的 fail-honest 机制更好**:`undo` 返回 `0` → 前端 `n===0` 判据 → 报「没有可撤销的内容」+ `return false` → `toast.js` 静默。**安全性靠判据,既不靠「不可达」也不靠 throw。** `memory.remove` 原是六兄弟里唯一返回 `undefined` 的异类,现已统一返回 `0`(preview 实测六个 stub 全为 0)。
- **★残留(评审第61轮记债,留后续刀)**:真·不可映射的行(如 `fact` 存了整数)仍会让 `memory_remove`(该行)与 `memory_clear`(整表)**永久失败**,用户在 app 内**无逃生口**。**正解是把不变式再锐化一格** —— 从「**销毁 ⇔ 快照完整**」改为「**提供撤销 ⇔ 快照完整**」:不可快照的行**允许销毁,但走 guardrail 确认 + 明确告知「此行已损坏,删除后无法撤销」、且不提供撤销按钮**。**红线只要求永不谎报撤销,并未要求拒绝销毁。** 已写进 `memory_snapshot_one` 头注。
- **[建议](不阻塞,记债)**:`clear`-on-empty 的「死撤销按钮」—— 关键性质已成立(`onUndo` 拒绝、PREV 未被还原、无假成功),但按钮仍出现,因 `guardrail.showUndo` 在 `onConfirm` 之后**无条件**触发。**本轮不动**(guardrail 禁改 + UI 已隐藏空库的清空按钮)。将来若动 guardrail,**正解形状与 `toastUndo` 契约同构**:`onConfirm: () => Promise<boolean>`,返回 `false` ⇒ 跳过 `showUndo`;`undefined` ⇒ 视为 `true`(现存调用点零回归)。**同一 opt-in 纪律,复用即可。**
- **验**:四测试**点名跑过**(`null_created_at_is_normalized...` / `unmappable_row_fails_closed...` / `repeated_memory_delete...` / `noop_destroy...`);cargo test **88 passed / 0 failed**(87→88);clippy `-D warnings` 净;fmt 净;`node --check` web.js 净;preview 实测六个 web stub 全返回 `0`;真机 WKWebView 4.08s boot 零 panic。

**★刀2a 全线收官(第60/61轮闭环)。TTL 方向已定(有界环)。下一刀 = 刀2b(keyed trash · chip `task_196c6897`)。** 评审刀2b 复核重点:① 四个闭包消费者逐字零回归(真模块导出 + 双向阳性对照);② token 失效 → `return false` + 自报,绝不退回默认「成功」;③ **`clear` 的整表快照要有字节上限**(环的淘汰判据 = 条数 ∧ 字节,两者取先到);④ **环内快照与 `stash_if_destroyed` 的关系:入环即「已销毁且可还原」,空快照永不入环** —— 把这条不变式带进新结构,别在重写中丢掉。

### 刀2b-1/2 · 后端有界环 + undo token(取代单槽 trash)· commit `14423e9` · ⏳ 待审
承评审第60轮裁决(**有界环取代时间 TTL**)。用户拍板拆两刀:本刀 = 后端环 + token;**刀2b-2 = 前端穿 token**。
- **★为何有界环而非时间 TTL**(评审裁决,已写进 `data.rs` 头注):①刀1 后撤销失败已由「后端权威拒绝 → restoreFn 上报 `false` → toast 静默」兜住,**无假成功** ⇒ TTL 漂移**降级为 UX 问题**;②**正确性绝不能依赖跨进程时钟一致**,没有时钟就没有时钟漂移;③真正要 bound 的是**内存**(快照含 embedding,`clear` 的快照可能是整表)⇒ **条数 ∧ 字节才是直接杠杆**,先到者触发淘汰。
- **★`UndoRing<T>`**(`MemTrash`/`DocTrash` 由 `Mutex<Vec<Row>>` → `Mutex<UndoRing<Row>>`),**三条不变式从单槽时代原样带进新结构**(评审第61轮点名「别在重写中丢掉」):①**空快照永不入环**(no-op 销毁不发 token、**不淘汰任何条目**);②**入环即「已销毁且可还原」**;③**单次快照超字节上限 ⇒ 不入环、不发 token**。上限 8 条 ∧ 64 MiB;`with_bounds` 供单测注入小上限。
- **命令签名**:四个销毁命令 `usize` → `DestroyResult { deleted, undoToken }`;`memory_undo`/`doc_undo(token: Option<String>)` —— `Some`=精确撤销那一次,`None`=撤销最近一次(**向后兼容**,刀2b-1 前端仍不带 token)。**token 已淘汰 / 未知 / 环空 ⇒ 返回 `0`,绝不静默成功**。
- **★★本刀引入的新危险,已在同刀堵死(否则又是一条「还原错记录」)**:`deleted>0` 但 `undoToken=null`(快照超上限未入环)时,**环顶是上一次销毁** ⇒ 若前端仍给撤销,`undo()` 会取走**别人的那一次**。故新增 `offerUndo()`,把不变式锐化为 **「提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原」**,四条销毁路径全部经它收口 ⇒ **「无 token ⇒ 不提供撤销」由后端结构性保证,不再是前端约定**(正是评审第61轮所说「让它成为结构性事实」)。
- **两端 runtime 同形**:desktop `{deleted, undoToken}`;web 降级 `{deleted:0, undoToken:null}`(如实上报,不让「web 不可达」这个偶然前提承重);`undo` 两端均返回还原条数。
- **验**:Rust 新增两测试**点名跑过** —— `undo_ring_evicts_by_count_and_bytes_and_rejects_oversized`(条数判据 / 字节判据 / **超限不入环不发 token 且不淘汰既有条目**)、`undo_ring_takes_by_token_not_just_newest`(**环的价值兑现**:精确取较旧那一次;未知 token → `None`;不带 token → 取最近一次;环空 → `None`)。三个 DB 级测试**移植到环 API 并加强**:no-op 删除现同时断言「不发 token」「不淘汰旧条目」;fail-closed 测试断言「失败的删除不得污染环」;`noop_destroy...` **保留阳性对照**(旧单槽无条件覆盖确会清空)并新增「**环同时保有 A 与 B 两次销毁**」——单槽时代做不到。cargo test **90 passed / 0 failed**(88→90);clippy `-D warnings` 净;fmt 净;真机 6.54s boot 零 panic。**preview 三场景**:①**超限(deleted>0, token=null)→ 不给撤销、提示「无法撤销」、`PREV` 未被取走**;②正常 → 给撤销、真还原、报「已撤销」,且 `undo` 仍不带 token(刀2b-1 语义);③no-op → 不给撤销(第60轮不变式未回归)。web 四个销毁 stub 与桌面同形。
- **★诚实边界**:本刀**未穿 token** —— 前端撤销仍调 `undo()`(=撤销最近一次),**环的精确撤销能力由单测覆盖、尚未被 UI 使用**。穿线 + 「token 失效 → `return false` + 自报」= **刀2b-2**。
- **刀2b-2 待办(评审预告的复核重点)**:① 四个闭包消费者逐字零回归(真模块导出 + 双向阳性对照);② token 失效 → `return false` + 自报,绝不退回默认「成功」;③ `clear` 整表快照的字节上限(**本刀已落**:不变式③);④ 环内快照与「空快照永不入环」的关系(**本刀已落**:不变式①)。

### ★ 第62轮独立复核 = 有条件通过 → [应改] + 两件必落已全落 `3eb3143`
- **评审确认**:①我自己抓出并堵死的「`deleted>0 ∧ token=null` ⇒ `undo()` 取环顶 ⇒ 还原错记录」通路,**确已堵死**;②它**独立复现了我的可达性论证并判定成立**,逐条走完 (a) 同域逐条删 / (b) 同域 clear / (c) guardrail 的 clear 撤销 toast 不被追踪但被世代拒 / (d) **跨域结构性隔离**(两个独立环 + 两个独立世代)/ (e) 超限 clear 命中 `gen(0)===memGen(0)` 被显式 `!ok` 堵死。三条不变式原样带进新结构、serde 契约测试 + 阳性对照、web 降级不再让「不可达」承重 —— 全部确认。
- **★评审替我补的可达变体 (f)(我没列)**:`memGen` 是**前端模块级、刷新即归零**,而**环是后端状态、跨刷新存活** ⇒「刷新后 `memGen=0` 而环里躺着 A」是**真实可达状态**;此时一次超限 clear(`ok=false`、不推进世代)恰好命中 `gen(0)===memGen(0)` —— **`if (!ok) return;` 是唯一挡住「撤销取走环顶 A」的那道闸,不是冗余**。已写进注释,**勿并进 `gen` 判据**。
- **★★架构后果(我未意识到)· 环让 `undo(None)` 比旧单槽更危险**:旧单槽 `mem::take` ⇒ 撤销一次后槽空 ⇒ 任何虚假的第二次 undo **还原 0 条**(诚实 no-op);新环 `take(None)` 弹出环顶 ⇒ 撤销 B 后 `ring=[A]` ⇒ 虚假的第二次 undo **还原 A(别人的那一次销毁)**。**失效模式从「no-op」升级为「还原一次更早的销毁」。** 今天挡住它的全是**前端**闸(`toastUndo.done` / `guardrail.showUndo.done` / 世代 / `dropToast` / `offerUndo`)—— **纵深防御被迫承重**,与本 arc「结构性 > 约定性」的方向相反。⇒ **刀2b-2 的任务不是「把 token 穿过去」,而是「把 `None` 这个 affordance 删掉」**(`token` 必填、未命中即 0 条)。已写进模块头(明记为**临时不安全 affordance**)+ 刀2b-2 验收判据。
- **★[应改](已落)· 清空确认文案在决策点承诺了环做不到的事**:guardrail 的 `detail` **无条件**写「可在几秒内撤销」,而不变式③下超上限 ⇒ 无 token ⇒ 不给撤销,用户只在**确认并销毁之后**才被告知。**这是用户做决定那一刻的谎报**,正是 §4-3 ★所禁。**注意方向:环之前 `memory_clear` 总是入槽,承诺总能兑现 —— 是本刀让这句话变成假的**(与第61轮「是我给那个吞错装上了牙齿」同构)。**落法(采纳评审推荐的 (b))**:新增 `memory_clear_undoable` / `doc_clear_undoable` 预检命令;确认文案据此二选一;**预检本身失败 ⇒ 保守按不可撤销告知**,绝不默认承诺。
- **★问题4(已落)· 字节上限只约束保留、不约束瞬时分配**:`doc_clear` 原先先把整库 chunk+embedding **物化进 RAM**,之后才由环按上限拒绝 ⇒ 2 GiB 知识库先分配 2 GiB(可能 OOM)再被礼貌拒绝。**上限给了虚假的安全感。** 修:`*_clear_inner` **先用 SQL 量字节**(`LENGTH(CAST(.. AS BLOB))` 取字节而非字符数),超上限则**根本不物化**、不发 token、不淘汰既有条目;销毁照常发生(红线只要求永不谎报撤销,并未要求拒绝销毁)。预检与 clear 用**同一个上限**(`ring.max_bytes()`)⇒「预检说可撤销 ⇒ stash 必接受」。
- **★裁决5(已落)· 字节口径原是假上限 —— 修好它,而不是写注释承认**:原 `undo_bytes` 用 `len()` 且不计结构体开销 ⇒ 账面 < 真实。评审:「**一个低估的账本不是上限**;把「这是下界」写进注释 = **记录一条假不变式(本 arc 第七次)**。**别记录,修好它。**」改用 `capacity()`,`stash` 另计 Vec 槽位 + `UndoEntry` 本体 + token 堆(不重复计数)。**实测坐实**:一条 `MemRow` 的真实入环开销 ≈110 B(两个 `String` 头 24B + `Vec` 24B + `i64`),而非旧账面的 ~9 B —— 原测试用 64 B 上限竟能装下,**正是假上限的证据**(该测试因此转红,已改为**先量出**一条的真实开销再设上限,不写死魔数)。
- **★裁决6 · 我提的「单条超限也入环、淘汰其余」被否**:那样**上限就不再是上限**(一条即可无界),等于退回旧的无界单槽。**大 clear 想要可撤销的正解是落盘**(仿 `clearAllDataFlow` 的清前备份),不是撑大 RAM 环。**留后续刀。** 64 MiB 作为「多次逐条删的累积保留上限」合理,**不该被调大去迁就 clear**(那只是把悬崖挪远)。
- **★裁决7 · 我最大的顾虑(`Option<String>` + null)由先例解决,风险可退**:`ai_chat(task: Option<String>)`(ai.rs:212)在 desktop.js:100 被以 `task: req.task || null` 调用,而 `streamReply` 从不传 task ⇒ **产品里每一条 Agent 消息都在向一个 `Option<String>` 命令显式传 `null`**,且工作正常。同形先例还有 `db_list(query)` / `ai_extract(image_data_url)` / `cap_invoke(input)`。桌面 e2e 仍值得顺手跑,但**不再是阻塞项**。
- **同刀订正过时注释(勿留假陈述)**:模块头与三处行内注释仍写「单槽覆盖 / `*trash = snap`」—— 环已取代之。改为:今日「撤销最近一次」的理由**不再是**单槽被覆盖,而是**本模块尚未穿 token**。
- **验**:Rust 新增 `clear_over_byte_cap_skips_snapshot_and_matches_its_own_precheck`(**点名跑过**):超上限 ⇒ `deleted=1`、**不发 token**、**不淘汰 PREV**、预检与 clear 结论一致;反面:小库预检说可撤销、clear 确实发 token。cargo test **92 passed / 0 failed**(91→92);clippy `-D warnings` 净;fmt 净;真机 6.99s boot 零 panic。**preview**:预检说可撤销 → 文案承诺撤销;预检说不可 → **确认前**即告知「无法撤销」且不含旧承诺;**预检失败 → 保守告警**;`detail` 为纯文本(guardrail 走 `textContent`,无 markdown);docs 侧同款。

**★刀2b-2 验收判据(评审在其两条之上加的第③条)**:① 四个闭包消费者**逐字零回归**(真模块导出 + 双向阳性对照,别让控制组空跑);② token 失效 → `return false` + 自报,**绝不退回默认「成功」**;**③ 删除 `undo(None)` 这个 affordance —— `token` 必填,未命中即还原 0 条。** 做完第③条,「还原错记录」才从「靠前端五道闸挡住」变成**结构上不可能**,这个 arc 才算真正收口。
**后续刀(记债)**:大快照 **spill 到磁盘**(仿 `clearAllDataFlow` 清前备份)⇒ 内存有界、撤销恒可用;guardrail `onConfirm: () => Promise<boolean>`(`false` ⇒ 跳过 `showUndo`,`undefined` ⇒ 视为 true,现存调用点零回归)。

### 刀2b-2/2 · 删除 `undo(None)` affordance:token 必填 · commit `71abe1f` · ⏳ 待审
承第62轮验收判据③。**撤销债 arc 由此收口。**
- **★核心不是「把 token 穿过去」,而是把 `None` 这个 affordance 删掉**(评审原话)。落法:`UndoRing::take(&mut self, token: &str)` —— `Option<&str>` 与「取环顶」分支**一并删除**;`memory_undo`/`doc_undo` 形参 `Option<String>` → `String`。**编译器即证明**:改签名后旧的 `take(None)` / `take(Some(..))` 调用点直接 E0308 —— 「取环顶」在**类型层面不再可被表达**。未命中(已淘汰/未知/已取走)→ 还原 0 条,绝不静默成功。
- **前端**:`offerUndo()` 由返 bool 改为**返 token(或 null)** ⇒「无 token ⇒ 不提供撤销」不再是前端约定,而是后端结构的显式化。四条销毁路径各自捕获**自己那一次**的 token 并在撤销回调回传;token 失效 → `staleUndo()` 自报 + `return false` ⇒ toast.js 不报「已撤销」(刀1 契约)。两端 runtime `undo(token)` token 必填。
- **同刀订正模块头**(勿留假陈述):第62轮写下的「本模块尚未穿 token ⇒ undo() 取环顶」已不成立。改为:今日撤销语义 = **「撤销它自己那一次销毁」**,由 token 结构性保证;并明记 **`memGen`/`docGen` 世代守卫、`dropToast`、`toastUndo.done` 已降为纯纵深防御,不再承重**(但也别删 —— 变体 (f) 的分析仍成立,只是不再是唯一那道闸)。
- **★staleUndo 措辞与成功提示解耦**:原文案含「已撤销**过**」——**内含「已撤销」四字**,那是 toast.js 成功路径的专用提示。复用会让用户(以及断言)把一次失败读成成功。此问题正是被我一条**子串断言**暴露的(`/已撤销/` 命中失败文案)⇒ 判据改为**精确匹配 toast 节点全文**,措辞亦改。
- **验(三条判据,每条配一个能亮的控制组)**:
  - ①**四个闭包消费者逐字零回归** —— 真模块导出(`typeof window.toastUndo === 'undefined'` 佐证控制组不是空跑,`CTL_moduleIsReal`);`restoreFn` 返 `undefined` → 仍报「已撤销」且闭包真跑;两个独立闭包快照并存、各自独立执行(`C1_twoIndependentToasts` / `C1_bothRanIndependently`);**真消费者端到端**(notes.js:48):新建 → 删 → 撤销 → **按原 id 还原**、仍报「已撤销」;**双击撤销**不重复插入、恰**一条**「已撤销」(刀1 `done` 闸未被本刀破坏)。
  - ②**token 失效** → 后端被调用(带 token)、还原 0 条、`staleUndo` 自报、**exact「已撤销」toast 数 = 0**、db 未变。**阳性对照**:成功路径确实产出 exact「已撤销」toast(`CTL_successProducesExactUndoneToast: true` ⇒ 判据能亮)。
  - ③**token 必填** —— 前端实际以**后端签发的那个 token** 调 undo(非 undefined);**结构性**:即便撤销的不是环顶,也**只还原它自己那一次**(A 被还原、B 原封不动、环内仍留 B)。Rust `undo_ring_takes_only_its_own_entry_by_token`(**点名跑过**):非环顶按 token 精确取 / 未知 token → `None` / **同一 token 不得撤销两次** / 环空 → `None`。
  - cargo test **92 passed / 0 failed**;clippy `-D warnings` 净;fmt 净;真机 WKWebView **5.14s boot 零 panic、进程存活**。
- **★诚实边界**:桌面真 `invoke('memory_undo', { token })` 未被端到端驱动(Rust 单测 + boot + web 桩 + preview 覆盖其余)。`Option<String>` → `String` 比第62轮裁决7 讨论的形状**更不易出错**(必填而非可空)。

**★撤销债 arc 收口**:刀1(toastUndo 契约:`undefined`=成功 / `false`=静默失败 / throw=错误)+ 刀2a(no-op 守卫 · fail-closed 快照 · 全域映射 · 据条数收口)+ 刀2b-1(有界环 · token 签发 · 决策点说真话 · 真字节上限)+ 刀2b-2(token 必填)。**「还原错记录」不再靠前端五道闸挡住,而是结构上不可能。**
**未清之债(记账,非本 arc)**:① 大快照 **spill 到磁盘**(仿 `clearAllDataFlow` 清前备份)⇒ 内存有界 ∧ 大 clear 恒可撤销;② guardrail `onConfirm: () => Promise<boolean>`(`false` ⇒ 跳过 `showUndo`;`undefined` ⇒ 视为 true ⇒ 现存调用点零回归);③ 「无逃生口」锐化:允许经 guardrail 销毁不可映射行(明告「不可撤销」);④ `toast.js` 的 `撤销`/`已撤销` CN-only #6 债(出口:标签参数化 / `setToastLabels`);⑤ `jobseek.rs` #6 i18n 债(随 app-tool 契约解);⑥ **路线 B 封顶**:app-tool 契约落地前不新增 `src-tauri/src/<app>.rs` 工具。

### ★ 第63轮独立复核 = 有条件通过 → [应改] + Q2 + [建议] 全落 `7f9416e` · **撤销债 arc 收口**
- **★★[应改] · token 命名空间重叠 —— 「结构上不可能」原本只在**环内**为真(本 arc 第八次「勿声明假不变式」,而它就出现在**收官宣言**里)**:两个 `UndoRing` 各有 `next: u64` 且都从 1 起 ⇒ `MemTrash` 与 `DocTrash` 的首个 token **同为 `"u1"`**。**token 不自带环身份** ⇒ 一个环的 token 若被交给另一个环的 undo,`position()` 会命中**同序号的另一次销毁**并静默还原它。今天不可达 —— **但挡住它的是前端约定,不是结构**。
  - **我独立核实了这条不可达性**(preview,两域故意发同号 token `"u1"`):记忆路径只调 `memory.undo("u1")`、文档路径只调 `docs.undo("u1")`,**零跨域调用**。⇒ 评审的「今天不可达」属实,「靠约定」也属实。
  - **落法(取评审第二个选项,strictly stronger)**:进程级 `static UNDO_TOKEN_SEQ: AtomicU64`。任意两条环条目 token 永不相同 ⇒ 错配必然落空 → `None` → 0 条 → `staleUndo()`。**失败从「静默还原错域」变成「响亮拒绝」**,且对未来的第三个环**天然免疫**(无需记得挑一个没被占用的前缀)。环的 `next` 字段删除。列为 `UndoRing` **不变式④**。
- **★★Q2 裁决 · 世代守卫 / `dropToast` 从「安全」降为「策略」(必须改注释)**:token 化后,一个陈旧撤销 toast 点下去 —— token 还在环里 ⇒ **精确还原它自己那一次(正确!这正是环存在的意义)**;已失效 ⇒ 诚实拒绝。**两种结果都不是「还原错记录」⇒ 现在删掉世代守卫是安全的。** 它只在执行一条**产品选择**「只有最近一次可撤销」。**★评审的判词:「你现在可以安全地删掉世代守卫」这个事实本身,就是安全性已迁入类型系统的证明;arc 收口的判据不是「闸还在」,是「闸没了也不出错」。** 全部注释改标「策略,非安全」。
  - ⚠ **不得一起降级的那一条**:`toast.js` 的 `done` 重入闸**仍为另外四个闭包消费者(notes/prompts/resumes/jobs)承重** —— 它们的 `restoreFn` 是 `splice(i,0,snap)`,双击会重复插入。memory 侧才是纵深。
- **★顺手清掉评审未点名、但已随刀2b-2 变假的四处陈述**:①「未穿 token ⇒ `undo()` 取环顶」;②「若 remove 失败…环顶仍是上一次销毁」;③「web 端降级返回 undefined → **视为成功**」(**实为 `{deleted:0,undoToken:null}`,被 `offerUndo` 拦下**);④「DocTrash 与 MemTrash…**均未穿 token**」。并把 `!token` 早返的**理由**改对:它挡的不再是「撤销取走环顶的别人那一次」,而是**一次注定失败的 IPC + 一条莫名其妙的错误 toast**(`token: String` 非 `Option`,`undo(null)` 在反序列化处即被拒;退一万步 `take("")` 也只会落空 → 0 条 → `staleUndo`)。**仍要保留。**
- **★[建议] 已落 · 预检与 stash 是两套账,方向须钉死**:预检 = SQL 侧估计(`payload*2 + rows*row_size*2 + OVERHEAD`),stash = 真实 `capacity` 口径,二者只共用同一个 `max_bytes()`。需要的性质是 **`预检估计 ≥ stash 实际`**,否则「预检说可撤销 → 承诺 → clear → stash 拒绝 → 无 token」= **第62轮 [应改] 原样复发**。新增 `clear_precheck_upper_bound_is_never_below_actual_stash_bytes`(点名跑过)。
  - **★阳性对照用变异测试证明能证伪生产代码**:把生产 `undo_bytes_upper_bound` 的系数 2 临时改 1 → 测试 **FAILED**(`预检上界 1810 < 实际 2812`);还原 → 绿。机理:`memory_rows_full` 用 `push` 建 Vec ⇒ 容量按 4→8→16→32 摊还翻倍 ⇒ `capacity > len` ⇒ 17 条**小行**时系数 1 必然低估。**fixture 选「多条小行」而非「一条大行」正是为此**(载荷主导时系数 1 也过得去,测试会变死靶)。
- **★评审对我提的 standing 规则:采纳其一、驳回其二 —— 我认同驳回**:
  - ✅ **采纳(standing)**:**对用户可见文案的断言,必须精确匹配文本节点全文,禁止子串匹配。** 由测试自身强制执行,永不失效。
  - ❌ **驳回(降为 advisory)**:「失败文案不得内含成功文案的子串」—— 把**产品文案**耦合到**测试技术**,且**语言相关**(中文 `已撤销` ⊂ `已撤销过` 成立;英文 `Undone` 与 `Undo expired` 不成立),**无任何机制强制执行**,一次翻译即可悄悄破坏。**用精确匹配挡住这一类,而不是让文案绕着测试走。**
- **★★方法论遗产(评审归并三条为一族)**:第56轮「不触发的控制组」· 第59轮「浏览器缓存的旧模块」· 第63轮「命中失败文案的子串断言」⇒ **控制组必须能亮;断言必须能红。**
- **验**:两 Rust 新测试点名跑过(`undo_tokens_never_collide_across_independent_rings` 自带阳性对照:复刻旧的每环计数器必定撞号 + **错配 token 双向落空** + 各自 token 仍正常);cargo test **94 passed / 0 failed**(92→94);clippy `-D warnings` 净;fmt 净;`node --check` 净;真机 WKWebView **2.20s boot 零 panic、进程存活**。preview(真模块导出,`typeof window.renderMemory === 'undefined'` 佐证非空跑):**跨域路由**(两域同号 token、各自只调自己那个命令、零跨域)+ 成功路径 exact「已撤销」toast = **1**(判据能亮)+ 失效路径 exact「已撤销」= **0** 且如实报「该撤销已失效」。

**★★撤销债 arc 全线收口**:刀1(`toastUndo` 契约)+ 刀2a(no-op 守卫 · fail-closed 快照 · 全域映射 · 据条数收口)+ 刀2b-1(有界环 · token 签发 · 决策点说真话 · 真字节上限)+ 刀2b-2(token 必填)+ 收尾刀(token 跨环唯一)。**「还原错记录」不再靠前端五道闸挡住,而是结构上不可能 —— 环内靠 `take(&str)`,环间靠全局唯一序号。安全性从五道前端闸,搬进了类型系统。**
**后续刀(评审裁的次序,均不阻塞 P2)**:② guardrail `onConfirm: () => Promise<boolean>` —— **先做**(最便宜,且消掉本 arc 残留的最后一处「沉默」:超限 clear 后 guardrail 仍给按钮,点下去 `if (!token) return;` 一声不吭,而整条 arc 的主题就是「失败必须出声」);③ 不可映射行的**逃生口**(一行坏数据同时 brick 掉逐条删与整库清空;可达性≈0 但后果是记忆功能整体不可管理 —— **若有用户报「某条记忆删不掉」,立刻插队**);① 大快照 **spill 到磁盘**(已由预检如实披露,从「谎报」降为「能力缺口」,等知识库功能成熟再做)。

### 撤销债 后续刀② · guardrail `onConfirm` 返回值契约 · commit `4780bd3` · ⏳ 待审
承第63轮 Q3 裁的次序(②先做)。**消掉整条撤销 arc 残留的最后一处「沉默」**:超上限 clear 之后 guardrail 无条件 `showUndo`,按钮照样出现,点下去被 `if (!token) return;` 早返 —— 一声不吭,而 arc 的主题正是**失败必须出声**。
- **契约(与 `toast.js` 的 `toastUndo` 逐字同款)**:`onConfirm` 返回**显式 `false` 或 `0`** ⇒ 没有可还原之物 ⇒ **按钮根本不出现**;返回 `undefined`(块体箭头隐式返回)⇒ 视为已执行;**抛错** ⇒ 销毁是否发生未知 ⇒ 同样不给按钮(此前 `catch{console.error}` 吞错后**仍给按钮** —— 同缺陷类的最后一条支路,一并堵死)。
- **★判据取 `v !== false && v !== 0`,不是只判 `!== false`**:preview 的 `C4_returnsZero` 暴露了两个姊妹原语的分歧 —— 否则 `onConfirm: async () => (await rt.x.remove(id)).deleted` 返回 `0` 时二者结论**相反**。**一份契约,一条规则。**
- **★零回归 = AST 机械核实,不靠肉眼**:全仓 **15** 个 `onConfirm` 属性**全是块体箭头 / function 体** ⇒ 隐式返回 `undefined` ⇒ 判据恒真。审计脚本自带**阳性对照**(临时塞一个表达式体箭头 → 审计器点名;移除 → 归零)。
- **★★同刀堵一处评审未点名的决策点自相矛盾**:`note.textContent = opts.onUndo ? '执行后可撤销。' : ''`(guardrail:99)只看 `onUndo` 是否存在 ⇒ 超上限 clear 的对话框**同时**印出「内容过大,清除后无法撤销。」(detail,第62轮修的)与「执行后可撤销。」(note)——**同一个对话框两句互相打脸**。修:两条 clear 路径**预检说不可撤销 ⇒ 连 `onUndo` 都不传** ⇒ 提示行自然消失(零新 API:`opts.onUndo` 本就是这行的开关)。
- **★`resolve` 语义刻意不动**(函数头 ⚠⚠ 钉死):它是「**用户是否点了确认**」,**不是**「是否执行成功」。`capability/mcp/confirm.js:39` 把它直接当 `approved` 回传 `rt.mcp.confirmResolve` ⇒ 若合并成「执行成功」,一个返回 `false` 的 `onConfirm` 会把**用户的「允许」静默翻转成「拒绝」**。安全语义,两处标注勿改。
- **§4-3 · 不给应用任何新权力**:应用本来就能通过**不声明 `onUndo`** 让销毁无从撤销;`false` 只是把同一个决定挪到执行之后(「有没有可还原之物」往往执行时才知道)。**不能**绕过确认闸。已写进 `WidgetActionSpec.onConfirm` 类型注释。
- **验**(每条判据配一个**能亮**的控制组;真 `window.SeekerGuardrail` 实例 + `CTL_freshCode` 佐证跑的是新码):
  - **原语面**:`undefined` → **仍给按钮**(阳性对照)· `false`/`0` → 无按钮 · `1` → 给按钮 · 抛错 → 无按钮 · `resolve` 恒为「用户点了确认」· 无 `onUndo` ⇒ 不印「执行后可撤销。」
  - **安全消费者**(mcp/confirm.js 形状):确认 → `approved=true`;取消 → `approved=false`;两路均无游离撤销按钮。**MCP 允许/拒绝语义零漂移。**
  - **真消费者端到端**(`renderMemory` 清空,真模块导出):①**超上限**(deleted=1, token=null)→ **无死按钮** + 对话框只说「无法撤销」**且不再印「执行后可撤销」** + toast 如实;②**阳性对照·正常 clear** → 按钮出现 + 对话框印「执行后可撤销」;③ no-op clear → 无按钮 + 「没有可清除的内容」。
  - tsc 无新增(61→61;guardrail 与 types.d.ts 零 error)· `node --check` 净 · Rust 未动 94/0 · 真机 WKWebView **2.14s boot 零 panic、进程存活**。
- **记债(不扩范围)**:`doc_remove` **无单篇预检**(后端只有 `doc_clear_undoable`)⇒ 事前的「执行后可撤销。」在「执行时才发现整篇超上限」的罕见情形下仍是一句事前承诺(按钮不会出现、toast 如实,但话已出口)。正解:补 `doc_remove_undoable`,与两条 clear 路径同款。代码处已标注。
- **剩余后续刀**(第63轮次序):③ 不可映射行的**逃生口** → ① 大快照 **spill 到磁盘**。

### ★★ 第64轮独立复核 = 🏁 **撤销债 arc 签字收口**(第56–64 轮)+ 1 [应改] + 3 [建议]
评审裁定核心不变式「还原错记录结构上不可能」**现在是真话**:token 取自进程级 `UNDO_TOKEN_SEQ` · `take(&str)` 只按 token 定位 · `token: String` 必填 · 前端 `offerUndo` 返回 token 本身 ⇒ **没有 token 就在类型上无法提供撤销**。
- **验收清单三条全过**;评审特别记下:①我先独立复核它的两句判断才动手(代码上确实撞号;preview 里故意发同号验证「今天不可达、挡住它的是约定」);②我顺手清掉四处它没点名、但已变假的陈述;③**我没有假设它给的阳性对照(系数 2→1)会成立,而是做了变异测试** —— 结果发现 fixture 必须是「多条小行」,否则载荷主导时系数 1 也能过、测试成死靶。评审:「**这正是外审存在的意义反向生效**,而且我错了一半。」
- **★评审的收口定义**:「那五道闸还在,但现在**删掉任何一道都不会产生错还原** —— 这就是收口的定义。」
- **★方法论遗产(评审点名收进 `reviewer-onboarding.md` §4)**:**控制组必须能亮,断言必须能红。** 不触发的控制组 / 缓存的旧模块 / 命中失败文案的子串断言 / 载荷主导的字节 fixture —— **同一族**。**测试没先失败过,就什么都没证明。**(已落 §4 新增 ⑥⑦ 两节。)

#### 后续刀③(队首)· `doc_remove` 单篇预检 · commit `47c27ad` · ⏳ 待审
- **★评审裁 Q1 = 算 §4-3 ★ 的决策点谎报,且排在 ③ 之前**。链条:`doc_remove` 无条件传 `onUndo` → guardrail **在建对话框时**就印出「执行后可撤销。」(guardrail:116)→ 用户据此确认 → `onConfirm` 执行时才发现整篇超上限 → 返 `false` → 按钮不出现 → 事后 toast。**话已经出口了。** 与第62轮判 [应改] 的 clear 路径同一类、同一机制,**定级必须一致**。评审:**「一条只在 3/4 条销毁路径上成立的不变式,不是不变式。」** 可达性亦严格高于 ③(单篇 >64 MiB ≈ 上万 chunk,用户加得出来;③ 需坏库,app 写路径造不出来)。
- **落法**:`doc_clear_undo_bytes` → `doc_undo_bytes(conn, doc_id: Option<&str>)`;新命令 `doc_remove_undoable(doc_id)`;两端 runtime;前端**先问预检再开对话框**,不可撤销 ⇒ detail 明说 + **连 `onUndo` 都不传**。**顺带修同支路的瞬时分配**(第62轮问题4 只修了 clear):`doc_remove_inner` 原先**先物化整篇再让环拒绝**,现改为先量后物化,与预检共用同一 `max_bytes()`。
- **★同刀订正两处 Rust 假陈述**(评审未点名):`memory_undo` 头注仍写「`token=None` → 撤销最近一次(向后兼容)」(该分支已在类型层面不存在);`doc_undo` 头注仍写「撤销**最近一次** … → **清空 trash**」(单槽时代的话)。
- **★★同刀修一处被 tsc 噪声底掩盖了三刀的类型漂移**(自查):`runtime/types.d.ts` 的 `MemoryApi`/`DocsApi` 自刀2b-1 起就在说谎(`remove(): Promise<void>` / `undo(): Promise<number>` 无 token、无 `DestroyResult`、无 `clearUndoable`)。tsc **一直在报**(TS2353/TS2322),但淹没在 61 条基线里 —— 而我历刀的判据是「**无新增** error」,**必要而不充分**:当基线里就有我正在改的文件的 error 时,「无新增」什么也没证明。补齐后 **tsc 61 → 51**(runtime/ 全清)。已收为 standing(§4-⑥)。
- **验**:两 Rust 新测试**点名跑过**;`doc_remove_precheck_is_per_doc...` 的阳性对照经**变异测试**证明能证伪生产代码(去掉 SQL 的 `WHERE doc_id` → 断言变红「小文档不得因『别的文档很大』而被判不可撤销」,还原 → 绿);96/0(94→96);clippy/fmt 净;真机 1.83s boot 零 panic;preview 真模块 e2e(先调 `removeUndoable('d1')` → 超上限:对话框只说「无法撤销」、不印「执行后可撤销」、无按钮、toast 如实;**阳性对照·正常删除**:印提示 + 给按钮)。
- ⇒ **「决策点不得承诺做不到的撤销」现已在全部四条销毁路径上成立**(三条 guardrail 路径各自先问预检;第四条走 `toastUndo`,事后提示、事前无承诺)。

#### 后续刀④ · 死闸响亮化 + `succeeded` 去重 + guardrail 容忍缺省 `onConfirm` · commit `d99558f` · ⏳ 待审
- **★Q2 裁决 · 两个选项(留/删)评审都不选,正解是「改响亮」**:`if (!token) return;` 守的分支结构上不可达,但它是**静默 `return`**。推演其唯一可能的作用 —— 没有它:某次重构让 token 变假 → `undo(undefined)` → 后端 `token: String` 反序列化报错 → `toast(errText)` → **响亮**;有它:直接 return → 用户点撤销**一声不吭**。⇒ **这道闸唯一可能的效果,是把一次响亮的失败变成一次沉默的失败** —— 正是整条 arc 消灭的那个东西。改 `noTokenUnreachable()`(`console.error` + `staleUndo()` + `return false`),三处全改。**无论可达与否,它只能让事情更响,永远不会更静。**
- **[建议]六 · `succeeded` 有两份拷贝** ⇒ 抽 `platform/outcome.js`(零依赖叶子,**零 import / 零副作用 / 零 i18n** ⇒ 无环、不移动 module-eval 求值序)。放 `platform/` 根而非 `platform/shell/`:**`guardrail/` 不该为一个纯谓词去依赖 `shell/`**(层级方向)。**一份契约,一条规则,一处代码。**
- **★[建议]四 · guardrail 容忍缺省 `onConfirm` —— 我偏离了评审给的落法并说明理由**:评审指出 mcp 传的 `onConfirm: () => {}` 现在**承重**(有人「清理」掉它 ⇒ TypeError ⇒ 每次 MCP 批准打一条 `[guardrail] 执行失败`),属实;它建议 `? await opts.onConfirm() : undefined`(⇒ `executed=true`)。**我改为 fail-closed**:`opts.onConfirm ? succeeded(await opts.onConfirm()) : false` —— `undefined` 会让「什么都没执行」也印出撤销按钮,与本 arc 核心不变式相悖。对 mcp(空实现 + **无 `onUndo`**)两者等价、陷阱一样消掉;但对将来「有 onUndo 却漏了 onConfirm」的调用点,fail-closed 才是对的那一边。
- **★留痕订正(评审第五节 · 覆盖声明本身也要为真)**:我上一刀说「零回归靠 AST 机械核实」——**该审计器查字面量 `onConfirm:` 属性,看不见 spread 路径**(`widget-actions.js:29` 的 `{...spec, source}`)。结论仍是无活回归,但**挡住它的不是我的审计器**,而是 `WidgetActionSpec.onConfirm` 的必填约束 + registry 的 `typeof spec.onConfirm === 'function'` 守卫。与第49轮「tokenizer 须 spread-aware」同族。(本刀的 fail-closed 缺省处理顺带给这条 spread 路径兜了底。)
- **★Q3 裁决 · 不拆 `resolve`**(评审给的理由比我写的更硬):两条通道回答两个正交问题给两类消费者 —— `resolve` → 「用户批准了吗」(mcp 当 `approved` 回传后端);`onConfirm` 返回值 → 「销毁发生了吗」(闸 `showUndo`)。合并 = **模型外部工具调用路径上的安全语义反转**。
- **验**:响亮化(伪造旧行为 guardrail 强制走进不可达分支 ⇒ `console.error` 含「不变式破坏」+ 用户可见 toast + 返回 `false` + **exact「已撤销」= 0**);共享谓词(两处均 import、本地拷贝已删;`toastUndo` 与 `guardrail` 的 `undefined` 路径均为**活靶**、`0` 路径均静默/无按钮);缺省 `onConfirm`(不抛、不给按钮、`resolve(true)`;mcp 形状 `approved=true` 照旧);tsc 51→51(三文件零 error)、AST 审计仍 0 回归面、Rust 96/0、真机 boot 零 panic。

**下一刀次序(评审裁定)**:③ **不可映射行的逃生口**(一行坏数据同时 brick 掉逐条删与整库清空;可达性≈0 但后果 = 记忆功能整体不可管理;**若有用户报「某条记忆删不掉」立刻插队**)→ ① **大快照 spill 到磁盘**(已由预检如实披露,从「谎报」降为「能力缺口」)。

### 撤销债 后续刀⑤ · 不可映射行的逃生口 · commit `8214e42` · ⏳ 待审
承第64轮裁的次序 ③。落法即红线自己写好的那条(§4-3「做不到可靠撤销就走 guardrail 确认闸」)⇒ **允许销毁 + 明告不可撤销 + 不给撤销按钮**。
- **不变式锐化一格**(第61轮记债 → 本刀兑现):旧「**销毁** ⇔ 快照完整」(fail-closed ⇒ 坏行删不掉、整库也清不掉 ⇒ **app 内无逃生口**)→ 新「**提供撤销** ⇔ 快照完整」(红线只要求永不谎报撤销,并未要求拒绝销毁)。
- **★★落码时实测到一个比「删不掉」更坏、记债里没写的后果 —— 这不只是可用性 bug,是 §4-2**:一行 `created_at='abc'` ⇒ `memory_entries` **整体报错** ⇒ 前端 catch 成空数组 ⇒ 用户看到「**AI 还没有记住任何内容。**」;而 `memory_all`(recall 那条路)**照常返回全部记忆**。**这个视图的全部意义就是「让用户查看与删除 AI 记住的内容」,它却在对用户说谎。** `doc_list` 同理(`MAX(created_at)` 为 TEXT 时整个知识库列不出,而 `doc_chunks_all` 照常召回)。⇒ **逃生口的第一步不是「能删」,而是「能看见」** —— 看不见的行没法点删除。
- **地基 · `typeof()` SQL 谓词**:与 rusqlite `FromSql` 的接受集**逐列等价**、**零物化**(故可用于 clear 的物化前预检)。实测五种损坏形态:`created_at` 为 TEXT / **REAL**(`1.5` 也不可映射 —— 光判 TEXT 不够)、`fact` 为 BLOB、`id` 为 BLOB、`embedding` 为 TEXT。等价性由 `typeof_predicate_matches_rusqlite_acceptance` 钉死。
- **落地**:①`memory_entries` / `doc_list` 宽容读列(`text_lossy`/`int_lossy`),**永不因一行坏数据整体失败**,逐行/逐篇给 `corrupt` + 记忆行给 **`rowid`**(坏行的 `id` 本身可能不可映射,不能当删除键)。**宽容只用于「给人看」的列表 —— 快照仍严格 fail-closed**(有损转换不是忠实快照)。②新命令 **`memory_remove_corrupt(rowid)`**:按 rowid 删、不快照、不发 token、不碰撤销环;**★★结构性守卫:拒绝销毁健康行** —— 否则它就是「绕过快照直接删」的后门,任何调用点都能拿它无声摧毁一条本可撤销的记忆。加了守卫,不变式在类型之外也成立:**健康行永远有快照可撤销;只有不可快照的行才可能被无撤销地销毁,且必经 guardrail 确认。**③预检返回 `bool` → **`{undoable, reason}`**(`ok`/`corrupt`/`too_large`)——**决策点不仅要说真话,还要说对理由**;`corrupt` 优先于 `too_large`。④三条 guardrail 路径:预检说不可撤销(超限**或**有坏行)⇒ 不物化、不发 token、**照常销毁**;说可撤销 ⇒ 快照仍严格 fail-closed。⑤**docs 侧同款**(不做「同一缺陷因所在支路不同而两种待遇」)。
- **验**:五个 Rust 新测试**点名跑过**;**变异测试证明两条最承重的断言能证伪生产代码** —— ①拿掉 `memory_remove_corrupt` 的「拒绝健康行」守卫 → 后门测试 FAILED;②从 `MEM_CORRUPT_PRED` 删掉 `created_at` 一列 → 等价性测试 FAILED;各自还原 → 绿。等价性测试**自带**弱化谓词的阳性对照(断言「分歧确实存在」,否则它是死靶)。断言里钉死那条谎言(坏行在列表里看得见、`memory_all` 一直读得到);并断言「**坏行删掉之后,健康行的常规删除恢复可撤销**」(整库解锁 = 逃生口真的有效)。cargo test **101 passed / 0 failed**(96→101);clippy/fmt 净;真机 1.73s boot 零 panic。
- **preview**(真模块导出 + **真 `window.SeekerGuardrail` 实例**;中途发现前一次 eval 覆写了 guardrail 桩,reload 还原后重跑):坏行看得见/标出/用 rowid 作键;删除走 guardrail、明告「删除后无法撤销」、**连 `onUndo` 都不传**、调用 `removeCorrupt(7)`、toast 如实、**exact「已撤销」toast = 0**;**后端拒绝(「该记录未损坏」)如实浮出,绝不静默**;**阳性对照**:健康行仍走即时删 + `toastUndo` 且给出撤销按钮(零回归)。三种 reason + 预检抛错 → 四种文案各不相同,不可撤销时**都不印**「执行后可撤销。」,`ok` 印(判据能亮)。**§4-4**:坏行的 `fact` 是有损转换的字节,进 DOM 仍全经 `cEsc`(`<img onerror>` 惰性、`data-memcorrupt` 属性位精确回环)。tsc 51→51(runtime/ 零 error;新 helper 顺手补 JSDoc,**不让 baseline 吸收新 error** —— 第64轮 standing 自用)。
- **诚实边界**:`doc_id` / `id` 列**本身**存成 BLOB 时,该篇/该行仍无法按名寻址(记忆侧有 `rowid` 兜底;文档侧只能靠整库清空)。可达性远低于 `created_at`/`fact` 损坏;**未修,如实记债。**

**剩余后续刀**:① 大快照 **spill 到磁盘**(评审第64轮:已由预检如实披露,从「谎报」降为「能力缺口」,等知识库功能成熟再做)。

### ★ 第65轮独立复核 = 🏁 通过 + 3 裁决 + 2 [建议] → 两刀全落 `51d41b0` + `556228f`
**评审先认错**:它在第62/64 轮把这条记债定性为「可用性悬崖」,**低估了**。代码坐实:`memory_all`(recall)不读 `created_at`,`memory_entries`(用户列表)读 ⇒ 一行 `created_at='abc'` ⇒ 用户被告知「AI 什么都没记住」而 AI 仍记得全部 ⇒ **这是 §4-2(用户对 AI 可读内容的掌控),不是可用性**。评审判词:「**逃生口的第一步不是能删,而是能看见**」是本刀的真正洞察。

#### 裁决 2(采纳)· 守卫改由「快照当裁判」 · commit `51d41b0`
- **病灶**:`memory_remove_corrupt` 原用 `MEM_CORRUPT_PRED` 二次判定拒绝健康行。这道守卫是**安全属性**,于是「谓词 ≡ rusqlite `FromSql`」也成了安全属性 —— 而它是一份**跨依赖版本的维护负债**。**危险方向 = 谓词比 rusqlite 更严**:一条健康、可快照的记忆会被**无快照、无撤销地销毁**(静默、不可逆)。
- **正解(评审原话)**:「**这行能不能快照**」的权威答案就是**快照代码本身**。抽 `map_mem_row`(与既有 `map_doc_row` 同款先例),`memory_rows_full` / `memory_snapshot_one` / 新增 `memory_row_state` **三处共用同一份映射** ⇒ 裁判 literally 是快照代码,而非重抄一份列清单。等价性遂**从安全属性降级为展示属性**(只剩列表打标 + clear 预检两个咨询性用途)。
- **★★与评审落法的刻意分歧(已写进代码注释)**:它写 `Err(_) => DELETE`。**那会把一次瞬时 DB 错误(sqlite BUSY / 磁盘 / 语句失败)读成「这行坏了」而销毁它。** 故严格区分「取行/语句失败」(传播 `Err`,**绝不销毁**)与「行取到了、列转换失败」(才是 `Unmappable`)。另:行不存在仍返回 `Ok(deleted:0)` 的**诚实 no-op**(评审草稿写 `Err("不存在")`)—— 与 `memory_remove`/`memory_clear` 的 no-op 语义一致,也是 `offerUndo` 的 `deleted===0` 分支所依赖的。
- **★跨版本对照实验(最强证据)**:把 `MEM_CORRUPT_PRED` 改成过严的 `"1=1"` —— **A. 旧码(`8214e42`,谓词当判据):`remove_corrupt_refuses_healthy...` FAILED(健康行被销毁)** ⇒ 评审预言的危险方向被实测复现;**B. 新码(快照当判据):同一过严谓词下测试照样绿**。
- 新测试两个点名跑过:`row_state_asks_the_snapshot_itself_not_a_proxy_predicate`(五形态 → Unmappable;健康 → Healthy 阳性对照;不存在 → Missing;**DROP TABLE 后 prepare 失败 → 必须 Err 传播**)、`guard_refuses_healthy_row_even_if_a_predicate_would_call_it_corrupt`。103/0;clippy/fmt 净;真机 boot 零 panic。

#### 裁决 3(采纳)· `text_lossy` 按列类型分开 · commit `556228f`
- `Text(b) | Blob(b)` 合并成一支 lossy,合并了两个不同的事实:TEXT 逐字返回(**必须保留** —— 用户要知道自己在删什么);BLOB 的乱码**不是内容,却长得像内容**,对「删掉它」这个唯一决定零信息量。安全性上无新破口(两支都经 `cEsc`)—— 是**呈现的诚实性**。
- **★★同刀订正评审裁决的一半**:它的 `Integer`/`Real` 一支**对现有调用点不可达**(实测,非推理)—— `id`/`fact`/`doc_id`/`doc_name` 全是 **TEXT 亲和**列,SQLite 把写入的数字**转成文本**(`fact=12345` → `typeof='text'`;`1.5` 亦然)⇒ 这类行是**健康行**、逐字呈现。只有 BLOB 不受亲和转换影响。两支仍保留(函数总体性),注释与测试写清不可达。
- **这条是被一个失败的测试逼出来的**:我按裁决写了「数字 → 占位符」的断言,它红了(实际值 `"12345"`),于是去 probe 亲和性才拿到事实。**断言能红,是它教我东西的前提。**
- `lossy_list_renders_text_verbatim_but_never_fakes_binary_as_content` 点名跑过(TEXT 逐字 = 阳性对照;BLOB → 占位符;亲和转换 → `corrupt=false`;`SELECT 7` 覆盖不可达分支)。104/0;preview 三行渲染 + `<img onerror>` 惰性 + rowid 作键。

#### 裁决 1 + [建议]:`doc_remove_corrupt` —— **未做,记债写准**
评审核实**文档侧没有死胡同**(`doc_clear_inner` 在 `reason=corrupt` 时 `undoable=false` ⇒ 不物化、不发 token、照常 `DELETE`),故**不构成逃生口漏洞**。真正的问题是**粒度不对称**:
- **记忆侧 = 逐行手术**(`memory_remove_corrupt(rowid)`);**文档侧 = 整库核弹**(只能 `doc_clear`,丢掉全部文档 + 全部 embedding 的重算成本)。
- 修法:`doc_chunks` 有 `rowid` ⇒ `doc_remove_corrupt(rowid)` 删掉那一个孤立的坏 chunk,其余文档立刻恢复健康(约 30 行 + UI 一处)。
- **不阻塞**(无死胡同 + `doc_id`/`id` 存成 BLOB 的可达性比 `created_at` 低一档:前者需外部写库,后者 schema 是 `DEFAULT 0` 而非 `NOT NULL`,NULL 天然可写、REAL 可由迁移写入)。**范围克制,留后续刀。**

**★方法论(评审点名,已收进 `reviewer-onboarding.md` §4-⑧)**:**记债是上一轮的判断,不是这一轮的事实。** 动手前先去量 blast radius —— 本刀正是这样把一个被记成「可用性问题」的 §4-2 说谎挖出来的。

**剩余后续刀**:① 大快照 **spill 到磁盘**;② `doc_remove_corrupt(rowid)`(粒度对齐)。做完 ①,撤销债清零。

### 撤销债 末刀 · 大快照 spill 到磁盘 · commit `2081df6` · ⏳ 待审 · **撤销债清零**
承第62轮裁决6(「大 clear 想要可撤销的**正解是落盘**,不是撑大 RAM 环」)+ 第64轮 Q3 次序 ①。
- **★要害:落盘也不许物化。** 「读进 Vec 再序列化」会让 2 GiB 的库先分配 2 GiB —— 正是第62轮问题4 所禁。故用 SQLite 自己搬:`ATTACH` 独立文件 → `INSERT INTO spill.t SELECT * FROM main.t [WHERE …]` → `DETACH`。逐行流式、常数内存;BLOB 按**存储类**原样复制 ⇒ embedding **逐位保真**(实测往返相等)。撤销 = 反向 `INSERT OR REPLACE`,同样流式。
- **不变式「提供撤销 ⇔ 销毁确已发生 ∧ 快照完整可还原」在新路径逐条兑现**:①**spill 在 DELETE 之前**,落盘失败 ⇒ `Err` + **一行都不销毁**;②空快照仍永不入环(复制 0 行即视为异常、删文件、报错);③**★`push` 永不淘汰它自己刚放进去的那一条** —— 否则会为一个已不在环里的条目发 token = **谎报可撤销**。RAM 路径靠 `stash` 的字节闸挡住,**落盘路径不过字节闸**,故 `push` 补 `len() > 1` + 「不动最后一条」两道结构守卫。**这条 bug 是被单测当场抓住的**(小上限下,落盘条目的路径串就超过 64 B 测试上限,被自己的淘汰循环吃掉却仍发了 token)。
- **预检与执行共用 `*_plan()`** ⇒「预检说可撤销 ⇒ 执行必接受」由**结构**保证(不再只靠断言测试 —— 这是评审第64轮点名赞许的那个性质,现推广到 corrupt/ram/spill/too_large 四分支)。次序即优先级:`corrupt` → `Ram` → `Spill` → `too_large`(**连落盘上限 2 GiB 也超了**才是真的不可撤销)。内存库落盘不可用 ⇒ 如实退回 `too_large`。
- **磁盘不得无界(三道)**:①环内**最多一个**落盘快照(**策略,非安全**),新的挤掉旧的**并删文件**,旧 token 随之失效;②被撤销即删(**还原失败则留着** —— 宁可留个孤儿也别丢掉唯一副本);③**开机清扫**(环是进程内状态,启动时必空 ⇒ `undo-spill/` 里任何文件都是崩溃遗留的孤儿)。
- **安全 / 隐私**:快照含 PII 与向量 ⇒ 落在**主库同目录**的 `undo-spill/`,与主库同等受文件权限保护,**绝不进系统临时目录**;表名格式化进 SQL ⇒ 只能来自 `SPILL_TABLES` **白名单**(入口再核一次,不靠调用点自律),**`profile` 不在白名单 = 永不落盘**;快照文件丢失 ⇒ **响亮报错**,绝不静默报「已撤销」。
- **前端**:`reason='spill'` 是一档**新的「可撤销」**状态 —— 照常给撤销按钮,但**如实告知**「会先把撤销快照写到磁盘,可能需要几秒」。**决策点既不许承诺做不到的事,也不该瞒着代价**(否则用户以为界面卡死)。
- **验**:六个新 Rust 测试**点名跑过**;**三条最承重的断言用变异测试证明能证伪生产代码** —— ①spill 挪到 DELETE 之后 → fail-closed 测试红;②淘汰时不删文件 → 「磁盘无界」测试红;③撤下 `push` 自我淘汰守卫 → 落盘往返测试红。**clippy 抓到我自己写的一条恒真空断言**(`has(&t2) || true`)—— 「断言必须能红」的同族,已改真断言。cargo test **110 passed / 0 failed**(104→110);clippy/fmt 净;tsc 51→51。
- **★真机验证不是空跑**:先在真实数据目录(`~/Library/Application Support/dev.zhapar.seeker/undo-spill/`)**植入两个孤儿快照** → boot(1.71s、零 panic、进程存活)→ **孤儿被清扫为 0** ⇒ 开机清扫在真机上真的跑了。
- **preview(真 guardrail 实例)**:`ok` 承诺可撤销且不提落盘(**阳性对照**)· **`spill` 仍给撤销按钮 + 如实披露磁盘代价** · `too_large` / `corrupt` 无按钮、理由各不相同、都不印「执行后可撤销」。

**★★撤销债清零(第56–65 轮外审)**:单槽被覆盖 → 空快照不入环 → 快照不完整则不销毁 → 有界环按真实字节计量 → token 全局唯一且必填 → 前端无 token 在类型上无法提供撤销 → 失败一律出声 → 决策点在四条销毁路径上都说真话 → 坏数据有逃生口 → **大快照落盘,可撤销不再让位于内存上限**。
**剩余(非本 arc)**:`doc_remove_corrupt(rowid)` 粒度对齐(第65轮 [建议],非阻塞)。**下一步**:P2(jobseek 6 aiRun 真化 / notes→记忆知识库 / prompts→Skills)或绿地(Skills/Project/Scheduled)。

### 逃生口粒度对齐 · `doc_remove_corrupt(rowid)` · commit `fcbd26a` · ⏳ 待审
承第65轮 [建议](裁决1 的落法)。评审核实文档侧**无死胡同**(`doc_clear_inner` 在 `reason=corrupt` 时不物化、不发 token、照常 DELETE)⇒ 非漏洞;真问题是**粒度不对称**:记忆侧逐行手术、文档侧只有整库核弹(丢掉全部文档 + 全部 embedding 的重算成本)。而上一刀我刚援引过「同一缺陷不得因所在支路不同而两种待遇」——**逃生口的粒度本身就是那种待遇差**。
- **落法(与记忆侧逐条同构)**:`doc_row_state(rowid)` → `Missing|Healthy|Unmappable`,判据是 **`map_doc_row`(快照代码本身)**,不是 `DOC_CORRUPT_PRED`(第65轮裁决2);取行/语句失败 ⇒ 传播 `Err`,**绝不把瞬时 sqlite 故障当成数据损坏而销毁**。`doc_remove_corrupt(rowid)` **拒绝销毁健康片段**、不存在 → 诚实 no-op、坏片段 → 删且不发 token、不碰环。
- **★用 rowid 而非 doc_id**,正好补上评审自己点名的残留:坏片段的 `doc_id` 列**本身**可能就是 BLOB,`WHERE doc_id = ?` 寻址不到它;rowid 够得到。`doc_list` 交出每篇的 `corruptRowids`(**展示走谓词、销毁守卫走快照**,角色分明)。
- **前端**:含坏片段的文档多出「移除已损坏片段」按钮 → guardrail 确认闸、**不传 onUndo**(§4-3)→ 逐 rowid 调 `removeCorrupt`。
- **★逃生口的意义被测试直接钉死**:移除坏片段后 `doc_plan` 由 `No("corrupt")` 变回 `Ram`,整篇的常规删除**重新可撤销** —— 不必为一个孤立的坏片段清空整个知识库。
- **验**:三个新 Rust 测试点名跑过(含 **DROP TABLE 后必须 Err 传播**、**BLOB doc_id 的坏片段也交出 rowid**、**健康片段的 rowid 绝不在列表里**);**变异测试证明两条断言能证伪生产代码**(①拿掉「拒绝健康片段」守卫 → 后门测试红;②`corruptRowids` 漏掉谓词过滤 → 「健康 rowid 不得在列表里」红);cargo test **113/0**(110→113);clippy/fmt 净;tsc 51→51;AST 审计 17 个 `onConfirm` 仍 0 回归面;真机 1.85s boot 零 panic。preview 真 guardrail:手术按钮**只**出现在坏片段那一篇、rowid 作键、明告不可撤销、不印「执行后可撤销」、逐 rowid 调用 `[7,9]`、无撤销按钮、**exact「已撤销」toast = 0**、**后端拒绝如实浮出**。
- **harness 自查**:首版 `await b.onclick()` 把自己挂死了(`onclick` 里 await 的是 guardrail,而 guardrail 要等用户点确认)。改 `.click()` 重跑 —— 与前两次 harness 自查同族。

⇒ **逃生口在记忆与文档两侧粒度一致**:坏数据可逐条/逐片段手术切除,健康数据永远享有可撤销删除。
**撤销债 + 其全部 [建议] 清零。下一步**:P2(jobseek 6 aiRun 真化 / notes→记忆知识库 / prompts→Skills)或绿地(Skills/Project/Scheduled,各自出方案)。

### ★★ 第66轮独立复核 = 通过 + 1 [应改] + 1 [建议]强 + 3 裁决 → 全落 `bfbe9c9`
**评审第二次自我订正,而且这次是它的 [建议] 本身欠考虑**:「坏片段」在最可达的那类损坏里根本不是坏的。它引用的正是我自己写在 `doc_list_inner` 注释里、却没带进「销毁告知」的那句话。**外审也得被外审。**
- **★我先量了真相表(probe,非推理)**,结论比评审说的还重一层:

| 损坏列 | 快照 | AI 召回 |
|---|---|---|
| `created_at`(TEXT/REAL) | ✗ | **✓ 整表正常,坏行也被召回** |
| memories `fact`/`id`/`embedding` | ✗ | ✗ **整个召回查询报错 ⇒ AI 一条记忆都读不到** |
| docs `doc_id`/`id`(BLOB) | ✗ | **✓ 内容仍在被检索** |
| docs `text`/`embedding` | ✗ | ✗ **整库检索报错** |

  ⇒ ①「这条记录已损坏,删除后无法撤销」在最常见情形下**误导**:内容与向量完好、AI 正在用它,用户为修一个时间戳而永久丢掉一段仍在服役的知识。⇒ ②**评审没说的那一半**:**召回列一坏,整个能力就哑了** —— 不是「读不到那一行」,是**一条都读不到**;此时删掉它反而是**恢复**检索,**文案方向必须反过来**。
- **[建议]强(根本修法)· 修复优先于销毁**:`created_at INTEGER **DEFAULT 0**` ⇒ 归一化为 0 是**忠实修复**,正落在第61轮裁决A 的线内。`memory_repair_corrupt` / `doc_repair_corrupt` **只碰 created_at**(`WHERE typeof(created_at) NOT IN ('integer','null')` 再夹一道),其余列**一个字节都不碰**(无 schema 默认值 ⇒ 销毁仍是唯一逃生口)。**两次都问 oracle**(快照代码本身),不问谓词。修好 ⇒ `*_plan` 由 `No("corrupt")` 回到 `Ram`,**可撤销删除恢复**。
- **[应改](已落)**:UI 按钮改「**修复**」;**只有修不好才退到销毁**,对话框按后端实测的 `aiReadable`/`recallBroken` 说清代价(仍在服役=删即永久失去 / 召回列已坏=删可**恢复**检索 / 无向量=AI 本就读不到)。旧文案「这条记录已损坏,无法生成撤销快照」已删。
- **裁决2(已落)· 漂移必须响亮**:`corruptRowids`/`corrupt` 来自**谓词(展示)**,守卫来自 **oracle**。二者一致时「其实健康」永不出现;一旦出现即「谓词比 oracle 更严」= 第65轮点名的危险方向 ⇒ `reason="healthy"` 与销毁循环的后端拒绝一律 `console.error` + 用户可见(`driftDetected`),**绝不静默吸收进计数**。**副产品**:守卫用 oracle 之后,这条路径成了**谓词漂移的运行时监视器**,比只靠变异测试更强(覆盖它没枚举过的形态)。
- **裁决1**:UI 按「这一篇里的 N 个」聚合是正确 affordance(坏片段对用户不可见、不可区分);披露不足已由 [应改] 补上。**裁决3**:第 17 个 `onConfirm` 字面量、在审计器视野内 ✓。
- **验**:五个新 Rust 测试点名跑过(含 `a_single_bad_recall_column_breaks_the_whole_recall_and_removing_it_restores` —— 钉死评审没说的那一半;`doc_with_blob_doc_id_is_unrepairable_yet_its_content_is_still_live`)。**三条最承重断言用变异测试证伪生产代码**:①修复后不再问 oracle → 「不可修复列」测试红;②修复时顺手清空 `fact` → 「零内容损失」测试红;③拿掉 `Healthy` 早返 → 漂移监视器测试红。**clippy 抓到我两条 `assert_eq!(x, true)`**(字面 bool),已改 `assert!`。cargo test **118/0**(113→118);clippy/fmt 净;tsc 51→51;AST 17 个 `onConfirm` 仍 0 回归面;真机 1.79s boot 零 panic。preview 真 guardrail:可修复 ⇒ **根本不开销毁对话框**;修不好+内容仍服役 ⇒ 警告「永久丢失」;修不好+召回列坏 ⇒ 文案**方向反转**;漂移 ⇒ console.error + 用户可见 + **绝不销毁**;文档混合场景(1 修好/1 漂移/1 修不好)只销毁那一个修不好的。
- **诚实边界**:`repair` 丢弃原来那个非法的 `created_at`(如 `'abc'`)。它从来不是合法时间戳,`int_lossy` 早已把它显示为 0 —— 修复只是让**存储**与用户**已经看到的**一致;不可撤销,toast 如实写明。
- **★评审的自我订正(记进方法论)**:「我第65轮说『补 doc_remove_corrupt』时,没有先去量『坏片段』到底坏在哪。这正是你上一轮教给我的那条 —— **记债是上一轮的判断,不是这一轮的事实** —— 而这次是我的 [建议] 成了那份过时的记债。」**⇒ §4-⑧ 对评审自身同样适用。**
- **订正评审一处过时信息**:它写「三条都不阻塞 ①(大快照 spill)」—— **① 已在 `2081df6` 落地**(撤销债末刀),故三条本就在 ① 之后。

**撤销债 arc + 全部派生 [建议] 清零。下一步**:P2(jobseek 6 aiRun 真化 / notes→记忆知识库 / prompts→Skills)或绿地(Skills/Project/Scheduled)。

### 第66轮签字附带的两条义务 · commit `225670a` · ⏳ 待审
- **义务① · 显式豁免 §4-3,不靠沉默**:`repair` 不走 guardrail 的论证已写进 **`MEM_REPAIR_SQL` 头注**(Rust)+ **`MemoryApi.repairCorrupt`**(types.d.ts)+ **CLAUDE.md §4-3**。核心:**guardrail 的判据是「用户有没有可失去之物」,不是「是不是写操作」** —— 被覆盖的旧值 app 内**没有任何代码路径能观测到**(`int_lossy` 早已显示为 0 / AI 召回的 SELECT 不含此列 / 快照读不了它);修复是**存储向显示收敛**,且幂等。三处均写明:**不得援引它作为「可观测的写操作也可跳过 guardrail」的先例**。模型无法触发 repair(UI 按钮,无对应 Capability)⇒ 安全内核未触碰。
- **义务② · 点名有损分支 —— 我先去量了,并订正评审一处、把它缩小**:评审说「REAL 分支归 0 **一个比特都没丢**」——**不成立**。实测 SQLite INTEGER 亲和性:`1.0`/`1e3`/`'123'`/`'1.0'` 都被存成 `integer`,**只有带小数的才留成 `real`** ⇒ 残留的 REAL 完全可能是**合理的 epoch 毫秒**(`1752105600000.5`),归 0 会丢掉**整个日期**。⇒ 改为 REAL 走 `CAST(… AS INTEGER)`(保住日期、只截亚毫秒)+ `BETWEEN` 防 CAST 饱和成 `i64::MAX` 假时间戳;**只有非数值 TEXT**(格式未知、解析即猜)退到 `DEFAULT 0`。**唯一有损的一支由「所有非整数时间戳」缩小为「非数值文本时间戳」**,且它今日 UI 也已显示为 0。toast 文案随之对齐。
- **顺手修**:`types.d.ts` 里 `UndoPrecheck` 的文档注释被 `RepairResult` 挤开、悬空挂在别人头上(我早先编辑留下的伤),已归位。
- **验**:新测试 `repair_preserves_real_timestamps_and_only_zeroes_unparseable_text`(**点名跑过**;先钉死亲和性前提,再断言 REAL 日期保住 / 非数值 TEXT → 0 / 超范围 REAL → 0 不饱和 / 合法整数一个字节不碰)。**变异测试**:CASE 退回「一律归 0」→ 「REAL 日期必须保住」变红。cargo test **119/0**(118→119);clippy/fmt 净;tsc 51→51;真机 2.02s boot 零 panic。

**★评审第66轮签字**:撤销债 arc 及其派生 [建议] **确认清零(第56–66 轮)**。评审并确认了我对它的两处订正(真相表推翻它 [应改] 的一半;`2081df6` 已落地故三条本就在 ① 之后)。
**★评审建议的下一步次序**:① **`app-tool 契约` 方案先行**(它是钥匙:一把解开 jobseek 6 aiRun 真化,并清掉「路线 B 封顶」与 `jobseek.rs` #6 i18n 两笔结构债;路线 A 在第51轮被判 [应改],必须先有设计好的契约)→ ② 并行热身 **notes → 记忆/知识库**(P2 里唯一无阻塞项)→ ③ 契约落地后 jobseek 真化 → ④ Skills 方案 → prompts→Skills → assets 退役。**不建议先做绿地**(后端零基础,会写出契约落地后要重新接管的代码)。

## ── P2 起步(评审第66轮建议的次序:契约方案先行 + notes 并行)──

### 方案 · app-tool 契约 · commit `e436ce1` · ⏳ 待审(方案级,未落码)
- **★方案的地基是一条我此前表述不精确、这次去量了的事实**:**6 处 `aiRun` 一次模型调用都没有**(`intake-action.js` 里 AI 调用数 = **0**),它是「假进度条 + `resultFn()` 本地确定性函数」。⇒「6 处 aiRun 真化」是**两件事**:**(i) 让模型真的参与**(产出是模型写的文字;`rt.ai.complete` 已通,**不需要任何新契约,不阻塞**)· **(ii) 让它们变成 Agent 窗口里模型可调的工具**(**这才是契约要解的**)。
- **三笔债同一把钥匙**:路线 A 破口(第51轮 [应改])· 路线 B 封顶(第52轮 standing)· `jobseek.rs` #6 i18n 债(**「呈现移回前端」正是契约的形状**)。
- **四条不变式**:I1 profile 结构性不可达 · I2 D3 不旁路(应用**不自己取数**,声明 `reads`,平台经既有 `query_data` 取)· I3 破坏性**收规格不收执行** · I4 结果经 schema 校验 / 三墙沙箱。
- **推荐 C**(声明 + 隔离纯计算 + 平台呈现):唯一同时满足 I1–I4 与 §1 的形状。代价是一条新的跨进程协议 —— 但**它的失败面可枚举、可测试(超时/取消/重入/校验失败),而 A 的失败面是隐私红线,B 的失败面是架构原则**。
- **★诚实前置(写进方案 §3)**:`apps/` 是**仓内一等公民代码**,不是第三方插件 ⇒ I1/I2 的价值**不是防恶意应用**,而是**结构性地防止应用层意外成为破口**。若将来允许第三方应用,I1–I4 **必要而不充分**。同理,三墙沙箱今天服务于「渲染不可信 HTML」,复用为「执行应用纯计算」是**新用途**,威胁模型须**重新论证**,不能靠「已过审」搭便车。
- **五个未决问题交评审裁**:隔离用 iframe 还是 Worker · `compute` 用 JS 模块还是声明式 DSL · 超时后模型看到什么 · `reads: []` 是否允许(且**不得与省略同义**)· app-tool 是否**明确禁止**破坏性。

### notes → 知识库 · commit `163a2de` · ⏳ 待审
- **★★落码前先量,量出一件我原本会做错的事:这不是「加个按钮」,是一次隐私域升级。** `assets` 整应用 `aiReadable:'default-off'`,**manifest 自己写着理由**「笔记是自由文本兜底容器、可能承载敏感个人信息」;而**知识库(`doc_chunks`)是 `Kind::Context`**,经 `contribute_all` → `build_context_message` **自动进模型上下文**(ai.rs:411),**没有 per-app 闸**。⇒ 迁入 = 内容从「默认不可读、需授权」搬到「**无需授权、自动被召回**」⇒ **绝不能是静默按钮**。
- **知情同意闸**(非破坏性 ⇒ **不走 guardrail**;承第66轮判据:**guardrail 管的是「用户有没有可失去之物」**,这里他不失去、只是**多暴露** ⇒ 要的是**知情同意**,不是撤销闸)。弹窗讲清三件事:原笔记保留 / **这会扩大 AI 能读到的范围** / 随时可在能力中心删除(可撤销)。
- **幂等 + ★自愈**:「是否已在知识库」**不认本地 `docId` 的一面之词**,而是与 `rt.docs.list()` 实况取交集 ⇒ 用户删了那篇文档,笔记**自动重新变成「可迁入」**;列表拿不到 ⇒ **保守当作一篇都不在**(宁可让用户看到「可迁入」再被后端如实拒绝,也不谎称「已在知识库」)。
- **失败如实上报**:逐条 add,记成功/失败数 + **第一条失败的真实原因**(如「未配置嵌入模型」);零成功时**绝无「已迁入」字样**。确认按钮 await 窗口内 `disabled`。
- **验**:空态无按钮 · 待迁入计数 · 同意弹窗四句话逐条断言 · 首行作文档名 · **自愈**(删一篇 ⇒ 那条重新待迁入,另一条仍标已在)· **幂等**(add 调用数不增)· **失败路径**(带出真实原因、无假成功)· **§4-4**(`<img onerror>` 开头的笔记:笔记页惰性、弹窗只渲染条数、**存储层收原文**、**该名进能力中心知识库列表时被 `cEsc` 挡住**)。tsc 51→51 且 **notes.js 零 error**;真机 1.86s boot 零 panic。
- **harness 自查(第四次同族)**:`added[0] === PAYLOAD` 首版失败 —— 不是代码问题,是 `ASSETS_NOTES` 是**模块状态、跨 eval 存活**。reload 后重跑。
- **诚实边界**:迁移是**复制**,两份内容此后各自独立(改笔记不同步文档)。assets 退役时再决定是否收敛为单一来源。

### ★ 第67轮独立复核 = notes 迁移 🏁 通过 + 契约方案 §(i) 有事实错误(已修)+ 两处落地
**评审这轮订正的是我 §(i) 的地基,而且它去读 `desktop.js:140` 才发现——「先量再改」这条,对方案、对代码、对评审的裁决,一样。**

#### 安全 · query_data / memory recall 进模型必框定 · commit `ef3e900` · ⏳ 待审
- **评审请我核的既存不对称,我核实为活缺口**:`complete` = `ai_chat` 完整工具循环(含 `memory(remember)` 写)· `invoke_raw` 结果一律 `(to_model_text, true)` 回灌、**唯独 MCP 带框定** · `jobs.jd` 是 JD 全文 ⇒ `query_data(jobs)` **今天就把外部文本无框定送进模型**。一份注入 JD → 模型调 `memory(remember)` → `LongTermMemory.contribute` 每轮自动注入 = **持久化上下文投毒**。
- **修**:`Output::Untrusted(Value)` 变体(可信度是**每次输出**属性、非能力静态属性 —— memory 的 remember 可信 / recall 不可信),`to_model_text` 对它**自带框定**(抽 `frame_untrusted` 与 MCP 共用)。**★回灌处零改动**(`Ok(out) => to_model_text()` 兜底自动框定 ⇒ 未来消费者默认安全);`cap_invoke`(前端直调、不进模型)返裸数据。
- **★★同刀自查抓出我自己写的死靶**(「断言必须能红」的反面,又犯):源码守卫用 `include_str!` 扫「query_data 走 Untrusted」,但断言的 needle 就写在测试自己里 ⇒ `contains` 永真、守卫永不红。修:`prod()` 只扫生产代码(截到 `#[cfg(test)]` 之前)。**并证明修后能红**:query_data 改回 Json → 守卫 FAILED。
- **验**:三新测试点名跑过,**两条最承重的各经变异证伪**(去框定 → 框定测试红;query_data 改回 Json → 源码守卫红);122/0(119→122);clippy/fmt 净;真机 boot 零 panic。**诚实边界**:invoke 需 AppHandle 不可纯单测(同 show_widget 边界)⇒ 源码守卫 + `to_model_text` 纯函数测两面夹 + e2e 真机。

#### notes→知识库 [建议] · commit `c31c62c` · ⏳ 待审
- 评审订正我「保守 = 假设一篇都不在」:**那是假设最宽松,会诱导用户造重复副本**(`docs.add` 不拒绝)。**真保守是拒绝行动**:`docs.list()` 抛错 ⇒ `docsStatusKnown=false` ⇒ 迁入按钮 `disabled` + 提示重试;既不谎称「已在知识库」也不制造重复。验:已知态按钮可点(阳性对照)→ 抛错后禁用 + 提示 + 不误标 → 盲态 add=0 → 恢复后重新可点。

#### 契约方案 §(i) 改写 + 五裁决记录 · commit(本条 docs)
- **§(i) 事实错误已修**:`rt.ai.complete` 不是补全,是完整工具循环 ⇒ (i) **不是零改动**,需「`ai_chat` 加 `tools:false` 档 + JD 的 Untrusted 框定」(后者已由 `ef3e900` 为 query_data/recall 落地,同一红线)。
- **五个未决问题评审全裁,已记入方案 §8**:①隔离用 **iframe**(但**不可复用 `buildSrcDoc`** —— 它的 `BRIDGE` 有 `window.seeker.action` 回父通道;计算沙箱要独立最小 srcDoc、无 action 通道)②`compute` = 沙箱 JS 模块 ③超时 = 标准工具错误 + `ok:false`,绝不返空/静默重试 ④`reads` **必填**(省略=注册被拒,绝不给默认语义)、`实际可读 = 静态 QUERYABLE ∩ D3 ∩ tool.reads` ⑤破坏性 app-tool **结构上不可能**(隔离上下文无 `rt`),破坏性走既有 `confirmDestructive` 规格通道。
- **★方法论(评审归纳,已在 §4-⑧)**:**先量,再改 —— 对方案、对代码、对评审的裁决,都一样。** 我两次量对(aiRun 零调用 / notes 隐私域),评审这轮读 `desktop.js:140` 推翻了我的 §(i);而 `ef3e900` 我又在自己的守卫测试里写出死靶、自查修红。**没有谁的判断免于「先量」。**

**下一刀(评审建议)**:(i) + `ai_chat` 的 `tools:false` 无工具档 + JD Untrusted 框定(一刀,小;JD 框定部分已落)→ 然后 T0 协议骨架。

### 块(i) · 无工具生成原语 + 出题真化 · commits `27fdbe0` `157447c` · ⏳ 待审
承评审第67轮下一刀 + 用户裁定(不拉 contribute / 先接一处 / 出题 / 喂 JD 全文)。

#### 原语 `ai_generate`(`27fdbe0`,站点无关)
- **结构性 fail-closed(前置③ 最强读法)**:`ai_generate` 命令与 `run_generate` **都不接收 registry/mcp/history** ⇒ 作用域**根本没有工具**。「带工具」是 `ai_chat`、「不带」是本命令 = **两个显式档**,task 拼写错误漏不出工具(结构性缺席,非运行时 flag)。同 `ai_extract` 先例。无 contribute(用户裁定:生成=(指令+数据)确定性变换)、无历史、保留 system_prompt。空工具表下模型捏造 tool_calls ⇒ **拒绝执行**。
- **JD 框定做成一等参数(前置②)**:`build_generate_user` 对 `untrusted` **必 `frame_untrusted`**,调用点漏不掉。
- 复用 `stream_round`(流式+重试);两端 runtime:desktop `rt.ai.generate` 复用 aiStream 订阅、invoke ai_generate;web 抛 NotImpl。
- **验**:2 新测试点名跑过,**各变异证伪**(去框定→红;签名加 registry→红);源码守卫只扫生产段(排 `#[cfg(test)]`,避死靶);124/0。

#### 站点 · 出题真化 `ivGenerate`(`157447c`)
- **★选出题而非面试反馈(量出来的,推翻「反馈 blast radius 最小」的预估)**:反馈的 `ivScore` 数值分数是整个面试子系统承重结构(整轮平均/练习记录/总评);出题是 text-in-text-out、不喂分数 schema ⇒ 最小。**先量再改,对评审的预估也适用。**
- **可信/不可信分离**:岗位+简历概要(用户自撰=可信)进 `instruction`;**JD 全文走 `untrusted`** ⇒ 后端必框定(前置② 由参数结构杜绝「拼接处漏框定」)。真·无工具流式 → `<pre>`(`textContent` 转义)→ `parseGenQuestions` 去编号取 3 题入 IV_BANK。**诚实降级**:`aiChatAvailable()` 假 ⇒ 回落原 mock,绝不假装。**失败出声**:onError 铺真实报错。§4-4:模型输出进 DOM 处处 `cEsc`(已核实)。
- **验**(preview 真模块 + 伪造 `__TAURI__` 走真路径):JD 进 untrusted **不进 instruction**、`task=interview`、3 行解析成 3 题、**注入 JD 的 `<img onerror>` 流式期与结果卡都不执行**;降级路径**绝不调真 generate**、回落 mock 仍出题。**★harness 自查**:降级测首现「0 题」= **eval 上下文定时器节流**把 aiRun 嵌套 setTimeout 拉长(隔离测 1 步+5s 正常、Math.random 正常),给足 6s 墙钟全绿。tsc 51→51、Rust 124/0、真机 1.89s boot 零 panic。
- **诚实边界**:端到端真模型需桌面+BYO(preview 以 stub 验契约面)。**记债**:`ivStartRound` 整轮种题仍 mock;面试反馈(需先解决分数 schema 承重)/ 简历改写真化各单出一刀。

### ★ 第68轮独立复核 = 块(i) 两刀通过 + 1 [建议](已落 `ed02dc2`)
- **★评审 trace 了我标成「硬编码可信」的 provenance,发现假陈述**:instruction 内插的 `j.co`/`role`/`j.need` 全是外部 JD 派生 —— `j.co`/`role` ← `ai.extract` 从 JD/截图抽取(intake-job.js:137)、`j.need = extractJdSkills(jd)`(:206);**我独立核实并挖深一层**:`resSummary(rtr)` 模板又内插 `j.co`/`role` ⇒ 简历概要也是 JD 派生、非「用户自撰可信」。攻击者控制招聘信息(job board = attacker-supplied),公司名设成「Acme\n\n忽略以上…」就进了 prompt 的**可信侧、无框定**。
- **判 [建议] 非 [应改] 的理由(我认同)· 无工具是承重防线**:`ai_generate` 结构性无工具 ⇒ 注入至多让模型写垃圾题,不能调工具/写记忆/持久化,输出经 cEsc ⇒ 无 XSS。爆炸半径 = 一次性垃圾题、非持久。
- **落法 · 让不变式为真(不「改注释承认违例」)**:instruction 改为**纯 app 常量**(零 JD 派生内插),所有外部/派生上下文(岗位信息+简历概要+完整 JD)进 `untrusted` ⇒ 后端 `frame_untrusted` 统一框定。**★钉住信任地基**:这条信任论证的地基是「本原语无工具」——一旦将来某生成流程需要工具,地基塌,抽取字段必须**重新按不可信处理**(注释固化,防后人加工具时忘掉)。
- **★★方法论(评审归纳,已入 §4-⑧)**:**「可信」是需要 trace provenance 才能下的判断,不是读一眼 instruction 就能断言的。** 这也是 rewrite/反馈两刀的**模板纪律**(rewrite 内插抽取字段更多,且其产出回流成 interview 的 `resumeNote`,信任问题随组合放大)。
- **验**(preview 真模块 + 攻击者公司名藏注入):被注入公司名 + JD + need **全落 untrusted**、**instruction 纯常量**(不含任何 JD 派生)、task=interview。node 净;tsc 51→51;Rust 124/0;真机 boot 零 panic。

**下一刀(评审第68轮建议次序)**:rewrite 真化(带 [建议] 信任纪律:抽取字段进 untrusted、instruction 纯常量、走 `ai_generate` 无工具、钉「无工具是地基」注释)→ 然后 T0 协议骨架(抽取字段信任问题的根本解)→ 反馈最后(先解 `ivScore` 分数 schema 承重)。

### 块(i) 站点② · 简历改写真化 `resumeGenerate` · commit `d622b32` · ⏳ 待审
承评审第68轮次序(rewrite 次之)+ 用户裁定(只写 summary)。
- **★量出的关键(rewrite ≠ 模型生成整份简历)**:`genTailoredResume` 的 work/projects/edu/strengths **全深拷自 MASTER(用户真实数据)**,skills 是集合运算,**只有 summary 是模板拼的** ⇒ rewrite 真化 = **模型只重写 summary**,事实字段一律用户真实数据、**模型绝不虚构**。(「summary + 重写项目 bullets」被用户否掉:模型编辑用户事实性陈述有失真风险,留后续可选刀。)
- **落法**:`genTailoredResume(j)` 建结构 → **只把 summary 模块 content 交模型流式重写**、其余不动。诚实降级(aiChatAvailable 假→回落 mock 模板 summary)、失败出声、结果卡 mock/真共用 `resumeGenResult`、`data-close`/`data-go` 走文档级委派。
- **信任纪律(承第68轮 [建议] 模板;rewrite 是评审警告「信任问题随组合放大」的那刀)**:instruction **纯 app 常量**;候选人背景+岗位信息+**JD 全文**全进 `untrusted`(后端框定)。地基仍是 **`ai_generate` 无工具**。**★链条闭合**:summary 会回流成 interview 的 `resumeNote`,而该处(ed02dc2)已把 resumeNote 归入 untrusted。§4-4:流式 `textContent`、渲染 `cEsc`。
- **验**(preview 真模块 + 攻击者 JD 藏注入):task=rewrite、**JD/背景/岗位全落 untrusted、instruction 纯常量**;**只 summary 被模型替换、work/projects/edu/skills 事实模块原封不动**;注入 `<img onerror>` 流式期与结果卡都不执行。降级路径**绝不调真 generate**、回落 mock 仍建简历(6s 墙钟避定时器节流)。tsc 51→51、Rust 124/0、真机 boot 零 panic。
- **诚实边界**:端到端需桌面+BYO。**记债**:项目 bullets 岗位向重写(用户已否决为默认)= 可选后续刀;面试反馈真化待(先解 `ivScore` 分数 schema);`ivStartRound` 整轮种题仍 mock。

**块(i) 三站点进度**:出题 ✓(`157447c`+`ed02dc2`)· 简历改写 ✓(`d622b32`)· **面试反馈**待(需先解 `ivScore` 分数 schema 承重)。**下一刀次序(评审第68轮)**:T0 协议骨架(抽取字段信任问题的根本解;纯平台,四失败面各带阳性对照)→ 面试反馈(最后,解分数 schema)。

### ★ 第69轮独立复核 = 简历改写真化 🏁 通过(无 [建议])+ 一刀清两处债
- **★核心量准且落地是结构性的**:`genTailoredResume` 的 work/projects/edu 深拷自 MASTER、skills 集合运算、strengths/certs 取 MASTER，**只有 summary 是模板串**;`onDone` 里 `sm.content=summary; done(base)` **只替换 summary 一模块的 content**、其余模块对象原样带过。⇒ **「模型绝不虚构经历/数字/技能」不是指令承诺,是结构保证** —— 模型输出只能落进 summary 一格,事实字段是 MASTER 深拷贝、碰不到。否掉「重写 project bullets」正确(那把模型的手伸进用户事实性陈述)。
- **★第68轮 [建议] 模板纪律不仅应用于 rewrite,还经 `ed02dc2` 回填了 interview**:diff 坐实——旧 interview 把 `j.co`/`role`/`need`/`resumeNote` 内插进可信 instruction(注释正是我点名的假标签「候选人简历概要是用户自撰=可信」),新版 instruction 零 JD 派生内插、全走 untrusted、注释改准。**我第68轮说的假标签被逐字改准。**
- **★组合链两端焊死**:第68轮我标的链「rewrite 产出 summary → 回流 interview 的 resumeNote → 进面试指令可信侧」——现在 rewrite 的 summary 经 cEsc + 无工具,它作为 resumeCtx 进 interview 时走 untrusted。**组合放大通路被掐断,靠两处都归 untrusted,不靠「希望没人注入」。**
- **★★下一刀裁决(评审)= T0 先于面试反馈**:面试反馈被 `ivScore` 承重结构挡着(整轮平均/IV_RECORDS 持久化/总评页渲染分数条)⇒ 它是「schema 刀之后的刀」,现在起=先撞墙。**T0 无阻塞且是根**:块(i) 三刀都在用「instruction 纯常量 + 派生进 untrusted + 无工具」的**手工纪律**防注入;**T0(app-tool 契约)才是把这套纪律变成结构** —— 隔离上下文无 rt、输入平台经 D3 供给、输出平台校验 ⇒ 抽取字段信任问题**从此不靠每个作者记得框定**。
- **块(i) 进度**:出题 ✓ · 改写 ✓;面试反馈待(ivScore schema 前置)。**用户现在能在真机上看到 AI 真在改写简历概要、真在出题 —— 对「不是 AI-Native」那句反馈的第一份正面证据落地了。**

### T0 · app-tool 协议骨架 · commit `7638d6b` · ⏳ 待审
承评审第69轮裁决(T0 先于面试反馈,是把块(i) 手工信任纪律变成结构的根)。**本刀只落协议核 = 「模型侧发起 → 前端隔离执行 → 结果回程」的 Rust 地基,尚未接入工具循环(=T2)。**
- **镜像 MCP confirm 的 pending-map 模式**(emit 事件 → `oneshot` 挂起 pending map → `select!` 三路唤醒),**但四个失败面都显式建模、且比 MCP 更严**:
  - **超时** `AppToolFail::Timeout` → run_app_tool 回「超时(未执行任何操作)」如实告知模型(评审 §8 裁决③:超时=标准工具错误,绝不返空/静默重试);
  - **取消** `AppToolFail::Cancelled` → `CancellationToken` 由工具循环持有(T2 接线);
  - **掉线** `AppToolFail::Closed` → 前端返回前 oneshot sender 掉线;
  - **★错配** `resolve_app_tool` 对未知/已完成 `call_id` **响亮拒绝(`Err`)**,而非 MCP confirm 的**静默忽略** —— 重入/伪造 callId 立即暴露。
- **call_id 全局唯一防串槽**:`APP_TOOL_SEQ`(process 级 `AtomicU64`)发号 ⇒ 不同调用的 oneshot 不会串槽(同撤销 token 的 `UNDO_TOKEN_SEQ` 先例)。`ai_app_tool_result` 命令是前端**唯一**回程入口,`ok/output/error` 三元组转 `AppToolOutcome::Ok|Err`。`run_app_tool`(AppHandle 包装,`#[allow(dead_code)]` 待 T2)emit `ai_app_tool` 事件(`AppToolEv` camelCase)。
- **验**:6 个 tokio/std 测试覆盖**四失败面 + 正常返回 + 双重 resolve**,各带正向控制组;**两处变异已证红**——静默忽略错配(仿 MCP)→ 错配测试红(ai.rs:1179);超时误归 `Closed` → 超时测试红(ai.rs:1131)。130/0(124→130);clippy 0;fmt 净;tsc 51(基线);**真机 WKWebView 冷启 0 panic + 进程存活**(验 `ai_app_tool_result` 注册 + `PendingAppTools` state 装载)。
- **诚实边界**:`run_app_tool` 需 AppHandle emit 不可纯单测(同 show_widget/invoke 边界)⇒ 纯协议核(await/resolve/命令)单测两面夹 + 真机 boot 验注册。**未接线 = T2**:工具循环里把 app-tool 声明拼进工具表、命中时调 run_app_tool、结果回喂——本刀不做。**下一步(评审第69轮次序)**:T1 隔离上下文(独立最小 srcDoc、无 `window.seeker.action` 回父通道)→ T2 接线 + 迁 `jobseek_market_value` → 面试反馈(先解 `ivScore` schema)。

### ★ 第70轮独立复核 = T0 协议核 🏁 通过(无 [应改])+ 1 [建议](措辞,已落)+ 三前置约束挂账
**评审逐帧走了生命周期,专查 pending-map 泄漏与 callId 串槽 —— 骨架刀的价值在把地基打正,复核重点放在「给 T1/T2 的前置约束」。**
- **结构性声称逐条坐实(评审读实际行号)**:错配/重入 → 响亮 `Err`(`resolve_app_tool` `.remove().ok_or_else` :482,`ai_app_tool_result` 直接返回 :540)· 四失败面各有**模型可见非空出口**(:519–521)· **pending-map 不泄漏**(`run_app_tool` await 后**无条件** `remove` :515 ⇒ 超时/取消/掉线都清挂起项;正常 resolve 已在 :481 remove)· callId 全局唯一(`APP_TOOL_SEQ` 进程级 `AtomicU64` :454,同 `UNDO_TOKEN_SEQ` 纪律)· oneshot 无丢唤醒(值缓冲在通道,await 立即取到)· emit 失败降级为超时(`let _ = app.emit` :505,无监听→走 deadline→「未执行任何操作」不挂死)· 变异+阳性对照到位(`rx.try_recv()` 断言判据能亮 :1178)。
- **[建议](措辞,不涉逻辑)· 已落**:`:483` 注释「理论到不了这;send 失败无害」只描述竞态那一支、把 `:483` 说成近乎不可达。**我独立逐帧核实属实**:正常在途路径前端 resolve 在 :481 取到 tx 时 `run_app_tool` 仍阻塞在 :514 await(`rx` 存活)⇒ `:483` send **成功、就是结果的投递机制**、**承重**;竞态(超时/取消已在 await 返回、:515 未及 remove)才 rx 已 drop、send 失败无害。改注释两分支说清「正常在途=投递机制 / 竞态=无害丢弃」。
- **★三前置约束挂账(评审:骨架刀最该输出的东西)· 记入方案 §7 后**:
  - **【T1】**srcDoc 只有 request→response,`sandbox="allow-scripts"` 不带 `allow-same-origin` + CSP `default-src 'none'` + **父窗口零入站接口**(除那条回传结果 postMessage);绝不复用 `buildSrcDoc`(其 `BRIDGE` 有 `window.seeker.action` 回父通道)。
  - **【T2】**①`deadline` **平台封顶**(平台常量或 `min(应用请求, 平台上限)`)—— 别让应用声明的 `timeoutMs` 挂住整个 `ai_chat` 回合(同 MCP 走 `MCP_CONFIRM_TIMEOUT` 先例);②**输入 D3 闸+框定在进沙箱前、输出 schema 校验在喂回模型前,两处都在可信代码**(沙箱是不可信计算 ⇒ 校验点必在其外)—— 这是第67轮判路线 C 成立的全部依据,T2 方案须点名这两处强制归哪一刀拥有。
  - **【T3】**迁 `jobseek_market_value` **不得丢 D3 双点闸**(第60轮验过:skills 不可读时工具既不上架、调用也硬拒);迁成 app-tool 后同等 D3 强制须由新路径接住,双向阳性对照验收。
- **验**:注释改动纯措辞、cargo fmt 净 + 130/0(注释级不影响编译)。**下一步认可**:T1 → T2(接线+迁 market_value+删 jobseek.rs)→ 面试反馈(ivScore schema 前置)。

### T1 · app-tool 计算沙箱 · commit `1cebfa4` · ⏳ 待审
承评审第70轮【T1】前置约束(srcDoc 只 request→response、无 `window.seeker.action` 回父通道、CSP `default-src 'none'`、父窗口零入站)。app-tool 契约(方案 C)第一块**红线**刀:应用声明的 compute 纯函数 `(input, rows) => output` 在隔离上下文里跑,输出经平台可信代码校验。**未接工具循环(=T2)。**
- **两个平台模块**(business-agnostic,`web/platform/capability/app-tools/`):
  - **`validate.js`** —— output JSON Schema 子集校验(I4 闸),纯函数、可 node 测。支持 `type`(含 integer/number 关系)/`properties`/`required`/`items`/`enum`/`additionalProperties`,**校验从严**。node 断言 **38 条**(每规则 pass/reject 双向),**两处变异各证红**(`additionalProperties===false`→`null` → 多余属性断言红;integer 判定去除 → integer 断言红)。
  - **`sandbox.js`** —— 独立最小 srcDoc 三墙隔离 + compute 执行 + 校验编排。**★与 `widgets/render.js` 的 `buildSrcDoc` 刻意不共享**:那条 BRIDGE 有 `window.seeker.action` 回父通道 + 主题/resize/样式,对纯计算全是多余攻击面 ⇒ 这里是最小 srcDoc:`CSP default-src 'none'` + compute 源 + **只做 `run→result` 的 bridge、零 action 通道**。**deadline 平台封顶** `min(请求, 60s)`(T2 约束预埋);**I4 fail-closed**:缺 output schema ⇒ 拒绝、iframe 都不建;**绝不 reject** —— 语法错/抛异常/超时/校验失败/端口失败全翻 `{ok:false,error}`。
- **★对抗性验证(真浏览器 iframe,非 node 可测,同 show_widget 边界)= 9/9**:A 良性往返 · **B 隔离(沙箱内 `rt`/`SeekerRT`/`seeker.action` 全 `undefined`、父不可达 `blocked:SecurityError` ⇒ `rt.profile` 双向不可达、fetch 被 CSP 掐 `blocked:TypeError`)** · **B-控制(父上下文 `SeekerRT=object`/`parentReach=object` 须能亮 ⇒ 证探针有检测力、B 的 undefined 非假阴性)** · C 校验失败不喂模型(error、无 output 字段)· D 超时 · E fail-closed · F 抛异常 · G 语法错 · H 非 result 入站被忽略。**★变异证红**:给 bridge 植 `window.seeker.action` → B 转红(8/9)、`seekerAction` 变 `function`;复原 9/9、回 `undefined` —— **「无回父通道」这条红线(不复用 `buildSrcDoc` 的全部理由)真能捕获泄漏**。
- **验**:node --check 双过 · tsc 51(基线,app-tools 内 0)· 真机 WKWebView 冷启 0 panic + 存活。**诚实边界**:真隔离由浏览器 iframe 保证、不可纯 node 单测(同 show_widget);validate.js 走 node 断言+变异,sandbox 本体走 preview 真浏览器对抗验证(harness 验后即删、未入库)。**未接线 = T2**:manifest.tools 契约 + 平台取数(reads∩D3)+ render + 工具循环命中时调 `runComputeSandbox`。**下一刀 = T2**(评审第70轮【T2】约束:deadline 封顶〔已预埋〕· 输入 D3+框定在进沙箱前/输出校验在喂回模型前两处都在可信代码 · 点名归属)。

### ★ 第71轮独立复核 = T1 计算沙箱 🏁 通过(隔离经变异证伪)+ 2 [建议](都 T2-blocking,已落 `2b1d57f`)
**评审逐墙读源码(非采信 9/9 送审词)确认三墙真实;重点落「校验保证有多强 + 谁来守」——两条都成立,我独立核实后落地。**
- **隔离逐墙坐实**:墙1 `sandbox='allow-scripts'` 无 `allow-same-origin`(:105)· 墙2 CSP `default-src 'none'` 无 connect-src(:24)· 墙3 只认 `e.source===parent` 握手 + 专属端口 `{type:'result'}`、无 `window.seeker`/action 通道(:40/:136)· fail-closed 缺 schema iframe 都不建(:89)· deadline `min(60s,…)`(:27/95,T0 flag 预埋)· 输出校验在可信父代码 `settle` 之前(:142)· `done` 幂等+清理无泄漏。**变异植入 `seeker.action`→B 红,红线真能捕获泄漏。**
- **★[建议]1(强)· I4 实为「⊇」非「=」· 我独立核实属实**:`additionalProperties` 省略即放行(validate:88)+ `settle` 回传 raw `msg.output`(sandbox:147)⇒ app `return {...row, score}`、schema 只声明 score 没写 `additionalProperties:false` ⇒ **整个 row(含 D3 用户数据/可能夹注入)喂回模型**;作者没作恶、`...row` 手滑,I4 本该结构性挡住。次要 footgun:properties-only 无 `type:'object'` ⇒ 错形状过松 schema。与本 arc default-deny 标准(reads 必填/`undefined`→拒/`onConfirm` 缺省)冲突 —— 唯此处退回 JSON Schema 宽松默认。`validate.js:6` 文档「严丝合缝」= **比代码强的假声明**(第 N 次「勿声明假不变式」)。**落法(评审推荐 A · 结构性)**:新增 `projectToSchema` —— 校验通过后**按声明重建副本**、未声明字段丢弃;sandbox 回传投影副本;闭合形状 footgun(properties/items 无 type 也强制形状)。**I4 从 ⊇ 收紧到 =。** AP 语义:子 schema 校验留/true 主动留/false 硬拒/省略丢。
- **★[建议]2 · I4 安全闸无入库测试(harness 会后即逝=永不在 CI 变红的断言)**:`1cebfa4` 只落两源文件、validate.js 纯函数无入库测试。**落法**:开 JS 单测 lane —— `test/validate.test.mjs`(node:test,web/ 外⇒不嵌入不 tsc-include)+ `npm test`。14 组覆盖两出口 + reviewer 的 `{...row,score}` 泄漏场景 + 嵌套剥离 + AP 四语义 + 形状 footgun;**两变异证红**(投影不剥→泄漏测试红;形状判定回归→footgun 测试红)。
- **验**:npm test 14/14(+变异证红)· **真浏览器 iframe 对抗 10/10**(新增 ★I/★I2:compute `Object.assign({}, rows[0], {score:88})`、rows[0] 夹 ssn/注入 → 经真沙箱投影 → 模型只见 `{score:88}`/`{items:[{name},{name}]}`,ssn/注入/secret/leak 剥净)· node --check 双过 · tsc 51 · 真机 boot 0 panic。
- **★T2 约束更新(评审据 T1 补)· 记入方案 §7**:【T2-5】**输出喂回模型前必 Untrusted 框定** —— strip 挡未声明字段,但**声明的 string 字段仍可能含外部/注入内容**(app-tool 在 D3 数据上算),须比照第67轮 `Output::Untrusted`;**strip + 框定两道并用,缺一不可**。【T2-6】**deadline 前后端对齐**:Rust `run_app_tool` deadline ≥ 前端 60s 上限,让模型只看到**一个**超时。【T3】迁 market_value 不丢 D3 双点闸(不变)。
- **★方法论**:评审读码推翻「校验从严」的送审词(实为 ⊇);「断言必须能红」的终极形态是**入库、CI 守得住**,不是 harness 里跑一次就散。**下一刀 = T2 接线**(manifest.tools + 平台取数 reads∩D3 + render + 工具循环调 `runComputeSandbox`;带 §7 全部 T2 约束)。

### T2a · manifest.tools[] 契约 + 注册期校验 · commit `7c4163c` · ⏳ 待审
承评审 T2 次序。**先量再改**:并行两 Explore agent 摸清工具循环(`ai.rs:763` 派发两分支 MCP/`invoke_raw`,app-tool 需第三分支)· AI 请求今**app-blind**(`{userText}`,需新 seam 携带描述符)· D3 取数复用(前端 `rt.capability.invoke('query_data')`→`cap_invoke`→`DataQuery::invoke` 同一 `QUERYABLE∩readable_set` 闸)· `run_app_tool` 返 raw Value **无框定**(须补 T2-5)· manifest 无 tools 字段(union gatherer 空位,同 `cards()`)。**契约优先(§6),T2 拆三刀**:本刀纯契约、零接线、低风险。
- **契约(types.d.ts)**:`AppToolSpec`(name/description/parameters/reads/compute/output/render 七字段 + 四不变式注释 I1–I4)· `AppToolWidget`(render 返回)· `AppManifest.tools?` · `SeekerShellApi.appTools()`。**compute 自包含纯函数**(平台以源码串注入三墙沙箱)、**render 前端跑**(tt() 可用 ⇒ #6 双语债消失)。
- **注册期校验(registry.js `validateTools`,default-deny 不靠作者记得)**:name 必 `<appId>_` 前缀 + 应用内不重名 · description 必填(自持可信文案)· parameters/output 必 schema 对象 · **reads 必填(省略即拒)且 ⊆ manifest.collections** · compute/render 必函数。任一违反即拒注册。`appTools()` 并集(同 appCommands;仅问启用应用 ⇒ 关应用即下架;D3 上架过滤留 T2b)。
- **验**:node 桩测(eval 经典 IIFE + window/localStorage 桩)—— **11 条违规各自拒** + 合法注册 + 两应用并集 + 关应用即下架 + 无-tools 应用无恙;**变异证红**(`reads⊆collections` 不强制 → 越界用例不再拒)。node --check 净 · tsc 51(基线,0 新)· 真机 boot 0 panic(既有 jobseek/assets 无 tools[],validateTools no-op)。**诚实边界**:registry.js 是经典 IIFE、无 ESM 单测 lane,桩测走 scratchpad 未入库(若评审要求入库,可抽 `validateTools` 为可测纯函数)。
- **下一刀 = T2b**:Rust 工具表第三分支 + 请求 seam(前端携描述符→ai_chat)+ 前端 `ai_app_tool` 编排(D3 取数→`runComputeSandbox`→render)+ **输出 Untrusted 框定**(T2-5)+ **deadline 前后端对齐**(T2-6),用测试 app-tool 验正向断言(模型只见 reads 内集合 / profile 推不进)。

### ★ 第72轮独立复核 = T2a 契约+注册闸 🏁 通过 + 1 [应改](已落 `02c350f`)
**评审读码核实了我没在送审词里说的第71轮 [建议]1 修复(projectToSchema 真投影),确认「独立核实双向:既抓回归也确认未叙述的改进」。1 条 [应改] 我先独立核实,发现半已完成、如实上报并只补另一半。**
- **★评审确认第71轮 [建议]1 已实现且超预期(读码非采信)**:`projectToSchema` 是真投影(project 模式从空对象重建、只拷声明属性、AP 省略丢弃 = default-deny)· sandbox 返重建副本非 raw · 顺手闭了次要 footgun(properties-only 无 type 也形状从严)· 单一 `walk` 两模式不漂移 · 输出框定入契约 I4。**送审词未叙述、评审读码撞见。**
- **`validateTools` default-deny 全字段逐条核实通过**:null 不当无-tools 放过 · name 前缀+不重名 · reads 必填⊆collections(静态声明层查、运行时 ∩QUERYABLE∩D3 留 T2b,分层正确)· output 必 schema(注册期+运行期双闸)· compute/render 必函数。`appTools()` 关应用即下架。
- **★[应改](升级自第71轮 [建议]2 · 复发):两安全闸无入库测试 = 会后不可变红的断言**。**我先独立核实,发现半已完成**:`projectToSchema`(I4)**T1 硬化 `2b1d57f` 就落了入库测试** `test/validate.test.mjs`(14 组含 `{...row,score}` 泄漏场景),npm test 一直在跑 —— 评审只看 T2a diff(registry/types)漏了它。**如实上报、不重做**。另一半 `validateTools`(I2 静态半)确无入库测试:埋在 registry 经典 IIFE、未导出。**落法**:registry.js 经典 IIFE(载序)不能 import ⇒ 抽纯函数会漂移/改 module 有载序险 ⇒ `test/registry-tools.test.mjs` **直接 eval 真 registry.js**(Function 注入 window/localStorage 桩)经 register() 驱动 validateTools,测出厂代码零漂移。验:npm test **20/20**(14+6);**变异证红 in CI**(reads⊆collections 不强制 ⇒ 19 pass/1 fail,非会后蒸发);registry.js 一字未改(纯加测试)。⇒ **两闸(I4/I2)现都 CI 守得住**。
- **★方法论(评审归纳)**:独立核实**双向** —— 抓回归,也确认「送审词未叙述的改进」真成立;**而我这轮又反用一次**:[应改] 我没照单全收,先核实发现 projectToSchema 半已完成、如实上报只补另一半(第71轮 `2b1d57f` 已落,评审漏看)。**送审词/裁定都要先量。**
- **T2b/T3 约束更新(评审)**:① Rust 第三分支输出**先 projectToSchema(已建)再 Untrusted 框定**才喂模型;② D3 取数 = 静态 QUERYABLE ∩ 运行时集 ∩ reads **运行期强制点**(非只注册期 ⊆collections);③ deadline 前端 60s 与 Rust `run_app_tool` 对齐(Rust ≥ 前端);④ **请求 seam 携描述符须 fail-closed**(不夹 profile/超范围);⑤ T3 迁移用本 lane 双向阳性对照验「skills 不可读时既不上架、调用也硬拒」。**下一刀 = T2b。**

### T2b-1 · app-tool 接线 Rust 侧(工具表第三分支 + Untrusted 框定 + 请求 seam) · commit `a30ff26` · ⏳ 待审
T2b 拆两半(Rust 测 vs preview 验):本刀 Rust 主体 + 前端请求 seam;前端编排(取数+沙箱+render)= T2b-2。把 T2a 声明的 app-tool 接进工具循环——模型能看见、能调,结果框定回灌。
- **Rust(ai.rs)**:`AppToolDesc`(前端携带描述符,**只 name/description/parameters** 应用自持可信元数据,结构上不接收 compute/reads/output/用户数据)· `ai_chat` 加 `app_tools: Option<Vec<AppToolDesc>>` + `PendingAppTools` state 透传 run_chat · 工具表并入 app-tool 描述符(同 MCP push)· **★第三分派分支**(MCP / app-tool / invoke_raw):app-tool 走 `run_app_tool` 专路(解 T0 dead_code)→ **`frame_app_tool_result` 框定(T2-5)才回灌模型**(输出在 D3 用户数据上算得、声明的 string 字段仍可能夹外部/注入 ⇒ 一律 Untrusted,同 query_data/MCP)· **`APP_TOOL_DEADLINE=70s`(T2-6)**:≥ 前端沙箱 60s + 余量 ⇒ 前端自己超时先触发给精确错误、Rust 只兜「前端整个掉线」不抢跑。
- **前端 seam**:`AiRequest.appTools?`(只元数据)· desktop.js 透传 · **ai-engine.js `readableAppTools()` = D3「上架」闸**(只带 reads ⊆ `aiReadableCollections()` 的工具、不可读即不上架;运行时「调用硬拒」由后端 query_data 独立兜底;fail-closed 缺 shell 返 []、只带元数据不带用户数据)。
- **验**:cargo test **133**(130+3:框定/只元数据/源码守卫分支必框定);**两变异证红**(分支回灌 raw v → 源码守卫红;helper 去 frame_untrusted → 单测红)· clippy 0 · fmt 净 · tsc 51 · npm test 20 · 真机 boot 0 panic。**诚实边界**:run_app_tool emit→await 往返 T0 已测;端到端(模型→工具→前端编排)需 T2b-2 + BYO。**评审 T2b-1 请核**:第三分支框定不可绕(源码守卫+单测双守)· deadline 对齐方向(Rust≥前端)· seam 只携元数据(不夹 profile/用户数据)· 「上架」D3 过滤在前端、「调用硬拒」在后端 query_data(双闸)。**下一刀 = T2b-2**(前端 `ai_app_tool` 编排:D3 取数 `query_data`→`runComputeSandbox`→render→appToolResult;preview 测试 app-tool 验正向断言)。

### T2b-2 · app-tool 前端编排(闭环) · commit `e692cff` · ⏳ 待审
T2 接线闭环。`platform/capability/app-tools/run.js`(业务无关、不识 app 符号)按契约执行链:查工具(未知 fail-closed)→ **D3 取数**(按 reads 逐集合走 `rt.capability.invoke('query_data')`,后端硬强制 QUERYABLE∩运行时集∩reads;任一被拒 ⇒ fail-closed = 「调用硬拒」)→ 隔离 compute+投影(源码注入三墙沙箱 I1、projectToSchema I4)→ render 产 widget 投画布(tt 可用 #6 债消失,**复用 onWidget 同一三墙沙箱渲染路**)→ 结果回程 `appToolResult`(Rust 再框定)。desktop.js aiStream 加 `ai_app_tool` listener(session 过滤同 ai_chunk),注入运行时能力调 runAppTool。
- **★I1 profile 结构不可达(闭环端)**:compute 只拿 `(input, rows)`,rows **只来自 tool.reads 的 query_data**,而 query_data 的 QUERYABLE 硬底**永不含 profile** ⇒ 无论工具怎么声明,profile 进不了 compute。一切失败面一律 fail-closed。
- **验(preview 真浏览器 + 真沙箱 + 桩 rt)7/7**:A 正常往返 `{count:3,sum:6}` · **★投影剥离未声明 leak(不进结果)** · render→onWidget · **★取数只在 reads(demo_a)、从不取 profile/他集合** · **★取数被 D3 拒 ⇒ 结果 false + 无 widget(compute 未跑)** · 未知工具 fail-closed · compute 抛异常 ⇒ false。**★变异证红**:取数吞掉 D3 reject ⇒ C 转红(结果变 `ok:true {count:0}`、不再 fail-closed)。node --check 净 · tsc 51 · npm test 20 · 真机 boot 0 panic。**诚实边界**:端到端(真模型触发)需 BYO;preview 桩 rt 驱动真编排+真沙箱验契约面。
- **★T2 接线闭环达成**:模型看得见 app-tool、能调 · D3 取数不旁路(双闸:前端「上架」过滤 + 后端 query_data「调用硬拒」)· profile 结构性推不进(compute 只见 reads 数据、QUERYABLE 永不含 profile)· 输出投影(I4)+ Untrusted 框定(T2-5)。**评审 T2b-2 请核**:orchestrator 业务无关(不识 app 符号)· fail-closed 五面齐(未知/取数拒/沙箱失败/异常/结果通道断)· profile 结构不可达论证(reads→query_data→QUERYABLE 三重)· render 失败不阻断结果回程(合理否)。**下一刀 = T3**(迁 `jobseek_market_value` → app-tool + 删 `jobseek.rs`;用 npm test + preview 双向阳性对照验「skills 不可读时既不上架、调用也硬拒」)。

### ★ 第73轮独立复核 = T2 全线闭环(路线 C)🏁 三刀全通过(`02c350f`+`a30ff26`+`e692cff`)+ 1 [建议](已落 `b6607ca`)
**评审亲跑 `npm test`(20/20)、逐条不变式读到强制点(非采信);判 arc 第51→67→现在收口:路线 A 会开的破口路线 C 一个没开。**
- **T2a [应改] 真闭**:评审亲跑 `npm test` pass 20/fail 0;确认「经 register() 驱动 validateTools = 测出厂代码零漂移」;变异 CI 红(reads⊆collections 不强制→19/1)。**第71轮 [建议]2→T2a [应改] 的复发闭环。**
- **★五不变式验到强制点(评审读码)**:**I1** compute 每一跳都够不到 profile(rows 仅来自 query_data〔QUERYABLE 静态底永无 profile〕、input 来自模型上下文〔本无 profile〕、compute 在三墙沙箱无 rt)· **★I2** `queryData→cap_invoke('query_data')→DataQuery.invoke` 的运行时 `readable_set` 二次硬校验(capability.rs:456,**非 `db_list`**;第60轮 D3 咽喉)· **I3** 沙箱无 rt⇒破坏性结构不可能 · **★I4** 投影(结构)在沙箱 `projectToSchema` + 框定(内容)在 Rust `frame_app_tool_result`(ai.rs:829)**两道缺一不可**。**两层 D3 镜像 `DataQuery` available+invoke**:上架闸(前端 readableAppTools 只带 reads⊆可读集)+ 调用硬拒(后端 query_data 二次校验)= 与第60轮 jobseek_market_value 双点闸同构、T3 天然保住。seam 只 `{name,description,parameters}`(compute/reads/output/render/profile 全不给模型)。deadline 70≥60 对齐。源码守卫 `app_tool_output_is_framed_before_model_in_source`(ai.rs:1319)。
- **★[建议](非 [应改]:lane 已建、Rust 强制已入库+守卫、run.js 的 D3 委托后端已测):run.js 的 fail-closed 编排只 preview 验、会后蒸发** ⇒ 落成入库。**我先独立核实 [建议] 成立**:run.js 两条最要害 fail-closed(未知工具 / D3 取数拒)在 `runComputeSandbox` **之前**短路、node 天然可测;其余注入桩沙箱。**落法**:`runAppTool` 加默认参 `runSandbox=runComputeSandbox`(生产默认真沙箱、desktop.js 2 参不变、行为不变),`test/run.test.mjs` 6 组桩 rt/sandbox 测编排(未知/**D3 拒⇒fail-closed+compute 未跑**/取数只在 reads/正常/沙箱失败/render 不阻断)。投影不在此测(sandbox 的活,validate.test.mjs+preview 已覆盖)。验:npm test **26/26**;**变异证红 in CI**(取数吞 D3 reject⇒25/1)。
- **★arc 收口(第51→67→现在)**:第51轮路线 A 前端直调 rt 能读 `rt.profile.getAll()`、绕 D3 = 结构破口;第67轮判路线 C;现在五不变式全建成且验到强制点——**把每一步送回既有咽喉(query_data D3)再叠结构隔离(沙箱无 rt)⇒ 路线 A 的破口一个没开**。安全性没靠「应用别乱写」:seam 结构只带元数据、D3 靠后端 invoke 硬拒、profile 靠 QUERYABLE 静态底+沙箱无 rt 双重结构不可达、破坏性靠沙箱无 rt 结构不可能。**红线从「约定」搬进「类型与结构」。**
- **★T3 三盯点(评审)**:① D3 双点闸(上架 reads⊆readable + 调用 query_data 硬拒)对 skills 不可读**既不上架、调用也拒**——用新 test lane 双向阳性对照(真模块导出,别让控制组会后蒸发);② `jobseek_market_value` HTML 现 Rust 硬编码中文(#6 债)——迁成 `render` 后 **tt() 可用 ⇒ #6 债同刀清**(契约 I4 注释已承诺);③ 删 `jobseek.rs` 后 registry 回 4 platform caps + 业务工具全经契约——确认平台层对 apps **零 import**(§1 第一性原理,批11B 不变式别在迁移中破)。**下一刀 = T3。**

### T3 · 迁 jobseek_market_value → app-tool + 删 jobseek.rs · commit `3ac1738` · ⏳ 待审
app-tool 契约的收成:第一个真 app-tool 替掉 Rust 打样(路线 B),`jobseek.rs` 删除。承第73轮三盯点全兑现。**先量再改**:量出 `openMarketValue`(UI 模态)是前端 mock(`YOU_VALUE`/`aiRun`)、`value-card`(frameQuery)另一路,均**不依赖 jobseek.rs** ⇒ T3 只迁 Rust `jobseek_market_value` 工具。
- **迁移(apps/jobseek/tools/)**:`market-value-compute.js`(**零 import**、node 可测、真模块导出;compute 以源码串注入沙箱故自包含)—— `computeMarketValue` 公式与旧 Rust **逐字等价**(base 20+Σ lvl×1.6、×0.88/×1.16、top5 降序)+ `MARKET_VALUE_{NAME,READS,DESC,OUTPUT}`;`market-value.js` 装配 spec(reads:['skills'])+ **render 前端跑 ⇒ tt() 双语**、技能名 cEsc。manifest `tools:[marketValueTool]`。
- **删除(路线 B 退役)**:`jobseek.rs` 删 · lib.rs 去 `mod jobseek` · capability.rs 去 MarketValue 注册 + 测试改「装配四者」(5→4 platform caps 全业务无关)。
- **★三盯点兑现**:①**D3 双点闸**——「上架」`filterReadableTools` 抽为 **node 可测纯函数**(reads⊆可读集)+「调用硬拒」后端 query_data(run.test.mjs 覆盖);②**#6 债同刀清**——render 回前端 tt() 双语(preview 实证:同一 output 产「市场价值估算/万·年」vs「Market value estimate/×10k·yr」,两语言 html/title 皆不同);③**§1 零 import**——无 `crate::jobseek` 残留(ai.rs 的 jobseek_market_value 是字符串 fixture 非 import)、平台层对 apps 零 import。
- **验**:cargo test **132**(133−1 jobseek 测)· clippy 0 · fmt 净 · npm test **33**(+7:公式等价/schema/自包含 eval/**★D3 上架双向阳性对照〔真 MARKET_VALUE_READS〕**)· tsc 51 · preview render 双语 **6/6** · 真机 boot 0 panic。**诚实边界**:模型→工具端到端需 BYO;preview 验 render 双语 + 真 spec 装配;compute 自包含由 eval-隔离作用域测 + preview 真沙箱兜。**评审 T3 请核**:①compute 迁移零行为漂移(公式逐字、真模块导出测)②D3 双点闸对 skills 不可读既不上架〔filterReadableTools 阳性对照〕又调用拒〔query_data〕③#6 债真消(render 前端 tt)④删 jobseek.rs 后 §1 零 import + 4 platform caps。**★app-tool 契约(T0–T3)全线收官**:协议→沙箱→契约→接线→首迁移,路线 B 退役、jobseek 业务工具全经契约。

### ★ 第74轮独立复核 = T3 🏁 通过 · app-tool 契约 T0–T3 收官 · 路线 B 退役 · 4 裁决 + 2 [建议](已落 `a4a9e2f`)
**评审亲跑 cargo 132/0 + npm 33→34;逐条结构性验(非采信);认可我 T2 [建议] run.js 入库不提自做。**
- **结构性收口(评审独立验)**:jobseek.rs 删 + `mod jobseek` 移除 + registry=4 platform caps(§1 重新业务无关);#6 债清(render 全 tt 双语 + 保留「示意性/打样」诚实框定);D3 双点闸迁移保住。
- **★裁决①(float 入参差异)= 接受 JS floor,别复刻已删 Rust 的 artifact**:Rust 旧 `as_i64(3.9)=None→1` 是 as_i64 对 float 返 None 的 **artifact 非设计**;**jobseek.rs 已删 ⇒「等价于已删代码」是伪命题**,JS 按自身对错判(floor 对);同第61(created_at 归一化非复刻旧 fail)/66(修复优先于复刻坏行为)裁法。**落**:compute doc 注「有意不同于已删 Rust、勿对齐」(勿留未述边界 standing)。**★「我 flag 它没蒙混」正是这条纪律在起作用。**
- **★裁决②(三 market-value 路径)= 真冗余,危害=公式漂移;收敛留 aiRun-真化(P2)**:app-tool(真 compute)/`openMarketValue`(前端 mock)/`value-card`(frameQuery)三份 `base+Σlvl×1.6` 会漂移。`computeMarketValue` 现零 import 可复用 ⇒ 真化 market-value 那刀三面收敛到单一 compute。**T3 范围克制正确、非现在做**。**记债**。
- **★[建议]③(自包含验证)= 加零-import 源码守卫**:eval 测 `new Function(String(compute))` 只证**被覆盖路径**(path-dependent),顶层 import 不进 `String(compute)`、只在真沙箱 ReferenceError(fail-closed=健壮性非安全 ⇒ [建议])。**落**:`fs.readFileSync` 源扫断言零 import(path-independent,镜像 registry-tools + Rust prod());变异证红(node-safe import→守卫单独红 34/33,隔离出是守卫非 load 失败)。
- **裁决④(filterReadableTools 抽取)= 零回归确认**:`reads.every(c=>readable.has(c))`+只 map 元数据,与旧内联逐字一致 + 加 `Array.isArray` 防御;ai-engine 委托。
- **[建议]§五(迁移残留)= 收回 private**:`readable_set`/`gen_widget_id` 当年为 jobseek.rs 放宽 `pub(crate)`(第60轮),jobseek.rs 删 + 二者仅 capability.rs 内用 ⇒ **独立核实用法后**收回 private fn + 删 stale「jobseek.rs 复用」注释。
- **验(复核收尾 `a4a9e2f`)**:npm test **34** · cargo test 132 · clippy 0(private fn 无未用告警)· fmt 净 · tsc 51 · boot 0 panic。
- **★arc 回望(第51→67→T0-T3)**:路线 A 破口(前端直调 rt 读 profile/绕 D3)→ 判路线 C → 协议核→沙箱→契约→接线→首迁移;**路线 A 会开的破口路线 C 一个没开**(compute 沙箱够不到 rt/profile、取数经 query_data 既有咽喉、输出投影+框定),安全全靠**结构与类型 + 入库 CI lane**(npm 34/0 + cargo 132/0)。**下一步(P2 主体解锁)**:jobseek 剩余 aiRun 真化(反馈需先解 ivScore schema;真化 market-value 那刀收敛三路径)· notes/prompts→记忆/Skills · assets 退役 · 绿地各单出方案。**app-tool 契约是它们的地基**。

### ivScore schema 刀 · 面试评分承重结构定 schema + fail-safe 归一化 · commit `0f20659` · ⏳ 待审
用户裁定的下一刀(P2:notes 由知识库半覆盖已过;跳过 notes→记忆〔记忆是 AI 专写、无 rt.memory.remember,promote 需新架构,用户裁定跳过〕;三候选选 ivScore schema)。**先量再改**:`ivScore(ans)` 是 mock(答案长度+`Math.random()`+硬编码文案池);评分 `{scores:{structure,depth,quant,overall}, good, improve}` 被单题反馈/整轮平均(`avg(k)=Σscores[k]/n`)/总评/成长曲线/`iv_records` 持久化全消费=**承重**。契约优先:真化前先钉死契约,「分数由谁产出(mock/AI)」与「结构+校验」解耦。
- **`iv-feedback.js`(新,零 import、node 可测、真模块导出)**:**wire 形(扁平)** = 产出方给 `{structure,depth,quant,good?,improve?}`(mock 现给/AI 真化后给,经 `IV_FEEDBACK_SCHEMA` 校验)**无 overall**(平台算、产出方不自报,防 AI 报个与维度不符的);**canonical 形(嵌套)** = 消费者用 `{scores:{...+overall},good,improve}`;`normIvFeedback(wire)` 归一:各维钳 0-10、**★overall 永远由 3 维重算**(与显示一致)、good/improve 强制字符串数组有界、**★fail-safe** 缺失/畸形→默认绝不抛(承重消费者不崩)。`IV_FEEDBACK_SCHEMA`/`IV_DIMS` 导出供真化校验 AI 产出。
- **intake-action.js**:mock ivScore 产 wire → `normIvFeedback`(顺带修旧 mock overall 用 pre-max quant 的潜在不一致);承重消费者**零改动**(仍拿 canonical 形)。
- **验**:npm test **42**(+8:钳/★overall 重算/★fail-safe/文字有界/schema 校验 wire/★零 import 源守卫);**两变异证红**(overall 信输入→重算测试红;去 clamp→钳+fail-safe 红);node --check 净·tsc 51·真机 boot 0 panic。**preview 真机驱动验证(用户要求补)**:清代理缓存(fetch cache:reload 5 文件后 reload,证 appTools/market-value tool 全新鲜)→ 面试页 → 题库点题 → 输入 225 字答案 → 提交 → **反馈卡渲染**:综合 **7.8**/10、结构 8.3/深度 8.4/量化 6.8、做得好×2、可以更好×3。**★overall 7.8 = round((8.3+8.4+6.8)/3,1) = round(7.833) ⇒ 证 normIvFeedback 运行、overall 由 3 维重算**(承重一致性);**0 console error**(正向证为主、console 辅)。**评审请核**:①契约选形(wire 无 overall、平台重算 = 防 AI 自报不符)是否稳妥;②承重消费者零改动的判断(整轮平均/总评/成长曲线/持久化都只吃 canonical `{scores:{4},good,improve}`);③fail-safe 覆盖面。**下一刀 = 面试反馈真化**(AI 产 wire → IV_FEEDBACK_SCHEMA 校验 → normIvFeedback → 消费者;走 ai_generate 无工具 + JD/答案 untrusted 框定,同出题/改写模板)。

### ★ 第75轮独立复核 = ivScore schema 刀 🏁 通过 + 1 [建议]④(已落 `7f91d2a`)+ 真化前置
**评审亲跑 npm 42/0;独立扫全部消费者确认零改动无漏;认可我 T3 [建议]③(零-import 源守卫)在这刀主动内化。**
- **核心核实**:`normIvFeedback` overall 永远 3 维重算(不信输入)· clampDim 非数→0/钳/1 位 · coerceList 有界 · fail-safe 非对象→`{}` 绝不抛。承重契约成立。
- **五自查裁决**:①**wire 无 overall、平台重算 = 背书**(不信不可信产出方派生值的结构化,对真化尤关键——被注入 AI 可能自报 `overall:10` 而维度都低,重算堵死;同 projectToSchema/撤销「重算最近一次」/整条 arc「recompute 不 trust」同源)②**消费者零改动无漏**(评审独立扫:单题卡/持久化/整轮平均/总评页/成长曲线/记录列表/skills 页全读 canonical 嵌套 `scores.{4}`;`intake-job.js:205` 的 `scores.interest/growth/match/chance` 是**岗位录入评分非面试反馈**、不相干)③**接受一致性修、别保旧 bug**(旧 mock overall 用 pre-max quant 算却显示 max(5,quant)=一致性 bug;为「零行为改动」保 bug=复刻坏行为,同 T3① 别复刻已删 artifact)④**判断半对 → [建议]**⑤fail-safe 够。
- **★[建议]④(整轮聚合走 normIvFeedback)· 已落**:`ivFinishRound:393` 整轮 overall = per-q overall 均值(非整轮 3 维重算)⇒ 总评卡 overall 与其显示 3 维只近似(舍入 ≤0.1),per-question 卡严格、整轮卡不严格=两级不一致。**我独立核实属实**后落:整轮 3 维均值走 normIvFeedback ⇒ 整轮 overall=round(整轮 3 维均值)、不变式两级一致 + DRY(删手写 .toFixed)+ fail-safe。**preview 真机驱动整轮(4 题)证**:总评卡 综合 **7.7**=round((7.9+7.4+7.7)/3)=整轮 3 维均值(新行为)≠ round(mean per-q overalls 7.7/7.5/7.5/7.8)=7.6(旧行为)⇒ 改动生效、不变式两级一致;0 console error。
- **★真化那刀的前置(评审现在说清)**:`IV_FEEDBACK_SCHEMA` 校验是**硬闸**,失败 → **诚实降级**(回落 mock / 如实报「未能生成评分,请重试」),**绝不落 normIvFeedback 全 0** —— normIvFeedback 的 fail-safe(garbage→全 0)是**保护承重消费者不崩的防御层,不是「AI 乱答就给 0 分」的产品语义**;直接喂 garbage→normIvFeedback→用户看到 `0.0/10` = 伪造 0 分、违「失败必须出声、不造半真结果」。**两层分工**:schema 拒畸形(产品语义)· normIvFeedback fail-safe(承重防崩、兜底非主路径)。
- **下一刀 = 面试反馈真化**(评审盯点):①`ai_generate` 无工具(结构性,同出题/改写)②JD+用户答案走 `untrusted` 框定(答案是用户输入、JD 外部,都不可信)③**★schema 校验硬闸失败诚实降级、不落 normIvFeedback 全 0**④流式 sink `textContent`、结果卡 cEsc。

### 面试反馈真化 · AI 产 wire → schema 硬闸 → normIvFeedback → 消费者 · commit `8db92ac` · ⏳ 待审
块(i) 收尾:ivScore schema 刀解锁后,面试反馈从 mock(答案长度+random)真化为真 AI 评分。严格复刻出题/改写模板 + 第75轮真化前置。
- **`iv-feedback.js`**:`parseFeedbackWire(text)` —— 从模型自由文本抽**第一个平衡 `{…}` 块**(串内花括号不计数),容错但不臆造;无/畸形 → null。零 import(node 可测)。
- **`resumes.js` ivSubmit 重构**:抽 `ivFeedbackHTML`/`bindIvFbButtons`(mock/真共用渲染+records 提交,调一次提交一次)· **门控诚实降级**(aiChatAvailable 假 → mock aiRun,不假装)· **真路径** `rt.ai.generate({task:'interview_feedback', instruction, untrusted})`:instruction **纯 app 常量**(要求只输出 JSON)· **untrusted = 题目+用户答案+岗位信息**(全不可信,后端 frame_untrusted 框定;信任地基=ai_generate 结构性无工具)· onDone `parseFeedbackWire` → **★`projectToSchema(wire, IV_FEEDBACK_SCHEMA)` 硬闸**,失败 → **诚实降级(报错重试)、绝不落 normIvFeedback 全 0** · 过闸 → normIvFeedback → 渲染;流式不展示原始 JSON、输出经 cEsc(§4-4)。
- **验**:npm test **44**(+2:parseFeedbackWire 6 例 / parse→schema→norm 全链硬闸)。**preview 真机(伪造 __TAURI__ 走真路径 + stub rt.ai.generate)**:①真路径 task=interview_feedback、**instruction 纯常量不含注入**、注入答案全落 untrusted ②合法 JSON→卡渲染 **overall 8=round((8+7+9)/3)**、good/improve 出、**注入 `<img onerror>` 经 cEsc 未成元素** ③无 JSON→诚实报错+submit 重启用 ④**★漏维 wire→schema 硬闸→诚实报错、绝不出 0.0/10 伪造卡** ⑤mock 路径(去 __TAURI__)零回归渲染 overall=avg;0 console error。node --check 净·tsc 51·真机 boot 0 panic。**诚实边界**:端到端真模型需 BYO;preview 以 stub 验契约面+全失败面。**评审请核**:①信任分层(instruction 纯常量 / 题目+答案+岗位全 untrusted;答案是用户输入必不可信)②schema 硬闸失败诚实降级不落全 0(第75轮前置兑现)③mock/真共用 ivFeedbackHTML 的 records 提交一次不重复 ④cEsc 覆盖 AI 输出(good/improve)。**★块(i) 三站点全真化**:出题 ✓ · 简历改写 ✓ · 面试反馈 ✓(schema 刀 + 真化)。

### ★ 第76轮独立复核 = ivScore [建议]④ + 面试反馈真化 🏁 两刀通过 · 块(i) 收尾 · 下一步次序裁定
**五自查点逐条核实全对,无 [应改]/[建议]。评审据我的测量修正了自己第74轮② 的框定。**
- **刀一([建议]④)**:`normIvFeedback({structure:dimAvg,...})` ⇒ 整轮 overall=round(整轮 3 维均值)、两级一致+DRY+fail-safe;preview 坐实新行为(7.7≠旧 7.6)。精确落地。
- **刀二(反馈真化)五自查全对**:①信任分层完整(instruction 纯常量、题目+用户答案+岗位全 untrusted)—— **比第68轮出题更干净**(那刀评审得 flag j.co 进 instruction;这刀从一开始所有派生就在 untrusted)②**★schema 硬闸两层分工**(`if(!wire||!projectToSchema.ok)诚实降级 return`,只有校验过的 wire 进 normIvFeedback;注释逐字兑现第75轮前置「fail-safe 是承重防崩、非乱答给 0 分」)③onToken 不展示原始 JSON、合理④**降级=报错重试非回落 mock**(gate 已在 AI 不可用时 mock;AI 可用却 garbage→报错、不给用户以为是 AI 的假 demo 分)⑤**无双重提交**(persist 在 ivFeedbackHTML,mock/真互斥各调一次)+ **★附带正确性**:schema-fail 路径不调 ivFeedbackHTML ⇒ **畸形 AI 输出零持久化**。npm 44/0 亲跑、注入经 cEsc 未成元素。
- **★块(i) 里程碑**:出题/改写/反馈三站点真化,用户最初「不是 AI-Native」反馈的三条核心流都有真 AI。
- **★★下一步次序裁定(评审答我三问)**:
  - **② market-value「48 是静态 mock 非公式副本」测量 → 降第74轮② 优先级**:评审第74轮② 把危害定为「三份 `base+Σlvl×1.6` 公式漂移」;**我量出 YOU_VALUE=48 是静态 mock 非公式副本 ⇒ 根本无共享公式可漂移**,「防漂移」紧迫性不成立 ⇒ market-value 收敛从「结构债」降为「**真化-质量 polish**(48→真实区间)」、**低优先随手做**。**评审:又一次「先量 refutes 上一轮判断」,这次 refute 的是评审第74轮框定。**
  - **③ 智能匹配真化要先走 schema 刀 = 要,且多一层设计决定**:match 分承重(overview/排序/analysis/持久化多消费)⇒ 同 ivScore、schema-first 已验证(ivScore 刀解耦、反馈真化时硬闸当场接住畸形 AI 输出)。**★但比 ivScore 多一层**:match 不只一个分、是**匹配逻辑**(为何匹配/gap)⇒ schema 刀里顺带定 **确定性公式(→ 可做 route-C app-tool,读 jobs+skills 算,第一次在真实复杂工具上验 T0–T3 契约)vs AI 判断(→ ai_generate 无工具)**的拆分,**很可能是混合**(分=app-tool/理由=generative)。
  - **① P2 主体推荐次序**:1)**智能匹配 schema 刀(含 app-tool-vs-generative 拆分)→ 真化**(首选:旗舰、用户可见价值最高、承重故 schema-first、块 i 肌肉记忆趁热、无上游依赖、可能首次真实复杂工具验 T0–T3);2)**Skills 契约方案**(其次/可并行:app-tool 已解锁、绿地设计从容出方案);3)prompts→Skills→assets 退役(下游,assets 退役偏早);4)market-value 收敛(低优先 polish)。**不建议**先 assets 退役/先绿地。
- **★智能匹配四盯点(评审预告)**:①schema-first 定 canonical match-result(分+理由+gap)+ fail-safe(承重不崩,同 ivScore)②若 match 分走 app-tool → **D3 双点闸**(reads:['jobs','skills'] 上架 filter + query_data 硬拒)+ 输出 projectToSchema+框定,现成 test lane 双向阳性对照 ③若走 ai_generate → JD+简历全 untrusted、schema 硬闸失败诚实降级不造假分 ④**混合时两条通道别合并语义**(同第64轮 resolve/onConfirm 之鉴)。**下一刀 = 智能匹配 schema 刀。**

### 智能匹配 方案 + M1(页面算真分) · 方案 `2018b5f`→修正 + M1 `f734a93` · ⏳ 待审
承第76轮次序裁定,起智能匹配。**★先量再改推翻我自己方案的 premise(第四次同类教训)**:方案初稿断言「match 分是静态 mock、真化为公式替换 j.match」;**落码前量清 = 错**:`j.match` 不是 mock、是**用户 intake 自评滑块**(intake-job.js:89「我现在的能力对得上吗」,与 兴趣/成长/机会 并列)⇒ **用 computeMatch 覆盖它 = 覆盖用户输入**。量清后真相:智能匹配页把**用户主观自评**当**客观 AI 分析**显示=错位;真·假的只有 rewrites(硬编码假 QPS)。**用户拍板「页面算真分 + 真化改写」**(4 选项;先 M1)。
- **M1 落地**:`match-result.js`(零 import node 可测)`computeMatch(job,skills)`(每 need 技能 lvl≥3 满/1-2 半/缺 0,score=10×Σ信用/need)+ `normMatchResult` fail-safe + `MATCH_REASONING_SCHEMA`(M3 prep)。**★两通道语义分离**:分/集合由 computeMatch 产、reasoning 由 AI 产(M3),分永不 AI 产(承重不信 AI,同反馈刀)。`matchReadout` 分/缺口/强项走 computeMatch、标**「综合匹配度 · 基于你的技能」**(诚实、区别于用户自评);**★`j.match` 滑块 + copilot 排序 + overview 均值不动**(用户输入不覆盖)。
- **验**:npm test **52**(+8:公式/★gaps need 序=topGapsOf 等价/全满全缺空/lvl 钳/★fail-safe/schema/零-import 守卫);**两变异证红**(partial 权重 0.5→1 分公式红;normMatchResult 不钳 fail-safe 红)。**preview 真机驱动 match 页**:字节岗 **pct=92**(5 满+1 partial → 5.5/6×10=9.2)**≠ j.match×10=75** ⇒ 证 computeMatch 生效(客观重叠≠用户自评)、「基于你的技能」标注出、gaps 出、0 console error。node --check 净·tsc 51·boot 0 panic。**方案 doc 已修正**(留档 premise 被推翻)。**评审请核**:①j.match=用户滑块的测量(computeMatch 不覆盖它,并存两个量)②computeMatch 公式(打样级、可复现、承重排序仍归 j.match)③两通道分离(分永不 AI)④诚实标注「基于你的技能」。**下一步**:M2(可选 match app-tool,首次真实复杂工具验 T0–T3)/ M3(改写链 resumeGenerate 或 AI gap 理由)。**★同类测量教训第四次(market-value/ivScore/此)**:真化≠全上 AI/公式,先量每个字段真实来源。

### ★ 第77轮独立复核 = 智能匹配方案+M1 🏁 通过 + 1 [建议]①(已落 `692b4b3`)+ 次序裁定
**评审认了这刀的核心测量翻案「从方法论变成防线」—— 阻止了一个会破坏用户数据的真 bug。**
- **★第三次先量翻案的独特价值 = 阻止数据破坏**:评审核实 `intake-job.js:89` `j.match` 确是用户自评滑块;**若照原方案「computeMatch 覆盖 j.match」编码,就摧毁用户输入**。这不只是「测量修正判断」第三次(market-value/ivScore/此),**独特在:测量阻止了会破坏用户数据的 bug**。「先量再改」从方法论变防线。
- **M1 核实通过**:不覆盖 j.match(jobs 列表/overview 仍用 j.match、match 页走 computeMatch 标「基于你的技能」)· 两量语义分离(分永不 AI 产)· computeMatch 读真实 skills/lvl 钳/gaps 序=topGapsOf 等价/零 import 守卫 · npm 52/0 亲跑+两变异证红 · normMatchResult 确未上主路径(M3 prep)。
- **四裁决**:①**两个 match 数并存标注做一半→[建议]**(客观侧「基于你的技能」好,但主观 j.match 在列表/overview 仍只叫「匹配」会困惑)②**排序保 j.match = M1 正确的非破坏选择**(切客观留下游产品决定,两键都可复现)③打样公式 OK ④**normMatchResult 前瞻件接受但系于 M3(b) 真做**(只做 M3(a) 就删它)。
- **★[建议]① 已落 `692b4b3`**:独立核实属实(量出 j.match 显示点)后落:intake `— SCORING`→`— SELF-ASSESSMENT · 我的评估`+消歧注;overview `平均匹配分`→`平均自评匹配`。主观自评与客观重叠不言自明是两回事。node/tsc/npm 净、代理服务新码确认、boot 0 panic。
- **★★下一步次序裁定(评审)**:**M1 后智能匹配剩的真·假只有 rewrites 硬编码假 QPS** ⇒ **① M3(a) rewrites → 复用已真化 `resumeGenerate`(下一刀首选:修最后一个假、便宜)** → ②可选 M3(b) AI gap 理由(做则前瞻件正当;不做则删)/ M2 app-tool(**多读 D3 已被 run.js reads 循环结构性覆盖、M2 只是首次 live 验=增量,可延、非假修**)→ ③ Skills 契约方案(更大已解锁 P2)→ market-value polish 低优先。**M3(a) 盯点**:match 页 rewrites 确路由到**已真化 resumeGenerate**(非另造 ai_generate)、信任分层/诚实降级继承、无双重提交。**下一刀 = M3(a)。**

### 智能匹配 M3(a) · match 页 rewrites 退役假 QPS → 指真化 resumeGenerate · commit `79a209c` · ⏳ 待审
承第77轮次序裁定(M3(a) 首选:修智能匹配最后一个假、便宜)。**先量确认**:match 页「生成完整定制简历」按钮(bindReadout `data-full`)本就 → `aiResumeForJob` → `resumeGenerate`(块 i 已真化:AI 只重写概要、事实字段用真实数据);真·假只是上面那段 `genRewrites` 硬编码预览(「10w+ QPS / 99.99% / P99 200ms→80ms」= 假数据)。
- **match.js matchReadout**:删 genRewrites 假预览(rw.map old/neo 对),RESUME REWRITE 改**诚实 CTA**「AI 会基于你**真实的**简历,按这个岗位重写**概要** —— 工作/项目/技能事实一律用你的原数据,**绝不虚构**」+ 保留按钮(→ 已真化 resumeGenerate,绑定不变)。**intake-action.js**:退役 `genRewrites` 定义(grep 确认 0 消费者)。
- **★盯点兑现**:①rewrites 确路由到**已真化 resumeGenerate**、非另造 ai_generate(按钮绑定不变)②信任分层/诚实降级**继承**(resumeGenerate 已有、零改动)③**无新增提交路径**(删预览、非加生成)。
- **验**:node --check 净·tsc 51·npm 52·**preview 真机驱动 match 页**:**假 QPS(10w+/99.99%/P99)消失**、诚实 CTA 出「绝不虚构」、按钮在且绑 aiResumeForJob、0 console error·boot 0 panic。
- **★★智能匹配「假」清零**:M1 分从「自评当客观」修为 computeMatch、[建议]① 消歧、M3(a) rewrites 退役假 QPS 指真化件。gaps/strengths/plan 本就真、j.match/排序是用户输入。**评审请核**:①genRewrites 退役 0 消费者(仅 match.js)②按钮 → resumeGenerate 未变、非另造 ③诚实 CTA 不过度声称(resumeGenerate 只写概要、事实不虚构,CTA 如实说)。**下一步**:M2/M3(b) 可选增强(非假修)/ Skills 契约方案(更大 P2)/ market-value polish 低优先。
