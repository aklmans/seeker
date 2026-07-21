# CLAUDE.md · 探索者 Seeker

> 在本仓工作的 Claude(及贡献者)始终遵循本文件。保持简短 —— 只写「现在是什么、什么不可违背、怎么干活」。

## 1 · 这是什么

**探索者 · Seeker** —— 本地优先的个人 AI Agent 平台:一个壳,N 个可开关的小应用。对话即入口(Agent 判断该做什么并执行),能力中心统一管理 连接器(MCP)/ 应用工具 / 记忆 / 知识库 / Skills / 定时任务 / 项目。首个应用是求职工作台,关掉它数据也保留。

**分发面**:桌面(Tauri 2,macOS/Windows)+ Web 演示(静态托管;自托管时经 `server/demo-proxy.mjs` 可接真模型)。

## 2 · 技术栈(不可偏离)

- **Tauri 2**:Rust 核 + 系统 WebView。不用 Electron。
- **前端原生 HTML/CSS/JS,不引入任何前端框架**;ES module,平台层 `@ts-check`(tsc 必须 0 error)。
- 数据:桌面 SQLite / 网页 IndexedDB,弹性 schema(骨架列 + `data_json`),加字段优先改 JSON 不写迁移。
- AI:BYO 多协议(OpenAI 兼容 / Anthropic / Gemini / Ollama),中立内部格式 + 适配器;前端只发文字收 token 流。

## 3 · 架构与目录

```
web/
├── platform/        # 平台层(稳定 · 业务无关):壳/契约/AI 网关/能力层/护栏/安全渲染/运行时适配
└── apps/            # 小应用层:每应用一目录,互不 import,只经 SeekerShell.* 契约与壳通信
    ├── jobseek/     #   求职工作台
    └── assets/      #   数据资产(Prompt 库 / 笔记)
src-tauri/           # Rust 核:SQLite · 钥匙串 · AI 工具循环 · MCP · 能力 registry(能力强制点在这里)
server/              # Web 演示自托管代理(零依赖单文件;key 只在服务端)
docs/                # 面向用户的文档(QUICKSTART / FEEDBACK / DEPLOY-DEMO / 截图)
```

**铁律:`platform/` 与 `apps/` 物理分离,只靠契约通信**;应用经 manifest 注册(页面/导航/卡片/命令/设置段),新增应用 = 新目录 + manifest,平台零改动;应用间禁止互相 import。

## 4 · 不可违背的红线(每段代码都要守)

1. **本地优先** —— 数据默认存本机、默认不外发;联网只为调用户自填的模型端点。
2. **密钥只进系统钥匙串** —— 绝不入库/配置文件/前端/日志;前端只见 `configured/empty`。Web 演示代理的上游 key 只存服务器环境,浏览器只持低价值访问码。
3. **隐私字段 AI 永不可读** —— `profile` 独立存储,类型层面无「导出给 AI」路径;能力层 `QUERYABLE` 是**静态常量硬底**(`profile/messages/settings/secrets` 永不在内,切勿重构成动态);应用数据 AI 可读走三层闸(应用启用 ∩ manifest 默认 ∩ 用户授权),强制点在 `query_data` invoke,非提示层暗示。
4. **设置不能经对话修改**;AI 不能给自己排定时任务、不能改项目指令 —— 自我持续/自我改写通路必须结构性缺席。
5. **反焦虑** —— 不用红色恐吓、不用倒计时。破坏性操作两档:非用户直接发起的**一律**走 guardrail(预览+确认+可撤销);用户 UI 发起的单条删除若撤销可靠可用「即时删 + toastUndo」。**「可撤销」必须是真的**(UI 语义与后端 trash 语义一致);guardrail 判据是「用户有没有可失去之物」;销毁之前先问能不能修。
6. **确认不可伪造** —— 确认按钮只能派发注册表(`cActions` 等,`Object.create(null)` + function-only)里的动作;按钮文案与语义由应用/平台自持硬编码,绝不由模型/RAG/MCP 派生内容决定;不可信内容只能作为已转义数据出现。
7. **不可信内容防注入** —— 模型输出/RAG/MCP/外部文本一律 `Untrusted` 框定后进模型、经安全渲染器(build-from-esc)进 DOM;LLM 生成 UI 走 iframe sandbox + srcDoc CSP + 父窗口零信任。
8. **设计语言统一** —— 暖橙节制(仅句号/标号/CTA/选中/进度)、0.5px 边框、系统字体栈、Mono 大写标签、衬线斜体标题+暖橙句号。不自创视觉。
9. **中英双语** —— 新增 UI 文案走 `tt()/T()` 双语。

## 5 · 工程纪律

- **先量再改**:动手前先测量(读代码/复现/取证),不凭印象断因果。
- **测试要能红**:断言必须能失败(变异测试是最强形态);「0 console error」必要非充分,主证是正向功能断言。
- **真机金标准**:改前端后 `cargo build` 必现 `Compiling app`(指纹重嵌);验收要截真窗口、走真实用户路径。给用户看效果须 `npm run build:all` 重打包。
- **preview 缓存坑**:浏览器按 URL 缓存模块,改完文件先 `fetch(url, {cache:'reload'})` + reload 再验;on-window 模块绝不可 `?bust=` import。
- **小步提交**:一个可工作的增量一个 commit;报告如实(测试挂了就说挂了)。

## 6 · 常用命令

```bash
npm test                 # 前端单元测试(node --test)
npm run typecheck        # tsc --noEmit(必须 0 error)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 测试
cargo fmt --manifest-path src-tauri/Cargo.toml    # 提交前跑(CI 有 --check 岗)
npm run build:all        # 打包 .app/.dmg(src-tauri/target/release/bundle/)
```

- **CI**(push 自动):fmt/clippy/双端 build/test + typecheck。
- **发布**:`gh release create vX.Y.Z` 后 tag 推送或手动触发 `release` workflow,自动出 mac dmg + Windows NSIS(现阶段刻意无签名,安装绕行见 docs/QUICKSTART.md)。
- **Web 演示部署**:push main(web/ 或 server/ 变更)自动经 `deploy-demo` workflow 部署到自托管服务器;配置全在 GitHub Secrets。

## 7 · 当前阶段

产品已公开发布(v0.1.x),**以稳定与真实用户反馈为先**:bug 修复与发布工程优先;新功能先提 issue 讨论再动手,不自行扩大范围(少即是多)。
