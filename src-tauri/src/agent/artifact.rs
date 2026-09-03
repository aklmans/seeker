//! 固定工作流的受控 artifact 生成、原子写入与机器验证。
//!
//! 文件名和目录均由平台常量/平台生成 id 决定，模型没有路径输入面。简历事实段逐字来自用户
//! 选择的 resumes 记录；模型只产生基于 JD 的面试问题，不能改写工作/项目/教育事实。

use crate::docx::{render_docx, DocBlock, DocModel, DocSection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(test)]
pub(super) struct TestArtifactRoot(pub PathBuf);

#[cfg(test)]
#[derive(Default)]
pub(super) struct TestArtifactFault(pub std::sync::atomic::AtomicUsize);

const DOCX_MIME: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REQUIRED_KINDS: &[&str] = &[
    "match_report",
    "tailored_resume",
    "cover_letter",
    "interview_checklist",
];

#[derive(Debug)]
struct ArtifactPayload {
    kind: &'static str,
    name: &'static str,
    mime: &'static str,
    bytes: Vec<u8>,
}

pub(super) struct PackageInput<'a> {
    pub task_id: &'a str,
    pub run_id: &'a str,
    pub snapshot: &'a Value,
    pub analysis: &'a Value,
    pub questions: &'a str,
    pub language: &'a str,
    pub now: i64,
}

fn value_id(value: &Value) -> String {
    value
        .get("id")
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}

fn text<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or("")
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn value_strings(value: Option<&Value>) -> Vec<String> {
    fn collect(value: &Value, seen: &mut HashSet<String>, out: &mut Vec<String>) {
        match value {
            Value::String(text) => {
                let text = text.trim();
                if !text.is_empty() && seen.insert(text.to_string()) {
                    out.push(text.to_string());
                }
            }
            Value::Array(values) => {
                for value in values {
                    collect(value, seen, out);
                }
            }
            Value::Object(values) => {
                for value in values.values() {
                    collect(value, seen, out);
                }
            }
            _ => {}
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    if let Some(value) = value {
        collect(value, &mut seen, &mut out);
    }
    out
}

fn selected_job<'a>(snapshot: &'a Value, analysis: &Value) -> Result<&'a Value, String> {
    let selected = analysis
        .get("selectedJobId")
        .and_then(Value::as_str)
        .ok_or_else(|| "匹配分析缺少 selectedJobId".to_string())?;
    snapshot["jobs"]
        .as_array()
        .and_then(|jobs| jobs.iter().find(|job| value_id(job) == selected))
        .ok_or_else(|| "匹配分析选择了输入快照之外的岗位".to_string())
}

fn selected_score<'a>(analysis: &'a Value, selected: &str) -> Option<&'a Value> {
    analysis["scores"]
        .as_array()
        .and_then(|scores| scores.iter().find(|score| score["jobId"] == selected))
}

fn entry_blocks(value: Option<&Value>) -> Vec<DocBlock> {
    let mut blocks = Vec::new();
    for row in value.and_then(Value::as_array).into_iter().flatten() {
        let mut seen = HashSet::new();
        let head = ["org", "name", "title", "major", "degree"]
            .into_iter()
            .filter_map(|field| row[field].as_str().map(str::trim))
            .filter(|part| !part.is_empty() && seen.insert((*part).to_string()))
            .collect::<Vec<_>>()
            .join(" · ");
        let details = ["summary", "description", "bullets"]
            .into_iter()
            .flat_map(|field| value_strings(row.get(field)))
            .collect::<Vec<_>>();
        if head.is_empty() {
            blocks.extend(details.into_iter().map(|text| DocBlock::Para { text }));
        } else {
            blocks.push(DocBlock::Entry {
                head,
                date: text(row, "date").to_string(),
                bullets: details,
            });
        }
    }
    blocks
}

fn push_value_section(sections: &mut Vec<DocSection>, label: &str, value: Option<&Value>) {
    let content = value_strings(value);
    if !content.is_empty() {
        sections.push(DocSection {
            label: label.to_string(),
            blocks: content
                .into_iter()
                .map(|text| DocBlock::Para { text })
                .collect(),
        });
    }
}

