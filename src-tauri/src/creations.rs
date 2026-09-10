//! User-owned creations. No tools or model-readable collection; writes compare versions.
use crate::data::{self, Db};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

const INVALID: &str = "作品格式无效或内容过长 / Invalid or oversized creation";
const CONFLICT: &str =
    "作品已有新版本，请重新打开后再编辑 / Creation changed; reopen before editing";

fn draft_value(input: &Value) -> Result<Value, String> {
    let id = input["id"].as_str().ok_or(INVALID)?;
    let suffix = id.strip_prefix("cr_").ok_or(INVALID)?;
    let kind = input["kind"].as_str().ok_or(INVALID)?;
    let title = input["title"].as_str().ok_or(INVALID)?;
    let project = input["projectId"].as_str().ok_or(INVALID)?;
    if suffix.is_empty()
        || suffix.len() > 80
        || !suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        || ![
            "widget",
            "mindmap",
            "card",
            "comparison",
            "timeline",
            "style",
        ]
        .contains(&kind)
        || title.trim().is_empty()
        || title.chars().count() > 200
        || project.len() > 200
        || !input["deleted"].is_boolean()
        || ["content", "style", "source"]
            .iter()
            .any(|k| !input[k].is_object())
    {
        return Err(INVALID.into());
    }
    let draft = json!({"id":id,"kind":kind,"title":title,"projectId":project,
        "deleted":input["deleted"],"content":input["content"],"style":input["style"],"source":input["source"]});
    if draft.to_string().len() > 262_144 {
        return Err(INVALID.into());
    }
    if kind == "widget" {
        let html = draft["content"]["html"].as_str().ok_or(INVALID)?;
        if html.trim().is_empty() || html.len() > 65_536 {
            return Err(INVALID.into());
        }
    }
    Ok(draft)
}

