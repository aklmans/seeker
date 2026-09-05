//! 机会雷达的受控来源、候选校验、确定性评分与持久化。

use crate::data::{get_record, list_records, upsert_record};
use crate::mcp::{flatten_content, McpManager};
use async_trait::async_trait;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::{AppHandle, Manager, Runtime};
use tokio_util::sync::CancellationToken;

pub(super) const OPPORTUNITIES: &str = "job_opportunities";
const MAX_SOURCE_TEXT: usize = 64 * 1024;
const MAX_TOTAL_SOURCE_TEXT: usize = 256 * 1024;

#[async_trait]
pub(super) trait RadarSourceReader<R: Runtime>: Send + Sync {
    async fn read_url(
        &self,
        app: &AppHandle<R>,
        url: &str,
        token: CancellationToken,
    ) -> Result<String, String>;

    async fn search_mcp(
        &self,
        app: &AppHandle<R>,
        server: &str,
        tool: &str,
        query: &str,
        token: CancellationToken,
    ) -> Result<String, String>;
}

pub(super) struct ProductionRadarSource;

fn mcp_accepts_query_only(schema: &Value) -> bool {
    schema["type"] == "object"
        && schema["properties"]["query"]["type"] == "string"
        && schema["required"].as_array().map_or(true, |required| {
            required.iter().all(|field| field == "query")
        })
}

#[async_trait]
impl RadarSourceReader<tauri::Wry> for ProductionRadarSource {
    async fn read_url(
        &self,
        _app: &AppHandle,
        url: &str,
        token: CancellationToken,
    ) -> Result<String, String> {
        tokio::select! {
            _ = token.cancelled() => Err("机会来源读取已取消".into()),
            result = crate::web::fetch_guarded_for_radar(url) => result,
        }
    }