fn build_resume(snapshot: &Value, analysis: &Value, language: &str) -> Result<DocModel, String> {
    let job = selected_job(snapshot, analysis)?;
    let resume = snapshot
        .get("resume")
        .filter(|v| v.is_object())
        .ok_or_else(|| "输入快照缺少简历".to_string())?;
    let selected = value_id(job);
    let score =
        selected_score(analysis, &selected).ok_or_else(|| "缺少所选岗位评分".to_string())?;
    let matched = string_list(score.get("matched"));
    let role = text(job, "role");
    let company = text(job, "co");
    let mut sections = Vec::new();
    sections.push(DocSection {
        label: if language == "en" {
            "Target role"
        } else {
            "目标岗位"
        }
        .into(),
        blocks: vec![DocBlock::Para {
            text: format!("{company} · {role}"),
        }],
    });
    push_value_section(
        &mut sections,
        if language == "en" {
            "Professional summary"
        } else {
            "职业概述"
        },
        resume.get("summary"),
    );
    push_value_section(
        &mut sections,
        if language == "en" {
            "Skills"
        } else {
            "专业技能"
        },
        resume.get("skills"),
    );
    if !matched.is_empty() {
        sections.push(DocSection {
            label: if language == "en" {
                "Relevant skills"
            } else {
                "匹配技能"
            }
            .into(),
            blocks: vec![DocBlock::Para {
                text: matched.join(" · "),
            }],
        });
    }
    let work = entry_blocks(resume.get("work"));
    if !work.is_empty() {
        sections.push(DocSection {
            label: if language == "en" {
                "Experience"
            } else {
                "工作经历"
            }
            .into(),
            blocks: work,
        });
    }
    let projects = entry_blocks(resume.get("projects"));
    if !projects.is_empty() {
        sections.push(DocSection {
            label: if language == "en" {
                "Projects"
            } else {
                "项目经历"
            }
            .into(),
            blocks: projects,
        });
    }
    let education = entry_blocks(resume.get("edu"));
    if !education.is_empty() {
        sections.push(DocSection {
            label: if language == "en" {
                "Education"
            } else {
                "教育经历"
            }
            .into(),
            blocks: education,
        });
    }
    for (field, zh, en) in [
        ("strengths", "特长与擅长领域", "Strengths"),
        ("certs", "证书与认证", "Certifications"),
        ("languages", "语言能力", "Languages"),
        ("honors", "荣誉奖项", "Honors"),
        ("portfolio", "作品集", "Portfolio"),
        ("research", "研究经历", "Research"),
        ("other", "其他职业信息", "Additional information"),
    ] {
        push_value_section(
            &mut sections,
            if language == "en" { en } else { zh },
            resume.get(field),
        );
    }
    // profile 结构性不进入任务域；明确占位，绝不默默生成或抓取联系方式。
    sections.push(DocSection {
        label: if language == "en" { "Private header" } else { "隐私信息" }.into(),
        blocks: vec![DocBlock::Para {
            text: if language == "en" {
                "Add your name and contact details locally before sending. Seeker did not expose profile data to this task."
            } else {
                "投递前请在本地补充姓名与联系方式；Seeker 未向本任务暴露个人信息。"
            }
            .into(),
        }],
    });
    Ok(DocModel {
        title: if language == "en" {
            format!("Targeted resume · {role}")
        } else {
            format!("针对性简历 · {role}")
        },
        sections,
    })
}

fn source_evidence(resume: &Value) -> Vec<String> {
    let mut candidates = value_strings(resume.get("summary"));
    for section in ["work", "projects"] {
        for entry in resume[section].as_array().into_iter().flatten() {
            for field in ["summary", "description", "bullets"] {
                candidates.extend(value_strings(entry.get(field)));
            }
        }
    }
    for field in [
        "skills",
        "strengths",
        "certs",
        "languages",
        "honors",
        "portfolio",
        "research",
        "other",
    ] {
        candidates.extend(value_strings(resume.get(field)));
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|item| seen.insert(item.clone()))
        .take(3)
        .collect()
}

