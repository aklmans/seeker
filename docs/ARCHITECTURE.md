# Seeker 架构与扩展边界

本文记录当前代码的真实运行方式。设计原则以 [CLAUDE.md](../CLAUDE.md) 为最高约束；这里回答“代码在哪里、数据怎么走、扩展时不能越过什么边界”。

## 运行时主链

```text
index.html
  → platform/runtime/index.js 选择 desktop.js 或 web.js
  → 安装 window.SeekerRT，并发出 seeker-rt-ready
  → platform/shell/registry.js 安装 window.SeekerShell
  → apps/*/manifest.js 注册页面、集合、工具与生命周期钩子
  → shell-boot.js 构建导航、页面与 Agent chrome
```

前端只依赖 `RuntimeApi`。桌面实现通过 Tauri invoke 进入 Rust；Web 实现把通用数据落到 IndexedDB。不要在业务模块直接调用 SQLite、钥匙串或外网。

## 数据所有权与 AI 可读性

| 数据 | 桌面真相源 | Web 真相源 | AI 可读规则 |
| --- | --- | --- | --- |
| jobs / job_opportunities / skills / actions / resumes / assets | SQLite | IndexedDB | 应用启用 ∩ manifest 授权 ∩ 用户授权；Rust 静态白名单再兜底 |
| messages | SQLite | IndexedDB | 不在 `QUERYABLE`；只在当前多轮历史中使用 |
| profile | 独立 profile 表 | 独立 profile store | 永不进入通用 `rt.db`，AI 无读取/写入接口 |
| API key / MCP token | 系统钥匙串 | Web 不持有桌面密钥 | 前端只见状态，类型接口没有 `get()` |
| memories / doc_chunks | SQLite 私有表 | IndexedDB 只保全便携包 | 仅能力实现访问，不开放通用集合查询 |
| opportunity_verifications / agent call ledger / MCP grants | SQLite 私有表 | Web 无可信副本 | 不在通用集合与便携备份中；只由 Rust 验链和执行器维护 |
| 自动备份策略 | SQLite settings | Web 明确不支持后台备份 | 只经窄命令 `backup_policy_get/set` |

便携备份格式当前为 v2：通用集合、隔离 profile、设置、记忆/文档和便携偏好统一导出。导入先快照、校验后单事务合并；清空必须先得到可导入备份，再原子删除。

## 通用首页与持久化会话

第一轮转型增量增加平台首页。第二轮将求职应用统一改为按需开启：旧安装标记、已有求职数据
和旧版未标记来源的启用值都不能自动启用应用。旧版无法区分自动开启与手动选择，升级后需要
在可信 UI 再次开启；新版 `explicitEnabled` 记录明确选择，跨重启与完整备份保留。业务数据不变。
应用默认值与聊天提示由 manifest 声明，平台不依赖具体业务模块。

`platform_conversations` 保存会话名称、项目归属与时间；`messages` 的新消息带
`conversationId` 和 `turnId`。两者随便携备份保全，均不进入 AI `QUERYABLE`。
旧消息保持原样，由项目归属形成兼容会话，首次续聊时才保存其会话元数据。

桌面 AI 网关从 SQLite、Web 聊天从 IndexedDB 恢复所选会话的完整 user/assistant 轮次，
仅使用最近 10 轮且不超过 16,000 字符；可见历史完整保存。失败或取消的孤立提问、
不匹配的 turnId、其他会话及定时任务消息不会混入。历史只投影为 canonical user/assistant，
不接受持久记录自报的 system/tool 角色。流式事件仍按每次请求独立 sessionId 路由。

Web 通用 upsert 等待事务完成后才报告成功。Web SSE 必须收到结束标志且有非空回答；
截断流不保存为成功回答。UI 在回答持久化完成前保持生成状态，失败提供明确重试入口。

默认提示提供日常助手定位；启用应用可声明 `chatTask`，只在其页面使用相应域提示。
Web 演示代理的服务端提示也采用通用定位，其能力仍限于聊天。

## 工作空间与通用设置

