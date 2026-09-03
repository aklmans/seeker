//! Task Agent 可恢复顺序协调器。

use super::{artifact, fresh_id, now_ms, ARTIFACTS, EVENTS, RUNS, STEPS, TASKS};
use crate::ai::{generate_agent_text, AgentGenerateOutcome};
use crate::data::{delete_record, get_record, list_records, upsert_record, Db};
use serde_json::{json, Value};
use std::collections::{hash_map::Entry, HashMap};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

const REQUEST_NONE: u8 = 0;
const REQUEST_PAUSE: u8 = 1;
const REQUEST_CANCEL: u8 = 2;

#[derive(Clone)]
struct RunControl {
    token: CancellationToken,
    requested: Arc<AtomicU8>,
}

impl RunControl {
    fn new() -> Self {
        Self {
            token: CancellationToken::new(),
            requested: Arc::new(AtomicU8::new(REQUEST_NONE)),
        }
    }

    fn request(&self, value: u8) {
        self.requested.store(value, Ordering::SeqCst);
        self.token.cancel();
    }

    fn requested(&self) -> u8 {
        self.requested.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
pub struct AgentRuns(Mutex<HashMap<String, RunControl>>);

fn reserve_run(runs: &AgentRuns, run_id: &str) -> Result<RunControl, String> {
    let mut active = runs.0.lock().map_err(|_| "运行锁中毒".to_string())?;
    match active.entry(run_id.to_string()) {
        Entry::Occupied(_) => Err("运行已经在执行".into()),
        Entry::Vacant(slot) => {
            let control = RunControl::new();
            slot.insert(control.clone());
            Ok(control)
        }
    }
}

fn release_run(runs: &AgentRuns, run_id: &str) {
    if let Ok(mut active) = runs.0.lock() {
        active.remove(run_id);
    }
}

fn set_fields(record: &mut Value, fields: &[(&str, Value)]) -> Result<(), String> {
    let target = record
        .as_object_mut()
        .ok_or_else(|| "Agent 记录不是对象".to_string())?;
    for (key, value) in fields {
        target.insert((*key).to_string(), value.clone());
    }
    target.insert("updatedAt".into(), Value::from(now_ms()));
    Ok(())
}

fn update_record(
    conn: &rusqlite::Connection,
    collection: &str,
    id: &str,
    fields: &[(&str, Value)],
) -> Result<Value, String> {
    let mut record = get_record(conn, collection, id)?
        .ok_or_else(|| format!("Agent 记录不存在: {collection}/{id}"))?;
    set_fields(&mut record, fields)?;
    upsert_record(conn, collection, &record)?;
    Ok(record)
}

fn append_event_conn(
    conn: &rusqlite::Connection,
    task_id: &str,
    run_id: &str,
    kind: &str,
    zh: &str,
    en: &str,
) -> Result<Value, String> {
    let now = now_ms();
    let event = json!({
        "id": fresh_id("event", now),
        "taskId": task_id,
        "runId": run_id,
        "type": kind,
        "message": zh,
        "messageEn": en,
        "createdAt": now,
        "updatedAt": now,
    });
    upsert_record(conn, EVENTS, &event)?;
    Ok(event)
}

fn emit_event(app: &AppHandle, event: &Value) {
    let _ = app.emit("agent_event", event);
}

fn fixed_steps(task_id: &str, run_id: &str, now: i64) -> Vec<Value> {
    [
        (
            "load",
            "读取任务输入",
            "Load task inputs",
            "read",
            "load_records",
            "read_only",
            "读取岗位、简历和职业资产快照",
            "result",
        ),
        (
            "analyze",
            "计算岗位匹配",
            "Score job matches",
            "reason",
            "analyze_match",
            "read_only",
            "得到可复算的岗位评分与推荐岗位",
            "schema",
        ),
        (
            "generate",
            "生成面试问题",
            "Generate interview questions",
            "generate",
            "generate_documents",
            "read_only",
            "得到基于目标 JD 的面试问题",
            "result",
        ),
        (
            "write",
            "生成投递包",
            "Write application package",
            "write",
            "write_artifact",
            "local_create",
            "写入四类真实文件",
            "file",
        ),
        (
            "verify",
            "验证任务产物",
            "Verify artifacts",
            "verify",
            "verify_artifact",
            "read_only",
            "验证文件存在、结构、大小和 SHA-256",
            "file",
        ),
    ]
    .into_iter()
    .enumerate()
    .map(
        |(order, (key, zh, en, kind, tool, effect, expected, verification))| {
            json!({
                "id": format!("step_{run_id}_{key}"),
                "taskId": task_id,
                "runId": run_id,
                "key": key,
                "order": order,
                "title": zh,
                "titleEn": en,
                "kind": kind,
                "tool": tool,
                "effect": effect,
                "status": "pending",
                "attempt": 0,
                "expectedOutput": expected,
                "verification": { "kind": verification },
                "output": Value::Null,
                "error": Value::Null,
                "createdAt": now,
                "updatedAt": now,
            })
        },
    )
    .collect()
}

fn active_status(status: &str) -> bool {
    matches!(
        status,
        "created"
            | "planning"
            | "running"
            | "waiting_input"
            | "waiting_approval"
            | "paused"
            | "interrupted"
    )
}

fn prepare_new_run(conn: &mut rusqlite::Connection, task: &Value) -> Result<Value, String> {
    let task_id = task["id"]
        .as_str()
        .ok_or_else(|| "任务缺少 id".to_string())?;
    let status = task["status"].as_str().unwrap_or("");
    if !matches!(status, "draft" | "failed") {
        return Err(format!("当前任务状态不能开始新运行: {status}"));
    }
    if list_records(conn, RUNS)?
        .iter()
        .any(|run| run["taskId"] == task_id && run["status"].as_str().is_some_and(active_status))
    {
        return Err("该任务已有未结束的运行".into());
    }
    let now = now_ms();
    let run_id = fresh_id("run", now);
    let steps = fixed_steps(task_id, &run_id, now);
    let run = json!({
        "id": run_id,
        "taskId": task_id,
        "status": "created",
        "currentStepId": Value::Null,
        "plan": {
            "version": 1,
            "summary": "读取输入、确定性评分、生成面试问题、写入并验证投递包",
            "stepIds": steps.iter().map(|s| s["id"].clone()).collect::<Vec<_>>(),
        },
        "budget": { "maxSteps": 12, "maxAttempts": 2 },
        "error": Value::Null,
        "createdAt": now,
        "updatedAt": now,
    });
    let mut queued_task = task.clone();
    set_fields(&mut queued_task, &[("status", json!("queued"))])?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    upsert_record(&tx, TASKS, &queued_task)?;
    upsert_record(&tx, RUNS, &run)?;
    for step in &steps {
        upsert_record(&tx, STEPS, step)?;
    }
    append_event_conn(
        &tx,
        task_id,
        &run_id,
        "run_created",
        "任务运行已创建",
        "Task run created",
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(run)
}

fn spawn_run(app: AppHandle, run_id: String, control: RunControl) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = execute_run(&app, &run_id, &control).await {
            log::error!("[agent] run {run_id} 协调器失败: {error}");
            if let Err(converge_error) = converge_unhandled_failure(&app, &run_id, &error) {
                log::error!(
                    "[agent] run {run_id} 无法收敛异常状态，将由下次启动恢复: {converge_error}"
                );
            }
        }
        if let Some(runs) = app.try_state::<AgentRuns>() {
            release_run(&runs, &run_id);
        }
    });
}