fn build_cover_letter(
    snapshot: &Value,
    analysis: &Value,
    language: &str,
) -> Result<DocModel, String> {
    let job = selected_job(snapshot, analysis)?;
    let resume = &snapshot["resume"];
    let selected = value_id(job);
    let score =
        selected_score(analysis, &selected).ok_or_else(|| "缺少所选岗位评分".to_string())?;
    let matched = string_list(score.get("matched"));
    let evidence = source_evidence(resume);
    let company = text(job, "co");
    let role = text(job, "role");
    let mut blocks = Vec::new();
    blocks.push(DocBlock::Para {
        text: if language == "en" {
            format!("Dear {company} hiring team,")
        } else {
            format!("{company} 招聘团队，您好：")
        },
    });
    blocks.push(DocBlock::Para {
        text: if language == "en" {
            format!("I am applying for the {role} position.")
        } else {
            format!("我希望申请贵公司的“{role}”岗位。")
        },
    });
    if !matched.is_empty() {
        blocks.push(DocBlock::Para {
            text: if language == "en" {
                format!(
                    "My recorded background directly covers: {}.",
                    matched.join(", ")
                )
            } else {
                format!(
                    "我的既有职业资料与以下要求直接匹配：{}。",
                    matched.join("、")
                )
            },
        });
    }
    for item in evidence {
        blocks.push(DocBlock::Para { text: item });
    }
    blocks.push(DocBlock::Para {
        text: if language == "en" {
            "The statements above are taken from my source resume. I would welcome the opportunity to discuss their relevance to the role."
        } else {
            "以上经历均取自我的主简历资料，期待有机会进一步说明这些经验与岗位的契合方式。"
        }
        .into(),
    });
    Ok(DocModel {
        title: if language == "en" {
            "Cover letter draft"
        } else {
            "求职信草稿"
        }
        .into(),
        sections: vec![DocSection {
            label: format!("{company} · {role}"),
            blocks,
        }],
    })
}

fn match_report(snapshot: &Value, analysis: &Value, language: &str) -> Result<String, String> {
    let selected = analysis["selectedJobId"]
        .as_str()
        .ok_or_else(|| "匹配分析缺少所选岗位".to_string())?;
    let mut out = if language == "en" {
        "# Job match report\n\n| Job | Score | Matched | Gaps |\n| --- | ---: | --- | --- |\n"
            .to_string()
    } else {
        "# 岗位匹配报告\n\n| 岗位 | 分数 | 已匹配 | 缺口 |\n| --- | ---: | --- | --- |\n"
            .to_string()
    };
    for score in analysis["scores"].as_array().into_iter().flatten() {
        let job_id = score["jobId"].as_str().unwrap_or("");
        let job = snapshot["jobs"]
            .as_array()
            .and_then(|jobs| jobs.iter().find(|j| value_id(j) == job_id));
        let label = job
            .map(|j| format!("{} · {}", text(j, "co"), text(j, "role")))
            .unwrap_or_else(|| job_id.to_string());
        let matched = string_list(score.get("matched")).join("、");
        let gaps = string_list(score.get("gaps")).join("、");
        let n = score["score"].as_f64().unwrap_or(0.0);
        out.push_str(&format!("| {label} | {n:.1} | {matched} | {gaps} |\n"));
    }
    let chosen = snapshot["jobs"]
        .as_array()
        .and_then(|jobs| jobs.iter().find(|j| value_id(j) == selected))
        .ok_or_else(|| "所选岗位不在输入快照中".to_string())?;
    out.push_str(&format!(
        "\n## {}\n\n{} · {}\n\n{}\n",
        if language == "en" { "Selected role" } else { "推荐岗位" },
        text(chosen, "co"),
        text(chosen, "role"),
        if language == "en" {
            "Scores are calculated from the job's required skills and the locally stored skill levels."
        } else {
            "分数由岗位必备技能与本地职业资产中的技能等级确定性计算得出。"
        }
    ));
    Ok(out)
}