`platform_projects` 继续保存空间名称、助手指令、归档状态和时间，用户通过平台工作空间页
创建、编辑、切换、归档及恢复。侧栏、首页、聊天切换器和设置提供同一个管理入口；能力中心
只保留跳转。空间隔离会话与聊天指令；资料、任务、应用开关和模型连接仍为设备共享，UI 明示范围。
首页最近对话只列当前空间；归档当前空间先安全切回默认会话，避免后续消息写入旧空间。

`seeker-workspace` 便携偏好保存默认空间显示名、启动页面及首页资料/任务可见性；启动页若因
应用关闭而不可用则回首页。前端与 Rust 便携白名单均收录该键。设置写成功后才改变启用状态和
空间选择；应用与空间设置不增加 AI 工具或扩大 `QUERYABLE`。

外观设置真实应用字号、导航/设置行密度、减少动效及跟随系统主题；系统主题变化会即时更新。
个人信息默认空白，通用页只显示通用字段，求职字段由启用的求职应用贡献。字段仍经隔离 profile
通道保存，成功后更新内存，失败保留输入并提示。

数据页展示当前空间消息数量和设备共享记录（含关闭应用），明确备份与精简导出的范围。
历史管理支持当前/全部空间查看；清除动作明确覆盖全部空间的消息和会话元数据，复用运行时
`db.clear` 的完整备份 + 原子事务，停止旧的逐条删除并吞错做法。通过导入备份恢复；失败不显示
清除成功。精简导出可能仍有对话与笔记正文，不能称为不含隐私的安全分享包。

## 可编辑作品与隔离导出

平台 `creations/` 拥有“我的作品”页，`platform_creations` 由 SQLite 迁移 16 / Web IndexedDB
版本 11 保存。记录拆分类型、内容、来源、空间归属和独立样式；当前列表在本机所有空间间共享。
完整便携备份保全作品及历史，精简导出排除此集合；Rust `QUERYABLE` 永久不包含它。

可信 UI 经 `rt.creations.save(draft, expectedRevision)` 写入，两端都在单个事务中比较版本，
成功后增加版本号并保留最近 20 个非递归快照。旧页面不能覆盖新版本；移除是可恢复标记，
撤销同样比较最新版本。损坏记录和写失败不能当作新记录或假成功。Widget 原始 HTML 最多
64 KiB，单份作品草稿最多 256 KiB、含历史最多 6 MB。样式字段严格收敛为颜色、枚举和有界数字，
不能插入任意 CSS；手动内容、风格与版本恢复均不调用模型。

聊天收到 Widget 时立即保存独立作品，消息中保存可信作品引用，历史重开加载作品最新版。
保存失败在卡片上提供重试；未完成聊天中的已生成作品仍保留。保存的是 Widget 源码，重新打开
会重新运行其交互；PNG/PDF 导出则捕获当前视图中的表单、按钮与 canvas 状态。自由 HTML 的
逐元素编辑不被冒充为通用能力，当前提供高级源码入口，普通知识卡片可以直接编辑正文。

Widget 保持 `sandbox="allow-scripts"`、无同源权限和 `default-src 'none'`。快照经专属消息端口
读回后仍是不可信数据；父页只在 inert template 中清理标签/属性，绝不将它插入应用 DOM。
另一个 opaque iframe 只允许新 nonce 对应的可信导出脚本执行，禁止不可信脚本、外网与表单。
html2canvas 1.4.1 的本地固定版本直接使用 DOM parser / CanvasRenderer，避开需要同源权限的
DocumentCloner；重建方法与许可证见 `web/vendor/README.md`。截图只处理独立快照，不修改 live
Widget。等待布局完成后测量，展开纵向滚动内容；超过 24 MP 或尺寸限制明确拒绝，不静默裁切。

`rt.render.creationImage` 只接受有界 PNG 输入。桌面 Rust 解码后写 PNG 或生成单页栅格 PDF，
平台决定 Downloads/Seeker 新文件名并重读校验；Web 验证图片尺寸后发起浏览器下载。PDF 是与预览
一致的图片页，不包含可编辑文字或脚本。`copyCreationImage` 桌面写系统图片剪贴板，Web 使用
实际 Clipboard API，失败保留 PNG 下载入口。复杂 CSS 重建可能与原稿不同，导出前展示真实预览。

