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
use std::path::{Path, PathBuf};
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
    let backups = dir.join("backups");
    migrate(&mut conn, &backups)?;
    // 周期性自动备份(开应用时若到期):best-effort,失败仅告警不阻断启动。
    if let Err(e) = auto_backup_if_due(&conn, &backups) {
        log::warn!("自动备份失败(不阻断): {e}");
    }
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
    // 长期记忆表(#2 C2):平台能力的私有存储,**不在 table_for** —— 通用 db_* 碰不到;
    // embedding 存 BLOB(小端 f32),暴力 cosine 检索(单用户规模足够)。
    (
        3,
        "CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, fact TEXT NOT NULL, embedding BLOB, created_at INTEGER DEFAULT 0);",
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

/// 锁住数据库连接跑一段只读 / 读写逻辑。供命令与**能力层**(只经白名单仓库,碰不到隐私表)复用。
pub fn with_db<T>(
    app: &AppHandle,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|_| "数据库锁中毒".to_string())?;
    f(&conn)
}

/// 列出某集合全量(updated_at 倒序)。`table_for` 白名单守卫 —— profile 等隐私表会被拒。
/// 骨架列 WHERE/ORDER 下推留待后续;前端现有筛选不变。
pub fn list_records(conn: &Connection, collection: &str) -> Result<Vec<Value>, String> {
    let table = table_for(collection)?;
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

/// 按 id 取一条(同样经 `table_for` 白名单)。
pub fn get_record(conn: &Connection, collection: &str, id: &str) -> Result<Option<Value>, String> {
    let table = table_for(collection)?;
    let sql = format!("SELECT data_json FROM {table} WHERE id = ?1");
    let s: Option<String> = conn
        .prepare(&sql)
        .map_err(|e| e.to_string())?
        .query_row(params![id], |r| r.get::<_, String>(0))
        .ok();
    Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
}

#[tauri::command]
pub fn db_list(
    db: State<'_, Db>,
    collection: String,
    _query: Option<Value>,
) -> Result<Vec<Value>, String> {
    let conn = db.0.lock().unwrap();
    list_records(&conn, &collection)
}

#[tauri::command]
pub fn db_get(db: State<'_, Db>, collection: String, id: String) -> Result<Option<Value>, String> {
    let conn = db.0.lock().unwrap();
    get_record(&conn, &collection, &id)
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

// ── 长期记忆存储(#2 C2)──────────────────────────────────────────
// `memories` 表不在 `table_for` 白名单:通用 db_* 碰不到,仅长期记忆能力(经 with_db)可达。
// embedding 以小端 f32 字节存 BLOB;检索走暴力 cosine(单用户规模足够,日后量大再换 sqlite-vec)。

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(v.len() * 4);
    for f in v {
        b.extend_from_slice(&f.to_le_bytes());
    }
    b
}

fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// 写入(或覆盖)一条记忆:事实文本 + 其嵌入向量。
pub fn memory_add(
    conn: &Connection,
    id: &str,
    fact: &str,
    embedding: &[f32],
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO memories (id, fact, embedding, created_at) VALUES (?1,?2,?3,?4)",
        params![id, fact, vec_to_blob(embedding), now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读全部记忆 `(id, fact, embedding)` 供暴力 cosine 检索(跳过缺嵌入的行)。
pub fn memory_all(conn: &Connection) -> Result<Vec<(String, String, Vec<f32>)>, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding FROM memories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<Vec<u8>>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (id, fact, blob) = r.map_err(|e| e.to_string())?;
        if let Some(b) = blob {
            out.push((id, fact, blob_to_vec(&b)));
        }
    }
    Ok(out)
}

/// 读记忆条目 `(id, fact, ts)` 供用户在设置页查看/清除 —— **不含 embedding**(隐私 + 体积:
/// 只回事实文本,绝不外泄向量字节)。按时间倒序。
pub fn memory_entries(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, created_at FROM memories ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let fact: String = r.get(1)?;
            let ts: i64 = r.get(2)?;
            Ok(serde_json::json!({ "id": id, "fact": fact, "ts": ts }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ── 长期记忆的用户掌控(#4 · 查看/清除/撤销入口)──────────────────────────
// 记忆可能含用户主动写出的 PII;给用户查看 + 清除 + **撤销**入口(本地、即时生效)。embedding 永不出后端。

/// 记忆销毁撤销暂存:存「最近一次销毁(清除/单删)」的记忆行(含 embedding)。
/// **向量仅留后端、绝不经命令外泄**(守 embedding 隔离红线);供 memory_undo 还原。进程内,重启即失(undo 是当场动作)。
type MemRow = (String, String, Vec<f32>, i64); // (id, fact, embedding, created_at)
#[derive(Default)]
pub struct MemTrash(pub Mutex<Vec<MemRow>>);

/// 读全量记忆行(含 embedding + 时间)——内部用(快照),绝不经命令外泄向量。
fn memory_rows_full(conn: &Connection) -> Result<Vec<MemRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding, created_at FROM memories")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let fact: String = r.get(1)?;
            let blob: Option<Vec<u8>> = r.get(2)?;
            let ts: i64 = r.get(3)?;
            Ok((id, fact, blob.map(|b| blob_to_vec(&b)).unwrap_or_default(), ts))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 还原一批记忆行(保留原 id / embedding / 时间)。
fn memory_restore_rows(conn: &Connection, rows: &[MemRow]) -> Result<usize, String> {
    let mut n = 0;
    for (id, fact, emb, ts) in rows {
        conn.execute(
            "INSERT OR REPLACE INTO memories (id, fact, embedding, created_at) VALUES (?1,?2,?3,?4)",
            params![id, fact, vec_to_blob(emb), ts],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// 列出长期记忆(不含 embedding)——供「数据与隐私」查看。
#[tauri::command]
pub fn memory_list(db: State<'_, Db>) -> Result<Vec<Value>, String> {
    let conn = db.0.lock().unwrap();
    memory_entries(&conn)
}

/// 清除全部长期记忆,返回删除条数。**删前把整表(含 embedding)快照进后端 trash**,供撤销(向量不出后端)。
#[tauri::command]
pub fn memory_clear(db: State<'_, Db>, trash: State<'_, MemTrash>) -> Result<usize, String> {
    let conn = db.0.lock().unwrap();
    let snap = memory_rows_full(&conn)?;
    let n = conn
        .execute("DELETE FROM memories", [])
        .map_err(|e| e.to_string())?;
    *trash.0.lock().unwrap() = snap;
    Ok(n)
}

/// 删除一条长期记忆。**删前把该行(含 embedding)快照进后端 trash**,供撤销。
#[tauri::command]
pub fn memory_remove(db: State<'_, Db>, trash: State<'_, MemTrash>, id: String) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding, created_at FROM memories WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let snap: Vec<MemRow> = stmt
        .query_map(params![id], |r| {
            let i: String = r.get(0)?;
            let f: String = r.get(1)?;
            let b: Option<Vec<u8>> = r.get(2)?;
            let t: i64 = r.get(3)?;
            Ok((i, f, b.map(|x| blob_to_vec(&x)).unwrap_or_default(), t))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();
    drop(stmt);
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    *trash.0.lock().unwrap() = snap;
    Ok(())
}

/// 撤销最近一次记忆销毁(清除 / 单删):从后端 trash 还原(原 embedding 与时间无损)→ 清空 trash。
#[tauri::command]
pub fn memory_undo(db: State<'_, Db>, trash: State<'_, MemTrash>) -> Result<usize, String> {
    let conn = db.0.lock().unwrap();
    let rows = std::mem::take(&mut *trash.0.lock().unwrap());
    memory_restore_rows(&conn, &rows)
}

// ── 周期性自动备份(平台 backlog)──────────────────────────────────
// 开应用时若距上次自动备份超阈值,则 VACUUM INTO 一份 + 修剪旧自动备份(保留最近 N)。
// 默认开;`settings.autobackup='off'` 可关(设置页开关接 settings 待 domain 接线)。
// 与「迁移前快照」(seeker-pre-*)、「手动备份」(seeker-backup-*)区分:自动备份名 seeker-auto-*。

const AUTO_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000; // 24h
const AUTO_BACKUP_KEEP: usize = 5;

fn kv_get(conn: &Connection, table: &str, k: &str) -> Option<String> {
    // table 仅取自本模块字面量(meta / settings),非用户输入。
    conn.query_row(
        &format!("SELECT v FROM {table} WHERE k = ?1"),
        params![k],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// 距上次备份是否到期(纯函数,便于测试)。
fn backup_due(last_ms: i64, now: i64) -> bool {
    now - last_ms >= AUTO_BACKUP_INTERVAL_MS
}

/// 开应用时:到期则 VACUUM INTO 一份自动备份 + 更新 meta + 修剪。
fn auto_backup_if_due(conn: &Connection, backups_dir: &Path) -> Result<(), String> {
    if kv_get(conn, "settings", "autobackup").as_deref() == Some("off") {
        return Ok(()); // 用户关闭
    }
    let last = kv_get(conn, "meta", "last_auto_backup")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let now = now_ms();
    if !backup_due(last, now) {
        return Ok(());
    }
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let path = backups_dir.join(format!("seeker-auto-{now}.db"));
    let p = path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{p}'"))
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('last_auto_backup', ?1)",
        params![now.to_string()],
    )
    .map_err(|e| e.to_string())?;
    prune_auto_backups(backups_dir, AUTO_BACKUP_KEEP);
    Ok(())
}

/// 修剪自动备份:按文件名(含时间戳,字典序≈时间序)排序,删超过 keep 的最旧者。
fn prune_auto_backups(backups_dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(backups_dir) else {
        return;
    };
    let mut autos: Vec<PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("seeker-auto-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    autos.sort();
    if autos.len() > keep {
        for old in &autos[..autos.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate, now_ms, schema_version, table_for, MIGRATIONS};
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

    #[test]
    fn memory_storage_roundtrip_and_isolated() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-mem");
        migrate(&mut conn, &tmp).unwrap();
        // memories 表存在但**不在通用 table_for**(db_* 碰不到 —— 隔离)。
        assert!(
            table_for("memories").is_err(),
            "memories 不应可经 db_* 访问"
        );
        super::memory_add(&conn, "m1", "用户偏好远程后端岗位", &[1.0, 0.0, 2.0]).unwrap();
        let all = super::memory_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].1, "用户偏好远程后端岗位");
        assert_eq!(all[0].2, vec![1.0, 0.0, 2.0]); // BLOB 小端往返无损
    }

    #[test]
    fn memory_entries_excludes_embedding_then_clear_empties() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-mement");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "m1", "我在学 Rust", &[0.1, 0.2]).unwrap();
        super::memory_add(&conn, "m2", "目标分布式后端", &[0.3, 0.4]).unwrap();
        let entries = super::memory_entries(&conn).unwrap();
        assert_eq!(entries.len(), 2);
        // 供查看的条目含 fact,**绝不含 embedding**(向量字节不外泄)。
        assert!(entries[0].get("fact").is_some());
        assert!(entries[0].get("embedding").is_none());
        assert!(entries.iter().any(|e| e["fact"] == "我在学 Rust"));
        // 清除全部 → 计数正确 + 列空(memory_clear 命令体即此 DELETE)。
        let n = conn.execute("DELETE FROM memories", []).unwrap();
        assert_eq!(n, 2);
        assert_eq!(super::memory_entries(&conn).unwrap().len(), 0);
    }

    #[test]
    fn memory_snapshot_then_restore_keeps_embedding_and_time() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-memundo");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "m1", "学 Rust", &[0.1, 0.2, 0.3]).unwrap();
        super::memory_add(&conn, "m2", "目标后端架构", &[0.4, 0.5]).unwrap();
        // 快照(含 embedding + 时间)—— memory_clear/remove 删前所做;向量仅在此后端结构里。
        let snap = super::memory_rows_full(&conn).unwrap();
        assert_eq!(snap.len(), 2);
        let ts1 = snap.iter().find(|r| r.0 == "m1").unwrap().3;
        conn.execute("DELETE FROM memories", []).unwrap();
        assert_eq!(super::memory_entries(&conn).unwrap().len(), 0);
        // 撤销 = 从快照还原:条数 + embedding + created_at 均无损。
        assert_eq!(super::memory_restore_rows(&conn, &snap).unwrap(), 2);
        let all = super::memory_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
        let m1 = all.iter().find(|x| x.0 == "m1").unwrap();
        assert_eq!(m1.2, vec![0.1, 0.2, 0.3]); // embedding 往返无损
        let restored_ts1: i64 = conn
            .query_row("SELECT created_at FROM memories WHERE id='m1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(restored_ts1, ts1); // 原时间保留(非 now)
    }

    #[test]
    fn auto_backup_due_threshold() {
        assert!(!super::backup_due(now_ms(), now_ms())); // 刚备份 → 不到期
        assert!(super::backup_due(0, super::AUTO_BACKUP_INTERVAL_MS)); // 恰好满阈值 → 到期
        assert!(super::backup_due(0, super::AUTO_BACKUP_INTERVAL_MS + 1));
        assert!(!super::backup_due(0, super::AUTO_BACKUP_INTERVAL_MS - 1));
    }

    fn auto_count(dir: &std::path::Path) -> usize {
        std::fs::read_dir(dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| {
                        e.file_name()
                            .to_str()
                            .map(|n| n.starts_with("seeker-auto-") && n.ends_with(".db"))
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn auto_backup_creates_when_due_then_skips() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join(format!("seeker-test-autobk-{}", now_ms()));
        let _ = std::fs::remove_dir_all(&tmp);
        migrate(&mut conn, &tmp).unwrap();
        // 首次:last 缺 → 到期 → 建一份。
        super::auto_backup_if_due(&conn, &tmp).unwrap();
        assert_eq!(auto_count(&tmp), 1, "首启应建一份自动备份");
        // 再调:刚备份未到阈值 → 不增。
        super::auto_backup_if_due(&conn, &tmp).unwrap();
        assert_eq!(auto_count(&tmp), 1, "未到阈值不重复备份");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn prune_keeps_last_n() {
        let tmp = std::env::temp_dir().join(format!("seeker-test-prune-{}", now_ms()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        for i in 0..super::AUTO_BACKUP_KEEP + 3 {
            std::fs::write(tmp.join(format!("seeker-auto-{i:03}.db")), b"x").unwrap();
        }
        std::fs::write(tmp.join("seeker-backup-keep.db"), b"x").unwrap(); // 非自动:不应被修剪
        super::prune_auto_backups(&tmp, super::AUTO_BACKUP_KEEP);
        assert_eq!(
            auto_count(&tmp),
            super::AUTO_BACKUP_KEEP,
            "自动备份修剪到上限"
        );
        assert!(
            tmp.join("seeker-backup-keep.db").exists(),
            "手动备份不受修剪"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
