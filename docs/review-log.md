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
- **真实搜索 MCP 接入**:stdio per-server env → 钥匙串(用户 2026-07-03 选暂缓);接入后 P1/P2 才算端到端(当前为机制级——用可信 mock 搜索 MCP 验证)。
- **R1 macOS WKWebView GUI 冒烟**:job-sources 卡过 tsc/node/重嵌,真机全量目测待屏幕录制授权。