思维导图使用 `mindmap-model.js` 的有界纯树模型（200 节点、12 层、300 字符/节点），结构操作先验证
再替换，不允许循环、重复 ID 或无效层级。可信编辑器自行绘制 SVG，任意 Widget HTML 不进入此编辑面。
三种布局使用同一几何计算与转义标签；SVG 导出经 Web DOMParser / Rust quick-xml 独立静态标签属性白名单，
拒绝脚本、外部资源与任意 CSS。Markdown 大纲包含折叠子树；栅格导出采用当前可见布局。

回答、笔记与文件通过 `SeekerShell.createFromText` 传递明确选中的正文，平台不跨应用读取材料。
AI 导图走无工具的 `rt.ai.generate(text_processing)`，仅发送本次文字或选中子树；返回 JSON 收敛为
节点文字/子节点，平台生成 ID，模型字段不能修改设置或样式。分支预览经用户应用才进入草稿；取消、
截断/无效输出及过期编辑版本拒绝应用，保存仍走原有比较版本事务。

个人样式使用同一 `platform_creations` 集合的 `kind=style`，复用版本事务、完整备份和精简导出排除。
默认样式保存为可信设置页主动复制的 `seeker-creation-style` 偏好，Web/Rust 便携白名单同步；收藏移除
不会删除此副本。卡片、导图、对比表、时间线和聊天 Widget 新建时取当前默认值，已存作品保持独立。
对比表与时间线使用有界纯结构校验及转义模板，不把单元格或事件正文解释为 HTML。

作品风格 AI 请求只包含当前规范化样式与用户要求，不包含正文或设置。响应只接受颜色、枚举及有界数字，
多余字段拒绝。Widget 修改只接受有界 HTML 字段，预览在无同源 iframe 中运行，父页不提供动作端口。
两者均由用户审阅后应用，并检查草稿是否仍与请求时一致；AI 不能调用默认样式设置通道。

分享预览由 `presentation.js` 将已校验 PNG 与用户勾选的标题、来源、署名合成；附加文字使用 Canvas
文本绘制，不解释 HTML，也不读取 profile。原始比例无附加文字时保留原图片，固定比例宽 1600 像素，
完整缩放内容而不裁切。快速改选项采用请求序号拒绝旧结果，输出按钮只使用已完成的最新预览。
编辑后立即导出会先刷新待绘制内容，并等待 Widget 加载和端口就绪，避免捕获旧正文。

`rt.render.creationOffline(title, html)` 在 Web / Rust 各自验证有界内容，并构造平台自持的 HTML 外壳。
标题与源码分别转义；源码只出现在 `sandbox="allow-scripts"` 的 opaque srcdoc 中，外壳不提供消息动作端口。
外层 `frame-src about:` 阻止组件跳转外站，内层前置 CSP 禁止连接、外部资源、嵌套框架和表单。
离线文件保存原始交互源码及独立样式，重新打开会初始化，不冒充交互状态持久化；图片比例仅用于静态导出。
桌面仍使用平台决定的新文件名、写后重读校验；Web 发起浏览器下载，不声称已经写入用户磁盘。

## 文字工具与本地资料库

`daily` 应用提供翻译、润色、总结和回复草稿，使用 `rt.ai.generate` 的独立生成链。
`textGeneration` 是明确的运行时能力：桌面提供，Web 不提供。请求只有可信的固定处理指令、
枚举选项和独立 `untrusted` 正文，不读取历史、项目、记忆、知识库或工具。生成系统基线优先遵守
明确的目标语言，避免聊天语言提示覆盖翻译。输入超过 12,000 Unicode 字符时执行前拒绝，
取消、截断、空结果和调用失败均不能作为可保存的完成结果。

`assets_notes` 继续由 `assets` 拥有，弹性 JSON 中增加用户可编辑的 title/tags/sourceUrl/favorite；
通过 `SeekerShell.saveNote` 明确保存回答、文字工具结果和摘录，应用间不互相 import。
普通保存不调用模型。独立 AI 整理只处理所选笔记正文，更新元数据时校验笔记版本，
不会用异步结果覆盖后续修改。加入知识库是单独的知情授权，说明未来自动召回和嵌入模型出网；
关联保存失败时撤回本次创建的副本。

