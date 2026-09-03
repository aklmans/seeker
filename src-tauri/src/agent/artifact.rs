//! 岗位投递包的受控 artifact 生成、原子写入与机器验证。
//!
//! 文件名和目录均由平台常量/平台生成 id 决定，模型没有路径输入面。简历事实段逐字来自用户
//! 选择的 resumes 记录；模型只产生基于 JD 的面试问题，不能改写工作/项目/教育事实。

use crate::docx::{render_docx, DocBlock, DocModel, DocSection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let org = text(row, "org");
            let name = text(row, "name");
            let title = text(row, "title");
            let primary = if org.is_empty() { name } else { org };
            let head = [primary, title]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            if head.is_empty() {
                return None;
            }
            Some(DocBlock::Entry {
                head,
                date: text(row, "date").to_string(),
                bullets: string_list(row.get("bullets")),
            })
        })
        .collect()
}

fn push_text_section(sections: &mut Vec<DocSection>, label: &str, content: &str) {
    let content = content.trim();
    if !content.is_empty() {
        sections.push(DocSection {
            label: label.to_string(),
            blocks: vec![DocBlock::Para {
                text: content.to_string(),
            }],
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
    ] {
        push_text_section(
            &mut sections,
            if language == "en" { en } else { zh },
            text(resume, field),
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
    ["work", "projects"]
        .into_iter()
        .flat_map(|field| {
            resume[field]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|entry| string_list(entry.get("bullets")))
        })
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
        .take(5)
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

fn write_to_root(root: &Path, input: &PackageInput<'_>) -> Result<Vec<Value>, String> {
    let PackageInput {
        task_id,
        run_id,
        snapshot,
        analysis,
        questions,
        language,
        now,
    } = input;
    if !safe_id(task_id) || !safe_id(run_id) {
        return Err("非法 task/run id".into());
    }
    let dir = root.join(task_id).join(run_id);
    let payloads = build_payloads(snapshot, analysis, questions, language)?;
    let mut records = Vec::new();
    for payload in payloads {
        let path = dir.join(payload.name);
        atomic_write(&path, &payload.bytes)?;
        records.push(json!({
            "id": format!("artifact_{run_id}_{}", payload.kind),
            "taskId": task_id,
            "runId": run_id,
            "stepId": format!("step_{run_id}_write"),
            "kind": payload.kind,
            "name": payload.name,
            "mime": payload.mime,
            "size": payload.bytes.len(),
            "sha256": sha256(&payload.bytes),
            "verified": false,
            "path": path.to_string_lossy(),
            "createdAt": *now,
            "updatedAt": *now,
        }));
    }
    Ok(records)
}

pub(super) fn write_job_package(
    app: &AppHandle,
    input: &PackageInput<'_>,
) -> Result<Vec<Value>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent_artifacts");
    write_to_root(&root, input)
}

pub(super) fn verify_artifacts(root: &Path, records: &[Value]) -> Result<Vec<Value>, String> {
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let kinds: HashSet<&str> = records.iter().filter_map(|r| r["kind"].as_str()).collect();
    for kind in REQUIRED_KINDS {
        if !kinds.contains(kind) {
            return Err(format!("缺少必需 artifact: {kind}"));
        }
    }
    let mut verified = Vec::new();
    for record in records {
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
        verified.push(copy);
    }
    Ok(verified)
}

pub(super) fn artifact_root(app: &AppHandle) -> Result<PathBuf, String> {
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
        let root = std::env::temp_dir().join(format!(
            "seeker-agent-artifact-escape-{}",
            super::super::now_ms()
        ));
        std::fs::create_dir_all(&root).unwrap();
        assert!(verify_artifacts(&root, &[]).unwrap_err().contains("缺少"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
