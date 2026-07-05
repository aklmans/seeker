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

## 第 20 轮 — ⏳ 待审(送审中) · 序5-b PROFILE→平台(落地第19轮 §1 必清项)(`0547ffd..af80e1d`)

> 落地第19轮裁定的序5-完成前必清项:PROFILE 数据对象 jobseek→platform,清 profile.js 的平台→apps §1 债。与 5-a 的 PROFILE 归属一并送审。

| 刀 | 内容 | 去向 | 性质 |
|---|---|---|---|
| 5-b `af80e1d` | PROFILE 数据对象(个人信息=壳级用户身份) | jobseek intake-action.js → platform/shell/profile.js | 归属归位(清第19轮 §1 债) |

**★ §1 债已清(第19轮裁定落地)**:PROFILE(name/phone/email/city/intent/exp)从 jobseek `intake-action.js:127` **逐字节纯剪切** → profile.js。**profile.js 现自持 PROFILE、不再具名引用 jobseek 全局**(之前 hydrateProfile 的 `PROFILE[k]=p[k]` = 平台模块→apps §1 债 → 现平台→平台);jobseek 消费者(resumes.js×8 读联系方式渲简历 / index.html renderSettings data-pf)读 PROFILE = **apps→平台(允许)**。**对安全无损**:profile 隔离仍在 rt.profile + 后端(未变),PROFILE 只是内存镜像。

**零回归**:PROFILE 全局唯一定义(profile.js:10,grep 核实);PROFILE 定义逐字节一致;载序 profile.js@868(head classic)先于消费者 intake-action@1550/resumes@1563(const 全局词法绑定、classic 间共享);node/内联 8 块/tsc(31 外链)净;**红线核心(capability/secret/data.rs profile/CSP/invariants)空 diff**。
**冒烟**:PROFILE 从 profile.js **live**(`city=北京`/`name=(在数据设置填写)`)、persistProfileField/hydrateProfile 在。**⚠ cache 缺口(测试环境 · 同序3-d-5 / 第12轮裁断)**:webview 强缓存旧 intake-action.js(含 `const PROFILE`)与新 profile.js `const PROFILE` 撞 → 缓存态该文件加载失败(console redeclaration);**磁盘正确**(`served_intake_hasPROFILE=false` / `served_profile_hasPROFILE=true` = PROFILE 全局唯一),桌面 asset:// / 清缓存无冲突、非代码缺陷。

**序5 剩余(过审后续做)**:5-c renderSettings 拆(壳部分 theme/lang/density/model → platform + jobseek 段 goals/weights/主简历 → apps · **第 7 契约 manifest.settings**)+ 5-d initShell + 5-e INIT 分解 + settingsPersistOn/saveSettings/hydrateSettings 归属。