资料库的创建、更新、删除和撤销均等待运行时实际成功才更新列表。Web upsert/remove 等待
IndexedDB 事务提交；remove 在同一事务读取快照并删除。资料库支持无模型编辑、全文搜索、
标签筛选、收藏、来源和 Markdown 导出。桌面 `rt.render.markdown` 只在 Downloads/Seeker 新建
平台决定的 `.md` 文件，拒绝空内容/超限，写后重读验证，不接受任意文件路径、不覆盖原文件；
Web 使用浏览器下载，返回文件名，不声称已验证用户磁盘。工具和资料库使用完整内容区域，
通过 `ShellPage.workspace` 声明，顶栏提供对话入口。

## 文件阅读的受限数据通道

`assets_documents` 由资料库应用拥有，桌面 SQLite 迁移 15、Web IndexedDB 版本 10。
记录包含原文件 Base64、SHA-256、格式、提取字数及带稳定 ID 的原文片段；完整便携备份保全
原始字节和正文，脱敏分享导出排除此集合。它永久不在 AI `QUERYABLE` 中，应用授权也不能扩大这一硬底。
`RuntimeApi.library` 只返回白名单投影，原始字节不进入页面列表和模型请求。

桌面从文件选择器读取用户选择的 1–5 份文件，逐份调用本地解析入口，等待实际保存成功后显示导入成功。
解析器接受 TXT/MD（UTF-8 或带 BOM 的 UTF-16）、文字型 PDF、DOCX 正文和表格文字；
单文件最多 10 MB、30,000 Unicode 字符，超限拒绝，不静默截断。DOCX 限制 1,000 条目、
64 MB 声明解压体积、8 MB 正文 XML，拒绝加密、DTD、未知实体和损坏结构。
PDF 最多 200 页，只有解析器提供的真实页序号才作为引用页码；无法完整提取的页面报错，
无文字页面提示，整份无文字则拒绝并解释可能是扫描件。

实际解析在同一编译程序的固定 `--seeker-parse-library` 模式中运行，不初始化 Tauri、数据库或模型。
父进程只传有界 JSON，不接受命令或磁盘路径；一次只启动一个解析进程，20 秒超时后终止，
输出限制 512 KB。库内部的 PDF 解码仍可能短时占用较多内存，首轮没有宣称操作系统级内存沙箱。

文件总结/问答只读取本次选定记录，经片段校验后发送独立的固定指令、问题和 `Untrusted` 正文，
无其他历史、项目、记忆、知识库或工具。非正常结束、空回答或无效 JSON 均失败；有依据的回答要求
1–8 条引用，每条 ID 必须存在，3–300 字的引文必须是对应片段的逐字子串。
信息不足会显示固定提示；引用按钮高亮已保存的原文。这里验证可追溯性，不能证明模型归纳的真实性。
回答仅在用户点击保存后进入笔记。Web 可预览备份正文及下载 Markdown，解析和问答明确不可用。

## AI 协议边界

Rust 内部使用一份 canonical message/tool 形状，`src-tauri/src/provider.rs` 只在出网边界翻译：

| 协议 | 对话/工具 | 图片抽取 | 嵌入 |
| --- | --- | --- | --- |
| OpenAI-compatible | `/chat/completions` + SSE | `image_url` | `/embeddings` |
| Anthropic | `/v1/messages` + 原生 tool blocks | base64 image source | 不支持，记忆/RAG 诚实停用 |
| Gemini | `streamGenerateContent` + function calls | `inlineData` | `batchEmbedContents` |
| Ollama | 官方 OpenAI-compatible `/v1` | 兼容 vision | 兼容 `/v1/embeddings`，不读取云端 key |

Ollama 使用固定非密钥占位值，不访问或转发共享的云端钥匙串条目。需要鉴权的远端兼容代理
使用 OpenAI-compatible 协议配置。云端协议继续要求有效 Key，空值与读取失败均拒绝出网。

