# Seeker · Roadmap

> 前瞻路线图。**当前状态 + 待办 + 明确延后**的单一视图。
> 权威推进顺序仍以 `../CLAUDE.md §5` 为准;架构「为什么」见 `proposal-app-platform.md`。本文件是它们的**前瞻汇总**,不覆盖二者。
> 更新于 2026-07-08(批11B 收官后)。

---

## ✅ 已达成(截至 2026-07-08)

| 里程碑 | 状态 |
|---|---|
| 阶段 0–2 · 壳与契约 + 应用管理页 + D3 三层闸 | 第5–6轮过审 |
| 阶段 3 · 求职逐页迁入 `apps/jobseek/` | 搬迁收官 |
| 阶段 4 · 第二应用「数据资产管理」(assets) | 第23轮过审(平台化前提成立:新增应用净成本 ≈ manifest+2页+白名单≈10行) |
| **3.y · 类型化 + 账本清空 + §1 契约化** | **第26–49轮全过审收官**。@ts-nocheck→全 module 全 import;桥 198→3(**业务桥 0**);§1 契约化四契约 `pageNew`/`pageActions`/`widgetActions`/`cActions` + `notifyDataImported`——平台层对 apps 符号裸读**全经契约收口** = **「platform/apps 物理分离、只靠契约通信」第一性原理实质达成** |

---

## 🔜 近期待办(收尾,非新功能)

- [x] **10d checklist① · AGENT_CMDS `@ts-check`** —— 抽出单列 `agent-commands.js`,字面量真受 `CommandSpec[]` 校验(漂移 tsc 可捕)。commit `8606a70`,待审。
- [ ] **10d checklist② · 真机覆盖 desktop-gated persist 写路径** —— 网页态 `jobsPersistOn()=false` 时 persist 写路径不执行;真机(`__TAURI__`)冒烟覆盖。
- [ ] **i18n 文案归属债** —— `agentGreet` 系开场白文案仍在平台(copilot-chrome `T('agentGreet')`)、带 jobseek 味;经 `manifest.greeting`(新契约或复用)归属应用。第14轮账。
- [ ] **#6 · macOS 签名 / 公证** —— 唯一长期挂账。需用户的 Apple 开发者证书(Claude 不碰凭据);Claude 可备构建/公证脚手架,证书与提交由用户手动。见 `RELEASE.md`。

> 完成上述后:用户手动真机体验一轮。

---

## ⏸ 阶段 5 · 后续应用逐个上(**已规划 · 暂不开发**)

> 用户裁定(2026-07-08):**写入 Roadmap 备忘,暂时不开发。** 平台化前提已由 assets(阶段4)验证成立——新增应用 = 新目录 + manifest,平台零改动。

按 `proposal-app-platform.md` 阶段5:

1. **记账(ledger)** —— 订阅 / 采购(新集合 `ledger_*`)+ **token 用量埋点**(唯一预见的平台层小改:AI 网关记 usage 事件——非红线,过审即可)。集合前缀 `ledger_`,`aiReadable: default-on` 可议。
2. **项目管理(project)** —— 新集合 `project_*`;纯应用层。
3. **健康管理(health)** —— **隐私分级示范**:`aiReadable: 'default-off'`(D3 三层闸的健康类红线前提)+ 首启明示;生理期/生理数据默认 AI 不可读、须用户 per-app 显式授权。

**新增每个应用的成本**(assets 已验)= manifest + 页面模块 + 后端集合白名单追加(D3 静态硬底的固有代价);**平台/壳 JS 零改动**(token 埋点是记账应用的唯一平台层小改)。

---

## 🧱 平台长期能力层(总盘 M 编号 · 按 CLAUDE.md §5 业务优先穿插)

- **#1 AI 网关**:BYO 多协议流式(已可用);token 用量埋点随记账应用落地。
- **#2 能力层**:RAG / 向量库 / 记忆 / MCP / ACP / Skills / show_widget —— 统一 `Capability` 契约(show_widget 不可信沙箱已立:iframe sandbox + srcDoc CSP + 父窗口零信任)。
- **#3 数据层**:弹性 schema(骨架列 + `data_json`)已落;迁移/快照。
- **#4 安全红线**:钥匙串 / profile 隔离 / D3 三层闸(**静态 `QUERYABLE` 硬底不可改动态**,第6轮钉死)—— standing。
- **#5 本地语音 sidecar**:业务定型后。

---

## 🔒 不可回退的红线(任何阶段都守 · 见 `../CLAUDE.md §4`)

- 密钥只进钥匙串;profile 独立仓库、AI 永不读写、类型层隔离。
- D3:静态 `QUERYABLE` 硬底(profile/messages/settings/secrets 永不在内);健康类 default-off。
- 破坏性操作一律 `platform/guardrail`(预览+确认+可撤销);契约**收规格不收执行**。
- 不可信内容(RAG/MCP/JD)转义 + `Untrusted` 标注;cActions 注册表即白名单。
- platform / apps 物理分离,只靠契约;应用间禁止互相 import。
