# Seeker Task Agent v0.2

> 本文定义 Seeker 从聊天 Agent 升级为任务 Agent 的实现契约。产品与架构总原则仍以
> `CLAUDE.md` 和 `docs/ARCHITECTURE.md` 为准；本文只描述任务运行域。

## 1. 版本目标

v0.2 的首个可交付闭环是「岗位投递包」：用户显式选择 1–5 个岗位与一份简历后，
Seeker 选择最匹配岗位，生成匹配报告、定制简历、求职信和面试准备清单，落成真实
artifact，并以机器验证结果而不是模型自述决定任务是否完成。

普通聊天继续存在。聊天可以提出一份任务草稿，但只有用户在可信 UI 中确认后才能创建
并启动运行。

## 2. 明确不做

- 不向模型提供任意 Shell、任意文件系统或通用数据库写入能力。
- 不自动投递岗位、发送邮件、付款或执行其他外部承诺行为。
- 不允许模型创建日程、项目、永久任务或改写任务授权范围。
- 不允许任务域读取 profile、secrets、settings、projects 或 schedules。
- v0.2 不承诺应用退出后继续运行；重启时将未决运行标为 interrupted，等待用户恢复。
- 不引入多 Agent、DAG 编排或供应商专属 Agent 协议。

## 3. 信任边界

TaskSpec 由用户 UI 或用户创建的 schedule 形成，是一次运行的权限包络。模型可以在包络
内提出步骤，但不得扩大集合、工具、预算或副作用级别。模型计划、岗位描述、MCP 结果和
app-tool 结果均是不可信数据，必须经过 schema 校验并在回灌模型时继续框定。

任务管理集合采用 `platform_agent_*` 前缀并永久排除在 `QUERYABLE` 之外。协调器只向模型
提供当前步骤所需的最小投影；模型不能查询、写入或伪造运行状态。

## 4. 持久化模型

| 集合 | 职责 |
| --- | --- |
| `platform_agent_tasks` | 目标、输入、约束、交付物、完成标准与授权范围 |
| `platform_agent_runs` | 一次运行、预算、检查点、当前状态与最终结论 |
| `platform_agent_steps` | 步骤、工具、effect、尝试次数、结果引用 |
| `platform_agent_artifacts` | 文件元数据、来源、hash、版本与验证状态 |
| `platform_agent_approvals` | 待批动作、预览、授权范围与决定 |
| `platform_agent_events` | 追加式用户可见时间线与审计事件 |

所有集合使用既有的「骨架列 + `data_json`」结构。完整备份包含它们；分享型 redact 导出
必须排除运行事件、审批记录和 artifact 绝对路径。

## 5. 状态机

Task 状态：

```text
draft -> queued -> running -> succeeded
                    |  |  \-> failed
                    |  \----> cancelled
                    \-------> waiting_input / waiting_approval / paused / interrupted
```

Run 状态：

```text
created -> planning -> running -> succeeded
              |          |  \-> waiting_input / waiting_approval / paused
              |          \----> failed / cancelled / interrupted
              \---------------> failed / cancelled / interrupted
```

Step 状态：

```text
pending -> running -> succeeded
                    |-> waiting_approval
                    |-> failed / skipped / cancelled
                    \-> outcome_unknown
```

`succeeded` 只能在 verifier 全部通过后写入。启动恢复将遗留的 planning/running 状态改为
interrupted，不自动继续。`outcome_unknown` 禁止盲重试，必须先验证副作用是否发生。

## 6. 工具 effect 与审批

每个动作工具必须声明 effect、是否幂等、是否支持预览/补偿，以及验证方式。

| effect | 默认策略 |
| --- | --- |
| `read_only` | TaskSpec 已授权范围内自动执行 |
| `local_create` | 仅任务 artifact 目录内自动执行 |
| `local_mutate` | 只允许修改本任务产物；其他目标需确认 |
| `destructive` | 逐次确认，复用 guardrail/undo |
| `external_draft` | 可生成草稿，不执行外部承诺 |
| `external_commit` | 逐次确认；v0.2 不提供真实实现 |

未知工具、未知 effect、畸形计划、越权集合或失效审批一律 fail closed。MCP 服务自报的
只读 annotation 不能覆盖本地策略。

## 7. 运行预算

v0.2 使用顺序计划，默认最多 12 步；每步默认最多 2 次可安全重试。TaskSpec 可以缩小
限制但不能超过平台硬上限。取消在当前原子操作的安全边界生效；若无法确定副作用结果，
步骤进入 outcome_unknown。

## 8. 完成定义

岗位投递包只有在以下条件全部满足时才能 succeeded：

1. 指定输入存在且仍在授权范围内。
2. 选择报告包含每个候选岗位的评分证据。
3. 简历、求职信、差距表和面试清单四类 artifact 均存在。
4. 文件可重新读取，记录的大小和 SHA-256 与磁盘一致。
5. 公司、职位、学校、日期、证书和量化指标等事实均有简历来源；无来源内容只能作为
   「待确认建议」，不得进入正式简历。
6. 所有 verifier 通过，且没有 waiting/unknown 步骤。

## 9. 恢复与幂等

每次状态转换、模型调用结论和工具结果都在进入下一步前落盘。动作步骤使用稳定的
idempotency key；本地文件以临时文件 + 原子 rename 写入确定路径。恢复时读取最后成功
检查点，不重放 succeeded 步骤。

## 10. 发布门槛

- 全量 JS、TypeScript、Playwright、Rust fmt/clippy/test/build 通过。
- 无新增 `@ts-nocheck`，任务管理集合不进入 `QUERYABLE`。
- 中断恢复不重复已完成副作用；失败与拒绝不伪装成功。
- Web 演示没有桌面执行能力时明确降级。
- 中英文用户可见文案齐全。
- 用户完成正常、恢复、缺输入、拒绝、取消、网络失败和恶意 JD 七个体验场景。

