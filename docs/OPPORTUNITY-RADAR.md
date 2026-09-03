# Seeker Opportunity Radar v0.3

> 本文定义 `job_opportunity_radar` 固定工作流的产品、权限、数据与验收契约。
> 通用任务状态机与恢复规则见 [AGENT-TASKS.md](AGENT-TASKS.md)，产品红线仍以
> `CLAUDE.md` 和 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。

## 1. 用户结果

机会雷达把“反复搜索岗位、去重、初筛和整理来源”变成一个可观察、可暂停、可恢复的任务。
用户在可信 UI 中设置目标职位、地点、远程偏好、技能、排除词、关注公司及来源，然后手动运行，
或显式创建每日/每周计划。一次运行交付：

- 一组独立的待审机会，不直接写入正式 `jobs`；
- 每条机会的来源、首次/最近发现时间、确定性匹配分和拒绝原因；
- 一份真实的 `opportunity-report.md`，即使零条有效结果也如实生成；
- 由用户逐条“接受”后才进入 `jobs` 的窄转换，并提供真实撤销。

## 2. 静态工作流与步骤

v0.3 只有两个编译期注册的工作流：`job_application_package` 与
`job_opportunity_radar`。模型不能新增、删除或重排步骤，也不能提交自定义 DAG。

机会雷达使用以下固定顺序计划：

1. `load_radar`：快照用户确认的搜索条件、来源和硬预算。
2. `discover`：对固定 URL 或用户明确选择的只读 MCP 搜索工具执行有限调用。
3. `normalize`：无工具、无历史、无 profile/简历的模型调用，把不可信结果整理为候选 JSON。
4. `verify_sources`：Rust 核逐条验 URL、限制重定向/响应体/超时并拒绝私网目标。
5. `rank_and_save`：本地确定性去重、评分，并事务写入待审机会。
6. `write_radar_report`：在受控 artifact 目录原子写入 Markdown 报告。
7. `verify_radar_report`：重读并校验路径、格式、大小和 SHA-256 后才能完成。

共同协调器继续负责状态、检查点、并发预占、暂停/取消、恢复、预算和审计。`external_read`
是可重放的外部读取 effect；已成功步骤不会因暂停/继续而重复，遗留执行态由启动恢复收敛为
`interrupted`，不会在应用重启后偷偷续跑。

## 3. TaskSpec 输入与预算

可信 UI 可提交的输入只有：

- `criteria.roles`：1–8 个目标职位；
- `criteria.seniority`、`locations`、`requiredSkills`、`excludedKeywords`、
  `watchedCompanies`：各自有长度和条数上限；
- `criteria.remotePreference`：`any / remote / hybrid / onsite`；
- `sources`：1–8 项，仅允许 `{kind:"url",url}` 或
  `{kind:"mcp",server,tool}`；MCP 工具必须当前已连接、由用户选择且本地判定为只读；
- `limits`：可缩小但不能放大平台硬上限：4 条查询、8 个来源、12 次来源调用、40 条候选、
  1 次模型调用；
- `language`：`zh / en`。

Rust 在创建任务与每次执行读取时重新白名单化并验证。前端传入的 scope、steps、deliverables、
状态、预算上限和 `createdBy` 都不可信并被丢弃。

## 4. 数据与信任边界

`job_opportunities` 是独立业务集合，进入完整便携备份，分享型导出默认排除；它不进入 AI
`QUERYABLE`。记录至少包含稳定 `dedupeKey`、当前状态、规范化字段、分数、来源标识、原始
URL、`firstObservedAt`、`observedAt` 和最近 run。状态只有：

```text
new -> reviewed -> accepted
  \-------> dismissed
  \-------> stale
```

重新发现同一机会只更新同一条记录；`accepted`、`dismissed` 等用户决定不会被后续运行覆盖。
候选 URL 必须逐字出现于对应原始来源结果（固定 URL 来源可等于该 URL），随后仍须通过 Rust
网络护栏。网页、MCP 结果与岗位文本均是不可信数据，不能改变工具、查询、预算或成功条件。

搜索请求只含用户确认的职业关键词和地理条件；不得读取或发送 `profile`、联系方式、简历正文、
对话历史、项目指令或密钥。MCP annotation 只作提示；工作流只调用任务中固化且运行时仍为
只读的确切 server/tool。模型规范化阶段结构性无工具。

## 5. 接受与撤销

“接受为正式岗位”只能由机会列表中的用户点击触发。Rust 在一个事务中创建 `jobs` 记录并把
机会标为 `accepted`，返回一次性撤销 token；撤销会删除该次创建的岗位并恢复机会先前状态。
不存在 token、token 失效、岗位后来被用户修改或来源记录不一致时必须响亮拒绝，不能误删。

任务本身永不自动申请、发送邮件、联系招聘方、修改外部系统或执行其他承诺行为。

## 6. 定时运行

用户可以在可信管理面为机会雷达任务创建 daily/weekly 计划。AI、MCP 和任务输出没有写
`platform_schedules` 的能力。计划只在 Seeker 打开时以分钟精度触发，错过不补跑；同一任务
已有活动 run 时跳过并如实记录状态，不排队、不重入、不形成调用风暴。

## 7. 验收场景

发布前至少覆盖：

1. 两个确定性假来源完成闭环，候选、分数和报告均可复算。
2. 重跑相同结果不产生重复机会，并保留用户状态。
3. 无效协议、私网、死链、越界重定向和过大正文被拒绝。
4. 来源含 prompt injection 时不读取 profile/简历、不增加工具、不扩大查询。
5. 来源/Provider 超时或失败、顶层异常和重启都收敛到可信状态。
6. 暂停/继续不重复已完成搜索或候选写入；取消不继续后续步骤。
7. dismissed 机会永不进入 `jobs`；接受需用户点击，撤销恢复两边状态。
8. 到期计划不重入、不补跑积压，运行失败被记录。
9. 零有效结果仍成功生成明确写着“未发现有效机会”的已验证报告。
10. Web 端可展示导入的任务、报告元数据和机会，但不伪装能执行搜索、写文件或接受岗位。
