//! 数据层(#3 · D1 骨架 + 仓库)。
//!
//! 弹性 schema:**骨架列 + `data_json` 弹性列**。加业务字段 = 改 JSON、零迁移;
//! 要查询/排序才"升列"(D1 仅 jobs 升 status/match_score 作样板)。上层只调仓库命令、不碰表。
//!
//! **隐私红线**:`profile` 走独立 `profile_get_all/profile_set`(k/v 表),**不在 `table_for` 白名单**,
//! 故通用 `db_*` 命令永远碰不到 profile / secrets / meta;`ai_chat` 亦无 profile 来源(见 ai.rs 单测)。
//! D2 接版本化迁移 + 迁移前快照;D1 先建表跑通仓库。

use rusqlite::{params, Connection};
use serde_json::{Map, Value};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

/// 进程内单连接(本地单机足够);Mutex 串行化访问。
pub struct Db(pub Mutex<Connection>);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// collection → 表名**白名单**。`profile` / `secrets` / `meta` / `settings` **不在此** ——
/// 通用 `db_*` 碰不到它们(隐私/密钥隔离从这里就成立)。
fn table_for(collection: &str) -> Result<&'static str, String> {
    match collection {
        "jobs" => Ok("jobs"),
        "skills" => Ok("skills"),
        "actions" => Ok("actions"),
        "resumes" => Ok("resumes"),
        "iv_records" => Ok("iv_records"),
        "messages" => Ok("messages"),
        other => Err(format!("未知或受保护的集合: {other}")),
    }
}

/// 打开(或创建)本地数据库并建表。
pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("seeker.db")).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, match_score REAL, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
         CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS resumes (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS iv_records (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS profile (k TEXT PRIMARY KEY, v TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())
}

fn record_id(record: &Value) -> Result<String, String> {
    match record.get("id") {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Number(n)) => Ok(n.to_string()),
        _ => Err("记录缺少 id".into()),
    }
}

#[tauri::command]
pub fn db_list(
    db: State<'_, Db>,
    collection: String,
    _query: Option<Value>,
) -> Result<Vec<Value>, String> {
    let table = table_for(&collection)?;
    let conn = db.0.lock().unwrap();
    // D1:返回全量(updated_at 倒序);骨架列 WHERE/ORDER 的下推留 D2,前端现有筛选不变。
    let sql = format!("SELECT data_json FROM {table} ORDER BY updated_at DESC, id");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let s = r.map_err(|e| e.to_string())?;
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            out.push(v);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn db_get(db: State<'_, Db>, collection: String, id: String) -> Result<Option<Value>, String> {
    let table = table_for(&collection)?;
    let conn = db.0.lock().unwrap();
    let sql = format!("SELECT data_json FROM {table} WHERE id = ?1");
    let s: Option<String> = conn
        .prepare(&sql)
        .map_err(|e| e.to_string())?
        .query_row(params![id], |r| r.get::<_, String>(0))
        .ok();
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

#[tauri::command]
pub fn db_upsert(db: State<'_, Db>, collection: String, record: Value) -> Result<Value, String> {
    let table = table_for(&collection)?;
    let id = record_id(&record)?;
    let data_json = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    let now = now_ms();
    let conn = db.0.lock().unwrap();
    if table == "jobs" {
        // 弹性 schema 写侧:从记录抽取骨架列(status 筛选 / match_score 排序)。
        let status = record.get("status").and_then(|v| v.as_str());
        let match_score = record.get("match").and_then(|v| v.as_f64());
        conn.execute(
            "INSERT OR REPLACE INTO jobs (id, status, match_score, updated_at, data_json) VALUES (?1,?2,?3,?4,?5)",
            params![id, status, match_score, now, data_json],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            &format!(
                "INSERT OR REPLACE INTO {table} (id, updated_at, data_json) VALUES (?1,?2,?3)"
            ),
            params![id, now, data_json],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(record)
}

/// 删除并**返回被删记录(快照)**——前端据此 toastUndo 撤销(经 db_upsert 还原)。
#[tauri::command]
pub fn db_remove(
    db: State<'_, Db>,
    collection: String,
    id: String,
) -> Result<Option<Value>, String> {
    let table = table_for(&collection)?;
    let conn = db.0.lock().unwrap();
    let sel = format!("SELECT data_json FROM {table} WHERE id = ?1");
    let snap: Option<Value> = conn
        .prepare(&sel)
        .map_err(|e| e.to_string())?
        .query_row(params![id.clone()], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])
        .map_err(|e| e.to_string())?;
    Ok(snap)
}

// ── profile:隐私表,与通用 db_* 物理隔离;无任何"导出给 AI"的方法 ──

#[tauri::command]
pub fn profile_get_all(db: State<'_, Db>) -> Result<Map<String, Value>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT k, v FROM profile")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut m = Map::new();
    for r in rows {
        let (k, v) = r.map_err(|e| e.to_string())?;
        m.insert(k, Value::String(v));
    }
    Ok(m)
}

#[tauri::command]
pub fn profile_set(db: State<'_, Db>, k: String, v: String) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO profile (k, v) VALUES (?1, ?2)",
            params![k, v],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::table_for;

    #[test]
    fn table_for_rejects_profile_and_secrets() {
        // 隐私红线:profile / secrets / settings / meta 不可经通用 db_* 访问。
        assert!(table_for("profile").is_err());
        assert!(table_for("secrets").is_err());
        assert!(table_for("settings").is_err());
        assert!(table_for("meta").is_err());
        // 业务集合可访问。
        assert!(table_for("jobs").is_ok());
        assert!(table_for("messages").is_ok());
    }
}
