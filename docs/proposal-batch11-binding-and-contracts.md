# 批11 · 绑定改造 + §1 契约化 —— 方案(2026-07-08,待批准)

> 批10 收官后的残留面:**35 个必要白名单桥**(全部因 window-解析或 §1 层级而存在)。批11 分两刀消化:
> **11A 绑定改造**(行为面,零契约)与 **11B §1 契约化**(SeekerShell 契约扩展,约束② 必审)。
> 输入:第40轮内联清点(38 静态 onclick + 18 cBtn 串)、第43轮 [建议]③(状态写 handler)与 [建议]④(§1 债 14 处/12 符号 + CACT 6)。

---

## 11A · 绑定改造(先行,纯行为面)

**目标**:消灭字面 `onclick="…"`(window-解析),桥随消清。**改绑不改逻辑**:每站点语义逐字等价。

1. **两个平台委派清大头(33/38 静态站点)**
   - `[data-close]` @modal.js:文档级委派 `closeModal()` —— 清 closeModal 14 站点(平台 4/jobseek 8/assets 2)。
   - `[data-go="<page>"]` @nav.js:委派 `go(dataset.go)` —— 清 go 9 直站点;aiErrHTML(ai-render:30)的 `copClose+go` 复合站点改 `[data-go="settings"][data-close-cop]` 双属性委派(copClose typeof 守卫语义保留)。
   - 委派器安全性同 cAB 纪律:只读 `dataset`、白名单页 id 不需(go 本身有 PAGES 校验? —— 核实 go 对未知 id 的行为,若无守卫则加 `PAGES.some` 检查,行为=现状 no-op)。
2. **散点改程序绑定(5+18)**:toast ×4(mock 按钮,或径直删 mock)、openResumeModal ×4、openMarketValue ×2、openNewJob/runMatch/showEmptyState 各 1 → 各文件既有 bind 段加 id/data 绑定。
   - ★[建议]③ 地雷单列:**resumes.js:332 状态写 handler**(`ivState.q=null;…;renderInterview()`)与 interview.js:53/58(`resumeState.jobId=…`)—— 改为 data-携带参数 + 文件内闭包绑定(写的是本文件/同 app 的 import 绑定,消 window 途径);与纯调用型分批验证。
3. **cBtn → cAB 迁移(18 站点)**:copilot-actions 的 oc-串全部改 `cAB(label, fn, args)`(既有 §4-4 委派 + CACT_ALLOWED);cBtn 模板保留但标记 deprecated(或删,若零剩余消费)。**注意**:cAB 分发仍 `window[name]` → CACT 名单在 11A 不减,等 11B。
4. **完成态**:字面 onclick=0;桥可再删 ~13(closeModal/go/toast/openResumeModal/openMarketValue/openNewJob/runMatch/showEmptyState/resumeState/ivState/renderInterview/openResumeUpload/copClose 中消尽者);剩 = CACT 6 + §1 计算集。
5. **验**:每站点点击链 LIVE(preview 净方法)+ SCC 环不变式机械复跑([建议]② TS AST)+ 真机。

## 11B · §1 契约化(后行,契约扩展必审)

**工作面**([建议]④ 清单):平台裸读 apps 符号 14 处/12 符号 + CACT_ALLOWED 6 名单。四个契约点:

1. **`manifest.pageActions`(新契约,汇总型)**:页级动作声明 `{pageId: [{label, run}]}` —— 收 nav.js renderTopActions 7 符号(openResumeModal/resumeGenerate/resumeState/renderResumes/openNewJob/openMarketValue/openNewAction)。run 为 manifest 侧闭包(import 解析)→ 平台零 app 符号。
2. **`manifest.pageNew`(新契约,选择型)**:`{pageId: fn}` —— 收 shell-keys contextNew 2 符号(openNewJob/openNewAction)。
3. **`manifest.widgetActions`(新契约,选择型 per-app)**:`{action: handler}` —— 收 widget-actions delete-job 分支 3 符号(JOBS/renderJobs/renderOverview 逻辑整段回迁 jobseek,平台只留通用 destructive 闸 + guardrail 调用)。红线不变式:widgetId 平台传入、破坏性一律 confirmDestructive(逐字迁移)。
4. **`manifest.cActions`(新契约,并集)**:cAB handler 注册表 —— CACT_ALLOWED 6 名单从平台硬编码改为各 manifest 声明之并集(仍白名单闸、仍按值调,分发器从 `window[name]` 改注册 Map → **杀掉最后 6 个强制桥**)。
5. **settings 2 残留**:showEmptyState → jobseek 设置段已有 appSettings 契约,改由 settings-jobseek 段内自绑(migrate 该行到 manifest.settings extend);hydrateJobs → 数据导入后的重水合改 `SeekerShell.notifyDataImported()`(或复用 onDataCleared 型第10契约,存在性广播)。
6. **完成态**:窗口桥 → **0 个业务桥**(仅剩契约命名空间 SeekerShell/SeekerKeys/SeekerRT/…);§1 债清账;CACT 契约化(阶段4"平台零改动"前提恢复)。
7. **验**:契约面加倍审(约束②)+ 全链 LIVE + 真机;附带清 i18n 文案归属债候审(agentGreet 系 → manifest.greeting,第14轮账,可并可分)。

**节奏建议**:11A 一轮(可拆 2 commit:委派大头 / 散点+状态写);11B 每契约一 commit、一轮送审;先 11A 后 11B(11B 的 cActions 依赖 11A 的 cBtn→cAB 迁移)。
