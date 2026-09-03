//! 编译期固定的 Task Agent 工作流注册表。
//!
//! 这里只存平台自持元数据；外部输入不能注册、增删或重排步骤。协调器按 workflow id
//! 取计划，未知 id 一律拒绝。

use serde_json::{json, Value};

pub(super) const JOB_PACKAGE: &str = "job_application_package";
pub(super) const OPPORTUNITY_RADAR: &str = "job_opportunity_radar";

pub(super) struct StepSpec {
    pub key: &'static str,
    pub zh: &'static str,
    pub en: &'static str,
    pub kind: &'static str,
    pub tool: &'static str,
    pub effect: &'static str,
    pub expected: &'static str,
    pub verification: &'static str,
}

pub(super) struct WorkflowSpec {
    pub id: &'static str,
    pub summary: &'static str,
    pub steps: &'static [StepSpec],
    pub required_artifacts: &'static [&'static str],
}

const JOB_PACKAGE_STEPS: &[StepSpec] = &[
    StepSpec {
        key: "load",
        zh: "读取任务输入",
        en: "Load task inputs",
        kind: "read",
        tool: "load_records",
        effect: "read_only",
        expected: "读取岗位、简历和职业资产快照",
        verification: "result",
    },
    StepSpec {
        key: "analyze",
        zh: "计算岗位匹配",
        en: "Score job matches",
        kind: "reason",
        tool: "analyze_match",
        effect: "read_only",
        expected: "得到可复算的岗位评分与推荐岗位",
        verification: "schema",
    },
    StepSpec {
        key: "generate",
        zh: "生成面试问题",
        en: "Generate interview questions",
        kind: "generate",
        tool: "generate_documents",
        effect: "read_only",
        expected: "得到基于目标 JD 的面试问题",
        verification: "result",
    },
    StepSpec {
        key: "write",
        zh: "生成投递包",
        en: "Write application package",
        kind: "write",
        tool: "write_artifact",
        effect: "local_create",
        expected: "写入四类真实文件",
        verification: "file",
    },
    StepSpec {
        key: "verify",
        zh: "验证任务产物",
        en: "Verify artifacts",
        kind: "verify",
        tool: "verify_artifact",
        effect: "read_only",
        expected: "验证文件存在、结构、大小和 SHA-256",
        verification: "file",
    },
];

const RADAR_STEPS: &[StepSpec] = &[
    StepSpec {
        key: "load_radar",
        zh: "读取雷达配置",
        en: "Load radar criteria",
        kind: "read",
        tool: "load_radar_spec",
        effect: "read_only",
        expected: "冻结搜索条件、来源和预算",
        verification: "schema",
    },
    StepSpec {
        key: "discover",
        zh: "检索机会来源",
        en: "Search opportunity sources",
        kind: "read",
        tool: "search_sources",
        effect: "external_read",
        expected: "得到受限、带来源的原始结果",
        verification: "result",
    },
    StepSpec {
        key: "normalize",
        zh: "整理候选机会",
        en: "Normalize opportunities",
        kind: "generate",
        tool: "normalize_candidates",
        effect: "read_only",
        expected: "得到有界候选 JSON",
        verification: "schema",
    },
    StepSpec {
        key: "verify_sources",
        zh: "验证候选来源",
        en: "Verify candidate sources",
        kind: "verify",
        tool: "verify_source_urls",
        effect: "external_read",
        expected: "拒绝死链、私网和越界重定向",
        verification: "result",
    },
    StepSpec {
        key: "rank_and_save",
        zh: "评分并保存候选",
        en: "Rank and save candidates",
        kind: "write",
        tool: "save_opportunities",
        effect: "local_create",
        expected: "确定性去重并写入待审机会",
        verification: "record",
    },
    StepSpec {
        key: "write_radar_report",
        zh: "生成机会报告",
        en: "Write opportunity report",
        kind: "write",
        tool: "write_artifact",
        effect: "local_create",
        expected: "写入真实 Markdown 报告",
        verification: "file",
    },
    StepSpec {
        key: "verify_radar_report",
        zh: "验证机会报告",
        en: "Verify opportunity report",
        kind: "verify",
        tool: "verify_artifact",
        effect: "read_only",
        expected: "验证报告路径、格式、大小和 SHA-256",
        verification: "file",
    },
];

const WORKFLOWS: &[WorkflowSpec] = &[
    WorkflowSpec {
        id: JOB_PACKAGE,
        summary: "读取输入、确定性评分、生成面试问题、写入并验证投递包",
        steps: JOB_PACKAGE_STEPS,
        required_artifacts: &[
            "match_report",
            "tailored_resume",
            "cover_letter",
            "interview_checklist",
        ],
    },
    WorkflowSpec {
        id: OPPORTUNITY_RADAR,
        summary: "冻结条件、受控检索、整理验链、确定性评分并生成机会报告",
        steps: RADAR_STEPS,
        required_artifacts: &["opportunity_report"],
    },
];

pub(super) fn get(id: &str) -> Result<&'static WorkflowSpec, String> {
    WORKFLOWS
        .iter()
        .find(|workflow| workflow.id == id)
        .ok_or_else(|| format!("当前不支持工作流: {id}"))
}

pub(super) fn build_steps(
    workflow_id: &str,
    task_id: &str,
    run_id: &str,
    now: i64,
) -> Result<Vec<Value>, String> {
    Ok(get(workflow_id)?
        .steps
        .iter()
        .enumerate()
        .map(|(order, step)| {
            json!({
                "id": format!("step_{run_id}_{}", step.key),
                "taskId": task_id,
                "runId": run_id,
                "key": step.key,
                "order": order,
                "title": step.zh,
                "titleEn": step.en,
                "kind": step.kind,
                "tool": step.tool,
                "effect": step.effect,
                "status": "pending",
                "attempt": 0,
                "expectedOutput": step.expected,
                "verification": { "kind": step.verification },
                "output": Value::Null,
                "error": Value::Null,
                "createdAt": now,
                "updatedAt": now,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_only_two_bounded_workflows() {
        assert_eq!(WORKFLOWS.len(), 2);
        assert_eq!(get(JOB_PACKAGE).unwrap().steps.len(), 5);
        let radar = get(OPPORTUNITY_RADAR).unwrap();
        assert_eq!(radar.steps.len(), 7);
        assert_eq!(radar.required_artifacts, &["opportunity_report"]);
        assert!(get("model_supplied_workflow").is_err());
    }

    #[test]
    fn radar_plan_has_bounded_effects_and_external_reads_only() {
        let steps = build_steps(OPPORTUNITY_RADAR, "task", "run", 1).unwrap();
        assert_eq!(steps[0]["key"], "load_radar");
        assert_eq!(steps[6]["key"], "verify_radar_report");
        assert!(steps.iter().all(|step| matches!(
            step["effect"].as_str(),
            Some("read_only" | "external_read" | "local_create")
        )));
    }
}
