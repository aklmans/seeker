# 构建 / 签名 / 发布 · 最小闭环现状

> 对应 `prototypes/构建签名发布方案.html`。M0 落地的是 **P1 的骨架**:
> 「能签的密钥已就绪 + CI 构建矩阵骨架」。真实证书/账号就绪后即可全量启用,无需改结构。

## 现在已就位(M0)

- **updater 签名密钥对**:本机 `tauri signer generate` 生成。
  - **私钥**:`~/.tauri/seeker-updater.key`(**仓库外** · 已 gitignore · 仅作 CI secret 来源)。
    > ⚠️ 当前**无密码**(骨架便利)。正式发布前应重生成带密码的密钥,妥善备份——
    > **私钥一旦丢失,将无法再推送任何自动更新**(见方案 ③ 最易踩的坑)。
  - **公钥(可公开)**:
    ```
    dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU5Q0VFMEVEOEY3MUVGRTUKUldUbDczR1A3ZURPV1NKcDJxNGhCRWxHK21oTE85cytCSEJSRkpSajJTblJmZGJiWmN3SmIwSGwK
    ```
    P2 接 updater 插件时写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- **CI 骨架**:
  - `.github/workflows/ci.yml` —— PR/push:rustfmt + clippy + 双端(win/mac)编译冒烟,不签名。
  - `.github/workflows/release.yml` —— tag `v*` 触发:双端构建矩阵 + tauri-action,签名凭据以 secrets 占位(缺失则出未签名包,不报错)。

## CI Secrets 清单(在 GitHub → Settings → Secrets and variables → Actions 配置)

| Secret | 用途 | 现状 |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | updater 私钥内容(`~/.tauri/seeker-updater.key` 全文) | 待填(密钥已生成) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥密码 | 当前空 |
| `APPLE_CERTIFICATE` / `_PASSWORD` | macOS Developer ID 证书(base64 .p12)+ 密码 | **TODO** 需 Apple 开发者账号 |
| `APPLE_SIGNING_IDENTITY` | 签名身份名 | **TODO** |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证用 Apple ID + app 专用密码 + 团队 ID | **TODO** |
| `WINDOWS_CERTIFICATE` / `_PASSWORD` | Win 代码签名证书(base64 .pfx)+ 密码 | **TODO** 需 OV/EV 证书 |

## 待办(证书/账号就绪后)

1. **macOS**:Apple 开发者账号 → 导出 Developer ID 证书 → 填 `APPLE_*` secrets → tauri-action 自动 codesign + notarize + staple。
2. **Windows**:申请 OV/EV 证书。两种接法:
   - **A(推荐 · Azure Trusted Signing)**:在 `tauri.conf.json` 配 `bundle.windows`,无需把 pfx 进 secrets。
   - **B(自带 pfx)**:`WINDOWS_CERTIFICATE*` secrets + 自定义 `signCommand`。
   > EV 证书能更快消除 SmartScreen 信誉警告;时间戳服务器签名防证书过期失效。
3. **P2 自动更新**:接 `tauri-plugin-updater`(Cargo 依赖 + lib.rs 注册 + capability 权限)+
   `tauri.conf.json` 的 `plugins.updater`(pubkey + endpoints)+ `bundle.createUpdaterArtifacts: true`;
   客户端内置公钥强制校验,校验失败拒装(对应 #4 供应链威胁 T6)。更新后跑数据迁移(#3),迁移前快照。

## 本机手动出包(可选,自测用)

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
# 从 app/ 运行;Windows 上出 NSIS 安装包(未签名)
tauri build --bundles nsis
# 产物:src-tauri/target/release/bundle/nsis/*.exe
```
> M0 已验证 debug 二进制可运行(`src-tauri/target/debug/app.exe`,~12.5MB,原生「Seeker」窗口 + WebView2)。
> 全量安装包打包由 CI 承担,本地按需执行上面命令即可。