模型设置的类型化模块先读取已保存配置，用户切换协议仅更新表单草稿，明确保存时才写入。
空 Key 不改动钥匙串条目；本地协议的配置存在性查询同样跳过云端钥匙串。设置与 Key 分属
不同通道，部分保存失败会说明已保存的部分，保留未完成输入。连接测试先等待保存，再经
无工具生成发送固定短句，不走聊天或历史链；截断、空回应和请求失败不能显示连接成功。
Web 模型页只说明桌面协议与已实现能力，不提供假的保存、订阅、语音配置或连接测试。
首页和设置使用完整内容区域，首页问题创建独立会话后交给现有聊天发送链。

系统提示、项目指令、历史和不可信资料在 canonical 层组装；适配器不得自行读取 profile。工具结果返回模型前仍须经过既有的 Untrusted 框定与破坏性护栏。

## Task Agent 运行域

`任务中心`是独立于聊天工具循环的受控执行面。前端只负责收集用户选择、展示 TaskSpec、
调用 `RuntimeApi.agent` 和呈现状态；权限缩减、状态转换、文件写入、恢复与完成判定全部在
Rust 核完成。工作流由编译期静态注册表定义；当前注册 `job_application_package`、
`job_opportunity_radar` 与 `material_report`，不接受模型或用户提供的自由 DAG。

任务页面由平台拥有；应用通过 manifest 的 `taskWorkflows` 贡献任务表单、输入说明、
交付物名称与完成说明。停用应用后已有任务记录保留，不能从该应用继续或创建运行。
求职业务字段留在求职应用，资料整理字段留在资料库应用，平台不跨应用 import。

资料整理在创建时按用户所选的 1–5 个文件/笔记 ID 和版本读取正文，合计上限 30,000
Unicode 字符。Rust 冻结白名单字段、完整片段和目标，保存 SHA-256；运行和恢复只读取
该快照，校验目标、哈希与编译期步骤，不重新查找现有笔记或文件。快照随任务完整备份保全。
固定流程为读取快照、逐材料提取、综合整理、校验结构及逐字引文、写入两个报告、重读验证。
共 N+5 步，无工具模型调用通常 N+1 次；每步骤最多两次尝试，私有调用账本硬上限 12 次，
暂停/恢复不重置。没有全库检索、历史、项目指令、profile、联网搜索或任意命令入口。

`material-report.md` 与 `material-report.docx` 由同一个确定性文档模型生成；所有来源和
模型字段作为文本，平台决定结构。事实与归纳必须有选中片段的逐字引用，建议明确标为
待确认。文件使用既有 run staging + 原子目录发布 + artifact 事务；验证时重新构造期望
内容并比较实际字节、格式、大小和哈希。暂停保留已完成提取，取消不能继续该运行，
写入中断先核对或清理受控目录，再允许恢复。引用校验不能替代模型内容的人工判断。

报告预览、另存笔记、打开或导出前现场复验 artifact；导出只在 Downloads/Seeker 新建
MD/DOCX 副本并重读验证，不接受任意路径、不覆盖原产物。Web 保全和展示任务快照，
创建、执行与磁盘产物操作明确不可用。使用说明见 [资料整理助手](MATERIAL-ORGANIZER.md)。

```text
可信 UI 确认 1–5 个岗位 + 专业简历
  → Rust 生成固定 TaskSpec 与 5 步顺序计划
  → 读取 jobs / skills / resumes 快照
  → 确定性计算匹配分数
  → 无工具、无历史、无 profile 的模型调用生成 5 道问题
  → 原子写入 2 个 DOCX + 2 个 Markdown
  → 重读文件并校验目录、格式、大小与 SHA-256
  → 全部通过后才写 succeeded
```

运行元数据落在 `platform_agent_tasks/runs/steps/artifacts/approvals/events` 六个集合；它们可
进入完整便携备份，但永久排除在 AI `QUERYABLE` 之外。`profile` 仍走独立通道，任务只读
取不含联系方式的专业简历记录；artifact 路径由平台在应用数据目录内生成，模型与前端均
不能提交任意路径。

暂停和取消通过运行级 cancellation token 在安全检查点生效。应用重启不会偷偷续跑：
遗留的 created/planning/running 运行改为 interrupted；正在执行的只读步骤回到 pending，副作用
步骤改为 outcome_unknown。岗位投递包的文件副作用步骤先在 run 级 staging 目录写齐四个文件，再以
目录 rename 发布；四条 artifact 记录也在单一 SQLite 事务中提交。副作用开始后的错误不会
降级成普通 failed。恢复前 Rust 会核对记录和磁盘：完整且可信则承认成功；不完整则必须先
清掉该 run 的受控目录和记录，清理或事务失败时继续保持 outcome_unknown，禁止重放。

