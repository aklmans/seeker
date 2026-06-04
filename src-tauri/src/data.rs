//! 数据层(#3 · D1 骨架 + 仓库)。
//!
//! 弹性 schema:**骨架列 + `data_json` 弹性列**。加业务字段 = 改 JSON、零迁移;
//! 要查询/排序才"升列"(D1 仅 jobs 升 status/match_score 作样板)。上层只调仓库命令、不碰表。
//!
//! **隐私红线**:`profile` 走独立 `profile_get_all/profile_set`(k/v 表),**不在 `table_for` 白名单**,
//! 故通用 `db_*` 命令永远碰不到 profile / secrets / meta;`ai_chat` 亦无 profile 来源(见 ai.rs 单测)。
//! D2 接版本化迁移 + 迁移前快照;D1 先建表跑通仓库。

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::path::Path;
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

/// 打开(或创建)本地数据库,跑迁移(迁移前自动快照、每步事务失败回滚)。
pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(dir.join("seeker.db")).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    migrate(&mut conn, &dir.join("backups"))?;
    Ok(conn)
}

/// 版本化迁移:每项 (版本号, SQL)。加业务字段本零迁移(改 data_json);要查询/排序才"升列"——
/// 那时追加一条迁移。启动时顺序应用 version > 当前 的项。
const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, match_score REAL, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
         CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS resumes (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS iv_records (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS profile (k TEXT PRIMARY KEY, v TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    ),
    // "字段升列"样板:把 data_json.state 提升为 actions 骨架列 + 回填 + 建索引。
    (
        2,
        "ALTER TABLE actions ADD COLUMN state TEXT;
         UPDATE actions SET state = json_extract(data_json, '$.state');
         CREATE INDEX IF NOT EXISTS idx_actions_state ON actions(state);",
    ),
];

fn schema_version(conn: &Connection) -> i64 {
    conn.query_row("SELECT v FROM meta WHERE k = 'schema_version'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(0)
}

/// 启动迁移:顺序应用待执行迁移;**迁移前自动快照**;每步独立事务,失败即回滚并中止(版本不前进)。
fn migrate(conn: &mut Connection, backups_dir: &Path) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let cur = schema_version(conn);
    let latest = MIGRATIONS.last().map(|m| m.0).unwrap_or(0);
    if cur >= latest {
        return Ok(());
    }
    // 迁移前自动快照(失败仅告警,不阻断;每步事务另有回滚兜底)。
    if let Err(e) = snapshot(conn, backups_dir, cur) {
        log::warn!("迁移前快照失败(继续迁移): {e}");
    }
    for (ver, sql) in MIGRATIONS.iter().filter(|m| m.0 > cur) {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql)
            .map_err(|e| format!("迁移 v{ver} 失败(已回滚): {e}"))?;
        tx.execute(
            "INSERT OR REPLACE INTO meta (k, v) VALUES ('schema_version', ?1)",
            params![ver.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 迁移前快照:VACUUM INTO 一份一致副本到 backups/(WAL 安全)。
fn snapshot(conn: &Connection, backups_dir: &Path, from_ver: i64) -> Result<(), String> {
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let path = backups_dir.join(format!("seeker-pre-v{}-{}.db", from_ver, now_ms()));
    // 路径作转义字符串字面量(避免绑定参数在 VACUUM INTO 的兼容性问题)。
    let p = path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{p}'"))
        .map_err(|e| e.to_string())?;
    Ok(())
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

/// 写入一条记录:jobs 额外抽取骨架列(status/match_score),其余仅 id+data_json。供 upsert/import 复用。
fn upsert_into(conn: &Connection, table: &str, record: &Value) -> Result<(), String> {
    let id = record_id(record)?;
    let data_json = serde_json::to_string(record).map_err(|e| e.to_string())?;
    let now = now_ms();
    if table == "jobs" {
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
    Ok(())
}

#[tauri::command]
pub fn db_upsert(db: State<'_, Db>, collection: String, record: Value) -> Result<Value, String> {
    let table = table_for(&collection)?;
    let conn = db.0.lock().unwrap();
    upsert_into(&conn, table, &record)?;
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

// ── 导出 / 导入 / 备份(#3 D3)──────────────────────────────────
// 全量导出含 profile(本地备份用);脱敏导出 redact=true 剔除 profile 供分享/调试。
// 导入前自动快照;profile 仅整体随备份导入/导出,绝不进 AI 提示(那条红线在 ai_chat 侧)。

#[tauri::command]
pub fn db_export(app: AppHandle, db: State<'_, Db>, redact: bool) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    let mut collections = Map::new();
    for c in [
        "jobs",
        "skills",
        "actions",
        "resumes",
        "iv_records",
        "messages",
    ] {
        let mut stmt = conn
            .prepare(&format!("SELECT data_json FROM {c} ORDER BY id"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut arr = Vec::new();
        for r in rows {
            if let Ok(v) = serde_json::from_str::<Value>(&r.map_err(|e| e.to_string())?) {
                arr.push(v);
            }
        }
        collections.insert(c.to_string(), Value::Array(arr));
    }
    let read_kv = |tbl: &str| -> Result<Map<String, Value>, String> {
        let mut m = Map::new();
        let mut s = conn
            .prepare(&format!("SELECT k, v FROM {tbl}"))
            .map_err(|e| e.to_string())?;
        let rs = s
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rs {
            let (k, v) = r.map_err(|e| e.to_string())?;
            m.insert(k, Value::String(v));
        }
        Ok(m)
    };
    let settings = read_kv("settings")?;
    let profile = if redact {
        Map::new()
    } else {
        read_kv("profile")?
    };
    let bundle = json!({
        "schemaVersion": schema_version(&conn),
        "exportedAt": now_ms(),
        "redacted": redact,
        "collections": collections,
        "settings": settings,
        "profile": profile,
    });
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let suffix = if redact { "-redacted" } else { "" };
    let path = dir.join(format!("seeker-export{suffix}-{}.json", now_ms()));
    let text = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn db_import(app: AppHandle, db: State<'_, Db>, json: String) -> Result<Value, String> {
    let bundle: Value =
        serde_json::from_str(&json).map_err(|_| "无法解析导入文件(非合法 JSON)".to_string())?;
    let imp_ver = bundle
        .get("schemaVersion")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let latest = MIGRATIONS.last().map(|m| m.0).unwrap_or(0);
    if imp_ver > latest {
        return Err(format!(
            "导入文件版本 v{imp_ver} 高于当前应用 v{latest},请升级应用后再导入"
        ));
    }
    let backups = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    let conn = db.0.lock().unwrap();
    let _ = snapshot(&conn, &backups, latest); // 导入前快照(best-effort)
    let mut counts = Map::new();
    if let Some(cols) = bundle.get("collections").and_then(|v| v.as_object()) {
        for (c, arr) in cols {
            let Ok(table) = table_for(c) else { continue }; // 跳过未知/受保护集合
            let mut n: i64 = 0;
            if let Some(records) = arr.as_array() {
                for rec in records {
                    if upsert_into(&conn, table, rec).is_ok() {
                        n += 1;
                    }
                }
            }
            counts.insert(c.clone(), Value::from(n));
        }
    }
    if let Some(p) = bundle.get("profile").and_then(|v| v.as_object()) {
        for (k, v) in p {
            if let Some(s) = v.as_str() {
                conn.execute(
                    "INSERT OR REPLACE INTO profile (k, v) VALUES (?1, ?2)",
                    params![k, s],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    if let Some(st) = bundle.get("settings").and_then(|v| v.as_object()) {
        for (k, v) in st {
            if let Some(s) = v.as_str() {
                conn.execute(
                    "INSERT OR REPLACE INTO settings (k, v) VALUES (?1, ?2)",
                    params![k, s],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(Value::Object(counts))
}

/// 即时备份:VACUUM INTO 一份一致副本到 backups/,返回路径。
#[tauri::command]
pub fn db_backup(app: AppHandle, db: State<'_, Db>) -> Result<String, String> {
    let backups = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let path = backups.join(format!("seeker-backup-{}.db", now_ms()));
    let conn = db.0.lock().unwrap();
    let p = path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{p}'"))
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{migrate, schema_version, table_for, MIGRATIONS};
    use rusqlite::Connection;

    #[test]
    fn migrate_upgrades_to_latest_and_promotes_actions_state() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups");
        migrate(&mut conn, &tmp).unwrap();
        assert_eq!(schema_version(&conn), MIGRATIONS.last().unwrap().0);
        // "升列"样板生效:actions.state 已成列。
        let has_state: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('actions') WHERE name = 'state'")
            .unwrap()
            .query_row([], |_| Ok(true))
            .unwrap_or(false);
        assert!(has_state, "actions.state 应已升列");
    }

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
