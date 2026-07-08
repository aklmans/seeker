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