协调器的开始、步骤完成、失败和最终完成状态与对应审计事件均按事务提交；未被步骤分支
覆盖的顶层异常也会尽力收敛到 failed 或 interrupted。若数据库当时不可写而无法收敛，下次
启动仍会把遗留 created/planning/running 恢复为 interrupted。产物打开前必须已有
`verified=true`，并现场
复算大小和 SHA-256；摘要不符会持久化 invalid 状态、追加审计事件，并撤销 run/task 的
“已完成”可信结论。

任务输入有效性与产物字段使用同一契约：纯 URL、日期、布尔值，以及叙述/公司/作品集字段中的
纯域名等占位不能单独构成职业资料；`skills/need/requiredSkills` 按字段语义允许无协议、无路径
的点号技术名，不依赖技术名白名单。所有允许作为实质输入的简历字段都会确定性进入定制简历，
summary 等可用事实也会进入求职信证据。模型不负责改写这些源事实。

桌面端具备真实执行与本地文件能力；Web 端只保全、导入并展示任务记录，所有执行和打开
文件方法都明确返回不支持，界面不提供伪执行入口。完整状态机、权限和预算见
[AGENT-TASKS.md](AGENT-TASKS.md)，人工验收见
[AGENT-TASKS-ACCEPTANCE.md](AGENT-TASKS-ACCEPTANCE.md)。

机会雷达把外部搜索限制在固定 URL，或用户在可信 UI 为手动运行明确授权的精确 MCP
`server/tool`。授权写入设备本地 Rust 私有表，不随任务 JSON、通用 CRUD 或便携备份迁移；
导入或通用改写同一任务会撤销旧授权，任务中心必须逐项展示并要求重新确认。
MCP 的 `readOnlyHint` 只作不可信提示，含 MCP 的雷达不能被调度。查询只含职业
关键词，不含 profile 或简历。整个 run 的来源调用与模型调用在 Rust 私有账本中逐次原子预占，
硬上限覆盖检索和验链，不因暂停或崩溃重置。结果先进入独立 `job_opportunities` 待审集合，
经硬筛选、Rust 验链和确定性评分后生成 `opportunity-report.md`。候选入库先产生未激活的私有
验链凭据，只有报告校验通过后才在 run 最终成功事务中激活；公开 run/step JSON 无法伪造该证明。
Web 没有私有授权副本，并会剥离导入任务自报的 MCP 授权派生字段。列表展示与接受入口
共用这套判定，运行中、失败或中断的候选不会显示为已验证。只有用户在可信 UI 明确接受，候选才事务性进入正式
`jobs`。撤销会比较接受后的完整机会与岗位快照，任一侧后来变化即拒绝覆盖。完整契约与验收见
[OPPORTUNITY-RADAR.md](OPPORTUNITY-RADAR.md)。

## 新增应用检查表

1. 在 `web/apps/<id>/manifest.js` 注册页面、集合、AI 默认授权和生命周期钩子。
2. 业务模块只能向 `platform/` 单向依赖；应用之间不得直接 import。
3. 新集合同时更新前端 `Collection`、Web IndexedDB 白名单、Rust 表映射和便携备份白名单。
4. 若集合可被 AI 查询，必须显式加入 Rust `QUERYABLE`；profile、messages、settings 与私有能力表禁止加入。
5. 可写/破坏性动作只能声明提案，执行走 `SeekerGuardrail`，并提供真实快照撤销。
6. 外部文本、MCP/RAG 返回值和模型 UI 一律按不可信数据处理。
7. 为纯逻辑加 Node 单测；为用户主链加 Playwright；桌面边界加 Rust 测试。

## 验证命令

```bash
npm test
npm run typecheck
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

`test/type-debt.test.mjs` 把 `@ts-nocheck` 数量锁为只降不升；优先清理数据、隐私、护栏和 AI 出口，再处理展示页。
