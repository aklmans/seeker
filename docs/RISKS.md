# 持续风险台账

> 记录已知但尚未闭合的风险,带着进后续里程碑,别等踩到才发现。
> 对应 `prototypes/Seeker 桌面工程总体方案.html` ⑬ 风险 与 `安全与隐私模型方案`。

## R1 · macOS / WKWebView 渲染零冒烟 〔最迟 M6 前必须闭合〕

- **现状**:开发机为 Windows,M0 仅在 **WebView2(Chromium 内核)** 验证了原型渲染。
  **WKWebView(Safari/WebKit 内核)从未冒烟过。**
- **为什么是风险**:两端 WebView 内核不同(总盘 ⑬「渲染差异」),CSS/JS 行为可能有别;
  原型用到的特性(如 `color-mix()`、`backdrop-filter`、字体回退、`localStorage`)需在 WKWebView 实测。
- **注意**:`release.yml` 的 `macos-latest` 只做**编译**,**编译 ≠ 渲染冒烟**——产物能编出不代表页面渲染正确。
- **闭合条件(任一)**:① 借一台 Mac 手动跑 `tauri dev` 目测 9 页 + 双模式 + 主题;
  ② CI 上加 macOS 的带 UI 自动化(启动 + 截图比对)。**macOS 正式发布前(最迟 M6)必须做。**
- **缓解**:每个里程碑保持"避免依赖单端特性 + 关键交互写差异回退"(总盘 ⑬ 对策)。

## R2 · #4 收紧 CSP 与原型大量内联的张力 〔进 #4 前预判〕

- **现状**:`index.html`(原型)是**单文件**,含**大量内联 `<style>` 与多段内联 `<script>`**,
  且用 `localStorage`(主题/语言/模式/侧栏宽度)。M0 的 `tauri.conf.json` `security.csp = null`(不限制)。
- **为什么是风险**:#4 安全要落地严格 CSP(`安全与隐私模型`:`default-src 'none'`、widget 内 CSP 等)。
  对主窗口若上 `script-src 'self'`、`style-src 'self'`,**会直接禁掉内联脚本/样式**,原型当场白屏。
- **进 #4 前要定的方案(三选一或组合)**:
  1. **抽取**:把内联 `<script>/<style>` 拆成外部 `.js`/`.css`(配合 domain/ui 模块化,本就是后续方向)——最干净,顺势做。
  2. **nonce / hash**:给保留的内联块加 `nonce-` 或 `'sha256-...'`(Tauri 支持注入 nonce)。
  3. 主窗口 CSP 适度放宽,**严格 CSP 只强制在 show_widget 的 iframe**(不可信代码才是重点)。
- **connect-src**:无论哪种,都要让 `connect-src` 放行 **AI 网关**所需(桌面端前端经 `rt.ai`→Tauri IPC,
  通常不直连外网;但要确认 IPC/asset 协议 origin 不被 CSP 误伤)。
- **关联**:这与 R 之外的「前端开始 import platform/domain 模块」是同一波改造(见 `docs/RELEASE.md` 与
  `tauri.conf.json` 的 frontendDist 复查点)——抽取内联 + 模块化 + 上 CSP 宜一起规划。
