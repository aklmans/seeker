//! 编译期固定的 Task Agent 工作流注册表。
//!
//! 这里只存平台自持元数据；外部输入不能注册、增删或重排步骤。协调器按 workflow id
//! 取计划，未知 id 一律拒绝。

use serde_json::{json, Value};

pub(super) const JOB_PACKAGE: &str = "job_application_package";
pub(super) const OPPORTUNITY_RADAR: &str = "job_opportunity_radar";
pub(super) const MATERIAL_REPORT: &str = "material_report";

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
        id: MATERIAL_REPORT,
        summary: "读取所选资料快照、逐份提取、综合整理、核对来源、写入并验证报告",
        steps: MATERIAL_STEPS,
        required_artifacts: &["material_report_md", "material_report_docx"],
    },
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

const MATERIAL_STEPS: &[StepSpec] = &[
    StepSpec {
        key: "load_materials",
        zh: "读取本次资料快照",
        en: "Load selected snapshots",
        kind: "read",
        tool: "load_material_snapshot",
        effect: "read_only",
        expected: "冻结的所选资料与整理目标",
        verification: "schema",
    },
    StepSpec {
        key: "extract_material",
        zh: "提取资料要点",
        en: "Extract source points",
        kind: "generate",
        tool: "extract_material",
        effect: "read_only",
        expected: "单份资料的要点和逐字引用",
        verification: "schema",
    },
    StepSpec {
        key: "synthesize_materials",
        zh: "综合整理与比较",
        en: "Synthesize and compare",
        kind: "generate",
        tool: "synthesize_materials",
        effect: "read_only",
        expected: "区分资料事实、模型归纳和建议的报告",
        verification: "schema",
    },
    StepSpec {
        key: "check_materials",
        zh: "检查报告结构和引用",
        en: "Check structure and quotations",
        kind: "verify",
        tool: "check_material_report",
        effect: "read_only",
        expected: "结构齐全、每条引用属于本次资料",
        verification: "schema",
    },
    StepSpec {
        key: "write_material_report",
        zh: "生成 Markdown 与 DOCX",
        en: "Write Markdown and DOCX",
        kind: "write",
        tool: "write_artifact",
        effect: "local_create",
        expected: "两个真实报告文件",
        verification: "file",
    },
    StepSpec {
        key: "verify_material_report",
        zh: "重读并验证报告文件",
        en: "Reread and verify report files",
        kind: "verify",
        tool: "verify_artifact",
        effect: "read_only",
        expected: "路径、内容、结构、大小与摘要均通过",
        verification: "file",
    },
];

/// Material sources repeat a compiled extraction step, once per validated source.
/// No free-form step definitions, tool names or effects are accepted from inputs.
pub(super) fn build_task_steps(
    task: &Value,
    task_id: &str,
    run_id: &str,
    now: i64,
) -> Result<Vec<Value>, String> {
    let id = task["workflowId"].as_str().unwrap_or("");
    let base = build_steps(id, task_id, run_id, now)?;
    if id != MATERIAL_REPORT {
        return Ok(base);
    }
    let snapshot = super::material::validate_task(task)?;
    let mut steps = Vec::new();
    for step in base {
        if step["key"] == "extract_material" {
            for (i, source) in snapshot.sources.iter().enumerate() {
                let mut copy = step.clone();
                let key = format!("extract_material_{}", i + 1);
                copy["id"] = json!(format!("step_{run_id}_{key}"));
                copy["key"] = json!(key);
                copy["title"] = json!(format!("提取要点 · {}", source.title));
                copy["titleEn"] = json!(format!("Extract points · {}", source.title));
                steps.push(copy);
            }
        } else {
            steps.push(step);
        }
    }
    for (i, step) in steps.iter_mut().enumerate() {
        step["order"] = json!(i);
    }
    Ok(steps)
}

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
    fn registry_contains_only_three_bounded_workflows() {
        assert_eq!(WORKFLOWS.len(), 3);
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