fn save(conn: &mut Connection, input: Value, expected: u64) -> Result<Value, String> {
    let mut next = draft_value(&input)?;
    if expected >= 9_007_199_254_740_991 {
        return Err(CONFLICT.into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Strict read: corrupt JSON or a database error must never look like an absent record.
    let raw: Option<String> = tx
        .query_row(
            "SELECT data_json FROM platform_creations WHERE id = ?1",
            params![next["id"].as_str().ok_or(INVALID)?],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let prior: Option<Value> = raw
        .map(|r| serde_json::from_str(&r))
        .transpose()
        .map_err(|_| INVALID)?;
    let revision = match &prior {
        Some(p) => p["revision"].as_u64().ok_or(INVALID)?,
        None => 0,
    };
    if revision != expected {
        return Err(CONFLICT.into());
    }
    let now = data::now_ms();
    let mut history = Vec::new();
    let created = if let Some(p) = prior {
        if p["id"] != next["id"] || p["kind"] != next["kind"] {
            return Err(INVALID.into());
        }
        history = p["history"].as_array().cloned().ok_or(INVALID)?;
        let mut snapshot = draft_value(&p)?;
        snapshot["revision"] = p["revision"].clone();
        snapshot["updatedAt"] = p["updatedAt"].clone();
        history.push(snapshot);
        p["createdAt"].as_i64().ok_or(INVALID)?
    } else {
        now
    };
    if history.len() > 20 {
        history.drain(..history.len() - 20);
    }
    next["history"] = Value::Array(history);
    next["revision"] = json!(expected + 1);
    next["createdAt"] = json!(created);
    next["updatedAt"] = json!(now);
    if next.to_string().len() > 6_000_000 {
        return Err(INVALID.into());
    }
    data::upsert_record(&tx, "platform_creations", &next)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub fn creation_save(
    db: State<'_, Db>,
    draft: Value,
    expected_revision: u64,
) -> Result<Value, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    save(&mut conn, draft, expected_revision)
}

/// Imported styles may lack revision metadata. Recovery only changes the deletion flag and
/// compares the complete original JSON, so removal/undo cannot clobber a subsequent repair.
fn set_style_deleted(
    conn: &mut Connection,
    expected: Value,
    deleted: bool,
) -> Result<Value, String> {
    if expected["kind"] != "style" {
        return Err(INVALID.into());
    }
    let id = match &expected["id"] {
        Value::String(id) => id.clone(),
        Value::Number(id) => id.to_string(),
        _ => return Err(INVALID.into()),
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let raw: Option<String> = tx
        .query_row(
            "SELECT data_json FROM platform_creations WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let prior: Value = serde_json::from_str(&raw.ok_or(CONFLICT)?).map_err(|_| INVALID)?;
    if prior != expected {
        return Err("样式记录已变化，请重新打开设置 / Style changed; reopen settings".into());
    }
    let mut next = prior;
    next["deleted"] = json!(deleted);
    data::upsert_record(&tx, "platform_creations", &next)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub fn creation_style_set_deleted(
    db: State<'_, Db>,
    expected: Value,
    deleted: bool,
) -> Result<Value, String> {
    let mut conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    set_style_deleted(&mut conn, expected, deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE platform_creations(id TEXT PRIMARY KEY, updated_at INTEGER, data_json TEXT NOT NULL);").unwrap();
        c
    }
    fn draft() -> Value {
        json!({"id":"cr_test","kind":"widget","title":"作品","projectId":"","deleted":false,
            "content":{"html":"<h1>中文</h1>"},"style":{},"source":{}})
    }
    #[test]
    fn damaged_style_deletion_preserves_data_and_rejects_stale_snapshots() {
        let mut c = setup();
        let bad = json!({"id":"cr_bad_style","kind":"style","title":"损坏样式","deleted":false,"extra":{"keep":"原稿"}});
        data::upsert_record(&c, "platform_creations", &bad).unwrap();
        let removed = set_style_deleted(&mut c, bad.clone(), true).unwrap();
        let mut expected = bad.clone();
        expected["deleted"] = json!(true);
        assert_eq!(removed, expected);
        assert_eq!(
            set_style_deleted(&mut c, removed.clone(), false).unwrap(),
            bad
        );
        let mut repaired = bad.clone();
        repaired["title"] = json!("后来的修改");
        data::upsert_record(&c, "platform_creations", &repaired).unwrap();
        assert!(set_style_deleted(&mut c, removed, false).is_err());
        assert!(set_style_deleted(&mut c, bad, true).is_err());
        assert_eq!(
            data::get_record(&c, "platform_creations", "cr_bad_style")
                .unwrap()
                .unwrap(),
            repaired
        );
        let other = draft();
        data::upsert_record(&c, "platform_creations", &other).unwrap();
        assert!(set_style_deleted(&mut c, other.clone(), true).is_err());
        assert_eq!(
            data::get_record(&c, "platform_creations", "cr_test")
                .unwrap()
                .unwrap(),
            other
        );
    }
    #[test]
    fn damaged_style_failed_write_or_unreadable_prior_never_reports_success() {
        let mut c = setup();
        let bad = json!({"id":"cr_bad_style","kind":"style","deleted":false});
        data::upsert_record(&c, "platform_creations", &bad).unwrap();
        c.execute_batch("CREATE TRIGGER fail_style_write BEFORE INSERT ON platform_creations BEGIN SELECT RAISE(ABORT, 'cannot write'); END;").unwrap();
        assert!(set_style_deleted(&mut c, bad.clone(), true)
            .unwrap_err()
            .contains("cannot write"));
        assert_eq!(
            data::get_record(&c, "platform_creations", "cr_bad_style")
                .unwrap()
                .unwrap(),
            bad
        );
        c.execute_batch(
            "DROP TRIGGER fail_style_write; UPDATE platform_creations SET data_json='broken';",
        )
        .unwrap();
        assert!(set_style_deleted(&mut c, bad.clone(), true).is_err());
        c.execute_batch("DROP TABLE platform_creations;").unwrap();
        assert!(set_style_deleted(&mut c, bad, true).is_err());
    }
    #[test]
    fn edits_delete_restore_and_stale_writes() {
        let mut c = setup();
        let initial = save(&mut c, draft(), 0).unwrap();
        assert_eq!(initial["revision"], 1);
        assert!(save(&mut c, draft(), 0).unwrap_err().contains("changed"));
        let mut changed = draft();
        changed["title"] = json!("改名");
        let second = save(&mut c, changed.clone(), 1).unwrap();
        assert_eq!(second["history"][0]["title"], "作品");
        changed["deleted"] = json!(true);
        let deleted = save(&mut c, changed, 2).unwrap();
        assert!(deleted["deleted"].as_bool().unwrap());
        let restored = save(&mut c, second, 3).unwrap();
        assert_eq!(restored["title"], "改名");
        assert_eq!(restored["deleted"], false);
        assert_eq!(restored["createdAt"], initial["createdAt"]);
        assert!(save(&mut c, initial, 2).is_err());
    }
    #[test]
    fn bounded_versions_and_fail_closed_storage() {
        let mut c = setup();
        for i in 0..25 {
            save(&mut c, draft(), i).unwrap();
        }
        let last = data::get_record(&c, "platform_creations", "cr_test")
            .unwrap()
            .unwrap();
        assert_eq!(last["history"].as_array().unwrap().len(), 20);
        assert_eq!(last["history"][0]["revision"], 5);
        assert!(last["history"][0].get("history").is_none());
        let mut bad = draft();
        bad["content"]["html"] = json!("中".repeat(30_000));
        assert!(save(&mut c, bad, 25).is_err());
        c.execute("UPDATE platform_creations SET data_json='broken'", [])
            .unwrap();
        assert!(save(&mut c, draft(), 0).is_err());
        c.execute_batch("DROP TABLE platform_creations;").unwrap();
        assert!(save(&mut c, draft(), 0).is_err());
    }
}