#[tauri::command]
pub async fn agent_run_start(
    app: AppHandle,
    db: State<'_, Db>,
    runs: State<'_, AgentRuns>,
    task_id: String,
) -> Result<Value, String> {
    let run = {
        let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
        let task =
            get_record(&conn, TASKS, &task_id)?.ok_or_else(|| format!("任务不存在: {task_id}"))?;
        prepare_new_run(&mut conn, &task)?
    };
    let run_id = run["id"]
        .as_str()
        .ok_or_else(|| "内部错误:运行缺少 id".to_string())?
        .to_string();
    let control = reserve_run(&runs, &run_id)?;
    spawn_run(app, run_id, control);
    Ok(run)
}

#[tauri::command]
pub fn agent_run_pause(runs: State<'_, AgentRuns>, run_id: String) -> Result<(), String> {
    let control = runs
        .0
        .lock()
        .map_err(|_| "运行锁中毒".to_string())?
        .get(&run_id)
        .cloned()
        .ok_or_else(|| "运行当前不在执行，无法暂停".to_string())?;
    control.request(REQUEST_PAUSE);
    Ok(())
}

#[tauri::command]
pub async fn agent_run_resume(
    app: AppHandle,
    db: State<'_, Db>,
    runs: State<'_, AgentRuns>,
    run_id: String,
) -> Result<(), String> {
    let control = reserve_run(&runs, &run_id)?;
    let initialized = (|| {
        let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
        let run =
            get_record(&conn, RUNS, &run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
        if !matches!(run["status"].as_str(), Some("paused" | "interrupted")) {
            return Err("只有已暂停或已中断的运行可以继续".into());
        }
        drop(conn);
        reconcile_unknown_steps(&app, &run_id)
    })();
    if let Err(error) = initialized {
        release_run(&runs, &run_id);
        return Err(error);
    }
    spawn_run(app, run_id, control);
    Ok(())
}

#[tauri::command]
pub fn agent_run_cancel(
    app: AppHandle,
    db: State<'_, Db>,
    runs: State<'_, AgentRuns>,
    run_id: String,
) -> Result<(), String> {
    if let Some(control) = runs.0.lock().unwrap().get(&run_id).cloned() {
        control.request(REQUEST_CANCEL);
        return Ok(());
    }
    let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let run = get_record(&conn, RUNS, &run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
    let status = run["status"].as_str().unwrap_or("");
    if matches!(status, "succeeded" | "failed" | "cancelled") {
        return Ok(());
    }
    let task_id = run["taskId"].as_str().unwrap_or("");
    update_record(&conn, RUNS, &run_id, &[("status", json!("cancelled"))])?;
    if !task_id.is_empty() {
        update_record(&conn, TASKS, task_id, &[("status", json!("cancelled"))])?;
    }
    for step in related(&conn, STEPS, "runId", &run_id)? {
        if matches!(
            step["status"].as_str(),
            Some("pending" | "running" | "waiting_approval")
        ) {
            if let Some(id) = step["id"].as_str() {
                update_record(&conn, STEPS, id, &[("status", json!("cancelled"))])?;
            }
        }
    }
    if !task_id.is_empty() {
        let event = append_event_conn(
            &conn,
            task_id,
            &run_id,
            "run_cancelled",
            "任务已取消",
            "Task cancelled",
        )?;
        emit_event(&app, &event);
    }
    Ok(())
}

/// 只自动协调当前唯一幂等副作用 `write_artifact`：
/// - 四项记录及文件均可验证 → 认定步骤已完成；
/// - 没有记录、部分记录或校验失败 → 先清理该 run 的受控目录和记录，再允许重放；
/// - 清理或事务任一步失败 → 保留 outcome_unknown，继续禁止新运行和本次恢复。
fn reconcile_unknown_steps(app: &AppHandle, run_id: &str) -> Result<(), String> {
    let root = artifact::artifact_root(app)?;
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let run = get_record(&conn, RUNS, run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
    let task_id = run["taskId"]
        .as_str()
        .ok_or_else(|| "运行缺少 taskId".to_string())?
        .to_string();
    for step in ordered_steps(&conn, run_id)? {
        if step["status"] != "outcome_unknown" {
            continue;
        }
        let step_id = value_id(&step);
        if step["key"] != "write" || step_id.is_empty() {
            return Err("存在无法自动协调的未知副作用，请检查运行记录".into());
        }
        let artifacts = related(&conn, ARTIFACTS, "runId", run_id)?;
        if let Ok(verified) = artifact::verify_artifacts(&root, &artifacts) {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for record in &verified {
                upsert_record(&tx, ARTIFACTS, record)?;
            }
            update_record(
                &tx,
                STEPS,
                &step_id,
                &[
                    ("status", json!("succeeded")),
                    (
                        "output",
                        json!({
                            "artifactIds": verified.iter().map(|record| record["id"].clone()).collect::<Vec<_>>(),
                            "reconciled": true,
                        }),
                    ),
                    ("error", Value::Null),
                ],
            )?;
            let event = append_event_conn(
                &tx,
                &task_id,
                run_id,
                "step_reconciled",
                "已验证未知结果，继续后续步骤",
                "Unknown outcome verified; continuing with later steps",
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            emit_event(app, &event);
            continue;
        }

        artifact::cleanup_run_output(&root, &task_id, run_id)
            .map_err(|error| format!("投递包结果未知且清理失败: {error}"))?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for record in &artifacts {
            let artifact_id = value_id(record);
            if !artifact_id.is_empty() {
                delete_record(&tx, ARTIFACTS, &artifact_id)?;
            }
        }
        update_record(
            &tx,
            STEPS,
            &step_id,
            &[
                ("status", json!("pending")),
                ("output", Value::Null),
                ("error", Value::Null),
            ],
        )?;
        let event = append_event_conn(
            &tx,
            &task_id,
            run_id,
            "step_reconciled_retry",
            "未知产物已清理，将重新执行写入步骤",
            "Unknown artifacts cleaned; the write step will be retried",
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        emit_event(app, &event);
    }
    Ok(())
}

fn persist_artifact_records_with_fault(
    conn: &mut rusqlite::Connection,
    records: &[Value],
    fail_record_at: Option<usize>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (index, record) in records.iter().enumerate() {
        if fail_record_at == Some(index + 1) {
            return Err(format!("故障注入：第 {} 条产物记录保存失败", index + 1));
        }
        upsert_record(&tx, ARTIFACTS, record)?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn persist_artifact_records(
    conn: &mut rusqlite::Connection,
    records: &[Value],
) -> Result<(), String> {
    persist_artifact_records_with_fault(conn, records, None)
}

fn related(
    conn: &rusqlite::Connection,
    collection: &str,
    field: &str,
    value: &str,
) -> Result<Vec<Value>, String> {
    Ok(list_records(conn, collection)?
        .into_iter()
        .filter(|row| row.get(field).and_then(Value::as_str) == Some(value))
        .collect())
}

fn ordered_steps(conn: &rusqlite::Connection, run_id: &str) -> Result<Vec<Value>, String> {
    let mut steps = related(conn, STEPS, "runId", run_id)?;
    steps.sort_by_key(|step| step["order"].as_u64().unwrap_or(u64::MAX));
    Ok(steps)
}

fn step_by_key(conn: &rusqlite::Connection, run_id: &str, key: &str) -> Result<Value, String> {
    ordered_steps(conn, run_id)?
        .into_iter()
        .find(|step| step["key"] == key)
        .ok_or_else(|| format!("运行缺少步骤: {key}"))
}

fn value_id(value: &Value) -> String {
    match value.get("id") {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
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

fn load_snapshot(conn: &rusqlite::Connection, task: &Value) -> Result<Value, String> {
    let inputs = task["inputs"]
        .as_object()
        .ok_or_else(|| "任务 inputs 损坏".to_string())?;
    let job_ids = string_list(inputs.get("jobIds"));
    let mut jobs = Vec::new();
    for id in job_ids {
        jobs.push(get_record(conn, "jobs", &id)?.ok_or_else(|| format!("输入岗位已不存在: {id}"))?);
    }
    let resume_id = inputs["resumeId"]
        .as_str()
        .ok_or_else(|| "任务缺少 resumeId".to_string())?;
    let resume = get_record(conn, "resumes", resume_id)?
        .ok_or_else(|| format!("输入简历已不存在: {resume_id}"))?;
    if !super::resume_has_professional_content(&resume) {
        return Err("输入简历没有有效职业资料，请先填写工作、项目、教育或专业能力".into());
    }
    let skills = list_records(conn, "skills")?;
    Ok(json!({ "jobs": jobs, "resume": resume, "skills": skills }))
}

fn analyze_snapshot(snapshot: &Value) -> Result<Value, String> {
    let jobs = snapshot["jobs"]
        .as_array()
        .filter(|jobs| !jobs.is_empty())
        .ok_or_else(|| "输入快照没有岗位".to_string())?;
    let levels: HashMap<String, f64> = snapshot["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|skill| {
            let name = skill["name"].as_str()?.trim().to_lowercase();
            let level = skill["lvl"].as_f64().unwrap_or(0.0).clamp(0.0, 5.0);
            (!name.is_empty()).then_some((name, level))
        })
        .collect();
    let mut scores = Vec::new();
    for (input_order, job) in jobs.iter().enumerate() {
        let needs = string_list(job.get("need"));
        let mut matched = Vec::new();
        let mut partial = Vec::new();
        let mut gaps = Vec::new();
        let mut credit = 0.0;
        for need in &needs {
            let level = levels.get(&need.to_lowercase()).copied().unwrap_or(0.0);
            if level >= 3.0 {
                matched.push(need.clone());
                credit += 1.0;
            } else if level >= 1.0 {
                partial.push(need.clone());
                gaps.push(need.clone());
                credit += 0.5;
            } else {
                gaps.push(need.clone());
            }
        }
        let score = if needs.is_empty() {
            job["match"].as_f64().unwrap_or(0.0).clamp(0.0, 10.0)
        } else {
            (credit / needs.len() as f64 * 100.0).round() / 10.0
        };
        scores.push(json!({
            "jobId": value_id(job),
            "score": score,
            "matched": matched,
            "partial": partial,
            "gaps": gaps,
            "inputOrder": input_order,
            "existingMatch": job["match"].as_f64().unwrap_or(0.0),
        }));
    }
    scores.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["score"].as_f64().unwrap_or(0.0))
            .then_with(|| {
                b["existingMatch"]
                    .as_f64()
                    .unwrap_or(0.0)
                    .total_cmp(&a["existingMatch"].as_f64().unwrap_or(0.0))
            })
            .then_with(|| {
                a["inputOrder"]
                    .as_u64()
                    .unwrap_or(u64::MAX)
                    .cmp(&b["inputOrder"].as_u64().unwrap_or(u64::MAX))
            })
    });
    let selected = scores[0]["jobId"]
        .as_str()
        .ok_or_else(|| "岗位记录缺少有效 id".to_string())?;
    Ok(json!({ "selectedJobId": selected, "scores": scores }))
}

enum StepOutcome {
    Done(Value),
    Cancelled,
}

async fn execute_step(
    app: &AppHandle,
    task: &Value,
    run_id: &str,
    step: &Value,
    token: &CancellationToken,
) -> Result<StepOutcome, String> {
    let key = step["key"].as_str().unwrap_or("");
    match key {
        "load" => {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            Ok(StepOutcome::Done(load_snapshot(&conn, task)?))
        }
        "analyze" => {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            let snapshot = step_by_key(&conn, run_id, "load")?["output"].clone();
            Ok(StepOutcome::Done(analyze_snapshot(&snapshot)?))
        }
        "generate" => {
            let (snapshot, analysis) = {
                let db = app.state::<Db>();
                let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
                (
                    step_by_key(&conn, run_id, "load")?["output"].clone(),
                    step_by_key(&conn, run_id, "analyze")?["output"].clone(),
                )
            };
            let selected = analysis["selectedJobId"].as_str().unwrap_or("");
            let job = snapshot["jobs"]
                .as_array()
                .and_then(|jobs| jobs.iter().find(|job| value_id(job) == selected))
                .ok_or_else(|| "推荐岗位不在输入快照中".to_string())?;
            let score = analysis["scores"]
                .as_array()
                .and_then(|scores| scores.iter().find(|score| score["jobId"] == selected))
                .ok_or_else(|| "推荐岗位缺少评分".to_string())?;
            let language = task["inputs"]["language"].as_str().unwrap_or("zh");
            let instruction = if language == "en" {
                "Create exactly five discriminating interview questions for the target role. Use only the role data below. Do not infer or mention candidate facts. Cover technical depth, system design, operations, tradeoffs, and one listed skill gap. Return one question per line with no heading or explanation."
            } else {
                "请为目标岗位生成恰好五个有区分度的面试问题。只使用下面的岗位数据，不推断或提及候选人事实。覆盖技术深度、系统设计、线上运维、方案权衡，并针对一个已列出的技能缺口。每行一个问题，不要标题和解释。"
            };
            let untrusted = json!({
                "company": job["co"],
                "role": job["role"],
                "requiredSkills": job["need"],
                "preferredSkills": job["plus"],
                "jobDescription": job["jd"],
                "skillGaps": score["gaps"],
            })
            .to_string();
            match generate_agent_text(
                app,
                &format!("agent_{run_id}_generate"),
                Some("interview"),
                instruction,
                Some(&untrusted),
                token.clone(),
            )
            .await?
            {
                AgentGenerateOutcome::Done(questions) if !questions.trim().is_empty() => {
                    Ok(StepOutcome::Done(json!({ "questions": questions.trim() })))
                }
                AgentGenerateOutcome::Done(_) => Err("模型没有生成可用的面试问题".into()),
                AgentGenerateOutcome::Cancelled => Ok(StepOutcome::Cancelled),
            }
        }
        "write" => {
            let (snapshot, analysis, questions) = {
                let db = app.state::<Db>();
                let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
                (
                    step_by_key(&conn, run_id, "load")?["output"].clone(),
                    step_by_key(&conn, run_id, "analyze")?["output"].clone(),
                    step_by_key(&conn, run_id, "generate")?["output"]["questions"]
                        .as_str()
                        .unwrap_or("")
                        .to_string(),
                )
            };
            let task_id = task["id"]
                .as_str()
                .ok_or_else(|| "任务缺少 id".to_string())?;
            let language = task["inputs"]["language"].as_str().unwrap_or("zh");
            let records = artifact::write_job_package(
                app,
                &artifact::PackageInput {
                    task_id,
                    run_id,
                    snapshot: &snapshot,
                    analysis: &analysis,
                    questions: &questions,
                    language,
                    now: now_ms(),
                },
            )?;
            let db = app.state::<Db>();
            let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            persist_artifact_records(&mut conn, &records)?;
            Ok(StepOutcome::Done(json!({
                "artifactIds": records.iter().map(|record| record["id"].clone()).collect::<Vec<_>>()
            })))
        }
        "verify" => {
            let task_id = task["id"]
                .as_str()
                .ok_or_else(|| "任务缺少 id".to_string())?;
            let records = {
                let db = app.state::<Db>();
                let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
                related(&conn, ARTIFACTS, "runId", run_id)?
                    .into_iter()
                    .filter(|record| record["taskId"] == task_id)
                    .collect::<Vec<_>>()
            };
            let verified = artifact::verify_artifacts(&artifact::artifact_root(app)?, &records)?;
            let db = app.state::<Db>();
            let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            persist_artifact_records(&mut conn, &verified)?;
            Ok(StepOutcome::Done(
                json!({ "verified": true, "count": verified.len() }),
            ))
        }
        _ => Err(format!("未知或未授权的工作流步骤: {key}")),
    }
}

fn settle_requested(
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
    step_id: Option<&str>,
    request: u8,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (status, kind, zh, en) = if request == REQUEST_CANCEL {
        ("cancelled", "run_cancelled", "任务已取消", "Task cancelled")
    } else {
        ("paused", "run_paused", "任务已暂停", "Task paused")
    };
    if let Some(step_id) = step_id {
        let step_status = if request == REQUEST_CANCEL {
            "cancelled"
        } else {
            "pending"
        };
        update_record(&tx, STEPS, step_id, &[("status", json!(step_status))])?;
    }
    update_record(&tx, RUNS, run_id, &[("status", json!(status))])?;
    update_record(&tx, TASKS, task_id, &[("status", json!(status))])?;
    let event = append_event_conn(&tx, task_id, run_id, kind, zh, en)?;
    tx.commit().map_err(|e| e.to_string())?;
    emit_event(app, &event);
    Ok(())
}

fn fail_run(
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
    step_id: &str,
    error: &str,
) -> Result<(), String> {
    let safe_error: String = error.chars().take(500).collect();
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    update_record(
        &tx,
        STEPS,
        step_id,
        &[
            ("status", json!("failed")),
            ("error", json!(safe_error.clone())),
        ],
    )?;
    update_record(
        &tx,
        RUNS,
        run_id,
        &[
            ("status", json!("failed")),
            ("error", json!(safe_error.clone())),
        ],
    )?;
    update_record(&tx, TASKS, task_id, &[("status", json!("failed"))])?;
    let event = append_event_conn(
        &tx,
        task_id,
        run_id,
        "run_failed",
        &format!("任务失败：{safe_error}"),
        &format!("Task failed: {safe_error}"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    emit_event(app, &event);
    Ok(())
}

fn mark_outcome_unknown(
    app: &AppHandle,
    task_id: &str,
    run_id: &str,
    step_id: &str,
    error: &str,
) -> Result<(), String> {
    let safe_error: String = error.chars().take(500).collect();
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    update_record(
        &tx,
        STEPS,
        step_id,
        &[
            ("status", json!("outcome_unknown")),
            ("error", json!(safe_error.clone())),
        ],
    )?;
    update_record(
        &tx,
        RUNS,
        run_id,
        &[
            ("status", json!("interrupted")),
            ("error", json!(safe_error.clone())),
        ],
    )?;
    update_record(&tx, TASKS, task_id, &[("status", json!("interrupted"))])?;
    let event = append_event_conn(
        &tx,
        task_id,
        run_id,
        "step_outcome_unknown",
        &format!("步骤产生副作用后结果未知：{safe_error}"),
        &format!("Step outcome is unknown after side effects: {safe_error}"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    emit_event(app, &event);
    Ok(())
}

fn converge_unhandled_failure_conn(
    conn: &mut rusqlite::Connection,
    run_id: &str,
    error: &str,
) -> Result<Option<Value>, String> {
    let run = get_record(conn, RUNS, run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
    if matches!(
        run["status"].as_str(),
        Some("succeeded" | "failed" | "cancelled")
    ) {
        return Ok(None);
    }
    let task_id = run["taskId"]
        .as_str()
        .ok_or_else(|| "运行缺少 taskId".to_string())?
        .to_string();
    let current_step_id = run["currentStepId"].as_str().unwrap_or("").to_string();
    let current_step = if current_step_id.is_empty() {
        None
    } else {
        get_record(conn, STEPS, &current_step_id)?
    };
    let uncertain = current_step.as_ref().is_some_and(|step| {
        step["status"] == "running" && step["effect"].as_str() != Some("read_only")
    });
    let safe_error: String = error.chars().take(500).collect();
    let terminal = if uncertain { "interrupted" } else { "failed" };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(step) = current_step {
        let step_id = value_id(&step);
        if !step_id.is_empty()
            && !matches!(step["status"].as_str(), Some("succeeded" | "cancelled"))
        {
            update_record(
                &tx,
                STEPS,
                &step_id,
                &[
                    (
                        "status",
                        json!(if uncertain {
                            "outcome_unknown"
                        } else {
                            "failed"
                        }),
                    ),
                    ("error", json!(safe_error.clone())),
                ],
            )?;
        }
    }
    update_record(
        &tx,
        RUNS,
        run_id,
        &[
            ("status", json!(terminal)),
            ("error", json!(safe_error.clone())),
        ],
    )?;
    if get_record(&tx, TASKS, &task_id)?.is_some() {
        update_record(&tx, TASKS, &task_id, &[("status", json!(terminal))])?;
    }
    let event = append_event_conn(
        &tx,
        &task_id,
        run_id,
        if uncertain {
            "run_interrupted"
        } else {
            "run_failed"
        },
        &format!("协调器异常，任务已收敛：{safe_error}"),
        &format!("Coordinator error; run converged: {safe_error}"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Some(event))
}

fn converge_unhandled_failure(app: &AppHandle, run_id: &str, error: &str) -> Result<(), String> {
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    if let Some(event) = converge_unhandled_failure_conn(&mut conn, run_id, error)? {
        emit_event(app, &event);
    }
    Ok(())
}

fn complete_run_conn(
    conn: &mut rusqlite::Connection,
    task_id: &str,
    run_id: &str,
) -> Result<Value, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    update_record(
        &tx,
        RUNS,
        run_id,
        &[
            ("status", json!("succeeded")),
            ("currentStepId", Value::Null),
            ("error", Value::Null),
        ],
    )?;
    update_record(&tx, TASKS, task_id, &[("status", json!("succeeded"))])?;
    let event = append_event_conn(
        &tx,
        task_id,
        run_id,
        "run_succeeded",
        "任务已完成并通过验证",
        "Task completed and verified",
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(event)
}

async fn execute_run(app: &AppHandle, run_id: &str, control: &RunControl) -> Result<(), String> {
    let (task_id, task) = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
        let run =
            get_record(&conn, RUNS, run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
        let task_id = run["taskId"]
            .as_str()
            .ok_or_else(|| "运行缺少 taskId".to_string())?
            .to_string();
        let task =
            get_record(&conn, TASKS, &task_id)?.ok_or_else(|| format!("任务不存在: {task_id}"))?;
        (task_id, task)
    };

    {
        let db = app.state::<Db>();
        let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
        let current = get_record(&conn, RUNS, run_id)?
            .and_then(|r| r["status"].as_str().map(ToString::to_string))
            .unwrap_or_default();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if current == "created" {
            update_record(&tx, RUNS, run_id, &[("status", json!("planning"))])?;
        }
        update_record(&tx, RUNS, run_id, &[("status", json!("running"))])?;
        update_record(&tx, TASKS, &task_id, &[("status", json!("running"))])?;
        let event = append_event_conn(
            &tx,
            &task_id,
            run_id,
            "run_started",
            "开始执行任务",
            "Task started",
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        emit_event(app, &event);
    }

    let steps = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
        ordered_steps(&conn, run_id)?
    };
    for original in steps {
        if control.requested() != REQUEST_NONE {
            settle_requested(app, &task_id, run_id, None, control.requested())?;
            return Ok(());
        }
        let step_id = original["id"]
            .as_str()
            .ok_or_else(|| "步骤缺少 id".to_string())?
            .to_string();
        let step = {
            let db = app.state::<Db>();
            let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            get_record(&conn, STEPS, &step_id)?.ok_or_else(|| "步骤不存在".to_string())?
        };
        match step["status"].as_str().unwrap_or("") {
            "succeeded" => continue,
            "outcome_unknown" => {
                return Err("步骤副作用结果未知，必须先完成协调".into());
            }
            "pending" | "failed" => {}
            other => {
                fail_run(
                    app,
                    &task_id,
                    run_id,
                    &step_id,
                    &format!("步骤处于不可执行状态: {other}"),
                )?;
                return Ok(());
            }
        }
        if step["attempt"].as_u64().unwrap_or(0) >= 2 {
            fail_run(
                app,
                &task_id,
                run_id,
                &step_id,
                "步骤已达到最多两次尝试，未继续自动重试",
            )?;
            return Ok(());
        }
        {
            let db = app.state::<Db>();
            let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
            let attempt = step["attempt"].as_u64().unwrap_or(0) + 1;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            let running = update_record(
                &tx,
                STEPS,
                &step_id,
                &[
                    ("status", json!("running")),
                    ("attempt", json!(attempt)),
                    ("error", Value::Null),
                ],
            )?;
            update_record(&tx, RUNS, run_id, &[("currentStepId", json!(step_id))])?;
            let event = append_event_conn(
                &tx,
                &task_id,
                run_id,
                "step_started",
                &format!("开始：{}", running["title"].as_str().unwrap_or("任务步骤")),
                &format!(
                    "Started: {}",
                    running["titleEn"].as_str().unwrap_or("task step")
                ),
            )?;
            tx.commit().map_err(|e| e.to_string())?;
            emit_event(app, &event);
        }

        match execute_step(app, &task, run_id, &step, &control.token).await {
            Ok(StepOutcome::Done(output)) => {
                let db = app.state::<Db>();
                let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                update_record(
                    &tx,
                    STEPS,
                    &step_id,
                    &[("status", json!("succeeded")), ("output", output)],
                )?;
                let event = append_event_conn(
                    &tx,
                    &task_id,
                    run_id,
                    "step_succeeded",
                    &format!("完成：{}", step["title"].as_str().unwrap_or("任务步骤")),
                    &format!(
                        "Completed: {}",
                        step["titleEn"].as_str().unwrap_or("task step")
                    ),
                )?;
                tx.commit().map_err(|e| e.to_string())?;
                emit_event(app, &event);
            }
            Ok(StepOutcome::Cancelled) => {
                settle_requested(app, &task_id, run_id, Some(&step_id), control.requested())?;
                return Ok(());
            }
            Err(error) => {
                if step["effect"] == "read_only" {
                    fail_run(app, &task_id, run_id, &step_id, &error)?;
                } else {
                    mark_outcome_unknown(app, &task_id, run_id, &step_id, &error)?;
                }
                return Ok(());
            }
        }
    }

    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let current_run =
        get_record(&conn, RUNS, run_id)?.ok_or_else(|| format!("运行不存在: {run_id}"))?;
    if current_run["status"] != "running" {
        return Ok(());
    }
    let verify = step_by_key(&conn, run_id, "verify")?;
    if verify["status"] != "succeeded" || verify["output"]["verified"] != true {
        drop(conn);
        fail_run(
            app,
            &task_id,
            run_id,
            verify["id"].as_str().unwrap_or(""),
            "产物验证没有通过",
        )?;
        return Ok(());
    }
    let artifacts = related(&conn, ARTIFACTS, "runId", run_id)?;
    if artifacts.len() != 4 || artifacts.iter().any(|record| record["verified"] != true) {
        drop(conn);
        fail_run(
            app,
            &task_id,
            run_id,
            verify["id"].as_str().unwrap_or(""),
            "产物可信状态不完整",
        )?;
        return Ok(());
    }
    if let Err(error) = artifact::verify_artifacts(&artifact::artifact_root(app)?, &artifacts) {
        drop(conn);
        fail_run(
            app,
            &task_id,
            run_id,
            verify["id"].as_str().unwrap_or(""),
            &format!("最终产物校验失败: {error}"),
        )?;
        return Ok(());
    }
    drop(conn);
    let db = app.state::<Db>();
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    let event = complete_run_conn(&mut conn, &task_id, run_id)?;
    emit_event(app, &event);
    Ok(())
}

/// 应用启动恢复：执行态改为 interrupted；正在执行的副作用步骤改为 outcome_unknown。
/// 不自动续跑，避免在用户不知情时重放动作。
pub fn recover_open_runs(conn: &rusqlite::Connection) -> Result<usize, String> {
    let mut recovered = 0;
    for run in list_records(conn, RUNS)? {
        if !matches!(run["status"].as_str(), Some("planning" | "running")) {
            continue;
        }
        let run_id = run["id"].as_str().unwrap_or("");
        let task_id = run["taskId"].as_str().unwrap_or("");
        if run_id.is_empty() || task_id.is_empty() {
            continue;
        }
        update_record(conn, RUNS, run_id, &[("status", json!("interrupted"))])?;
        if get_record(conn, TASKS, task_id)?.is_some() {
            update_record(conn, TASKS, task_id, &[("status", json!("interrupted"))])?;
        }
        for step in related(conn, STEPS, "runId", run_id)? {
            if step["status"] != "running" {
                continue;
            }
            let status = match step["effect"].as_str() {
                Some("read_only" | "external_draft") => "pending",
                _ => "outcome_unknown",
            };
            if let Some(step_id) = step["id"].as_str() {
                update_record(conn, STEPS, step_id, &[("status", json!(status))])?;
            }
        }
        append_event_conn(
            conn,
            task_id,
            run_id,
            "run_interrupted",
            "检测到上次运行中断，等待用户继续",
            "Previous run was interrupted; waiting for the user to resume",
        )?;
        recovered += 1;
    }
    Ok(recovered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE platform_agent_tasks (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
             CREATE TABLE platform_agent_runs (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
             CREATE TABLE platform_agent_steps (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
             CREATE TABLE platform_agent_artifacts (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
             CREATE TABLE platform_agent_events (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);",
        )
        .unwrap();
        conn
    }

    fn seed_running(conn: &rusqlite::Connection, effect: &str) {
        upsert_record(
            conn,
            TASKS,
            &json!({ "id": "task_1", "status": "running", "updatedAt": 1 }),
        )
        .unwrap();
        upsert_record(
            conn,
            RUNS,
            &json!({
                "id": "run_1", "taskId": "task_1", "status": "running",
                "currentStepId": "step_1", "updatedAt": 1
            }),
        )
        .unwrap();
        upsert_record(
            conn,
            STEPS,
            &json!({
                "id": "step_1", "taskId": "task_1", "runId": "run_1",
                "status": "running", "effect": effect, "updatedAt": 1
            }),
        )
        .unwrap();
    }

    #[test]
    fn fixed_workflow_has_bounded_ordered_effects() {
        let steps = fixed_steps("task_1", "run_1", 1);
        assert_eq!(steps.len(), 5);
        assert_eq!(steps[0]["key"], "load");
        assert_eq!(steps[4]["key"], "verify");
        assert_eq!(
            steps
                .iter()
                .filter(|s| s["effect"] == "local_create")
                .count(),
            1
        );
        assert!(steps
            .iter()
            .all(|s| s["effect"] == "read_only" || s["effect"] == "local_create"));
    }

    #[test]
    fn deterministic_match_uses_skill_levels_and_stable_tiebreaks() {
        let snapshot = json!({
            "jobs": [
                { "id": "j1", "need": ["Rust", "SQL"], "match": 9 },
                { "id": "j2", "need": ["Rust"], "match": 5 },
                { "id": "j3", "need": ["Go"], "match": 10 }
            ],
            "skills": [
                { "name": "Rust", "lvl": 4 },
                { "name": "SQL", "lvl": 2 },
                { "name": "Go", "lvl": 0 }
            ]
        });
        let analysis = analyze_snapshot(&snapshot).unwrap();
        assert_eq!(analysis["selectedJobId"], "j2");
        let scores = analysis["scores"].as_array().unwrap();
        assert_eq!(scores[0]["score"], 10.0);
        assert_eq!(scores[1]["jobId"], "j1");
        assert_eq!(scores[1]["score"], 7.5);
        assert_eq!(scores[1]["partial"], json!(["SQL"]));
        assert_eq!(scores[2]["gaps"], json!(["Go"]));
    }

    #[test]
    fn empty_job_snapshot_fails_closed() {
        assert!(analyze_snapshot(&json!({ "jobs": [], "skills": [] })).is_err());
        assert!(analyze_snapshot(&json!({})).is_err());
    }

    #[test]
    fn startup_recovery_marks_side_effect_outcome_unknown_without_replay() {
        let conn = agent_db();
        upsert_record(
            &conn,
            TASKS,
            &json!({ "id": "task_1", "status": "running", "updatedAt": 1 }),
        )
        .unwrap();
        upsert_record(
            &conn,
            RUNS,
            &json!({ "id": "run_1", "taskId": "task_1", "status": "running", "updatedAt": 1 }),
        )
        .unwrap();
        upsert_record(
            &conn,
            STEPS,
            &json!({ "id": "step_read", "runId": "run_1", "status": "running", "effect": "read_only", "updatedAt": 1 }),
        )
        .unwrap();
        upsert_record(
            &conn,
            STEPS,
            &json!({ "id": "step_write", "runId": "run_1", "status": "running", "effect": "local_create", "updatedAt": 1 }),
        )
        .unwrap();

        assert_eq!(recover_open_runs(&conn).unwrap(), 1);
        assert_eq!(
            get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
            "interrupted"
        );
        assert_eq!(
            get_record(&conn, TASKS, "task_1").unwrap().unwrap()["status"],
            "interrupted"
        );
        assert_eq!(
            get_record(&conn, STEPS, "step_read").unwrap().unwrap()["status"],
            "pending"
        );
        assert_eq!(
            get_record(&conn, STEPS, "step_write").unwrap().unwrap()["status"],
            "outcome_unknown"
        );
        assert_eq!(list_records(&conn, EVENTS).unwrap().len(), 1);
    }

    #[test]
    fn nth_artifact_record_failure_rolls_back_the_entire_batch() {
        for fail_at in 1..=4 {
            let mut conn = agent_db();
            let records = (1..=4)
                .map(|index| {
                    json!({
                        "id": format!("artifact_{index}"),
                        "taskId": "task_1",
                        "runId": "run_1",
                        "updatedAt": index,
                    })
                })
                .collect::<Vec<_>>();
            let error = persist_artifact_records_with_fault(&mut conn, &records, Some(fail_at))
                .unwrap_err();
            assert!(error.contains(&format!("第 {fail_at} 条")));
            assert!(list_records(&conn, ARTIFACTS).unwrap().is_empty());
        }
    }

    #[test]
    fn concurrent_resume_reservation_invokes_fake_provider_once() {
        use std::sync::{Arc, Barrier};

        let runs = Arc::new(AgentRuns::default());
        let barrier = Arc::new(Barrier::new(8));
        let provider_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let workers = (0..8)
            .map(|_| {
                let runs = Arc::clone(&runs);
                let barrier = Arc::clone(&barrier);
                let provider_calls = Arc::clone(&provider_calls);
                std::thread::spawn(move || {
                    barrier.wait();
                    if reserve_run(&runs, "run_1").is_ok() {
                        provider_calls.fetch_add(1, Ordering::SeqCst);
                    }
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(provider_calls.load(Ordering::SeqCst), 1);
        assert_eq!(runs.0.lock().unwrap().len(), 1);
    }

    #[test]
    fn failed_resume_initialization_releases_its_reservation() {
        let runs = AgentRuns::default();
        reserve_run(&runs, "run_1").unwrap();
        release_run(&runs, "run_1");
        assert!(reserve_run(&runs, "run_1").is_ok());
    }

    #[test]
    fn unhandled_side_effect_error_converges_to_unknown_in_one_transaction() {
        let mut conn = agent_db();
        seed_running(&conn, "local_create");
        let event = converge_unhandled_failure_conn(&mut conn, "run_1", "disk uncertain")
            .unwrap()
            .unwrap();
        assert_eq!(event["type"], "run_interrupted");
        assert_eq!(
            get_record(&conn, STEPS, "step_1").unwrap().unwrap()["status"],
            "outcome_unknown"
        );
        assert_eq!(
            get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
            "interrupted"
        );
        assert_eq!(
            get_record(&conn, TASKS, "task_1").unwrap().unwrap()["status"],
            "interrupted"
        );
        assert_eq!(list_records(&conn, EVENTS).unwrap().len(), 1);
    }

    #[test]
    fn state_or_event_save_failure_is_recovered_on_next_startup() {
        for trigger in [
            "CREATE TRIGGER fail_save BEFORE INSERT ON platform_agent_runs BEGIN SELECT RAISE(FAIL, 'state save failed'); END;",
            "CREATE TRIGGER fail_save BEFORE INSERT ON platform_agent_events BEGIN SELECT RAISE(FAIL, 'event save failed'); END;",
        ] {
            let mut conn = agent_db();
            seed_running(&conn, "read_only");
            conn.execute_batch(trigger).unwrap();
            assert!(converge_unhandled_failure_conn(&mut conn, "run_1", "boom").is_err());
            assert_eq!(
                get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
                "running"
            );
            conn.execute_batch("DROP TRIGGER fail_save;").unwrap();
            assert_eq!(recover_open_runs(&conn).unwrap(), 1);
            assert_eq!(
                get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
                "interrupted"
            );
        }
    }

    #[test]
    fn final_completion_failure_cannot_leave_a_false_success() {
        let mut conn = agent_db();
        seed_running(&conn, "read_only");
        conn.execute_batch(
            "CREATE TRIGGER fail_completion_event BEFORE INSERT ON platform_agent_events
             BEGIN SELECT RAISE(FAIL, 'completion event failed'); END;",
        )
        .unwrap();
        assert!(complete_run_conn(&mut conn, "task_1", "run_1").is_err());
        assert_eq!(
            get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
            "running"
        );
        assert_eq!(
            get_record(&conn, TASKS, "task_1").unwrap().unwrap()["status"],
            "running"
        );
        conn.execute_batch("DROP TRIGGER fail_completion_event;")
            .unwrap();
        converge_unhandled_failure_conn(&mut conn, "run_1", "completion failed").unwrap();
        assert_eq!(
            get_record(&conn, RUNS, "run_1").unwrap().unwrap()["status"],
            "failed"
        );
    }
}