fn interview_checklist(
    snapshot: &Value,
    analysis: &Value,
    questions: &str,
    language: &str,
) -> Result<String, String> {
    let job = selected_job(snapshot, analysis)?;
    let selected = value_id(job);
    let score =
        selected_score(analysis, &selected).ok_or_else(|| "缺少所选岗位评分".to_string())?;
    let gaps = string_list(score.get("gaps"));
    let lines: Vec<String> = questions
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(|c: char| {
                    c.is_ascii_digit() || matches!(c, '.' | ')' | '-' | '、')
                })
                .trim()
        })
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect();
    if lines.len() != 5 {
        return Err(format!(
            "模型必须生成恰好五个面试问题，实际得到 {} 个",
            lines.len()
        ));
    }
    let mut out = format!(
        "# {}\n\n{} · {}\n\n## {}\n",
        if language == "en" {
            "Interview checklist"
        } else {
            "面试准备清单"
        },
        text(job, "co"),
        text(job, "role"),
        if language == "en" {
            "Questions"
        } else {
            "练习问题"
        },
    );
    for line in lines {
        out.push_str(&format!("- [ ] {line}\n"));
    }
    out.push_str(&format!(
        "\n## {}\n",
        if language == "en" {
            "Gaps to prepare"
        } else {
            "重点补齐缺口"
        }
    ));
    if gaps.is_empty() {
        out.push_str(if language == "en" {
            "- No clear hard-skill gap\n"
        } else {
            "- 暂无明显硬技能缺口\n"
        });
    } else {
        for gap in gaps {
            out.push_str(&format!("- [ ] {gap}\n"));
        }
    }
    Ok(out)
}

fn build_payloads(
    snapshot: &Value,
    analysis: &Value,
    questions: &str,
    language: &str,
) -> Result<Vec<ArtifactPayload>, String> {
    let resume = build_resume(snapshot, analysis, language)?;
    let cover = build_cover_letter(snapshot, analysis, language)?;
    Ok(vec![
        ArtifactPayload {
            kind: "match_report",
            name: "match-report.md",
            mime: "text/markdown",
            bytes: match_report(snapshot, analysis, language)?.into_bytes(),
        },
        ArtifactPayload {
            kind: "tailored_resume",
            name: "tailored-resume.docx",
            mime: DOCX_MIME,
            bytes: render_docx(&resume),
        },
        ArtifactPayload {
            kind: "cover_letter",
            name: "cover-letter.docx",
            mime: DOCX_MIME,
            bytes: render_docx(&cover),
        },
        ArtifactPayload {
            kind: "interview_checklist",
            name: "interview-checklist.md",
            mime: "text/markdown",
            bytes: interview_checklist(snapshot, analysis, questions, language)?.into_bytes(),
        },
    ])
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "artifact 路径缺少父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        error.to_string()
    })
}

fn artifact_records(
    dir: &Path,
    input: &PackageInput<'_>,
    payloads: &[ArtifactPayload],
) -> Vec<Value> {
    payloads
        .iter()
        .map(|payload| {
            json!({
                "id": format!("artifact_{}_{}", input.run_id, payload.kind),
                "taskId": input.task_id,
                "runId": input.run_id,
                "stepId": format!("step_{}_write", input.run_id),
                "kind": payload.kind,
                "name": payload.name,
                "mime": payload.mime,
                "size": payload.bytes.len(),
                "sha256": sha256(&payload.bytes),
                "verified": false,
                "validationStatus": "pending",
                "validationError": Value::Null,
                "path": dir.join(payload.name).to_string_lossy(),
                "createdAt": input.now,
                "updatedAt": input.now,
            })
        })
        .collect()
}

