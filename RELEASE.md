# Seeker · 构建与发布(#6)

本机构建桌面安装包,并验证 **prod 资源路径**(`BaseDirectory::Resource`)。
代码签名 / 公证 / WKWebView 冒烟仍 gated(见末节)。

## 前置

- Rust toolchain —— `~/.cargo/bin` 须在 PATH(本机全新 shell 不自带,见 `cargo-path-fresh-shell` 记忆)。
- Node + npm —— `npm install` 会装 `@tauri-apps/cli`(已钉 2.11.2,与 Rust `tauri` crate 一致),使构建版本可复现。

## 构建未签名安装包

```sh
npm install            # 一次性:装 @tauri-apps/cli(本地、版本钉死)
npm run build          # = tauri build --bundles nsis(NSIS 已缓存,免下 WiX)
# npm run build:all    # 全 targets(MSI 需 WiX,首次会联网下载)
```

产物:

- `src-tauri/target/release/app.exe` —— release 二进制(`debug_assertions` 关)。
- `src-tauri/target/release/bundle/nsis/Seeker_<ver>_x64-setup.exe` —— **未签名** NSIS 安装包。
- `src-tauri/target/release/prompts/prompts.json` —— `bundle.resources` 映射的域系统提示 overlay 资源。

## 验证 prod 资源路径(BaseDirectory::Resource)

系统提示 = 平台基线(`src-tauri/src/prompts.rs` 的 `PROMPT_BASELINE`)+ 运行时加载的域 overlay
(`web/domain/prompts/prompts.json`,经 `app.path().resolve("prompts/prompts.json", BaseDirectory::Resource)`)。
**release 构建 `debug_assertions` 关闭 → 无 dev 源文件回退**,所以跑 release 二进制就是纯 prod 资源路径。

```powershell
# 1) 带 CDP 端口启动 release 二进制
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
Start-Process .\src-tauri\target\release\app.exe
# 2) 跑验证脚本:mock SSE 端点抓 ai_chat 的系统提示,查是否含域 overlay 文案
node scripts/verify-prod-resource.mjs
```

期望输出含 `"hasOverlay": true` —— 即 overlay 从 Tauri 资源成功加载,prod 资源路径 OK。
脚本只临时改 `base_url`/`model`(验完还原),**不动钥匙串里的 key**(原无 key 时设临时 dummy、用完清除)。

## 已验证(2026-06 · 本机 Windows)

- NSIS 未签名安装包产出:`Seeker_0.1.0_x64-setup.exe`(~3.7 MB)。
- **prod 资源路径闭合**:release 构建 `BaseDirectory::Resource` 端到端解析 `prompts.json` 成功
  (`hasOverlay: true`,系统提示含域 overlay 文案 "job-hunt research assistant",sysLen ≈ 1225)。

## 仍 gated(需对应环境 / 凭据)

- **WKWebView 冒烟** —— 需 macOS。
- **代码签名 / 公证** —— 需 Windows 代码签名证书 / Apple 公证凭据。
- **updater 自动更新** —— 需重新生成签名密钥(见 `seeker-m0-state` 记忆)。
