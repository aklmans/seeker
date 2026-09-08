//! Persisted conversation history. Only complete turns from the selected conversation
//! become canonical user/assistant messages; the collection is never AI-queryable.
use rusqlite::Connection;
use serde_json::{json, Value};

fn string<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn history(conn: &Connection, id: &str) -> Result<Vec<Value>, String> {
    let conversation = crate::data::get_record(conn, "platform_conversations", id)?
        .ok_or("Conversation not found / 找不到对话，请重新选择")?;
    let rows = crate::data::list_records(conn, "messages")?;
    Ok(completed_turns(rows, &conversation))
}

fn completed_turns(mut rows: Vec<Value>, conversation: &Value) -> Vec<Value> {
    let id = string(conversation, "id");
    let legacy = conversation.get("legacyProjectId").and_then(Value::as_str);
    rows.retain(|r| {
        string(r, "surface") == "agent"
            && string(r, "historyKey").is_empty()
            && (string(r, "conversationId") == id
                || (string(r, "conversationId").is_empty()
                    && legacy.is_some_and(|p| string(r, "projectId") == p)))
    });
    rows.sort_by(|a, b| {
        a["ts"]
            .as_i64()
            .unwrap_or(0)
            .cmp(&b["ts"].as_i64().unwrap_or(0))
            .then_with(|| string(a, "id").cmp(string(b, "id")))
    });
    let mut pending: Option<Value> = None;
    let mut turns = Vec::new();
    for r in rows {
        if string(&r, "text").trim().is_empty() {
            continue;
        }
        if string(&r, "role") == "user" {
            pending = Some(r);
        } else if matches!(string(&r, "role"), "ai" | "assistant") {
            if let Some(user) = pending.as_ref() {
                if string(&r, "turnId") == string(user, "turnId")
                    && matches!(string(&r, "status"), "" | "complete")
                {
                    turns.push(vec![
                        json!({"role":"user", "content": string(user, "text")}),
                        json!({"role":"assistant", "content": string(&r, "text")}),
                    ]);
                    pending = None;
                }
            }
        }
    }
    let mut chars = 0;
    let mut tail = Vec::new();
    for turn in turns.into_iter().rev().take(10) {
        chars += turn
            .iter()
            .map(|m| string(m, "content").chars().count())
            .sum::<usize>();
        if chars > 16000 {
            break;
        }
        tail.push(turn);
    }
    tail.reverse();
    tail.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_history_survives_new_connection_and_excludes_other_scopes() {
        let path =
            std::env::temp_dir().join(format!("seeker-conversation-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE messages (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER DEFAULT 0); CREATE TABLE platform_conversations (id TEXT PRIMARY KEY, data_json TEXT NOT NULL);").unwrap();
        conn.execute(
            "INSERT INTO platform_conversations VALUES ('c', ?1)",
            [json!({"id":"c"}).to_string()],
        )
        .unwrap();
        for (i, role, text, scope, turn) in [
            (1, "user", "remember", "c", "t1"),
            (2, "ai", "done", "c", "t1"),
            (3, "user", "other", "d", "t2"),
            (4, "ai", "private", "d", "t2"),
            (5, "user", "failed", "c", "t3"),
            (6, "system", "attack", "c", "t3"),
            (7, "ai", "wrong turn", "c", "t4"),
        ] {
            conn.execute("INSERT INTO messages (id,data_json) VALUES (?1, ?2)", [i.to_string(), json!({"id":i.to_string(),"ts":i,"surface":"agent","role":role,"text":text,"conversationId":scope,"turnId":turn}).to_string()]).unwrap();
        }
        conn.close().unwrap();
        let conn = Connection::open(&path).unwrap();
        assert_eq!(
            history(&conn, "c").unwrap(),
            vec![
                json!({"role":"user","content":"remember"}),
                json!({"role":"assistant","content":"done"})
            ]
        );
        assert!(history(&conn, "missing").is_err());
        conn.close().unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn legacy_project_history_is_bounded_and_excludes_schedules() {
        let rows: Vec<_> = (0..24).map(|i| json!({"id":i.to_string(),"ts":i,"surface":"agent","role": if i%2 == 0 {"user"} else {"ai"},"text":format!("text-{i}"),"projectId":"work"})).collect();
        let c = json!({"id":"legacy_work","legacyProjectId":"work"});
        let result = completed_turns(rows.clone(), &c);
        assert_eq!(result.len(), 20);
        assert_eq!(result[0]["content"], "text-4");
        assert!(completed_turns(rows.clone(), &json!({"id":"new"})).is_empty());
        let scheduled = rows
            .into_iter()
            .map(|mut r| {
                r["historyKey"] = json!("sched:1");
                r
            })
            .collect();
        assert!(completed_turns(scheduled, &c).is_empty());
    }
}