fn write_to_root_with_fault(
    root: &Path,
    input: &PackageInput<'_>,
    fail_file_at: Option<usize>,
) -> Result<Vec<Value>, String> {
    let PackageInput {
        task_id,
        run_id,
        snapshot,
        analysis,
        questions,
        language,
        now: _,
    } = input;
    if !safe_id(task_id) || !safe_id(run_id) {
        return Err("非法 task/run id".into());
    }
    let task_dir = root.join(task_id);
    let dir = task_dir.join(run_id);
    let staging = task_dir.join(format!(".{run_id}.staging"));
    let payloads = build_payloads(snapshot, analysis, questions, language)?;
    let records = artifact_records(&dir, input, &payloads);

    if dir.exists() {
        for payload in &payloads {
            let bytes = std::fs::read(dir.join(payload.name))
                .map_err(|error| format!("已有投递包不完整，需先协调: {error}"))?;
            if bytes.len() != payload.bytes.len() || sha256(&bytes) != sha256(&payload.bytes) {
                return Err("已有投递包与本次确定性输出不一致，需先协调".into());
            }
        }
        return Ok(records);
    }

    std::fs::create_dir_all(&task_dir).map_err(|e| e.to_string())?;
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let write_result = (|| {
        for (index, payload) in payloads.iter().enumerate() {
            if fail_file_at == Some(index + 1) {
                return Err(format!("故障注入：第 {} 个产物写入失败", index + 1));
            }
            atomic_write(&staging.join(payload.name), &payload.bytes)?;
        }
        std::fs::rename(&staging, &dir).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(records)
}

fn write_to_root(root: &Path, input: &PackageInput<'_>) -> Result<Vec<Value>, String> {
    write_to_root_with_fault(root, input, None)
}

pub(super) fn cleanup_run_output(root: &Path, task_id: &str, run_id: &str) -> Result<(), String> {
    if !safe_id(task_id) || !safe_id(run_id) {
        return Err("非法 task/run id".into());
    }
    let task_dir = root.join(task_id);
    for path in [
        task_dir.join(run_id),
        task_dir.join(format!(".{run_id}.staging")),
    ] {
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn write_job_package<R: Runtime>(
    app: &AppHandle<R>,
    input: &PackageInput<'_>,
) -> Result<Vec<Value>, String> {
    let root = artifact_root(app)?;
    #[cfg(test)]
    if let Some(fault) = app.try_state::<TestArtifactFault>() {
        let fail_at = fault.0.load(std::sync::atomic::Ordering::SeqCst);
        return write_to_root_with_fault(&root, input, (fail_at > 0).then_some(fail_at));
    }
    write_to_root(&root, input)
}

pub(super) fn write_radar_report<R: Runtime>(
    app: &AppHandle<R>,
    task_id: &str,
    run_id: &str,
    bytes: Vec<u8>,
    now: i64,
) -> Result<Vec<Value>, String> {
    if !safe_id(task_id) || !safe_id(run_id) || bytes.is_empty() {
        return Err("非法或为空的机会报告".into());
    }
    let root = artifact_root(app)?;
    let task_dir = root.join(task_id);
    let dir = task_dir.join(run_id);
    let staging = task_dir.join(format!(".{run_id}.staging"));
    let name = "opportunity-report.md";
    let record = json!({
        "id": format!("artifact_{run_id}_opportunity_report"),
        "taskId": task_id,
        "runId": run_id,
        "stepId": format!("step_{run_id}_write_radar_report"),
        "kind": "opportunity_report",
        "name": name,
        "mime": "text/markdown",
        "size": bytes.len(),
        "sha256": sha256(&bytes),
        "verified": false,
        "validationStatus": "pending",
        "validationError": Value::Null,
        "path": dir.join(name).to_string_lossy(),
        "createdAt": now,
        "updatedAt": now,
    });
    if dir.exists() {
        let existing = std::fs::read(dir.join(name))
            .map_err(|error| format!("已有机会报告不完整，需先协调: {error}"))?;
        if existing.len() != bytes.len() || sha256(&existing) != sha256(&bytes) {
            return Err("已有机会报告与本次确定性输出不一致，需先协调".into());
        }
        return Ok(vec![record]);
    }
    std::fs::create_dir_all(&task_dir).map_err(|error| error.to_string())?;
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir(&staging).map_err(|error| error.to_string())?;
    if let Err(error) = atomic_write(&staging.join(name), &bytes)
        .and_then(|_| std::fs::rename(&staging, &dir).map_err(|error| error.to_string()))
    {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(vec![record])
}

fn validate_record(root: &Path, record: &Value) -> Result<(Value, PathBuf, Vec<u8>), String> {
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let raw = record["path"]
        .as_str()
        .ok_or_else(|| "artifact 缺少 path".to_string())?;
    let path = std::fs::canonicalize(raw).map_err(|e| format!("artifact 不存在: {e}"))?;
    if !path.starts_with(&root) {
        return Err("artifact 路径逃逸受控目录".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err(format!("artifact 为空: {raw}"));
    }
    if record["size"].as_u64() != Some(bytes.len() as u64)
        || record["sha256"].as_str() != Some(sha256(&bytes).as_str())
    {
        return Err(format!("artifact 大小或 SHA-256 不匹配: {raw}"));
    }
    let mime = record["mime"].as_str().unwrap_or("");
    if mime == DOCX_MIME {
        if !bytes.starts_with(b"PK\x03\x04")
            || !bytes
                .windows("word/document.xml".len())
                .any(|w| w == b"word/document.xml")
        {
            return Err(format!("DOCX 结构无效: {raw}"));
        }
    } else if mime == "text/markdown" && std::str::from_utf8(&bytes).is_err() {
        return Err(format!("Markdown 不是 UTF-8: {raw}"));
    }
    let mut copy = record.clone();
    copy["verified"] = Value::Bool(true);
    copy["validationStatus"] = json!("verified");
    copy["validationError"] = Value::Null;
    Ok((copy, path, bytes))
}

pub(super) fn verify_artifacts(root: &Path, records: &[Value]) -> Result<Vec<Value>, String> {
    verify_artifacts_for(root, records, REQUIRED_KINDS)
}

pub(super) fn verify_artifacts_for(
    root: &Path,
    records: &[Value],
    required_kinds: &[&str],
) -> Result<Vec<Value>, String> {
    let kinds: HashSet<&str> = records.iter().filter_map(|r| r["kind"].as_str()).collect();
    for kind in required_kinds {
        if !kinds.contains(kind) {
            return Err(format!("缺少必需 artifact: {kind}"));
        }
    }
    records
        .iter()
        .map(|record| validate_record(root, record).map(|(record, _, _)| record))
        .collect()
}

pub(super) fn validated_file<R: Runtime>(
    app: &AppHandle<R>,
    record: &Value,
) -> Result<(PathBuf, Vec<u8>), String> {
    if record["verified"] != true || record["validationStatus"] == "invalid" {
        return Err("artifact 尚未验证或已失效，不能读取或打开".into());
    }
    let (_, path, bytes) = validate_record(&artifact_root(app)?, record)?;
    Ok((path, bytes))
}

pub(super) fn artifact_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(root) = app.try_state::<TestArtifactRoot>() {
        return Ok(root.0.clone());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent_artifacts"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Value, Value) {
        let snapshot = json!({
            "jobs": [{ "id": "j1", "co": "Acme", "role": "Backend", "need": ["Rust", "SQL"] }],
            "resume": {
                "id": "r1",
                "work": [{ "org": "Source Co", "title": "Engineer", "date": "2022—2025", "bullets": ["Built a Rust service"] }],
                "projects": [{ "name": "Queue", "date": "2024", "bullets": ["Reduced latency from 20ms to 10ms"] }],
                "edu": [{ "org": "Source University", "title": "CS", "date": "2018—2022" }],
                "strengths": "Distributed systems"
            }
        });
        let analysis = json!({
            "selectedJobId": "j1",
            "scores": [{ "jobId": "j1", "score": 5.0, "matched": ["Rust"], "gaps": ["SQL"] }]
        });
        (snapshot, analysis)
    }

    #[test]
    fn package_uses_source_resume_facts_and_four_required_outputs() {
        let (snapshot, analysis) = fixture();
        let payloads = build_payloads(
            &snapshot,
            &analysis,
            "Question one?\nQuestion two?\nQuestion three?\nQuestion four?\nQuestion five?",
            "en",
        )
        .unwrap();
        assert_eq!(payloads.len(), 4);
        assert_eq!(
            payloads.iter().map(|p| p.kind).collect::<HashSet<_>>(),
            REQUIRED_KINDS.iter().copied().collect()
        );
        let all = payloads
            .iter()
            .flat_map(|p| p.bytes.iter().copied())
            .collect::<Vec<_>>();
        let lossy = String::from_utf8_lossy(&all);
        for source_fact in [
            "Source Co",
            "2022—2025",
            "Built a Rust service",
            "Source University",
        ] {
            assert!(
                lossy.contains(source_fact),
                "source fact missing: {source_fact}"
            );
        }
        assert!(lossy.contains("did not expose profile data"));
    }

    #[test]
    fn every_field_that_can_validate_a_resume_reaches_the_targeted_resume() {
        let (base_snapshot, analysis) = fixture();
        for (resume, source_fact) in [
            (
                json!({ "work": [{ "org": "Work organization token" }] }),
                "Work organization token",
            ),
            (
                json!({ "work": [{ "title": "Work title token" }] }),
                "Work title token",
            ),
            (
                json!({ "work": [{ "summary": "Work summary token" }] }),
                "Work summary token",
            ),
            (
                json!({ "work": [{ "description": "Work description token" }] }),
                "Work description token",
            ),
            (
                json!({ "work": [{ "bullets": ["Work bullet token"] }] }),
                "Work bullet token",
            ),
            (
                json!({ "projects": [{ "name": "Project name token" }] }),
                "Project name token",
            ),
            (
                json!({ "projects": [{ "title": "Project title token" }] }),
                "Project title token",
            ),
            (
                json!({ "projects": [{ "summary": "Project summary token" }] }),
                "Project summary token",
            ),
            (
                json!({ "projects": [{ "description": "Project description token" }] }),
                "Project description token",
            ),
            (
                json!({ "projects": [{ "bullets": ["Project bullet token"] }] }),
                "Project bullet token",
            ),
            (
                json!({ "edu": [{ "org": "Education organization token" }] }),
                "Education organization token",
            ),
            (
                json!({ "edu": [{ "title": "Education title token" }] }),
                "Education title token",
            ),
            (
                json!({ "edu": [{ "major": "Education major token" }] }),
                "Education major token",
            ),
            (
                json!({ "edu": [{ "degree": "Education degree token" }] }),
                "Education degree token",
            ),
            (
                json!({ "edu": [{ "summary": "Education summary token" }] }),
                "Education summary token",
            ),
            (
                json!({ "edu": [{ "description": "Education description token" }] }),
                "Education description token",
            ),
            (
                json!({ "edu": [{ "bullets": ["Education bullet token"] }] }),
                "Education bullet token",
            ),
            (
                json!({ "summary": "Professional summary token" }),
                "Professional summary token",
            ),
            (
                json!({ "skills": ["Node.js skill token"] }),
                "Node.js skill token",
            ),
            (json!({ "strengths": "Strength token" }), "Strength token"),
            (
                json!({ "certs": ["Certification token"] }),
                "Certification token",
            ),
            (json!({ "languages": ["Language token"] }), "Language token"),
            (json!({ "honors": ["Honor token"] }), "Honor token"),
            (
                json!({ "portfolio": "Portfolio description token" }),
                "Portfolio description token",
            ),
            (json!({ "research": "Research token" }), "Research token"),
            (
                json!({ "other": { "note": "Additional information token" } }),
                "Additional information token",
            ),
        ] {
            assert!(super::super::resume_has_professional_content(&resume));
            let mut snapshot = base_snapshot.clone();
            snapshot["resume"] = resume;
            let bytes = render_docx(&build_resume(&snapshot, &analysis, "en").unwrap());
            assert!(
                String::from_utf8_lossy(&bytes).contains(source_fact),
                "source fact missing from targeted resume: {source_fact}"
            );
        }
    }

    #[test]
    fn checklist_requires_exactly_five_questions() {
        let (snapshot, analysis) = fixture();
        let too_many = (1..=6)
            .map(|index| format!("{index}. Question {index}?"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(interview_checklist(&snapshot, &analysis, &too_many, "en")
            .unwrap_err()
            .contains("实际得到 6 个"));

        let exactly_five = (1..=5)
            .map(|index| format!("{index}. Question {index}?"))
            .collect::<Vec<_>>()
            .join("\n");
        let checklist = interview_checklist(&snapshot, &analysis, &exactly_five, "en").unwrap();
        assert_eq!(checklist.matches("- [ ] Question").count(), 5);
    }

    #[test]
    fn atomic_write_is_idempotent_and_verifier_detects_tampering() {
        let (snapshot, analysis) = fixture();
        let root = std::env::temp_dir().join(format!(
            "seeker-agent-artifact-test-{}",
            super::super::now_ms()
        ));
        let records = write_to_root(
            &root,
            &PackageInput {
                task_id: "task_1",
                run_id: "run_1",
                snapshot: &snapshot,
                analysis: &analysis,
                questions:
                    "Question one?\nQuestion two?\nQuestion three?\nQuestion four?\nQuestion five?",
                language: "en",
                now: 1,
            },
        )
        .unwrap();
        let second = write_to_root(
            &root,
            &PackageInput {
                task_id: "task_1",
                run_id: "run_1",
                snapshot: &snapshot,
                analysis: &analysis,
                questions:
                    "Question one?\nQuestion two?\nQuestion three?\nQuestion four?\nQuestion five?",
                language: "en",
                now: 2,
            },
        )
        .unwrap();
        assert_eq!(records.len(), 4);
        assert_eq!(records[0]["sha256"], second[0]["sha256"]);
        let verified = verify_artifacts(&root, &records).unwrap();
        assert!(verified.iter().all(|r| r["verified"] == true));

        let path = records[0]["path"].as_str().unwrap();
        std::fs::write(path, b"tampered").unwrap();
        assert!(verify_artifacts(&root, &records)
            .unwrap_err()
            .contains("SHA-256"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn verifier_rejects_missing_kind_and_path_escape() {
        let stamp = super::super::now_ms();
        let root = std::env::temp_dir().join(format!("seeker-agent-artifact-root-{stamp}"));
        let outside =
            std::env::temp_dir().join(format!("seeker-agent-artifact-outside-{stamp}.md"));
        std::fs::create_dir_all(&root).unwrap();
        assert!(verify_artifacts(&root, &[]).unwrap_err().contains("缺少"));
        std::fs::write(&outside, b"outside").unwrap();
        let outside_record = json!({
            "path": outside.to_string_lossy(),
            "mime": "text/markdown",
            "size": 7,
            "sha256": sha256(b"outside"),
        });
        assert!(validate_record(&root, &outside_record)
            .unwrap_err()
            .contains("路径逃逸"));
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nth_file_failure_never_publishes_a_partial_package() {
        let (snapshot, analysis) = fixture();
        for fail_at in 1..=4 {
            let root = std::env::temp_dir().join(format!(
                "seeker-agent-artifact-fault-{}-{fail_at}",
                super::super::now_ms()
            ));
            let result = write_to_root_with_fault(
                &root,
                &PackageInput {
                    task_id: "task_1",
                    run_id: "run_1",
                    snapshot: &snapshot,
                    analysis: &analysis,
                    questions:
                        "Question one?\nQuestion two?\nQuestion three?\nQuestion four?\nQuestion five?",
                    language: "en",
                    now: 1,
                },
                Some(fail_at),
            );
            assert!(result.unwrap_err().contains(&format!("第 {fail_at} 个")));
            assert!(!root.join("task_1/run_1").exists());
            assert!(!root.join("task_1/.run_1.staging").exists());
            let _ = std::fs::remove_dir_all(&root);
        }
    }

    #[test]
    fn coordinated_retry_removes_old_output_before_recreating_package() {
        let (snapshot, analysis) = fixture();
        let root = std::env::temp_dir().join(format!(
            "seeker-agent-artifact-retry-{}",
            super::super::now_ms()
        ));
        let input = PackageInput {
            task_id: "task_1",
            run_id: "run_1",
            snapshot: &snapshot,
            analysis: &analysis,
            questions:
                "Question one?\nQuestion two?\nQuestion three?\nQuestion four?\nQuestion five?",
            language: "en",
            now: 1,
        };
        let first = write_to_root(&root, &input).unwrap();
        std::fs::write(first[0]["path"].as_str().unwrap(), b"stale").unwrap();

        cleanup_run_output(&root, "task_1", "run_1").unwrap();
        assert!(!root.join("task_1/run_1").exists());

        let retried = write_to_root(&root, &input).unwrap();
        assert_eq!(retried.len(), 4);
        assert!(verify_artifacts(&root, &retried).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }
}
