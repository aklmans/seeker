# 持续风险台账

> 记录已知但尚未闭合的风险,带着进后续里程碑,别等踩到才发现。
> 对应 `prototypes/Seeker 桌面工程总体方案.html` ⑬ 风险 与 `安全与隐私模型方案`。

## R1 · macOS / WKWebView 渲染零冒烟 〔核心已闭 · 2026-07-03〕

- **核心盲区已闭合(2026-07-03,屏幕录制授权后真机 computer-use 冒烟)**:把 dev binary 包成 `.app` 装进 `/Applications` 以正式身份运行,WKWebView 逐项目测——**总览 / 智能匹配 / 数据设置 / 应用管理模态**四个不同页面 + **浅色↔深色主题切换** + **应用开关交互(关求职→nav 只剩设置、当前页跳走、设置页可用;重开→恢复)+ shellReassemble 重装配**,全部渲染/交互正确;设计语言(暖橙节制、衬线斜体标题+暖橙句号、Mono 大写标签、0.5px 边框)在 WebKit 内核与网页端一致。→ "WKWebView 从未真机渲染"的核心风险消除,并取得**阶段2 后视觉基线**(供阶段3 搬迁对比)。
- **剩余增量(不阻塞)**:其余 5 业务页(简历/岗位/分析/职业资产/行动/面试)逐页目测 + Agent 双模式 + D3 后端强制 e2e(需可用模型);均走同一已验证的 WKWebView 渲染管线,风险低。
- **旧现状(存档)**:开发机原为 Windows,M0 仅在 **WebView2(Chromium 内核)** 验证过原型渲染;
  **WKWebView(Safari/WebKit 内核)当时从未冒烟。**
- **为什么是风险**:两端 WebView 内核不同(总盘 ⑬「渲染差异」),CSS/JS 行为可能有别;
  原型用到的特性(如 `color-mix()`、`backdrop-filter`、字体回退、`localStorage`)需在 WKWebView 实测。
- **注意**:`release.yml` 的 `macos-latest` 只做**编译**,**编译 ≠ 渲染冒烟**——产物能编出不代表页面渲染正确。
- **闭合条件(任一)**:① 借一台 Mac 手动跑 `tauri dev` 目测 9 页 + 双模式 + 主题;
  ② CI 上加 macOS 的带 UI 自动化(启动 + 截图比对)。**macOS 正式发布前(最迟 M6)必须做。**
- **缓解**:每个里程碑保持"避免依赖单端特性 + 关键交互写差异回退"(总盘 ⑬ 对策)。

## R2 · 收紧 CSP 与原型大量内联的张力 〔已闭合 · #2 S2,2026-06-03〕

- **结论**:采用上方案 3(主窗口适度放宽、强隔离留给沙箱 iframe)。`tauri.conf.json`
  `security.csp` 由 `null` 收紧为:`default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self';
  frame-ancestors 'none'`,并 `dangerousDisableAssetCspModification: ["script-src","style-src"]`。
- **为何 `'unsafe-inline'` 不可免(非偷懒)**:原型有**几十处内联 `onclick="..."` 事件处理器**
  + 海量内联 `style="..."`。内联事件处理器**既不能 nonce 也不能 hash**(仅 `'unsafe-inline'` 放行);
  方案 1/2(抽取 / nonce)需把这些处理器全改写成 `addEventListener`——大动原型、违反"不偏离原型 + 范围克制"。
  `dangerousDisableAssetCspModification` 是必需:否则 Tauri 给 `<script>/<style>` 注入 nonce 会按 CSP 规范
  **使 `'unsafe-inline'` 失效**,内联处理器当场全废。
- **安全增益仍实在**:主窗口是**半信任壳**(只跑我们自己的代码,不把不可信 HTML 注入主 DOM——
  LLM widget 走沙箱 iframe、外部文本转义标 Untrusted);真正威胁是被注入后外泄,已由
  **`connect-src` 锁死(仅 self + Tauri IPC,杜绝前端直连外网)** + `default-src 'self'` + `object-src 'none'` 封堵。
- **实测(桌面 CDP)**:CSP 下原型**零违规干净加载**(`securitypolicyviolation` 收集器全程为空,
  内联脚本/样式/`onclick` 处理器均工作)、IPC `invoke` 通(`rt.db.list` 往返)、
  **外部网络被拦**——对**可连通**的本地非 self 源(127.0.0.1:8799)`fetch` 抛 `TypeError`(可达却被拦=CSP),
  违规日志录到 `connect-src | https://example.com/`。
- **遗留**:show_widget 的 iframe 严格 CSP(`default-src 'none'`)+ 沙箱三道墙随 **show_widget(#2 下一步)**
  落地;届时复查主窗口是否需为 srcdoc iframe 放行 `frame-src`(当前回落 `default-src 'self'`)。
- macOS/WKWebView 上同一 CSP 的行为差异并入 [R1] 一并冒烟。

## R3 · Windows `open_external`(explorer)修复运行时未验 〔Windows 发布前必须闭合〕

- **现状**:第 3 轮审查发现 Windows 路径 `cmd /C start "" <url>` 命令注入(`http://x/?a&calc.exe` 可执行任意命令 + 含 `&` 多参 URL 截断),已改 `explorer`(commit `5a54fdb`);但开发机为 Mac,`#[cfg(target_os = "windows")]` 分支在 Mac **不编译、更未运行时验**。
- **为什么是风险**:纯 std `Command::new("explorer").arg(url)` 与已验证的 macOS/Linux 启动器**结构同构**(仅程序名不同)→ 编译几乎必然;但"explorer 确实打开默认浏览器 + `&` 等 cmd 元字符确实当字面量(不注入)"需在**真实 Windows** 点验。
- **闭合条件**:一次 Windows 构建 + 手动点开一个含 `&` 的多参 URL(如 `https://x/?utm=a&ref=b`),确认打开正确浏览器、无命令执行。**Windows 正式发布前必做**(与 [R1] 一并;当前 Mac 焦点,不阻塞 Mac 里程碑)。
- **缓解**:macOS `open` / Linux `xdg-open` 路径不受影响(走 argv、无 shell);Windows 非近期发布目标。详见 [review-log.md](review-log.md) 第 3 轮。

## R4 · 多应用平台化的单体拆分回归 〔阶段 1–3 持续存续〕

- **现状**:2026-07-03 拍板多应用平台化(`proposal-app-platform.md`);重构对象 = 4602 行 / 248 函数的 `index.html` 单体(9 页、双模式、10 卡种、i18n 全内联),`web/domain/` 为空壳。
- **为什么是风险**:壳化(阶段 1)与逐页搬迁(阶段 3)动的是全部 UI 接线;且 [R1] 的 WKWebView 真机目测仍未做——大重构 × 零真机基线 = 双重风险。
- **缓解**:D5 适配器先行(阶段 1 行为零回归)+ 逐页一 commit;每步 `node --check`/`tsc`/`cargo build` 重嵌;**网页端静态服务冒烟**(同一份前端,浏览器可自动化点验 9 页,补桌面 GUI 冒烟盲区);每阶段外审过再进下一阶段。
- **闭合条件**:阶段 3 搬迁完成 + 目测(含 [R1] 的 WKWebView 冒烟)。
- **进展(2026-07-03)**:[R1] 核心已闭,取得**阶段2 后的 WKWebView 视觉基线**(总览/智能匹配/设置/应用管理 + 双主题真机正确)→ 阶段 3 逐页搬迁后可与此基线对比,回归风险显著下降。