    async fn search_mcp(
        &self,
        app: &AppHandle,
        server: &str,
        tool: &str,
        query: &str,
        token: CancellationToken,
    ) -> Result<String, String> {
        let manager = app.state::<McpManager>();
        manager.ensure_named_connected(app, server).await?;
        let descriptor = manager
            .tool_descriptors()
            .await
            .into_iter()
            .find(|candidate| candidate.server == server && candidate.tool == tool)
            .ok_or_else(|| format!("机会来源 MCP 工具未连接或不存在: {server}/{tool}"))?;
        // readOnlyHint 是 MCP 服务端自报提示，不作授权。能到达此处的工具必须已在
        // TaskSpec 中由用户精确选定，且调度入口会在 Rust 核拒绝所有 MCP 来源。
        if !mcp_accepts_query_only(&descriptor.input_schema) {
            return Err(format!(
                "机会雷达 MCP 工具必须只依赖字符串 query 参数: {server}/{tool}"
            ));
        }
        tokio::select! {
            _ = token.cancelled() => Err("机会来源搜索已取消".into()),
            result = manager.call(server, tool, json!({ "query": query })) => {
                let raw = result?;
                if raw["isError"] == true {
                    return Err(format!("机会来源 MCP 工具返回错误: {server}/{tool}"));
                }
                Ok(flatten_content(&raw))
            }
        }
    }
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn bounded_text(value: Option<&Value>, max: usize) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

fn truncate_source(text: String) -> String {
    text.chars().take(MAX_SOURCE_TEXT).collect()
}

pub(super) fn load_snapshot(task: &Value) -> Result<Value, String> {
    let inputs = task["inputs"]
        .as_object()
        .ok_or_else(|| "机会雷达 inputs 损坏".to_string())?;
    // 任务记录可能来自旧备份或被直接修改；每次执行都重新走同一白名单，避免把新增字段、
    // profile 片段或放大的预算带入外部查询/模型上下文。
    super::normalize_radar_inputs(inputs)
}

pub(super) fn build_queries(snapshot: &Value) -> Vec<String> {
    let criteria = &snapshot["criteria"];
    let locations = strings(&criteria["locations"]);
    let skills = strings(&criteria["requiredSkills"]);
    let seniority = strings(&criteria["seniority"]);
    let remote = criteria["remotePreference"].as_str().unwrap_or("any");
    let suffix = [
        seniority.first().cloned().unwrap_or_default(),
        locations.first().cloned().unwrap_or_default(),
        if remote != "any" {
            remote.to_string()
        } else {
            String::new()
        },
        skills.into_iter().take(3).collect::<Vec<_>>().join(" "),
        "jobs careers".into(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    let max = snapshot["limits"]["maxQueries"].as_u64().unwrap_or(4) as usize;
    strings(&criteria["roles"])
        .into_iter()
        .take(max.min(4))
        .map(|role| format!("{role} {suffix}"))
        .collect()
}

pub(super) async fn discover<R: Runtime, S: RadarSourceReader<R>, F>(
    app: &AppHandle<R>,
    snapshot: &Value,
    source_reader: &S,
    token: &CancellationToken,
    reserve_source_call: &F,
) -> Result<Value, String>
where
    F: Fn() -> Result<bool, String> + Sync,
{
    let queries = build_queries(snapshot);
    let sources = snapshot["sources"]
        .as_array()
        .ok_or_else(|| "机会来源快照损坏".to_string())?;
    let max_sources = snapshot["limits"]["maxSources"].as_u64().unwrap_or(8) as usize;
    let max_calls = snapshot["limits"]["maxSourceCalls"].as_u64().unwrap_or(12) as usize;
    let mut calls = 0usize;
    let mut total = 0usize;
    let mut results = Vec::new();
    for (source_index, source) in sources.iter().take(max_sources.min(8)).enumerate() {
        if calls >= max_calls || total >= MAX_TOTAL_SOURCE_TEXT {
            break;
        }
        match source["kind"].as_str() {
            Some("url") => {
                let url = source["url"].as_str().ok_or("URL 来源缺少 url")?;
                if !reserve_source_call()? {
                    break;
                }
                let content = source_reader.read_url(app, url, token.clone()).await?;
                let content = truncate_source(content);
                total += content.len();
                calls += 1;
                results.push(json!({
                    "sourceIndex": source_index,
                    "kind": "url",
                    "sourceUrl": url,
                    "query": Value::Null,
                    "content": format!("Source URL: {url}\n{content}"),
                }));
            }
            Some("mcp") => {
                if source["authorization"] != "user_selected_exact_tool" {
                    return Err("MCP 来源缺少用户对精确工具的明确授权".into());
                }
                let server = source["server"].as_str().ok_or("MCP 来源缺少 server")?;
                let tool = source["tool"].as_str().ok_or("MCP 来源缺少 tool")?;
                for query in &queries {
                    if calls >= max_calls || total >= MAX_TOTAL_SOURCE_TEXT {
                        break;
                    }
                    if !reserve_source_call()? {
                        break;
                    }
                    let content = source_reader
                        .search_mcp(app, server, tool, query, token.clone())
                        .await?;
                    let content = truncate_source(content);
                    total += content.len();
                    calls += 1;
                    results.push(json!({
                        "sourceIndex": source_index,
                        "kind": "mcp",
                        "server": server,
                        "tool": tool,
                        "query": query,
                        "content": content,
                    }));
                }
            }
            _ => return Err("机会来源类型在执行前已失效".into()),
        }
    }
    Ok(json!({ "queries": queries, "calls": calls, "results": results }))
}

fn extract_json_object(text: &str) -> Result<Value, String> {
    let start = text.find('{').ok_or("模型结果不含 JSON 对象")?;
    let end = text.rfind('}').ok_or("模型结果 JSON 未闭合")?;
    serde_json::from_str(&text[start..=end]).map_err(|error| format!("候选 JSON 无效: {error}"))
}

fn canonical_url(raw: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(raw).map_err(|_| format!("候选 URL 无效: {raw}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("候选 URL 仅支持 http/https".into());
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

fn content_has_exact_url(content: &str, expected: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    for prefix in ["http://", "https://"] {
        for (start, _) in lower.match_indices(prefix) {
            let tail = &content[start..];
            let end = tail
                .find(|ch: char| ch.is_whitespace() || "\"'<>{}[]()".contains(ch))
                .unwrap_or(tail.len());
            let raw = tail[..end].trim_end_matches(['.', ',', ';', '!']);
            if canonical_url(raw).is_ok_and(|url| url == expected) {
                return true;
            }
        }
    }
    false
}

pub(super) fn normalize_candidates(
    model_text: &str,
    discovered: &Value,
    max_results: usize,
) -> Result<Value, String> {
    let parsed = extract_json_object(model_text)?;
    let candidates = parsed["candidates"]
        .as_array()
        .ok_or("候选 JSON 缺少 candidates 数组")?;
    let results = discovered["results"].as_array().ok_or("原始来源结果损坏")?;
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    let mut rejected = 0usize;
    for candidate in candidates.iter().take(max_results.min(40)) {
        let Some(source_index) = candidate["sourceIndex"].as_u64().map(|v| v as usize) else {
            rejected += 1;
            continue;
        };
        let raw_url = candidate["url"].as_str().unwrap_or("").trim();
        let Ok(url) = canonical_url(raw_url) else {
            rejected += 1;
            continue;
        };
        let matching_result = results.iter().find(|result| {
            result["sourceIndex"].as_u64() == Some(source_index as u64)
                && (result["content"]
                    .as_str()
                    .is_some_and(|content| content_has_exact_url(content, &url))
                    || result["sourceUrl"]
                        .as_str()
                        .and_then(|source_url| canonical_url(source_url).ok())
                        .is_some_and(|source_url| source_url == url))
        });
        let Some(result) = matching_result else {
            rejected += 1;
            continue;
        };
        if !seen.insert(url.clone()) {
            continue;
        }
        let company = bounded_text(candidate.get("company"), 120);
        let role = bounded_text(candidate.get("role"), 120);
        let skills = strings(&candidate["requiredSkills"])
            .into_iter()
            .take(16)
            .map(|value| value.chars().take(80).collect::<String>())
            .collect::<Vec<_>>();
        let summary = bounded_text(candidate.get("summary"), 600);
        if company.is_empty() || role.is_empty() || (skills.is_empty() && summary.is_empty()) {
            rejected += 1;
            continue;
        }
        normalized.push(json!({
            "url": url,
            "title": bounded_text(candidate.get("title"), 160),
            "company": company,
            "role": role,
            "seniority": bounded_text(candidate.get("seniority"), 80),
            "location": bounded_text(candidate.get("location"), 120),
            "remote": bounded_text(candidate.get("remote"), 40),
            "requiredSkills": skills,
            "summary": summary,
            "sourceIndex": source_index,
            "sourceKind": result["kind"],
            "sourceServer": result["server"],
            "sourceTool": result["tool"],
            "sourceQuery": result["query"],
        }));
    }
    Ok(json!({ "candidates": normalized, "rejectedByProvenance": rejected }))
}

pub(super) async fn verify_candidates<R: Runtime, S: RadarSourceReader<R>, F>(
    app: &AppHandle<R>,
    normalized: &Value,
    source_reader: &S,
    token: &CancellationToken,
    reserve_source_call: &F,
) -> Result<Value, String>
where
    F: Fn() -> Result<bool, String> + Sync,
{
    let mut verified = Vec::new();
    let mut rejected = Vec::new();
    for candidate in normalized["candidates"].as_array().into_iter().flatten() {
        let url = candidate["url"].as_str().unwrap_or("");
        if !reserve_source_call()? {
            rejected.push(json!({ "url": url, "error": "运行来源调用预算已用尽" }));
            continue;
        }
        match source_reader.read_url(app, url, token.clone()).await {
            Ok(text) if !text.trim().is_empty() => verified.push(candidate.clone()),
            Ok(_) => rejected.push(json!({ "url": url, "error": "来源正文为空" })),
            Err(error) => rejected
                .push(json!({ "url": url, "error": error.chars().take(300).collect::<String>() })),
        }
    }
    Ok(json!({ "candidates": verified, "rejected": rejected }))
}

fn contains_folded(haystack: &str, needle: &str) -> bool {
    !needle.trim().is_empty()
        && haystack
            .to_lowercase()
            .contains(&needle.trim().to_lowercase())
}

fn score(candidate: &Value, criteria: &Value) -> Option<(f64, Vec<String>)> {
    let role_text = format!(
        "{} {}",
        candidate["title"].as_str().unwrap_or(""),
        candidate["role"].as_str().unwrap_or("")
    );
    let candidate_seniority = candidate["seniority"].as_str().unwrap_or("").trim();
    let seniority_text = if candidate_seniority.is_empty() {
        role_text.clone()
    } else {
        candidate_seniority.to_string()
    };
    let location_text = format!(
        "{} {}",
        candidate["location"].as_str().unwrap_or(""),
        candidate["remote"].as_str().unwrap_or("")
    );
    let candidate_remote = candidate["remote"].as_str().unwrap_or("").trim();
    let remote_text = if candidate_remote.is_empty() {
        candidate["location"].as_str().unwrap_or("")
    } else {
        candidate_remote
    };
    let searchable = format!(
        "{} {} {} {} {} {}",
        candidate["title"].as_str().unwrap_or(""),
        candidate["company"].as_str().unwrap_or(""),
        candidate["role"].as_str().unwrap_or(""),
        candidate["location"].as_str().unwrap_or(""),
        candidate["summary"].as_str().unwrap_or(""),
        strings(&candidate["requiredSkills"]).join(" ")
    );
    if strings(&criteria["excludedKeywords"])
        .iter()
        .any(|word| contains_folded(&searchable, word))
    {
        return None;
    }
    let roles = strings(&criteria["roles"]);
    let matched_role = roles
        .iter()
        .find(|role| contains_folded(&role_text, role))?;
    let seniority = strings(&criteria["seniority"]);
    if !seniority.is_empty()
        && !seniority
            .iter()
            .any(|level| contains_folded(&seniority_text, level))
    {
        return None;
    }
    let skills = strings(&criteria["requiredSkills"]);
    if !skills
        .iter()
        .all(|skill| contains_folded(&searchable, skill))
    {
        return None;
    }
    let locations = strings(&criteria["locations"]);
    if !locations.is_empty()
        && !locations
            .iter()
            .any(|location| contains_folded(&location_text, location))
    {
        return None;
    }
    let remote = criteria["remotePreference"].as_str().unwrap_or("any");
    if remote != "any" && !contains_folded(remote_text, remote) {
        return None;
    }
    let mut points = 0.0;
    let mut reasons = Vec::new();
    points += 40.0;
    reasons.push(format!("role:{matched_role}"));
    if let Some(level) = seniority
        .iter()
        .find(|level| contains_folded(&seniority_text, level))
    {
        reasons.push(format!("seniority:{level}"));
    }
    if !skills.is_empty() {
        let matched = skills
            .iter()
            .filter(|skill| contains_folded(&searchable, skill))
            .count();
        points += 30.0 * matched as f64 / skills.len() as f64;
        reasons.push(format!("skills:{matched}/{}", skills.len()));
    }
    if locations.is_empty()
        || locations
            .iter()
            .any(|location| contains_folded(&searchable, location))
    {
        points += 10.0;
    }
    if remote == "any" || contains_folded(remote_text, remote) {
        points += 10.0;
    }
    if let Some(company) = strings(&criteria["watchedCompanies"])
        .iter()
        .find(|company| contains_folded(&searchable, company))
    {
        points += 10.0;
        reasons.push(format!("watched:{company}"));
    }
    Some(((points * 10.0).round() / 10.0, reasons))
}

pub(super) fn opportunity_id(url: &str) -> (String, String) {
    let dedupe = format!("{:x}", Sha256::digest(url.as_bytes()));
    (format!("opportunity_{}", &dedupe[..20]), dedupe)
}

fn verification_fingerprint(record: &Value) -> Result<String, String> {
    let trusted_fields = json!({
        "id": record["id"],
        "dedupeKey": record["dedupeKey"],
        "title": record["title"],
        "company": record["company"],
        "role": record["role"],
        "seniority": record["seniority"],
        "location": record["location"],
        "remote": record["remote"],
        "requiredSkills": record["requiredSkills"],
        "summary": record["summary"],
        "url": record["url"],
        "matchScore": record["matchScore"],
        "scoreReasons": record["scoreReasons"],
        "source": record["source"],
        "taskId": record["taskId"],
        "lastRunId": record["lastRunId"],
        "firstObservedAt": record["firstObservedAt"],
        "observedAt": record["observedAt"],
        "sourceVerified": record["sourceVerified"],
        "sourceVerifiedAt": record["sourceVerifiedAt"],
    });
    let encoded = serde_json::to_vec(&trusted_fields).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

pub(super) fn persist_verification_receipt(
    conn: &rusqlite::Connection,
    record: &Value,
) -> Result<(), String> {
    let opportunity_id = record["id"].as_str().ok_or("机会验证缺少 id")?;
    let task_id = record["taskId"].as_str().ok_or("机会验证缺少 taskId")?;
    let run_id = record["lastRunId"]
        .as_str()
        .ok_or("机会验证缺少 lastRunId")?;
    let dedupe_key = record["dedupeKey"]
        .as_str()
        .ok_or("机会验证缺少 dedupeKey")?;
    let url = record["url"].as_str().ok_or("机会验证缺少 URL")?;
    let verified_at = record["sourceVerifiedAt"]
        .as_i64()
        .ok_or("机会验证缺少时间")?;
    let fingerprint = verification_fingerprint(record)?;
    conn.execute(
        "INSERT OR REPLACE INTO opportunity_verifications
         (opportunity_id, task_id, run_id, dedupe_key, url, fingerprint, verified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            opportunity_id,
            task_id,
            run_id,
            dedupe_key,
            url,
            fingerprint,
            verified_at
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn verification_receipt_matches(
    conn: &rusqlite::Connection,
    record: &Value,
) -> Result<bool, String> {
    let Some(opportunity_record_id) = record["id"].as_str() else {
        return Ok(false);
    };
    let Some(record_url) = record["url"].as_str() else {
        return Ok(false);
    };
    let (_, expected_dedupe_key) = opportunity_id(record_url);
    let receipt = conn
        .query_row(
            "SELECT task_id, run_id, dedupe_key, url, fingerprint, verified_at
             FROM opportunity_verifications WHERE opportunity_id = ?1",
            params![opportunity_record_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((task_id, run_id, dedupe_key, url, fingerprint, verified_at)) = receipt else {
        return Ok(false);
    };
    Ok(record["sourceVerified"] == true
        && record["taskId"].as_str() == Some(task_id.as_str())
        && record["lastRunId"].as_str() == Some(run_id.as_str())
        && record["dedupeKey"].as_str() == Some(dedupe_key.as_str())
        && dedupe_key == expected_dedupe_key
        && record["url"].as_str() == Some(url.as_str())
        && record["sourceVerifiedAt"].as_i64() == Some(verified_at)
        && verification_fingerprint(record)? == fingerprint)
}

pub(super) fn rank_and_save(
    conn: &mut rusqlite::Connection,
    task_id: &str,
    run_id: &str,
    criteria: &Value,
    verified: &Value,
    now: i64,
) -> Result<Vec<Value>, String> {
    let mut records = Vec::new();
    for candidate in verified["candidates"].as_array().into_iter().flatten() {
        let Some((match_score, score_reasons)) = score(candidate, criteria) else {
            continue;
        };
        let url = candidate["url"].as_str().ok_or("候选缺少 URL")?;
        let (id, dedupe_key) = opportunity_id(url);
        let existing = get_record(conn, OPPORTUNITIES, &id)?;
        let first_observed = existing
            .as_ref()
            .and_then(|record| record["firstObservedAt"].as_i64())
            .unwrap_or(now);
        let status = existing
            .as_ref()
            .and_then(|record| record["status"].as_str())
            .filter(|status| {
                matches!(
                    *status,
                    "new" | "reviewed" | "accepted" | "dismissed" | "stale"
                )
            })
            .unwrap_or("new");
        let mut record = json!({
            "id": id,
            "dedupeKey": dedupe_key,
            "status": status,
            "title": candidate["title"],
            "company": candidate["company"],
            "role": candidate["role"],
            "seniority": candidate["seniority"],
            "location": candidate["location"],
            "remote": candidate["remote"],
            "requiredSkills": candidate["requiredSkills"],
            "summary": candidate["summary"],
            "url": url,
            "sourceVerified": true,
            "sourceVerifiedAt": now,
            "matchScore": match_score,
            "scoreReasons": score_reasons,
            "source": {
                "kind": candidate["sourceKind"],
                "server": candidate["sourceServer"],
                "tool": candidate["sourceTool"],
                "query": candidate["sourceQuery"],
            },
            "taskId": task_id,
            "lastRunId": run_id,
            "firstObservedAt": first_observed,
            "observedAt": now,
            "updatedAt": now,
        });
        if let Some(existing) = existing.as_ref() {
            for field in ["jobId", "acceptedAt"] {
                if let Some(value) = existing.get(field) {
                    record[field] = value.clone();
                }
            }
        }
        records.push(record);
    }
    records.sort_by(|a, b| {
        b["matchScore"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["matchScore"].as_f64().unwrap_or(0.0))
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    for record in &records {
        upsert_record(&tx, OPPORTUNITIES, record)?;
        persist_verification_receipt(&tx, record)?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(records)
}

pub(super) fn records_for_run(
    conn: &rusqlite::Connection,
    run_id: &str,
) -> Result<Vec<Value>, String> {
    let mut records = list_records(conn, OPPORTUNITIES)?
        .into_iter()
        .filter(|record| record["lastRunId"] == run_id)
        .collect::<Vec<_>>();
    records.sort_by(|a, b| {
        b["matchScore"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["matchScore"].as_f64().unwrap_or(0.0))
    });
    Ok(records)
}

pub(super) fn report_markdown(records: &[Value], rejected: usize, language: &str) -> Vec<u8> {
    let mut out = if language == "en" {
        "# Opportunity radar report\n\n".to_string()
    } else {
        "# 机会雷达报告\n\n".to_string()
    };
    if records.is_empty() {
        out.push_str(if language == "en" {
            "No valid opportunities were found in this run.\n"
        } else {
            "本次运行未发现有效机会。\n"
        });
    } else {
        for (index, record) in records.iter().enumerate() {
            out.push_str(&format!(
                "## {}. {} · {}\n\n- {}: {:.1}\n- URL: {}\n- {}: {}\n\n{}\n\n",
                index + 1,
                record["company"].as_str().unwrap_or("—"),
                record["role"]
                    .as_str()
                    .unwrap_or(record["title"].as_str().unwrap_or("—")),
                if language == "en" {
                    "Match"
                } else {
                    "匹配分"
                },
                record["matchScore"].as_f64().unwrap_or(0.0),
                record["url"].as_str().unwrap_or(""),
                if language == "en" {
                    "Location"
                } else {
                    "地点"
                },
                record["location"].as_str().unwrap_or("—"),
                record["summary"].as_str().unwrap_or("")
            ));
        }
    }
    out.push_str(&format!(
        "---\n{}: {rejected}\n",
        if language == "en" {
            "Rejected or unverifiable results"
        } else {
            "已拒绝或无法验证的结果"
        }
    ));
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_candidates_require_exact_provenance_and_are_deduplicated() {
        let discovered = json!({ "results": [
            { "sourceIndex": 0, "kind": "mcp", "content": "Backend https://jobs.example.com/1" }
        ]});
        let result = normalize_candidates(
            r#"{"candidates":[
              {"sourceIndex":0,"url":"https://jobs.example.com/1","company":"Acme","role":"Backend","summary":"Build systems"},
              {"sourceIndex":0,"url":"https://jobs.example.com/1","company":"Acme","role":"Duplicate","summary":"Build systems"},
              {"sourceIndex":0,"url":"https://invented.example/2","company":"Bad","role":"Invented","summary":"Not sourced"}
            ]}"#,
            &discovered,
            40,
        )
        .unwrap();
        assert_eq!(result["candidates"].as_array().unwrap().len(), 1);
        assert_eq!(result["rejectedByProvenance"], 1);
    }

    #[test]
    fn provenance_does_not_accept_a_candidate_url_as_another_urls_prefix() {
        let discovered = json!({ "results": [
            { "sourceIndex": 0, "kind": "mcp", "content": "https://jobs.example.com/1-evil" }
        ]});
        let result = normalize_candidates(
            r#"{"candidates":[{"sourceIndex":0,"url":"https://jobs.example.com/1","company":"Acme","role":"Backend","summary":"Build systems"}]}"#,
            &discovered,
            40,
        )
        .unwrap();
        assert!(result["candidates"].as_array().unwrap().is_empty());
        assert_eq!(result["rejectedByProvenance"], 1);
    }

    #[test]
    fn mcp_search_schema_must_be_callable_with_query_alone() {
        assert!(mcp_accepts_query_only(&json!({
            "type": "object", "properties": { "query": { "type": "string" } },
            "required": ["query"]
        })));
        assert!(!mcp_accepts_query_only(&json!({
            "type": "object", "properties": { "query": { "type": "string" }, "token": { "type": "string" } },
            "required": ["query", "token"]
        })));
        assert!(!mcp_accepts_query_only(&json!({
            "type": "object", "properties": { "query": { "type": "number" } }
        })));
    }

    #[test]
    fn execution_snapshot_reapplies_the_input_whitelist_and_budgets() {
        let snapshot = load_snapshot(&json!({
            "inputs": {
                "criteria": {
                    "roles": ["Backend Engineer"],
                    "privateProfile": "PROFILE_SECRET"
                },
                "sources": [{ "kind": "url", "url": "https://jobs.example.com/careers", "headers": { "Authorization": "secret" } }],
                "limits": { "maxQueries": 999, "maxSources": 999, "maxSourceCalls": 999, "maxResults": 999 },
                "profile": { "email": "private@example.com" }
            }
        }))
        .unwrap();
        assert_eq!(snapshot["limits"]["maxQueries"], 4);
        assert_eq!(snapshot["limits"]["maxSources"], 8);
        assert_eq!(snapshot["limits"]["maxSourceCalls"], 12);
        assert_eq!(snapshot["limits"]["maxResults"], 40);
        assert_eq!(
            snapshot["sources"][0],
            json!({
                "kind": "url", "url": "https://jobs.example.com/careers"
            })
        );
        assert!(!snapshot.to_string().contains("PROFILE_SECRET"));
        assert!(!snapshot.to_string().contains("private@example.com"));
        assert!(!snapshot.to_string().contains("Authorization"));
    }

    #[test]
    fn deterministic_score_filters_excluded_terms_and_preserves_user_status() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE job_opportunities (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
             CREATE TABLE opportunity_verifications (opportunity_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL, dedupe_key TEXT NOT NULL, url TEXT NOT NULL, fingerprint TEXT NOT NULL, verified_at INTEGER NOT NULL);",
        )
        .unwrap();
        let criteria = json!({
            "roles": ["Backend Engineer"], "locations": ["Remote"],
            "remotePreference": "remote", "requiredSkills": ["Rust", "SQL"],
            "excludedKeywords": ["unpaid"], "watchedCompanies": ["Acme"]
        });
        let verified = json!({ "candidates": [
            { "url":"https://jobs.example.com/1", "title":"Backend Engineer", "company":"Acme", "role":"Backend Engineer", "location":"Remote", "remote":"remote", "requiredSkills":["Rust","SQL"], "summary":"Build systems" },
            { "url":"https://jobs.example.com/2", "title":"Backend Engineer", "company":"Other", "role":"Backend Engineer", "location":"Remote", "remote":"remote", "requiredSkills":["Rust"], "summary":"Unpaid role" }
        ]});
        let first = rank_and_save(&mut conn, "task", "run1", &criteria, &verified, 10).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0]["matchScore"], 100.0);
        let id = first[0]["id"].as_str().unwrap();
        let mut reviewed = get_record(&conn, OPPORTUNITIES, id).unwrap().unwrap();
        reviewed["status"] = json!("dismissed");
        upsert_record(&conn, OPPORTUNITIES, &reviewed).unwrap();
        let rerun = rank_and_save(&mut conn, "task", "run2", &criteria, &verified, 20).unwrap();
        assert_eq!(rerun[0]["status"], "dismissed");
        assert_eq!(rerun[0]["firstObservedAt"], 10);
        assert_eq!(list_records(&conn, OPPORTUNITIES).unwrap().len(), 1);
    }

    #[test]
    fn role_seniority_location_remote_and_skills_are_hard_filters_for_every_source_kind() {
        let criteria = json!({
            "roles": ["Backend Engineer"],
            "seniority": ["Senior"],
            "locations": ["Remote"],
            "remotePreference": "remote",
            "requiredSkills": ["Rust", "SQL"]
        });
        let base = json!({
            "title": "Senior Backend Engineer",
            "company": "Acme",
            "role": "Backend Engineer",
            "seniority": "Senior",
            "location": "Remote",
            "remote": "remote",
            "requiredSkills": ["Rust", "SQL"],
            "summary": "Build reliable systems"
        });
        for kind in ["url", "mcp"] {
            let mut candidate = base.clone();
            candidate["sourceKind"] = json!(kind);
            assert!(score(&candidate, &criteria).is_some(), "{kind}");
        }
        for kind in ["url", "mcp"] {
            for (field, value) in [
                ("title", json!("Senior Product Designer")),
                ("role", json!("Product Designer")),
                ("seniority", json!("Junior")),
                ("location", json!("Berlin")),
                ("remote", json!("onsite")),
                ("requiredSkills", json!(["Rust"])),
            ] {
                let mut candidate = base.clone();
                candidate["sourceKind"] = json!(kind);
                candidate[field] = value;
                if field == "title" || field == "role" {
                    candidate["title"] = json!("Senior Product Designer");
                    candidate["role"] = json!("Product Designer");
                }
                if field == "location" {
                    candidate["remote"] = json!("onsite");
                }
                assert!(score(&candidate, &criteria).is_none(), "{kind}/{field}");
            }
        }
    }

    #[test]
    fn empty_report_is_explicit_not_false_success() {
        let text = String::from_utf8(report_markdown(&[], 3, "zh")).unwrap();
        assert!(text.contains("未发现有效机会"));
        assert!(text.contains("已拒绝或无法验证的结果: 3"));
    }
}
