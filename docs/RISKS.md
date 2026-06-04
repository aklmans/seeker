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
