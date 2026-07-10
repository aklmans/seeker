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
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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
        // 阶段4 第二应用「数据资产管理」(assets):D1 <appId>_ 前缀;隐私表(profile/secrets/meta/settings)仍不在此。
        "assets_prompts" => Ok("assets_prompts"),
        "assets_notes" => Ok("assets_notes"),
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
    // RAG-over-docs(#2):用户文档切块 + 嵌入。平台能力私有,**不在 table_for** —— db_* 碰不到;
    // 只经 DocContext 自动召回(标 Untrusted)。doc_id 聚合为"一篇文档";embedding 同记忆 BLOB。
    (
        4,
        "CREATE TABLE IF NOT EXISTS doc_chunks (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, doc_name TEXT NOT NULL, text TEXT NOT NULL, embedding BLOB, created_at INTEGER DEFAULT 0);
         CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);",
    ),
    // 阶段4 第二应用「数据资产管理」(assets):D1 新应用集合以 <appId>_ 前缀声明;骨架列 + data_json 弹性 schema 同既有业务集合。
    (
        5,
        "CREATE TABLE IF NOT EXISTS assets_prompts (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS assets_notes (id TEXT PRIMARY KEY, updated_at INTEGER DEFAULT 0, data_json TEXT NOT NULL);",
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

// ── 不可映射行(「坏数据」)的识别与逃生口 ────────────────────────────────
//
// ★背景(评审第61轮记债 → 第64轮裁定为下一刀):`fact` 存了 BLOB、`created_at` 存了 TEXT ……
// 这类行**无法完整快照** ⇒ fail-closed 之下 `remove`/`clear` 双双报错 ⇒ **app 内无逃生口**。
// 红线只要求「**永不谎报撤销**」,并未要求拒绝销毁 ⇒ 不变式锐化一格:
//   旧:**销毁** ⇔ 快照完整      新:**提供撤销** ⇔ 快照完整
// 即:损坏行**允许销毁**,但必须走 guardrail 确认 + 明告「无法撤销」+ 不给撤销按钮。
//
// ★★落码时实测到一个比「删不掉」更坏的后果(记债里没写):`memory_entries` 也会整体报错
// ⇒ 前端 `catch` 成空数组 ⇒ 用户看到「AI 还没有记住任何内容。」;而 `memory_all`(recall 那条路)
// **照常返回全部记忆**。⇒ 用户被告知「没有记忆」,AI 却仍然记得。**这个视图的全部意义就是用户掌控,
// 它却在说谎**(§4-2)。`doc_list` 同理(`MAX(created_at)` 为 TEXT 时整表列不出,而 `doc_chunks_all`
// 照常召回)。故逃生口的第一步不是「能删」,而是「**能看见**」—— 看不见的行没法点删除。
//
/// 与 rusqlite `FromSql` 的接受集**逐列等价**的 SQL 谓词:用 `typeof()` 判定,**不物化任何行**
/// (故可安全用于 `clear` 的物化前预检)。等价性由 `typeof_predicate_matches_rusqlite_acceptance`
/// 逐形态钉死(含阳性对照:少判一列就会与 rusqlite 分歧)。
///
/// 对应 `MemRow = (String, String, Vec<f32>, i64)`:`String` 只收 Text;`Option<Vec<u8>>` 只收 Blob/Null;
/// `Option<i64>` 只收 Integer/Null(**Real 不收** —— 实测 `created_at=1.5` 会让映射失败)。
const MEM_CORRUPT_PRED: &str = "typeof(id)<>'text' OR typeof(fact)<>'text' OR typeof(embedding) NOT IN ('blob','null') OR typeof(created_at) NOT IN ('integer','null')";

/// 同上,对应 `DocRow = (String, String, String, String, Vec<f32>, i64)`。
const DOC_CORRUPT_PRED: &str = "typeof(id)<>'text' OR typeof(doc_id)<>'text' OR typeof(doc_name)<>'text' OR typeof(text)<>'text' OR typeof(embedding) NOT IN ('blob','null') OR typeof(created_at) NOT IN ('integer','null')";

/// **宽容**读一列文本:BLOB / 数字 / NULL 一律不报错(损坏行也要能被用户看见,才可能被删掉)。
/// 仅用于**给人看**的列表,绝不用于快照 —— 快照仍严格 fail-closed(有损转换不是忠实快照)。
fn text_lossy(r: &rusqlite::Row, i: usize) -> rusqlite::Result<String> {
    use rusqlite::types::ValueRef;
    Ok(match r.get_ref(i)? {
        ValueRef::Null => String::new(),
        ValueRef::Integer(v) => v.to_string(),
        ValueRef::Real(v) => v.to_string(),
        ValueRef::Text(b) | ValueRef::Blob(b) => String::from_utf8_lossy(b).into_owned(),
    })
}

/// **宽容**读一列整数:非 Integer(含 TEXT / REAL / NULL)一律归 0(schema `DEFAULT 0`)。
fn int_lossy(r: &rusqlite::Row, i: usize) -> rusqlite::Result<i64> {
    use rusqlite::types::ValueRef;
    Ok(match r.get_ref(i)? {
        ValueRef::Integer(v) => v,
        _ => 0,
    })
}

/// 读记忆条目 `(id, fact, ts, rowid, corrupt)` 供用户查看/清除 —— **不含 embedding**(隐私 + 体积:
/// 只回事实文本,绝不外泄向量字节)。按时间倒序。**永不因一行坏数据而整体失败**(见上 ★★)。
///
/// `rowid`:损坏行的 `id` 本身可能不可映射(如 BLOB),无法作为删除键 ⇒ 前端用 `rowid` 走
/// `memory_remove_corrupt`。健康行仍按 `id` 走可撤销的常规删除。
pub fn memory_entries(conn: &Connection) -> Result<Vec<Value>, String> {
    let sql = format!(
        "SELECT rowid, id, fact, created_at, ({MEM_CORRUPT_PRED}) AS corrupt FROM memories ORDER BY created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let rowid: i64 = r.get(0)?;
            let corrupt: i64 = r.get(4)?;
            Ok(serde_json::json!({
                "id": text_lossy(r, 1)?,
                "fact": text_lossy(r, 2)?,
                "ts": int_lossy(r, 3)?,
                "rowid": rowid,
                "corrupt": corrupt != 0,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 表内**不可映射行**的条数(SQL 谓词,零物化)。
fn mem_corrupt_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM memories WHERE ({MEM_CORRUPT_PRED})"),
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 同上;`doc_id = Some(id)` 只数这一篇。
fn doc_corrupt_count(conn: &Connection, doc_id: Option<&str>) -> Result<i64, String> {
    match doc_id {
        Some(did) => conn.query_row(
            &format!("SELECT COUNT(*) FROM doc_chunks WHERE doc_id = ?1 AND ({DOC_CORRUPT_PRED})"),
            params![did],
            |r| r.get(0),
        ),
        None => conn.query_row(
            &format!("SELECT COUNT(*) FROM doc_chunks WHERE ({DOC_CORRUPT_PRED})"),
            [],
            |r| r.get(0),
        ),
    }
    .map_err(|e| e.to_string())
}

/// 一次销毁**能否撤销**,以及**为什么不能** —— 决策点必须说真话,而且要说对**理由**
/// (「内容过大」与「数据已损坏」对用户是两件事,后者还提示该行需要处理)。
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct UndoPrecheck {
    pub undoable: bool,
    /// `"ok"` | `"corrupt"`(有不可映射行,快照不可能完整)| `"too_large"`(超环字节上限)
    pub reason: &'static str,
}
impl UndoPrecheck {
    fn ok() -> Self {
        Self {
            undoable: true,
            reason: "ok",
        }
    }
    fn no(reason: &'static str) -> Self {
        Self {
            undoable: false,
            reason,
        }
    }
}

/// 记忆整表清空的预检。**`corrupt` 优先于 `too_large`**:有损坏行时快照根本不可能完整,
/// 字节是否超限无关紧要,且「已损坏」对用户更可操作。
fn memory_clear_precheck(conn: &Connection, cap: usize) -> Result<UndoPrecheck, String> {
    if mem_corrupt_count(conn)? > 0 {
        return Ok(UndoPrecheck::no("corrupt"));
    }
    if memory_clear_undo_bytes(conn)? > cap {
        return Ok(UndoPrecheck::no("too_large"));
    }
    Ok(UndoPrecheck::ok())
}

/// 文档销毁的预检(`doc_id = None` → 整库清空;`Some` → 单篇)。判据同 memory 侧。
fn doc_precheck(
    conn: &Connection,
    cap: usize,
    doc_id: Option<&str>,
) -> Result<UndoPrecheck, String> {
    if doc_corrupt_count(conn, doc_id)? > 0 {
        return Ok(UndoPrecheck::no("corrupt"));
    }
    if doc_undo_bytes(conn, doc_id)? > cap {
        return Ok(UndoPrecheck::no("too_large"));
    }
    Ok(UndoPrecheck::ok())
}

// ── 长期记忆的用户掌控(#4 · 查看/清除/撤销入口)──────────────────────────
// 记忆可能含用户主动写出的 PII;给用户查看 + 清除 + **撤销**入口(本地、即时生效)。embedding 永不出后端。

/// 记忆销毁撤销暂存的行(含 embedding)。**向量仅留后端、绝不经命令外泄**(守 embedding 隔离红线);
/// 供 memory_undo 还原。进程内,重启即失(undo 是当场动作)。
type MemRow = (String, String, Vec<f32>, i64); // (id, fact, embedding, created_at)

// ── 撤销环(刀2b-1:取代单槽 trash)────────────────────────────────────
// ★为何是「有界环」而非「时间 TTL」(评审第60轮裁决):
//   · 刀1(toastUndo 契约化)之后,撤销失败已由「后端权威拒绝 → restoreFn 上报 false → toast 静默」
//     兜住,**不会出现假的「已撤销」** ⇒ TTL 漂移从**正确性问题降级为 UX 问题**。
//   · **正确性绝不能依赖跨进程时钟一致**;没有时钟,就没有时钟漂移,整类问题消失。
//   · 真正要 bound 的是**内存**(快照含 embedding,`clear` 的快照可能是整表)——
//     **条数 ∧ 字节才是直接杠杆,时间不是**;两者取先到者触发淘汰。

/// 环上限(默认值;`with_bounds` 供单测注入小上限,免得为测字节判据去分配 64 MiB)。
const UNDO_RING_MAX_ENTRIES: usize = 8;
const UNDO_RING_MAX_BYTES: usize = 64 * 1024 * 1024;

/// 一行快照**堆上**占用的字节(String / Vec 的实际 `capacity`,含 embedding 向量)。
///
/// ★评审第62轮:原实现用 `len()` 且不计结构体开销 ⇒ **账面 < 真实** ⇒ `UNDO_RING_MAX_BYTES`
/// 成了一条**假上限**(小行时结构开销占比可达 2–3×)。**一个低估的账本不是上限**;
/// 而把「这是下界」写进注释 = 记录一条假不变式(本 arc 第七次)。**别记录,修好它。**
/// 故改用 `capacity()`;元组本体 / 环条目 / token 的开销由 `stash` 统一计入(见下),避免重复计数。
pub(crate) trait UndoBytes {
    /// 仅**堆上**载荷。元组本体(`size_of::<T>()`)按 `Vec` 槽位由 `stash` 计入。
    fn heap_bytes(&self) -> usize;
}
impl UndoBytes for MemRow {
    fn heap_bytes(&self) -> usize {
        self.0.capacity() + self.1.capacity() + self.2.capacity() * std::mem::size_of::<f32>()
    }
}

struct UndoEntry<T> {
    token: String,
    rows: Vec<T>,
    bytes: usize,
}

/// **进程级**撤销 token 序号 —— 全局唯一,**跨环不重号**。
///
/// ★评审第63轮 [应改](本 arc 第八次「勿声明假不变式」,且它就出现在收官宣言里):
/// 原实现给每个环一个 `next: u64`、都从 1 起 ⇒ `MemTrash` 的首个 token 是 `"u1"`,
/// `DocTrash` 的首个 token **也是** `"u1"`。**token 不自带环身份。**
/// 于是「还原错记录在类型层面不可能」只在**环内**为真:一旦某个 token 被交给**另一个环**的
/// `undo`(复制粘贴 / 将来的重构错配),`position()` 会命中**同序号的另一次销毁**并静默还原它。
/// 今天不可达(四条路径各自捕获自己的 token、命令与环由类型绑定),**但挡住它的是前端约定,不是结构**。
///
/// 改为进程级单调序号后:**任意两条环条目的 token 永不相同** ⇒ 错配的 token 必然 `position()` 落空
/// → `None` → 还原 0 条 → 前端 `staleUndo()` 如实上报。失败从「静默还原错域」变成「响亮拒绝」,
/// 且对未来新增的第三个环**天然免疫**(无需记得给它挑一个没被占用的前缀)。
static UNDO_TOKEN_SEQ: AtomicU64 = AtomicU64::new(1);

/// **有界撤销环**:保留最近若干次销毁的快照,按「条数 ∧ 字节」双判据淘汰最旧。
///
/// ★不变式(从单槽时代的 `stash_if_destroyed` **原样带进新结构**,别在重写中丢掉 —— 评审第61轮点名):
///  ① **空快照永不入环**:no-op 销毁(行已不存在 / 库本就空)**不发 token、不淘汰任何东西**;
///     与前端「**提供撤销 ⇔ 销毁确已发生**」严格对称。
///  ② **入环即「已销毁且可还原」**:环里躺着的每一条,都是确实被销毁、且能被完整还原的行。
///  ③ **单次快照超字节上限 ⇒ 不入环、不发 token**:前端据「无 token」**不提供撤销**,
///     而不是给一个还原不了的按钮 —— 同「提供撤销 ⇔ 快照完整」的锐化方向。
///  ④ **token 全局唯一**(评审第63轮):序号取自进程级 `UNDO_TOKEN_SEQ`,**不是**每个环自己的计数器
///     ⇒ 一个环的 token 永不命中另一个环的条目(见 `UNDO_TOKEN_SEQ` 注释)。
pub struct UndoRing<T> {
    entries: VecDeque<UndoEntry<T>>,
    bytes: usize,
    max_entries: usize,
    max_bytes: usize,
}

impl<T> Default for UndoRing<T> {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
            max_entries: UNDO_RING_MAX_ENTRIES,
            max_bytes: UNDO_RING_MAX_BYTES,
        }
    }
}

impl<T: UndoBytes> UndoRing<T> {
    #[cfg(test)]
    fn with_bounds(max_entries: usize, max_bytes: usize) -> Self {
        Self {
            max_entries,
            max_bytes,
            ..Default::default()
        }
    }

    /// 入环并发 token。空快照 / 超字节上限 → `None`(不入环、不淘汰、不发 token)。
    fn stash(&mut self, rows: Vec<T>) -> Option<String> {
        if rows.is_empty() {
            return None; // 不变式①
        }
        // ★真实口径(评审第62轮):堆载荷(capacity)+ Vec 槽位 + 环条目本体 + token 串的堆。
        //   不重复计数:元组本体只在「Vec 槽位」里算一次。
        // token 取自**进程级**序号(不变式④):跨环唯一 ⇒ 错配的 token 只会落空,绝不命中别的环。
        let token = format!("u{}", UNDO_TOKEN_SEQ.fetch_add(1, Ordering::Relaxed));
        let bytes = rows.iter().map(|r| r.heap_bytes()).sum::<usize>()
            + rows.capacity() * std::mem::size_of::<T>()
            + std::mem::size_of::<UndoEntry<T>>()
            + token.capacity();
        if bytes > self.max_bytes {
            return None; // 不变式③:一次 clear 撑不爆环,也不谎报可撤销
        }
        self.entries.push_back(UndoEntry {
            token: token.clone(),
            rows,
            bytes,
        });
        self.bytes += bytes;
        // 双判据淘汰,先到者触发。新入那条的 bytes ≤ max_bytes,故循环必终止且至少留下它。
        while self.entries.len() > self.max_entries || self.bytes > self.max_bytes {
            match self.entries.pop_front() {
                Some(old) => self.bytes -= old.bytes,
                None => break,
            }
        }
        Some(token)
    }

    /// 取走**指定 token 的那一次销毁**并移出环。找不到(已淘汰 / 未知 / 已被取走)→ `None`,
    /// 命令遂返回 0,**绝不静默成功**。
    ///
    /// ★★刀2b-2:**`token` 必填 —— 「取最近一次」这个 affordance 已被删除**(评审第62轮验收判据③)。
    /// 理由:环下 `take(None)` 弹环顶 ⇒ 一次**虚假的**撤销会还原**别人的那一次销毁**
    /// (旧单槽下只会还原 0 条,是诚实的 no-op)⇒ **失效模式从 no-op 升级为「还原更早的销毁」**。
    /// 当时挡住它的全是**前端**闸(`toastUndo.done` / `guardrail.showUndo.done` / 世代 / `dropToast`),
    /// 纵深防御被迫承重。删掉 `None` 之后:每次撤销都**只能**作用于它自己那一次销毁 ⇒
    /// **「还原错记录」在环内不可能**(跨环由不变式④ 的全局唯一 token 保证)。
    ///
    /// ★连带后果(评审第63轮 Q2,**别误读前端注释**):前端的 `memGen`/`docGen` 世代守卫与 `dropToast`
    /// 由此**从「安全」降为「策略」**——一个陈旧的撤销 toast 点下去,要么精确还原它自己那一次(正确),
    /// 要么 token 已失效被诚实拒绝;**两种结果都不是「还原错记录」**。它们如今只在执行一条产品选择:
    /// 「只有最近一次可撤销」。(而 `toastUndo.done` 仍为另外四个闭包消费者**承重** —— 别一起降级。)
    fn take(&mut self, token: &str) -> Option<Vec<T>> {
        let idx = self.entries.iter().position(|e| e.token == token)?;
        let e = self.entries.remove(idx)?;
        self.bytes -= e.bytes;
        Some(e.rows)
    }

    /// 本环的字节上限 —— `*_clear_inner` 的预检据此决定「是否值得物化快照」,
    /// 保证「预检说可撤销」与「stash 会接受」用的是**同一个上限**。
    fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
    #[cfg(test)]
    fn total_bytes(&self) -> usize {
        self.bytes
    }
    #[cfg(test)]
    fn has(&self, token: &str) -> bool {
        self.entries.iter().any(|e| e.token == token)
    }
}

/// 环条目的固定开销上界(条目本体 + token 串 + Vec 槽位余量)。
const UNDO_ENTRY_OVERHEAD: usize = 256;

/// 把 SQL 量到的载荷字节 + 行数 换算成「入环会占多少字节」的**上界**。
///
/// ★取 2× 是刻意的**保守上界**:`String`/`Vec` 的 `capacity` 可能超 `len`(摊还增长最多 2×)。
/// 只有 `估算 ≥ 实际` 才能保证「预检说可撤销 ⇒ stash 一定接受」——
/// 否则用户在**确认之前**被告知可撤销、销毁之后才发现不能,正是 §4-3 ★所禁的决策点谎报。
/// 代价:载荷超过约 `上限/2` 时保守地判为不可撤销。**保守拒绝优于失信承诺。**
fn undo_bytes_upper_bound(payload: i64, rows: i64, row_size: usize) -> usize {
    (payload.max(0) as usize) * 2 + (rows.max(0) as usize) * row_size * 2 + UNDO_ENTRY_OVERHEAD
}

/// **物化前**估算「清空记忆的快照会占多少环字节」(上界)。
///
/// ★评审第62轮:原先 `clear` 先把整表(含 embedding)物化进 RAM,**之后**才由环按上限拒绝
/// ⇒ 一个 2 GiB 的库会先分配 2 GiB(可能 OOM),再被礼貌地拒绝。**上限只约束保留,不约束瞬时分配。**
/// 故改为先用 SQL 量字节(`LENGTH(CAST(... AS BLOB))` 取字节而非字符数;BLOB 的 `LENGTH` 即字节)。
fn memory_clear_undo_bytes(conn: &Connection) -> Result<usize, String> {
    let (payload, rows): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(id AS BLOB)) + LENGTH(CAST(fact AS BLOB)) + LENGTH(COALESCE(embedding, x''))), 0), COUNT(*) FROM memories",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(undo_bytes_upper_bound(
        payload,
        rows,
        std::mem::size_of::<MemRow>(),
    ))
}

#[derive(Default)]
pub struct MemTrash(pub Mutex<UndoRing<MemRow>>);

/// 销毁命令的返回:**实际销毁条数** + **撤销 token**(`None` = 没什么可撤销 / 快照未入环)。
///
/// ★`deleted` 支撑前端不变式「**提供撤销 ⇔ 销毁确已发生**」(第60轮 [建议]1);
/// ★`undoToken` 支撑刀2b-2 的**精确撤销**,并让「**无 token ⇒ 不提供撤销**」成为**结构性事实**,
///   而不再是前端约定。
#[derive(serde::Serialize, Debug)]
pub struct DestroyResult {
    pub deleted: usize,
    #[serde(rename = "undoToken")]
    pub undo_token: Option<String>,
}

/// 读全量记忆行(含 embedding + 时间)——内部用(快照),绝不经命令外泄向量。
/// **记忆行的唯一映射函数**(与 `map_doc_row` 同款先例)—— `memory_rows_full` / `memory_snapshot_one` /
/// `memory_row_state` 三处共用。
///
/// ★评审第65轮:「**这行能不能快照**」的权威答案就是**快照代码本身**,不是它的代理谓词。
/// 把它抽成一个函数,`memory_row_state` 遂能直接问它,而不是重抄一份列清单(那是「重抄被测代码」的同族)。
/// `created_at` 的 `Option<i64>.unwrap_or(0)` = 第61轮裁决 A 的全域映射(schema `DEFAULT 0`,忠实归一化)。
fn map_mem_row(r: &rusqlite::Row) -> rusqlite::Result<MemRow> {
    let id: String = r.get(0)?;
    let fact: String = r.get(1)?;
    let blob: Option<Vec<u8>> = r.get(2)?;
    let ts: i64 = r.get::<_, Option<i64>>(3)?.unwrap_or(0);
    Ok((
        id,
        fact,
        blob.map(|b| blob_to_vec(&b)).unwrap_or_default(),
        ts,
    ))
}

fn memory_rows_full(conn: &Connection) -> Result<Vec<MemRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding, created_at FROM memories")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_mem_row).map_err(|e| e.to_string())?;
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
pub fn memory_clear(
    db: State<'_, Db>,
    trash: State<'_, MemTrash>,
) -> Result<DestroyResult, String> {
    let conn = db.0.lock().unwrap();
    memory_clear_inner(&conn, &trash.0)
}

/// 清空记忆的**真实逻辑**(抽出以便单测覆盖真实命令体 · 第60轮 [建议]3 纪律)。
///
/// ★超上限时**根本不物化快照**(评审第62轮):既不把整库 embedding 拉进 RAM,也不发 token;
/// 前端据「无 token」不提供撤销。销毁照常发生 —— 红线只要求**永不谎报撤销**,并未要求拒绝销毁。
fn memory_clear_inner(
    conn: &Connection,
    ring: &Mutex<UndoRing<MemRow>>,
) -> Result<DestroyResult, String> {
    let cap = ring.lock().unwrap().max_bytes();
    // ★预检与本函数**共用同一判据**(`memory_clear_precheck`)⇒「预检说可撤销 ⇒ stash 必接受」。
    //   `reason=corrupt`(有不可映射行)⇒ **不物化、不发 token,但照常销毁** —— 这就是逃生口:
    //   一行坏数据不得把整库锁死。红线只要求永不谎报撤销(确认弹窗已在决策点如实告知)。
    //   `undoable=true` 时快照仍严格 fail-closed:承诺了可撤销就必须真能还原,取不到就 Err、不销毁。
    let undoable = memory_clear_precheck(conn, cap)?.undoable;
    let snap = if undoable {
        memory_rows_full(conn)?
    } else {
        Vec::new() // 超上限 / 有损坏行:不物化
    };
    let n = conn
        .execute("DELETE FROM memories", [])
        .map_err(|e| e.to_string())?;
    // 清空一个已空的库 = no-op ⇒ 空快照不入环、不发 token(不变式①),旧条目不受影响。
    let undo_token = ring.lock().unwrap().stash(snap);
    Ok(DestroyResult {
        deleted: n,
        undo_token,
    })
}

/// 预检:这次「清空记忆」是否可撤销?**供确认弹窗在用户做决定之前说真话**(评审第62轮 [应改])。
#[tauri::command]
pub fn memory_clear_undoable(
    db: State<'_, Db>,
    trash: State<'_, MemTrash>,
) -> Result<UndoPrecheck, String> {
    let conn = db.0.lock().unwrap();
    let cap = trash.0.lock().unwrap().max_bytes();
    memory_clear_precheck(&conn, cap)
}

/// 快照一条记忆行(含 embedding)。**行不存在 → 空 Vec;行存在但映射失败 → `Err`(fail-closed)。**
///
/// ★评审第60轮 [建议]2:原实现用 `.filter_map(|x| x.ok())` **吞掉逐行映射错误**(先存缺陷,随
/// `memory_remove` 内联体忠实搬出)。而 `DELETE` **不管映射成不成功都会删掉那行** ⇒ 旧语义下
/// `snap.is_empty()` 实为「命中 0 行 **或** 命中的行全部映射失败」,**并不等价于「0 行被销毁」**。
/// 一旦配上 `stash_if_destroyed`,后果被放大成:行被删、快照为空 → 跳过 stash → 槽里留着**上一次**的
/// 快照 → 命令仍 `Ok` → 前端推进世代并给出撤销 → 用户点撤销 **还原了错的记录**、且 `n>0` 报「已撤销」。
/// (对比旧码 `*slot = snap`(空)只是**清空**槽:丢 A,但不还原错的。**本刀曾把良性吞错变成还原错记录的通路**。)
///
/// 故改为**与三个兄弟一致地传播错误**(`memory_rows_full` / `doc_snapshot` 均 `r.map_err(…)?`;
/// 本函数曾是四者里唯一的异类)。映射失败 → 在 `DELETE` **之前**返回 `Err` ⇒ 什么也没销毁、槽未被动、
/// 前端 `ok=false` 不推进世代不给撤销。**此后 `snap.is_empty()` 才真正 ⟺「0 行被销毁」,`is_empty()` 判据才名副其实。**
///
/// ★★全域映射 vs fail-closed 的界线(评审第61轮裁决 A):**纯 fail-closed 会把正确性 bug 换成可用性 bug**
/// —— 一行 `created_at=NULL` 的记忆将**永远删不掉**。裁决的原则是:
///   **全域映射只在 schema 自己定义了默认值的地方合法;其余一律 fail-closed。**
///   · `created_at INTEGER **DEFAULT 0**` ⇒ `NULL → 0` 是**忠实归一化**(不是猜值):快照仍**完整表示**
///     将被销毁的那一行,撤销能按 schema 原意还原 ⇒ 不变式不受损。**故五处 `created_at` 读全部归一化**
///     (`memory_entries` / `memory_rows_full` / 本函数 / `doc_list` 的 `MAX(created_at)` / `map_doc_row`)——
///     **必须一起改**,否则「坏行能删、整库不能清」的不对称会换个方向复活。
///   · 反之 `fact TEXT NOT NULL` / `id TEXT PRIMARY KEY`:schema **没有**为「非文本的 fact」定义默认值。
///     把它们也弄成全域 = **凭空造值** ⇒ 快照不再忠实表示被销毁的行 ⇒ trash 的意义被掏空。**此处 fail-closed 必须保留。**
///
/// ★残留(评审第61轮记债,留后续刀):真·不可映射的行(如 `fact` 存了整数)仍会让 `memory_remove`(该行)
/// 与 `memory_clear`(整表)永久失败,用户在 app 内**无逃生口**。正解是把不变式再锐化一格 ——
/// 从「**销毁 ⇔ 快照完整**」改为「**提供撤销 ⇔ 快照完整**」:不可快照的行**允许销毁,但走 guardrail 确认 +
/// 明确告知「此行已损坏,删除后无法撤销」、且不提供撤销按钮**。红线只要求**永不谎报撤销**,并未要求拒绝销毁。
fn memory_snapshot_one(conn: &Connection, id: &str) -> Result<Vec<MemRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding, created_at FROM memories WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let it = stmt
        .query_map(params![id], map_mem_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in it {
        out.push(r.map_err(|e| e.to_string())?); // fail-closed:不能完整快照,就不销毁
    }
    Ok(out)
}

/// 删除一条长期记忆的**真实逻辑**(快照 → 删 → 按需 stash)。命令只负责取锁转调。
///
/// ★评审第60轮 [建议]3:抽出 inner 是为了让单测覆盖**真实命令体** —— 原测试自己重抄了
/// 「snapshot → DELETE → stash」这段序列,断言的是**测试自己写的代码**:若有人把命令改回
/// `*trash = snap`、或把 stash 挪到 DELETE 之前,那测试照样绿。**重抄被测代码的测试,证明的是测试、不是代码**
/// (与「不触发的控制组什么都证明不了」同族纪律)。
fn memory_remove_inner(
    conn: &Connection,
    ring: &Mutex<UndoRing<MemRow>>,
    id: &str,
) -> Result<DestroyResult, String> {
    let snap = memory_snapshot_one(conn, id)?; // 映射失败 → 提前 Err,什么也不销毁
    let n = conn
        .execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    // ★重复删同一 id ⇒ snap 空 ⇒ 不入环、不发 token(不变式①),环内旧条目**不受影响**。
    let undo_token = ring.lock().unwrap().stash(snap);
    Ok(DestroyResult {
        deleted: n,
        undo_token,
    })
}

/// 删除一条长期记忆。**删前把该行(含 embedding)快照进后端 trash**,供撤销。返回**实际删除条数**。
///
/// ★返回条数(本刀新增,原为 `()`):`doc_remove`/`memory_clear`/`doc_clear` 早已返回 `usize`,
/// 唯独此命令不返回 ⇒ 前端**无从判断销毁是否真的发生**,「提供撤销 ⇔ 销毁确已发生」这条不变式
/// 在此**无法贯彻**(no-op 删除会推进世代并给出撤销,点下去还原的是**上一次**的记录)。补齐以消除该盲区。
#[tauri::command]
pub fn memory_remove(
    db: State<'_, Db>,
    trash: State<'_, MemTrash>,
    id: String,
) -> Result<DestroyResult, String> {
    let conn = db.0.lock().unwrap();
    memory_remove_inner(&conn, &trash.0, &id)
}

/// 撤销**指定 token 的那一次**记忆销毁,返回**实际还原条数**。
///
/// **`token` 必填**(刀2b-2:`UndoRing::take(&str)` 已在类型层面删掉「取最近一次」的 affordance;
/// 且 token 取自进程级序号、跨环唯一)⇒ 一次撤销**只能**作用于它自己那一次销毁。
/// **token 已被淘汰 / 未知 / 已被取走 / 环为空 ⇒ 返回 `0`,绝不静默成功** —— 前端据 `n===0` 如实上报
/// **逃生口**:销毁一条**不可映射(已损坏)**的记忆 —— 按 `rowid` 删,**不快照、不发 token**。
///
/// ★★结构性守卫(本命令存在的关键):**它拒绝销毁健康行。**
/// 否则这就成了一个「绕过快照直接删」的后门 —— 任何调用点(将来的重构 / 别的页面)都能拿它
/// 无声地摧毁一条本可撤销的记忆。加了守卫之后,不变式在**类型之外**也成立:
///   **健康行永远有快照可撤销;只有不可快照的行才可能被无撤销地销毁,且必经 guardrail 确认。**
/// 行不存在 → `deleted = 0`(诚实 no-op,与 `memory_remove` 同);行存在且健康 → `Err`。
///
/// 不触碰撤销环:不 stash、不淘汰任何既有条目(环不变式①③ 不受影响)。
#[tauri::command]
pub fn memory_remove_corrupt(db: State<'_, Db>, rowid: i64) -> Result<DestroyResult, String> {
    let conn = db.0.lock().unwrap();
    memory_remove_corrupt_inner(&conn, rowid)
}

/// 命令体本身(评审第60轮 [建议]3:命令只取锁转调,测试直调 inner —— **测试要守生产代码,不是重抄它**)。
/// 一行相对于**快照映射**的三态。判定权威 = `map_mem_row`(快照本身用的那一个),不是任何代理谓词。
#[derive(Debug, PartialEq)]
enum RowState {
    Missing,
    /// 可完整快照 ⇒ 必须走**可撤销**的常规删除
    Healthy,
    /// 不可映射 ⇒ 没有可还原之物 ⇒ 允许经逃生口销毁(guardrail 已在决策点告知不可撤销)
    Unmappable,
}

/// 「这一行能不能被快照?」—— **让快照代码自己回答**(评审第65轮 [建议]强)。
///
/// ★为什么不用 `MEM_CORRUPT_PRED`:那道谓词若比 rusqlite `FromSql` **更严**,
/// `memory_remove_corrupt` 会把一条**健康、可快照**的记忆无快照、无撤销地销毁 —— 静默且不可逆。
/// 于是「谓词 ≡ rusqlite」成了**安全属性**,而它是一份**跨依赖版本**的维护负债
/// (rusqlite 某次升级改了强制转换语义,谓词就悄悄变严)。改用快照当裁判后,
/// 等价性从**安全属性降级为展示属性**(仅用于列表打标 + clear 预检,两处都是咨询性的)。
///
/// ★★我与评审给的落法有一处**刻意分歧**:它写 `Err(_) => DELETE`。**那会把一次瞬时 DB 错误
/// (sqlite BUSY / 磁盘 / 语句失败)读成「这行坏了」而销毁它。** 故此处严格区分
/// 「**取行/语句失败**」(向上传播 Err,绝不销毁)与「**行取到了、但列转换失败**」(才是 Unmappable)。
fn memory_row_state(conn: &Connection, rowid: i64) -> Result<RowState, String> {
    let mut stmt = conn
        .prepare("SELECT id, fact, embedding, created_at FROM memories WHERE rowid = ?1")
        .map_err(|e| e.to_string())?; // 语句失败 ⇒ 传播,不判定
    let mut rows = stmt.query(params![rowid]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        // 取行失败 ⇒ 传播
        None => Ok(RowState::Missing),
        // 行已在手:此处 map_mem_row 的 Err **只可能**是列转换失败 ⇒ 才是「不可映射」
        Some(r) => Ok(match map_mem_row(r) {
            Ok(_) => RowState::Healthy,
            Err(_) => RowState::Unmappable,
        }),
    }
}

fn memory_remove_corrupt_inner(conn: &Connection, rowid: i64) -> Result<DestroyResult, String> {
    match memory_row_state(conn, rowid)? {
        // 行已不在 ⇒ 诚实 no-op(与 memory_remove 的 deleted=0 同语义,不是错误)
        RowState::Missing => {
            return Ok(DestroyResult {
                deleted: 0,
                undo_token: None,
            })
        }
        // ★结构性守卫:健康行必须走可撤销的常规删除,绝不经此路无快照销毁
        RowState::Healthy => return Err("该记录未损坏:请走常规删除(可撤销),不得绕过快照。".into()),
        RowState::Unmappable => {}
    }
    let n = conn
        .execute("DELETE FROM memories WHERE rowid = ?1", params![rowid])
        .map_err(|e| e.to_string())?;
    Ok(DestroyResult {
        deleted: n,
        undo_token: None, // 不可完整快照 ⇒ 没有可还原之物 ⇒ 绝不发 token
    })
}

/// 「该撤销已失效」并 `return false`,`toast.js` 遂不报「已撤销」。
#[tauri::command]
pub fn memory_undo(
    db: State<'_, Db>,
    trash: State<'_, MemTrash>,
    token: String,
) -> Result<usize, String> {
    let conn = db.0.lock().unwrap();
    let rows = trash.0.lock().unwrap().take(&token);
    match rows {
        Some(rows) => memory_restore_rows(&conn, &rows),
        None => Ok(0), // 环内已无此次销毁(已淘汰 / 已撤销过)⇒ 还原 0 条,前端据此如实上报
    }
}

// ── RAG-over-docs 存储(#2)──────────────────────────────────────────────
// doc_chunks:用户文档切块 + 嵌入。平台能力私有(不在 table_for)、只经 DocContext 自动召回。

/// 批量写入一篇文档的切块(含 embedding)。
pub fn doc_chunks_insert(
    conn: &Connection,
    doc_id: &str,
    doc_name: &str,
    rows: &[(String, Vec<f32>)],
) -> Result<(), String> {
    let now = now_ms();
    for (i, (text, emb)) in rows.iter().enumerate() {
        conn.execute(
            "INSERT OR REPLACE INTO doc_chunks (id, doc_id, doc_name, text, embedding, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![format!("{doc_id}_{i}"), doc_id, doc_name, text, vec_to_blob(emb), now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 读全部切块 `(doc_name, text, embedding)` 供暴力 cosine 检索(跳过缺嵌入行)。
pub fn doc_chunks_all(conn: &Connection) -> Result<Vec<(String, String, Vec<f32>)>, String> {
    let mut stmt = conn
        .prepare("SELECT doc_name, text, embedding FROM doc_chunks")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let dn: String = r.get(0)?;
            let txt: String = r.get(1)?;
            let blob: Option<Vec<u8>> = r.get(2)?;
            Ok((dn, txt, blob))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (dn, txt, blob) = r.map_err(|e| e.to_string())?;
        if let Some(b) = blob {
            out.push((dn, txt, blob_to_vec(&b)));
        }
    }
    Ok(out)
}

/// 列出文档(按 doc_id 聚合:名 + 片段数 + 时间)——供管理 UI。**不含 embedding / 全文**。
#[tauri::command]
pub fn doc_list(db: State<'_, Db>) -> Result<Vec<Value>, String> {
    let conn = db.0.lock().unwrap();
    doc_list_inner(&conn)
}

/// 命令体(供单测直调;命令只取锁转调)。
fn doc_list_inner(conn: &Connection) -> Result<Vec<Value>, String> {
    // ★逃生口(③):**列表永不因一个坏片段而整体失败**。实测 `MAX(created_at)` 为 TEXT 时原实现整表列不出,
    //   而 `doc_chunks_all`(RAG 召回那条路)照常返回 —— 用户看到「知识库为空」,AI 却仍在检索它。
    //   `ts` 只取 Integer 型的最大值;`corrupt` = 本篇是否含不可映射片段(该篇的删除将不可撤销)。
    let sql = format!(
        "SELECT doc_id, doc_name, COUNT(*) AS chunks, \
         MAX(CASE WHEN typeof(created_at)='integer' THEN created_at ELSE 0 END) AS ts, \
         MAX(CASE WHEN ({DOC_CORRUPT_PRED}) THEN 1 ELSE 0 END) AS corrupt \
         FROM doc_chunks GROUP BY doc_id ORDER BY ts DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let chunks: i64 = r.get(2)?;
            let corrupt: i64 = r.get(4)?;
            Ok(serde_json::json!({
                "docId": text_lossy(r, 0)?,
                "name": text_lossy(r, 1)?,
                "chunks": chunks,
                "ts": int_lossy(r, 3)?,
                "corrupt": corrupt != 0,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ── 文档销毁撤销(DocTrash;与 MemTrash 对称)──────────────────────────
/// 暂存"最近一次文档销毁(删一篇 / 清空)"的整行(含 embedding),供 doc_undo 还原。进程内、重启即失。
type DocRow = (String, String, String, String, Vec<f32>, i64); // (id, doc_id, doc_name, text, embedding, created_at)
impl UndoBytes for DocRow {
    fn heap_bytes(&self) -> usize {
        self.0.capacity()
            + self.1.capacity()
            + self.2.capacity()
            + self.3.capacity()
            + self.4.capacity() * std::mem::size_of::<f32>()
    }
}
/// **物化前**估算「这次文档销毁的快照会占多少环字节」(上界)。与 memory 侧同纪律。
///
/// `doc_id = None` → 整库(`doc_clear`);`Some(id)` → 单篇(`doc_remove`)。
///
/// ★评审第64轮 [应改]:`doc_remove` 原先**既无预检、又先物化整篇再让环拒绝** —— 与第62轮问题4
/// (`doc_clear` 的瞬时分配)是**同一缺陷换了一条支路**。评审原话:
/// **「一条只在 3/4 条销毁路径上成立的不变式,不是不变式。」**
fn doc_undo_bytes(conn: &Connection, doc_id: Option<&str>) -> Result<usize, String> {
    const SUMS: &str = "SELECT COALESCE(SUM(LENGTH(CAST(id AS BLOB)) + LENGTH(CAST(doc_id AS BLOB)) + LENGTH(CAST(doc_name AS BLOB)) + LENGTH(CAST(text AS BLOB)) + LENGTH(COALESCE(embedding, x''))), 0), COUNT(*) FROM doc_chunks";
    let (payload, rows): (i64, i64) = match doc_id {
        Some(did) => conn.query_row(&format!("{SUMS} WHERE doc_id = ?1"), params![did], |r| {
            Ok((r.get(0)?, r.get(1)?))
        }),
        None => conn.query_row(SUMS, [], |r| Ok((r.get(0)?, r.get(1)?))),
    }
    .map_err(|e| e.to_string())?;
    Ok(undo_bytes_upper_bound(
        payload,
        rows,
        std::mem::size_of::<DocRow>(),
    ))
}

#[derive(Default)]
pub struct DocTrash(pub Mutex<UndoRing<DocRow>>);

fn map_doc_row(r: &rusqlite::Row) -> rusqlite::Result<DocRow> {
    let blob: Option<Vec<u8>> = r.get(4)?;
    let ts: i64 = r.get::<_, Option<i64>>(5)?.unwrap_or(0); // schema DEFAULT 0 → NULL 归一化(与 memory 侧四处一致)
    Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        blob.map(|b| blob_to_vec(&b)).unwrap_or_default(),
        ts,
    ))
}

/// 快照 doc_chunks 整行(doc_id=Some → 一篇;None → 全部),含 embedding。
fn doc_snapshot(conn: &Connection, doc_id: Option<&str>) -> Result<Vec<DocRow>, String> {
    let sql = "SELECT id, doc_id, doc_name, text, embedding, created_at FROM doc_chunks";
    let mut out = Vec::new();
    match doc_id {
        Some(did) => {
            let mut stmt = conn
                .prepare(&format!("{sql} WHERE doc_id = ?1"))
                .map_err(|e| e.to_string())?;
            let it = stmt
                .query_map(params![did], map_doc_row)
                .map_err(|e| e.to_string())?;
            for r in it {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
            let it = stmt.query_map([], map_doc_row).map_err(|e| e.to_string())?;
            for r in it {
                out.push(r.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

fn doc_restore_rows(conn: &Connection, rows: &[DocRow]) -> Result<usize, String> {
    let mut n = 0;
    for (id, doc_id, doc_name, text, emb, ts) in rows {
        conn.execute(
            "INSERT OR REPLACE INTO doc_chunks (id, doc_id, doc_name, text, embedding, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, doc_id, doc_name, text, vec_to_blob(emb), ts],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// 删除一篇文档(其全部切块)。**删前快照进 DocTrash**,供撤销。
#[tauri::command]
pub fn doc_remove(
    db: State<'_, Db>,
    trash: State<'_, DocTrash>,
    doc_id: String,
) -> Result<DestroyResult, String> {
    let conn = db.0.lock().unwrap();
    doc_remove_inner(&conn, &trash.0, &doc_id)
}

/// 删除一篇文档的**真实逻辑**(与 memory_remove_inner 同构;抽出以便单测覆盖真实命令体 · [建议]3)。
fn doc_remove_inner(
    conn: &Connection,
    ring: &Mutex<UndoRing<DocRow>>,
    doc_id: &str,
) -> Result<DestroyResult, String> {
    // ★第64轮 [应改]:先用 SQL 量字节,超上限则**根本不物化**(一篇上万 chunk 的大语料不得先分配再被环拒绝),
    //   且与 `doc_remove_undoable` 用**同一个上限** ⇒「预检说可撤销 ⇒ stash 必接受」。
    //   销毁照常发生:红线只要求**永不谎报撤销**,并未要求拒绝销毁。
    let cap = ring.lock().unwrap().max_bytes();
    // 预检与本函数共用同一判据(超上限 / 有不可映射行 ⇒ 不物化、不发 token,但**照常销毁** = 逃生口)。
    let undoable = doc_precheck(conn, cap, Some(doc_id))?.undoable;
    let snap = if undoable {
        doc_snapshot(conn, Some(doc_id))? // 承诺可撤销 ⇒ 快照仍严格 fail-closed
    } else {
        Vec::new() // 超上限 / 有损坏片段:不物化、不发 token、不淘汰既有条目(环不变式①③)
    };
    let n = conn
        .execute("DELETE FROM doc_chunks WHERE doc_id = ?1", params![doc_id])
        .map_err(|e| e.to_string())?;
    let undo_token = ring.lock().unwrap().stash(snap); // 与 memory_remove_inner 同构
    Ok(DestroyResult {
        deleted: n,
        undo_token,
    })
}

/// 清空全部文档。**删前快照进 DocTrash**,供撤销。
#[tauri::command]
pub fn doc_clear(db: State<'_, Db>, trash: State<'_, DocTrash>) -> Result<DestroyResult, String> {
    let conn = db.0.lock().unwrap();
    doc_clear_inner(&conn, &trash.0)
}

/// 清空知识库的**真实逻辑**;超上限时**根本不物化快照**(与 memory_clear_inner 同纪律)。
fn doc_clear_inner(
    conn: &Connection,
    ring: &Mutex<UndoRing<DocRow>>,
) -> Result<DestroyResult, String> {
    let cap = ring.lock().unwrap().max_bytes();
    let undoable = doc_precheck(conn, cap, None)?.undoable;
    let snap = if undoable {
        doc_snapshot(conn, None)?
    } else {
        Vec::new() // 超上限:不物化(2 GiB 知识库不得先分配 2 GiB 再被环拒绝);有损坏片段:同样不物化
    };
    let n = conn
        .execute("DELETE FROM doc_chunks", [])
        .map_err(|e| e.to_string())?;
    let undo_token = ring.lock().unwrap().stash(snap);
    Ok(DestroyResult {
        deleted: n,
        undo_token,
    })
}

/// 预检:这次「清空知识库」是否可撤销?供确认弹窗说真话(评审第62轮 [应改])。
#[tauri::command]
pub fn doc_clear_undoable(
    db: State<'_, Db>,
    trash: State<'_, DocTrash>,
) -> Result<UndoPrecheck, String> {
    let conn = db.0.lock().unwrap();
    let cap = trash.0.lock().unwrap().max_bytes();
    doc_precheck(&conn, cap, None)
}

/// 预检:这次「删除单篇文档」是否可撤销?(评审第64轮 [应改] · 队首)
///
/// 与 `doc_clear_undoable` 同款,只是 `WHERE doc_id = ?1`。**存在的理由是决策点诚实**:
/// guardrail 在**建对话框时**就据 `onUndo` 是否存在印出「执行后可撤销。」——
/// 若等到 `onConfirm` 执行时才发现整篇超上限,那句话**已经出口**了。
#[tauri::command]
pub fn doc_remove_undoable(
    db: State<'_, Db>,
    trash: State<'_, DocTrash>,
    doc_id: String,
) -> Result<UndoPrecheck, String> {
    let conn = db.0.lock().unwrap();
    let cap = trash.0.lock().unwrap().max_bytes();
    doc_precheck(&conn, cap, Some(&doc_id))
}

/// 撤销**指定 token 的那一次**文档销毁(删一篇 / 清空):从 DocTrash 的环里按 token 取出并还原
/// (原 id / embedding / 时间无损)。**token 必填**(刀2b-2);未命中(已淘汰 / 未知 / 已被取走)
/// ⇒ 还原 0 条,绝不静默成功。
#[tauri::command]
pub fn doc_undo(
    db: State<'_, Db>,
    trash: State<'_, DocTrash>,
    token: String,
) -> Result<usize, String> {
    let conn = db.0.lock().unwrap();
    let rows = trash.0.lock().unwrap().take(&token);
    match rows {
        Some(rows) => doc_restore_rows(&conn, &rows),
        None => Ok(0), // 环内已无此次销毁 ⇒ 还原 0 条,绝不静默成功
    }
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

    /// 造一条已知字节数的记忆行:`undo_bytes = id.len() + 0 + 4*emb_len + 8`。
    fn mrow(id: &str, emb_len: usize) -> super::MemRow {
        (id.to_string(), String::new(), vec![0.0f32; emb_len], 0)
    }

    /// ★不变式①(从单槽时代带进环,评审第61轮点名):**空快照永不入环** ——
    /// no-op 销毁不发 token、**不淘汰任何东西**。含**阳性对照**:旧的单槽「无条件覆盖」确会把
    /// 上一次的快照清成空(缺陷真实、测试能捕获)。
    #[test]
    fn noop_destroy_must_not_clobber_undo_slot() {
        use std::sync::Mutex;

        // ── 阳性对照:旧行为 `*slot = snap` 无条件覆盖 ⇒ 空快照把 A 清掉
        let old: Mutex<Vec<super::MemRow>> = Mutex::new(Vec::new());
        *old.lock().unwrap() = vec![mrow("A", 0)]; // 第一次真销毁
        *old.lock().unwrap() = Vec::new(); // 第二次 no-op 删除(空快照)
        assert!(
            old.lock().unwrap().is_empty(),
            "阳性对照:旧的无条件覆盖确会清空撤销槽(A 的快照永久丢失)"
        );

        // ── 阴性:环里,空快照不入环、不发 token、不淘汰旧条目
        let mut ring: super::UndoRing<super::MemRow> = Default::default();
        let ta = ring.stash(vec![mrow("A", 0)]).expect("真销毁应发 token");
        assert!(
            ring.stash(Vec::new()).is_none(),
            "空快照不得入环、不得发 token"
        );
        assert_eq!(ring.len(), 1, "no-op 销毁不得淘汰任何条目");
        assert!(ring.has(&ta), "A 那一次仍应在环内");

        // 真销毁正常入环,且**不再覆盖**上一次(单槽时代会覆盖 —— 这正是环的价值)
        let tb = ring.stash(vec![mrow("B", 0)]).unwrap();
        assert_eq!(ring.len(), 2, "环应同时保有 A 与 B 两次销毁");
        assert!(ring.has(&ta) && ring.has(&tb));
    }

    /// ★不变式③ + 双判据淘汰:条数上限、字节上限、以及**单次超限快照不入环、不发 token**。
    #[test]
    fn undo_ring_evicts_by_count_and_bytes_and_rejects_oversized() {
        // ── 条数判据:上限 2,推 3 条 ⇒ 最旧被淘汰
        let mut ring: super::UndoRing<super::MemRow> = super::UndoRing::with_bounds(2, 1 << 20);
        let t1 = ring.stash(vec![mrow("1", 0)]).unwrap();
        let t2 = ring.stash(vec![mrow("2", 0)]).unwrap();
        let t3 = ring.stash(vec![mrow("3", 0)]).unwrap();
        assert_eq!(ring.len(), 2, "条数上限应触发淘汰");
        assert!(!ring.has(&t1), "最旧的应被淘汰");
        assert!(ring.has(&t2) && ring.has(&t3));

        // ── 字节判据:先量出「一条」的真实入环开销(口径含 capacity + 结构体 + 环条目 + token),
        //    再据此设上限 ⇒ 测试不写死魔数,口径改了也不会假绿。
        let one = {
            let mut probe: super::UndoRing<super::MemRow> =
                super::UndoRing::with_bounds(100, usize::MAX);
            probe.stash(vec![mrow("a", 5)]).unwrap();
            probe.total_bytes()
        };
        assert!(one > 0);
        let mut ring: super::UndoRing<super::MemRow> =
            super::UndoRing::with_bounds(100, one * 2 + one / 2); // 恰好容 2 条
        let a = ring.stash(vec![mrow("a", 5)]).unwrap();
        let b = ring.stash(vec![mrow("b", 5)]).unwrap();
        let c = ring.stash(vec![mrow("c", 5)]).unwrap();
        assert!(ring.total_bytes() <= one * 2 + one / 2, "字节上限必须成立");
        assert_eq!(ring.len(), 2, "字节判据应把最旧的淘汰掉");
        assert!(!ring.has(&a), "字节判据应淘汰最旧");
        assert!(ring.has(&b) && ring.has(&c));

        // ── 不变式③:单次快照超字节上限 ⇒ 不入环、不发 token、旧条目不受影响
        let mut ring: super::UndoRing<super::MemRow> = super::UndoRing::with_bounds(10, one);
        let keep = ring.stash(vec![mrow("k", 0)]).unwrap();
        let huge = ring.stash(vec![mrow("h", 10_000)]); // 远超 one
        assert!(huge.is_none(), "超上限快照不得入环、不得发 token");
        assert_eq!(ring.len(), 1, "超限快照不得淘汰既有条目");
        assert!(ring.has(&keep));
    }

    /// ★评审第62轮 [应改] + 问题4:`clear` **必须在物化前**用 SQL 估算;超上限则
    /// **根本不快照**(不把整库 embedding 拉进 RAM)、**不发 token**、**不淘汰既有条目**;
    /// 且 `*_clear_undoable()` 的预检结论必须与 `clear` 的实际行为**一致**
    /// —— 否则确认弹窗会在用户**做决定之前**承诺一个做不到的撤销。
    #[test]
    fn clear_over_byte_cap_skips_snapshot_and_matches_its_own_precheck() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups");
        migrate(&mut conn, &tmp).unwrap();

        // 一条带 4KiB embedding 的记忆(1024 个 f32)
        let emb: Vec<u8> = (0..1024u32)
            .flat_map(|i| (i as f32).to_le_bytes())
            .collect();
        conn.execute(
            "INSERT INTO memories (id, fact, embedding, created_at) VALUES ('m1','fact',?1,1)",
            rusqlite::params![emb],
        )
        .unwrap();

        // 量出「一条最小条目」的真实入环开销(新口径含 String/Vec 头 + 环条目 + token),
        // 上限恰设为它 ⇒ PREV 装得下,而带 4KiB embedding 的整表快照必然超限。
        let one_small = {
            let mut probe: super::UndoRing<super::MemRow> =
                super::UndoRing::with_bounds(8, usize::MAX);
            probe.stash(vec![mrow("PREV", 0)]).unwrap();
            probe.total_bytes()
        };
        let ring: Mutex<super::UndoRing<super::MemRow>> =
            Mutex::new(super::UndoRing::with_bounds(8, one_small));
        // 环里先躺着一条「上一次销毁」——它绝不能被淘汰,也绝不能被错还原
        let prev = ring.lock().unwrap().stash(vec![mrow("PREV", 0)]).unwrap();

        // 预检:应判为不可撤销(与下面 clear 的行为一致)
        let cap = ring.lock().unwrap().max_bytes();
        let est = super::memory_clear_undo_bytes(&conn).unwrap();
        assert!(est > cap, "该库的快照应超过环上限");

        // clear:销毁照常发生,但**不发 token**、**不淘汰 PREV**
        let r = super::memory_clear_inner(&conn, &ring).unwrap();
        assert_eq!(r.deleted, 1, "销毁照常发生(红线不要求拒绝销毁)");
        assert!(
            r.undo_token.is_none(),
            "超上限 ⇒ 不发 token ⇒ 前端不提供撤销"
        );
        let g = ring.lock().unwrap();
        assert_eq!(g.len(), 1, "超上限的 clear 不得淘汰既有条目");
        assert!(g.has(&prev), "PREV 那一次必须原封不动");
        drop(g);

        // 反面:上限足够大时,预检说可撤销,clear 也确实发 token
        let mut conn2 = Connection::open_in_memory().unwrap();
        migrate(&mut conn2, &tmp).unwrap();
        conn2
            .execute(
                "INSERT INTO memories (id, fact, embedding, created_at) VALUES ('m1','fact',NULL,1)",
                [],
            )
            .unwrap();
        let ring2: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());
        let cap2 = ring2.lock().unwrap().max_bytes();
        assert!(
            super::memory_clear_undo_bytes(&conn2).unwrap() <= cap2,
            "小库预检应判为可撤销"
        );
        let r2 = super::memory_clear_inner(&conn2, &ring2).unwrap();
        assert_eq!(r2.deleted, 1);
        assert!(
            r2.undo_token.is_some(),
            "预检说可撤销 ⇒ clear 必须真的发 token"
        );
    }

    /// ★跨进程契约:`DestroyResult` 必须序列化为 `{ deleted, undoToken }`。
    /// 若 `#[serde(rename)]` 写错,前端读到 `undefined` ⇒ `token == null` 成立 ⇒ `offerUndo` 判为
    /// 「超上限、无法撤销」⇒ **每次真实删除都静默失去撤销**,而无任何测试会红。故在此钉死。
    #[test]
    fn destroy_result_serializes_as_deleted_and_camel_case_undo_token() {
        let some = serde_json::to_value(super::DestroyResult {
            deleted: 3,
            undo_token: Some("u7".into()),
        })
        .unwrap();
        assert_eq!(some["deleted"], 3);
        assert_eq!(some["undoToken"], "u7");
        assert!(
            some.get("undo_token").is_none(),
            "不得暴露 snake_case 字段名(前端按 undoToken 读)"
        );

        let none = serde_json::to_value(super::DestroyResult {
            deleted: 0,
            undo_token: None,
        })
        .unwrap();
        assert!(
            none["undoToken"].is_null(),
            "无 token 须序列化为 null(前端据此不提供撤销)"
        );
    }

    /// ★环的价值兑现 + **刀2b-2 的结构性保证**:撤销**只能**作用于它自己那一次销毁。
    /// `take` 的 `token` 已是必填 —— 「取最近一次」的 affordance 在**类型层面**不存在,
    /// 故「一次虚假的撤销还原了别人那一次销毁」**不可能被表达**。
    #[test]
    fn undo_ring_takes_only_its_own_entry_by_token() {
        let mut ring: super::UndoRing<super::MemRow> = Default::default();
        let ta = ring.stash(vec![mrow("A", 0)]).unwrap();
        let tb = ring.stash(vec![mrow("B", 0)]).unwrap();

        // ★即便 A 不是环顶(B 才是),按 A 的 token 撤销也**只**还原 A —— 绝不会碰到 B。
        let rows = ring.take(&ta).expect("按 token 应取到 A 那一次");
        assert_eq!(rows[0].0, "A", "必须还原它自己那一次,而非环顶");
        assert!(!ring.has(&ta), "取走后应移出环");
        assert!(ring.has(&tb), "B 那一次不受影响");

        // 未知 token → None(命令遂返回 0,绝不静默成功)
        assert!(ring.take("nope").is_none());
        // 同一 token 二次撤销 → None(已被取走)⇒ 前端如实上报「该撤销已失效」
        assert!(ring.take(&ta).is_none(), "同一 token 不得被撤销两次");
        // B 仍可按自己的 token 撤销
        assert_eq!(ring.take(&tb).unwrap()[0].0, "B");
        // 环空 → 任何 token 都 None
        assert!(ring.take(&tb).is_none());
    }

    /// ★不变式④(评审第63轮 [应改])· **token 跨环唯一 —— 一个环的 token 永不命中另一个环的条目**。
    ///
    /// 修前:每个环各有 `next: u64` 且都从 1 起 ⇒ `MemTrash` 与 `DocTrash` 的首个 token **同为 `"u1"`**
    /// ⇒ 把记忆的 token 传给 `doc_undo` 会**静默还原一次用户没要求撤销的文档销毁**。
    /// (今天不可达,因为四条前端路径各自捕获自己的 token —— 但那是**约定**,不是结构。)
    /// 修后:序号取自进程级 `UNDO_TOKEN_SEQ` ⇒ 错配的 token 必然落空 → `None` → 还原 0 条 → `staleUndo()`。
    ///
    /// **阳性对照**:`local_next` 复刻旧的「每环自己从 1 起」——同一断言下它必定相撞,证明缺陷真实、断言能红。
    #[test]
    fn undo_tokens_never_collide_across_independent_rings() {
        // 阳性对照:旧口径(每环自己的计数器)—— 两个独立环的首个 token 相同。
        let local_next_mem = 1u64;
        let local_next_doc = 1u64;
        assert_eq!(
            format!("u{local_next_mem}"),
            format!("u{local_next_doc}"),
            "阳性对照:旧的每环计数器确会撞号(缺陷真实)"
        );

        // 生产口径:两个**类型不同、实例独立**的环,token 仍全局唯一。
        let mut mem: super::UndoRing<super::MemRow> = Default::default();
        let mut doc: super::UndoRing<super::DocRow> = Default::default();
        let tm = mem.stash(vec![mrow("A", 0)]).unwrap();
        let td = doc
            .stash(vec![(
                "c1".into(),
                "d1".into(),
                "JD".into(),
                "文本".into(),
                vec![],
                0,
            )])
            .unwrap();
        assert_ne!(tm, td, "两个环的 token 不得重号");

        // ★结构性后果:把记忆的 token 交给文档环 → 落空,绝不还原「同序号的另一次销毁」。
        assert!(doc.take(&tm).is_none(), "错配的 token 必须落空,而非命中");
        assert!(mem.take(&td).is_none(), "反向亦然");
        // 各自的 token 仍正常工作。
        assert_eq!(mem.take(&tm).unwrap()[0].0, "A");
        assert_eq!(doc.take(&td).unwrap()[0].1, "d1");
    }

    /// ★评审第63轮 [建议] · **预检估计 ≥ stash 实际** —— 否则第62轮 [应改](决策点谎报)原样复发:
    /// 预检说可撤销 → 确认文案承诺 → clear 执行 → stash 因超限拒绝 → 无 token → 「内容过大,无法撤销」。
    ///
    /// 两处用的是**两套账**:预检是 SQL 侧估计(`payload*2 + rows*row_size*2 + OVERHEAD`),
    /// stash 是真实 `capacity` 口径。它们只共用同一个 `max_bytes()`,**估计式并不相同** ⇒ 必须钉死方向。
    ///
    /// **阳性对照**:`bound_factor1` 复刻「系数取 1」的版本。行数足够时 `Vec` 的摊还增长
    /// (`memory_rows_full` 用 `push`,容量按 4→8→16→32 翻倍)会让 `rows.capacity() > rows.len()`,
    /// 系数 1 遂**低估** ⇒ 断言必红。证明这条测试守的是生产代码,不是它自己。
    #[test]
    fn clear_precheck_upper_bound_is_never_below_actual_stash_bytes() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-bound");
        migrate(&mut conn, &tmp).unwrap();
        // 多条**小行**:让「Vec 槽位 + 结构体开销」而非载荷主导 —— 正是第62轮假上限的失效面。
        for i in 0..17 {
            super::memory_add(&conn, &format!("m{i}"), "x", &[0.5, 0.25]).unwrap();
        }

        let bound = super::memory_clear_undo_bytes(&conn).unwrap();
        let rows = super::memory_rows_full(&conn).unwrap();
        let (payload, n_rows): (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(CAST(id AS BLOB)) + LENGTH(CAST(fact AS BLOB)) + LENGTH(COALESCE(embedding, x''))), 0), COUNT(*) FROM memories",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        // 阳性对照:系数取 1(= 忘了 capacity 可超 len)——必须低于实际,否则本测试是死靶。
        let bound_factor1 = (payload.max(0) as usize)
            + (n_rows.max(0) as usize) * std::mem::size_of::<super::MemRow>()
            + 256;

        // 实际入环字节 = 生产 `stash` 自己算的那个数(上限设成天文数字,保证必入环)。
        let mut ring: super::UndoRing<super::MemRow> = super::UndoRing::with_bounds(8, usize::MAX);
        ring.stash(rows).unwrap();
        let actual = ring.total_bytes();

        assert!(
            bound >= actual,
            "预检上界 {bound} 必须 ≥ stash 实际 {actual},否则「预检说可撤销 → stash 拒绝」= 决策点谎报"
        );
        assert!(
            bound_factor1 < actual,
            "阳性对照失效:系数 1 的上界 {bound_factor1} 竟未低于实际 {actual} —— 断言红不起来,本测试是死靶"
        );
    }

    /// ★评审第64轮 [应改](队首)· **`doc_remove` 的单篇预检**:与 `doc_clear` 同款,不可让同一缺陷
    /// 因所在支路不同而两种待遇。三条性质一起钉:
    ///  ① **预检与 `doc_remove_inner` 结论一致**(同一个 `max_bytes()`);
    ///  ② 超上限 ⇒ 销毁照常发生、**不发 token**、**不淘汰既有条目**、且**根本不物化**快照;
    ///  ③ **只量这一篇**(`WHERE doc_id`)—— 阳性对照:另一篇很大时不得把这一篇也判成不可撤销。
    #[test]
    fn doc_remove_precheck_is_per_doc_and_matches_its_own_removal() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-docprecheck");
        migrate(&mut conn, &tmp).unwrap();

        // small = 一个微小片段;big = 带 4096 个 f32(16 KiB)的片段
        super::doc_chunks_insert(&conn, "small", "小文档", &[("s".into(), vec![0.5])]).unwrap();
        let big_emb: Vec<f32> = (0..4096).map(|i| i as f32).collect();
        super::doc_chunks_insert(&conn, "big", "大文档", &[("b".into(), big_emb)]).unwrap();

        // 上限 = 恰好装得下 small 那一篇的真实入环开销
        let small_cost = {
            let mut probe: super::UndoRing<super::DocRow> =
                super::UndoRing::with_bounds(8, usize::MAX);
            probe
                .stash(super::doc_snapshot(&conn, Some("small")).unwrap())
                .unwrap();
            probe.total_bytes()
        };
        let ring: Mutex<super::UndoRing<super::DocRow>> =
            Mutex::new(super::UndoRing::with_bounds(8, small_cost));
        let prev = ring
            .lock()
            .unwrap()
            .stash(super::doc_snapshot(&conn, Some("small")).unwrap())
            .unwrap();
        let cap = ring.lock().unwrap().max_bytes();

        // ③ 逐篇量:big 超限、small 不超限。**阳性对照** —— 若 SQL 漏了 `WHERE doc_id`,
        //    small 会把 big 的字节也算进来而被判不可撤销,本断言即红。
        assert!(
            super::doc_undo_bytes(&conn, Some("big")).unwrap() > cap,
            "大文档应判为不可撤销"
        );
        assert!(
            super::doc_undo_bytes(&conn, Some("small")).unwrap() <= cap,
            "小文档不得因『别的文档很大』而被判不可撤销(WHERE doc_id 漏了就会这样)"
        );
        // 反面:整库口径确实把两篇都算上 ⇒ 超限(证明 None 与 Some 走的是不同集合)
        assert!(super::doc_undo_bytes(&conn, None).unwrap() > cap);

        // ①② 删 big:销毁发生、不发 token、不淘汰 PREV
        let r = super::doc_remove_inner(&conn, &ring, "big").unwrap();
        assert_eq!(r.deleted, 1, "销毁照常发生(红线不要求拒绝销毁)");
        assert!(r.undo_token.is_none(), "超上限 ⇒ 不发 token ⇒ 前端不给撤销");
        {
            let g = ring.lock().unwrap();
            assert_eq!(g.len(), 1, "超上限的 remove 不得淘汰既有条目");
            assert!(g.has(&prev), "PREV 那一次必须原封不动");
        }

        // ① 反面:删 small(预检说可撤销)⇒ 确实发 token
        let r2 = super::doc_remove_inner(&conn, &ring, "small").unwrap();
        assert_eq!(r2.deleted, 1);
        assert!(
            r2.undo_token.is_some(),
            "预检说可撤销 ⇒ stash 必接受(两处同一个 max_bytes)"
        );
    }

    /// ★与 memory 侧同款:`doc_remove` 的**预检估计 ≥ stash 实际**,否则「预检说可撤销 → 承诺 →
    /// 执行 → stash 拒绝」= 决策点谎报复发。阳性对照:系数取 1 必然低估(Vec 容量摊还翻倍)。
    #[test]
    fn doc_remove_precheck_upper_bound_is_never_below_actual_stash_bytes() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-docbound");
        migrate(&mut conn, &tmp).unwrap();
        // 多个**小片段**:让 Vec 槽位 + 结构体开销主导(载荷主导时系数 1 也能过 ⇒ 测试成死靶)
        let chunks: Vec<(String, Vec<f32>)> =
            (0..17).map(|i| (format!("c{i}"), vec![0.5])).collect();
        super::doc_chunks_insert(&conn, "d1", "文档", &chunks).unwrap();

        let bound = super::doc_undo_bytes(&conn, Some("d1")).unwrap();
        let (payload, n_rows): (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(CAST(id AS BLOB)) + LENGTH(CAST(doc_id AS BLOB)) + LENGTH(CAST(doc_name AS BLOB)) + LENGTH(CAST(text AS BLOB)) + LENGTH(COALESCE(embedding, x''))), 0), COUNT(*) FROM doc_chunks WHERE doc_id = 'd1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let bound_factor1 = (payload.max(0) as usize)
            + (n_rows.max(0) as usize) * std::mem::size_of::<super::DocRow>()
            + 256;

        let mut ring: super::UndoRing<super::DocRow> = super::UndoRing::with_bounds(8, usize::MAX);
        ring.stash(super::doc_snapshot(&conn, Some("d1")).unwrap())
            .unwrap();
        let actual = ring.total_bytes();

        assert!(
            bound >= actual,
            "预检上界 {bound} 必须 ≥ stash 实际 {actual}"
        );
        assert!(
            bound_factor1 < actual,
            "阳性对照失效:系数 1 的上界 {bound_factor1} 未低于实际 {actual} —— 断言红不起来"
        );
    }

    // ═══ 逃生口(评审第64轮次序 ③)· 不可映射行 ═══════════════════════════

    /// SQL 的 `typeof()` 谓词与 rusqlite `FromSql` 的接受集**逐形态等价**。
    ///
    /// ★评审第65轮之后,这条等价性是**展示属性**,不再是安全属性:`memory_remove_corrupt` 的守卫已改由
    /// `memory_row_state`(=快照映射本身)裁决,谓词只用于**列表打标**与 **clear 预检**(两处都是咨询性的)。
    /// 谓词若与 rusqlite 漂移,后果是「行的 corrupt 标记 / 预检理由不准」,**而不是「健康行被无撤销地销毁」**。
    /// 故本测试仍然要跑(它守着 UI 的诚实),但**它不再是安全边界**。
    ///
    /// **阳性对照**:`WEAK_PRED` 少判 `created_at` 一列 —— 对 `created_at='abc'` 它说「没坏」,
    /// 而 rusqlite 映射失败 ⇒ 二者分歧。断言这个分歧**确实存在**,证明本测试能分辨谓词的对错。
    #[test]
    fn typeof_predicate_matches_rusqlite_acceptance() {
        const WEAK_PRED: &str = "typeof(id)<>'text' OR typeof(fact)<>'text' OR typeof(embedding) NOT IN ('blob','null')";
        let cases: [(&str, &str, bool); 6] = [
            (
                "healthy",
                "INSERT INTO memories VALUES ('m','f',NULL,1)",
                false,
            ),
            (
                "created_at=TEXT",
                "INSERT INTO memories VALUES ('m','f',NULL,'abc')",
                true,
            ),
            (
                "created_at=REAL",
                "INSERT INTO memories VALUES ('m','f',NULL,1.5)",
                true,
            ),
            (
                "fact=BLOB",
                "INSERT INTO memories VALUES ('m',X'00FF',NULL,1)",
                true,
            ),
            (
                "id=BLOB",
                "INSERT INTO memories VALUES (X'00FF','f',NULL,1)",
                true,
            ),
            (
                "embedding=TEXT",
                "INSERT INTO memories VALUES ('m','f','notablob',1)",
                true,
            ),
        ];
        let mut weak_disagreed = false;
        for (label, insert, expect_corrupt) in cases {
            let mut conn = Connection::open_in_memory().unwrap();
            let tmp = std::env::temp_dir().join("seeker-test-typeof");
            migrate(&mut conn, &tmp).unwrap();
            conn.execute(insert, []).unwrap();

            let pred_says_bad = super::mem_corrupt_count(&conn).unwrap() > 0;
            let rusqlite_fails = super::memory_rows_full(&conn).is_err();
            assert_eq!(
                pred_says_bad, rusqlite_fails,
                "[{label}] typeof 谓词判「损坏」={pred_says_bad},而 rusqlite 映射失败={rusqlite_fails} —— 两者必须一致"
            );
            assert_eq!(
                pred_says_bad, expect_corrupt,
                "[{label}] 期望 corrupt={expect_corrupt}"
            );

            // 阳性对照:弱化谓词(漏判 created_at)在 created_at 两例上与 rusqlite 分歧
            let weak_bad: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM memories WHERE ({WEAK_PRED})"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            if (weak_bad > 0) != rusqlite_fails {
                weak_disagreed = true;
            }
        }
        assert!(
            weak_disagreed,
            "阳性对照失效:弱化谓词竟与 rusqlite 处处一致 —— 本测试分辨不出谓词的对错,是死靶"
        );
    }

    /// ★★守卫的**真正判据**(评审第65轮 [建议]强):`memory_row_state` 直接问 `map_mem_row`
    /// (快照代码本身),不问任何代理谓词。三态必须准确,且**瞬时 DB 错误绝不能被读成「这行坏了」**。
    #[test]
    fn row_state_asks_the_snapshot_itself_not_a_proxy_predicate() {
        let cases: [(&str, &str); 5] = [
            (
                "created_at=TEXT",
                "INSERT INTO memories VALUES ('m','f',NULL,'abc')",
            ),
            (
                "created_at=REAL",
                "INSERT INTO memories VALUES ('m','f',NULL,1.5)",
            ),
            (
                "fact=BLOB",
                "INSERT INTO memories VALUES ('m',X'00FF',NULL,1)",
            ),
            (
                "id=BLOB",
                "INSERT INTO memories VALUES (X'00FF','f',NULL,1)",
            ),
            (
                "embedding=TEXT",
                "INSERT INTO memories VALUES ('m','f','notablob',1)",
            ),
        ];
        for (label, insert) in cases {
            let mut conn = Connection::open_in_memory().unwrap();
            let tmp = std::env::temp_dir().join("seeker-test-rowstate");
            migrate(&mut conn, &tmp).unwrap();
            conn.execute(insert, []).unwrap();
            let rowid: i64 = conn
                .query_row("SELECT rowid FROM memories LIMIT 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                super::memory_row_state(&conn, rowid).unwrap(),
                super::RowState::Unmappable,
                "[{label}] 快照映射失败 ⇒ Unmappable"
            );
        }

        // 健康行 → Healthy(阳性对照:三态判据能分辨,不是恒返 Unmappable)
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-rowstate-ok");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "good", "健康行", &[0.1]).unwrap();
        let good: i64 = conn
            .query_row("SELECT rowid FROM memories WHERE id='good'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            super::memory_row_state(&conn, good).unwrap(),
            super::RowState::Healthy
        );
        // 不存在 → Missing(≠ Unmappable:绝不能把「行不在」当成「行坏了」而去 DELETE)
        assert_eq!(
            super::memory_row_state(&conn, 999_999).unwrap(),
            super::RowState::Missing
        );

        // ★★瞬时 DB 错误(表被删 ⇒ prepare 失败)必须**传播为 Err**,绝不判成 Unmappable。
        //   评审给的落法 `Err(_) => DELETE` 会在此把一次 sqlite 故障读成「这行坏了」而销毁它。
        conn.execute("DROP TABLE memories", []).unwrap();
        assert!(
            super::memory_row_state(&conn, good).is_err(),
            "语句/取行失败必须向上传播,不得被判定为 Unmappable"
        );
    }

    /// ★★守卫**不再依赖谓词**:即便 `MEM_CORRUPT_PRED` 把健康行错标为损坏(前端遂渲染出逃生口按钮),
    /// 后端仍必须拒绝销毁它 —— 因为裁判是快照,不是谓词。
    /// (此处用「谓词说坏、快照说好」的真实分歧做断言:健康行的谓词判定为 false,故直接断言二者结论不同源。)
    #[test]
    fn guard_refuses_healthy_row_even_if_a_predicate_would_call_it_corrupt() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-guard-source");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "good", "健康行", &[0.1]).unwrap();
        let rowid: i64 = conn
            .query_row("SELECT rowid FROM memories WHERE id='good'", [], |r| {
                r.get(0)
            })
            .unwrap();

        // 模拟一个「过严的谓词」(把一切都判成损坏)——它若还是判据,健康行就会被无撤销销毁。
        let over_strict: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories WHERE rowid = ?1 AND 1=1",
                rusqlite::params![rowid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            over_strict, 1,
            "过严谓词确实会把这条健康行判成『损坏』(活靶)"
        );

        // 而真正的判据是快照:它说 Healthy ⇒ 守卫拒绝,行仍在。
        assert_eq!(
            super::memory_row_state(&conn, rowid).unwrap(),
            super::RowState::Healthy
        );
        assert!(super::memory_remove_corrupt_inner(&conn, rowid)
            .unwrap_err()
            .contains("未损坏"));
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM memories", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1,
            "健康行必须原封不动"
        );
    }

    /// ★逃生口的第一步不是「能删」,而是「**能看见**」—— 看不见的行没法点删除。
    /// 并钉死那条**用户掌控的谎言**:修前 `memory_entries` 报错(前端 catch 成空列表 ⇒ 用户被告知
    /// 「AI 还没有记住任何内容」),而 `memory_all`(recall)照常返回全部记忆。
    #[test]
    fn corrupt_row_stays_visible_while_recall_still_reads_the_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-visible");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "good", "用户偏好远程岗位", &[0.1]).unwrap();
        conn.execute("INSERT INTO memories VALUES ('bad','坏行',NULL,'abc')", [])
            .unwrap();

        // 列表:两条都在,坏的那条被标出来
        let entries = super::memory_entries(&conn).unwrap();
        assert_eq!(entries.len(), 2, "一行坏数据不得让整张列表消失");
        let bad = entries.iter().find(|e| e["fact"] == "坏行").unwrap();
        let good = entries
            .iter()
            .find(|e| e["fact"] == "用户偏好远程岗位")
            .unwrap();
        assert_eq!(bad["corrupt"], serde_json::json!(true));
        assert_eq!(good["corrupt"], serde_json::json!(false));
        assert_eq!(
            bad["ts"],
            serde_json::json!(0),
            "非 Integer 的 created_at 归一化为 0"
        );
        assert!(
            bad["rowid"].as_i64().unwrap() > 0,
            "损坏行须给出 rowid 作删除键(其 id 未必可映射)"
        );

        // 这就是修前的谎言:recall 那条路一直读得到整张表
        assert_eq!(
            super::memory_all(&conn).unwrap().len(),
            1,
            "recall 仍读得到健康行"
        );
        // 且 embedding 绝不出现在给人看的条目里(隐私红线,顺带守住)
        assert!(entries.iter().all(|e| e.get("embedding").is_none()));
    }

    /// ★★逃生口的**结构性守卫**:`memory_remove_corrupt` 拒绝销毁健康行。
    /// 否则它就是一个「绕过快照直接删」的后门 —— 不变式「健康行永远可撤销」会被它无声掏空。
    #[test]
    fn remove_corrupt_refuses_healthy_rows_and_never_touches_the_ring() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-forced");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "good", "健康行", &[0.1]).unwrap();
        conn.execute("INSERT INTO memories VALUES ('bad','坏行',NULL,'abc')", [])
            .unwrap();

        let ring: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());
        let prev = ring.lock().unwrap().stash(vec![mrow("PREV", 0)]).unwrap();

        let rowid = |id: &str| -> i64 {
            conn.query_row(
                "SELECT rowid FROM memories WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap()
        };
        let good_rowid = rowid("good");
        let bad_rowid = rowid("bad");

        // ① 健康行 → 拒绝(**且行还在**)
        let err = super::memory_remove_corrupt_inner(&conn, good_rowid).unwrap_err();
        assert!(err.contains("未损坏"), "健康行必须被拒:{err}");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM memories WHERE id='good'", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1,
            "被拒之后健康行必须原封不动"
        );

        // ② 不存在的 rowid → 诚实 no-op(0 条),不报错
        let r0 = super::memory_remove_corrupt_inner(&conn, 999_999).unwrap();
        assert_eq!(r0.deleted, 0);
        assert!(r0.undo_token.is_none());

        // ③ 损坏行 → 销毁发生、**不发 token**
        let r = super::memory_remove_corrupt_inner(&conn, bad_rowid).unwrap();
        assert_eq!(
            r.deleted, 1,
            "逃生口必须真的能删(红线只禁谎报撤销,不禁销毁)"
        );
        assert!(r.undo_token.is_none(), "不可完整快照 ⇒ 绝不发 token");
        assert_eq!(
            super::memory_entries(&conn).unwrap().len(),
            1,
            "只删掉了那一条"
        );

        // ④ 全程不碰撤销环
        let g = ring.lock().unwrap();
        assert_eq!(g.len(), 1);
        assert!(g.has(&prev), "逃生口不得淘汰既有撤销条目");

        // ⑤ 坏行删掉之后,健康行的常规删除**恢复可撤销**(整库解锁)
        drop(g);
        let r2 = super::memory_remove_inner(&conn, &ring, "good").unwrap();
        assert_eq!(r2.deleted, 1);
        assert!(r2.undo_token.is_some(), "坏行清掉后,健康行必须重新可撤销");
    }

    /// 整表逃生口:有损坏行时 `clear` **照常销毁**、不物化、不发 token,且预检的**理由**是 `corrupt`
    /// (不是 `too_large` —— 决策点不仅要说真话,还要说对理由)。
    #[test]
    fn clear_with_corrupt_row_destroys_without_snapshot_and_precheck_says_corrupt() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-clearcorrupt");
        migrate(&mut conn, &tmp).unwrap();
        super::memory_add(&conn, "good", "健康行", &[0.1]).unwrap();
        conn.execute("INSERT INTO memories VALUES ('bad','坏行',NULL,'abc')", [])
            .unwrap();

        let ring: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());
        let prev = ring.lock().unwrap().stash(vec![mrow("PREV", 0)]).unwrap();
        let cap = ring.lock().unwrap().max_bytes();

        let pc = super::memory_clear_precheck(&conn, cap).unwrap();
        assert_eq!(
            pc,
            super::UndoPrecheck {
                undoable: false,
                reason: "corrupt"
            }
        );

        let r = super::memory_clear_inner(&conn, &ring).unwrap();
        assert_eq!(r.deleted, 2, "一行坏数据不得把整库锁死(修前这里是 Err)");
        assert!(r.undo_token.is_none(), "没有完整快照 ⇒ 绝不发 token");
        let g = ring.lock().unwrap();
        assert!(g.has(&prev), "不得淘汰既有撤销条目");

        // 反面(阳性对照):库里没有坏行时,预检说 ok、clear 确实发 token
        drop(g);
        super::memory_add(&conn, "x", "健康", &[0.1]).unwrap();
        assert_eq!(
            super::memory_clear_precheck(&conn, cap).unwrap(),
            super::UndoPrecheck {
                undoable: true,
                reason: "ok"
            }
        );
        assert!(super::memory_clear_inner(&conn, &ring)
            .unwrap()
            .undo_token
            .is_some());
    }

    /// docs 侧同款(**同一缺陷不得因所在支路不同而两种待遇** —— 第64轮裁词)。
    /// 列表宽容、单篇/整库预检说 `corrupt`、销毁照常发生且不发 token。
    #[test]
    fn docs_escape_hatch_mirrors_memory_for_corrupt_chunks() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-doccorrupt");
        migrate(&mut conn, &tmp).unwrap();
        super::doc_chunks_insert(&conn, "ok", "健康文档", &[("片段".into(), vec![0.1])]).unwrap();
        super::doc_chunks_insert(&conn, "bad", "坏文档", &[("片段".into(), vec![0.1])]).unwrap();
        conn.execute(
            "UPDATE doc_chunks SET created_at='abc' WHERE doc_id='bad'",
            [],
        )
        .unwrap();

        // 列表:两篇都在(修前整表列不出,而 doc_chunks_all 照常召回 = 同一个谎言)
        let docs = super::doc_list_inner(&conn).unwrap();
        assert_eq!(docs.len(), 2, "一个坏片段不得让整个知识库消失");
        assert_eq!(
            super::doc_chunks_all(&conn).unwrap().len(),
            2,
            "召回那条路一直读得到"
        );
        let bad = docs.iter().find(|d| d["docId"] == "bad").unwrap();
        let ok = docs.iter().find(|d| d["docId"] == "ok").unwrap();
        assert_eq!(bad["corrupt"], serde_json::json!(true));
        assert_eq!(ok["corrupt"], serde_json::json!(false));

        let ring: Mutex<super::UndoRing<super::DocRow>> = Mutex::new(Default::default());
        let cap = ring.lock().unwrap().max_bytes();
        // 单篇预检:坏的说 corrupt、好的说 ok(**逐篇**,不被别人的坏数据牵连)
        assert_eq!(
            super::doc_precheck(&conn, cap, Some("bad")).unwrap().reason,
            "corrupt"
        );
        assert_eq!(
            super::doc_precheck(&conn, cap, Some("ok")).unwrap(),
            super::UndoPrecheck {
                undoable: true,
                reason: "ok"
            }
        );
        // 整库预检:被坏片段拉成 corrupt
        assert_eq!(
            super::doc_precheck(&conn, cap, None).unwrap().reason,
            "corrupt"
        );

        // 删坏的那篇:销毁发生、不发 token
        let r = super::doc_remove_inner(&conn, &ring, "bad").unwrap();
        assert_eq!(r.deleted, 1);
        assert!(r.undo_token.is_none());
        // 删健康那篇:仍可撤销(阳性对照)
        let r2 = super::doc_remove_inner(&conn, &ring, "ok").unwrap();
        assert!(r2.undo_token.is_some(), "健康文档必须仍然可撤销");
    }

    /// 重复删同一 id:trash 仍保有第一次的快照,且 `memory_restore_rows` 能把它还原(评审点名的复现)。
    /// ★评审第60轮 [建议]3:**直调 `memory_remove_inner`(真实命令体)**,而非在测试里重抄
    /// 「snapshot → DELETE → stash」序列 —— 否则有人把命令改回 `*trash = snap` 此测试照样绿。
    #[test]
    fn repeated_memory_delete_keeps_first_snapshot_and_undo_restores_it() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups");
        migrate(&mut conn, &tmp).unwrap();
        conn.execute(
            "INSERT INTO memories (id, fact, embedding, created_at) VALUES ('A','fact A',NULL,1)",
            [],
        )
        .unwrap();

        let ring: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());

        // 第一次删 A(真销毁)→ 快照入环 + 发 token —— 走真实命令体
        let r1 = super::memory_remove_inner(&conn, &ring, "A").unwrap();
        assert_eq!(r1.deleted, 1);
        let ta = r1.undo_token.expect("真销毁应发 token");
        assert_eq!(ring.lock().unwrap().len(), 1);

        // 第二次删 A(行已不存在 = no-op)→ 空快照:**不入环、不发 token、不淘汰旧条目**
        let r2 = super::memory_remove_inner(&conn, &ring, "A").unwrap();
        assert_eq!(r2.deleted, 0, "no-op 销毁应如实返回 0 条");
        assert!(r2.undo_token.is_none(), "no-op 销毁不得发 token");
        assert!(
            ring.lock().unwrap().has(&ta),
            "no-op 重复删除后环内仍应保有 A 那一次"
        );

        // 撤销:按 token 取走并还原 → A 回来了(还原行数 > 0 ⇒ 前端不会谎报)
        let rows = ring.lock().unwrap().take(&ta).unwrap();
        let n = super::memory_restore_rows(&conn, &rows).unwrap();
        assert_eq!(n, 1, "撤销应真还原 1 行");
        let back: String = conn
            .query_row("SELECT fact FROM memories WHERE id = 'A'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(back, "fact A", "A 应按原内容还原");
    }

    /// ★评审第61轮裁决 A:`created_at` 为 **NULL** 时归一化为 `0`(schema `DEFAULT 0` 的忠实归一化)
    /// ⇒ 该行**可被完整快照、可被删除、撤销能按 `ts=0` 还原**。
    /// **阳性对照**:直接以严格 `i64` 读同一值必须失败 —— 证明归一化确实在做事;若生产代码改回 `i64`,
    /// 快照即 `Err`、本测试转红。
    #[test]
    fn null_created_at_is_normalized_and_row_stays_deletable_and_undoable() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups");
        migrate(&mut conn, &tmp).unwrap();
        conn.execute(
            "INSERT INTO memories (id, fact, embedding, created_at) VALUES ('B','fact B',NULL,NULL)",
            [],
        )
        .unwrap();

        // 阳性对照:严格 i64 读 NULL 必失败(若生产代码改回 i64,快照 → Err,本测试转红)
        let strict = conn.query_row("SELECT created_at FROM memories WHERE id='B'", [], |r| {
            r.get::<_, i64>(0)
        });
        assert!(
            strict.is_err(),
            "阳性对照:严格 i64 读 NULL 必须失败,否则本测试不在检验归一化"
        );

        // 归一化后:可完整快照,ts 归 0
        let snap =
            super::memory_snapshot_one(&conn, "B").expect("NULL created_at 应归一化、不得 Err");
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].3, 0, "NULL 应按 schema DEFAULT 0 归一化为 0");

        // 可删除(不再被 fail-closed 挡住 = 可用性回归已消)
        let ring: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());
        let r = super::memory_remove_inner(&conn, &ring, "B").expect("坏时间戳的行仍应可删");
        assert_eq!(r.deleted, 1);
        let t = r.undo_token.expect("快照完整 ⇒ 应入环并发 token");

        // 撤销:按 token 取走,按 ts=0 还原
        let rows = ring.lock().unwrap().take(&t).unwrap();
        assert_eq!(super::memory_restore_rows(&conn, &rows).unwrap(), 1);
        let ts: i64 = conn
            .query_row("SELECT created_at FROM memories WHERE id='B'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(ts, 0, "撤销应按 schema 原意还原为 0");
    }

    /// ★评审第60轮 [建议]2 + 第61轮裁决 A:**其余列**(schema 未定义默认值)仍须 **fail-closed**。
    /// 用 `created_at='abc'` —— INTEGER 亲和列存非数字文本会**保持 TEXT**(已在 SQL 层实证),
    /// 故连 `Option<i64>` 也映射不了 ⇒ 提前 `Err`、什么也不销毁、槽不被动。
    /// (原用 `NULL` 作 fixture;裁决 A 后 NULL 已可映射,**该 fixture 会使本测试空跑**,故更换。)
    #[test]
    fn unmappable_row_fails_closed_and_never_clobbers_or_deletes() {
        use std::sync::Mutex;
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups");
        migrate(&mut conn, &tmp).unwrap();

        // 环里先放一条「上一次销毁」的快照(A)——它绝不能被错还原、也不能被这次失败污染
        let ring: Mutex<super::UndoRing<super::MemRow>> = Mutex::new(Default::default());
        let ta = ring
            .lock()
            .unwrap()
            .stash(vec![("A".into(), "fact A".into(), vec![], 1)])
            .unwrap();

        // B 存在但 created_at 是非数字文本 ⇒ 即便归一化也映射不了(真·不可映射)
        conn.execute(
            "INSERT INTO memories (id, fact, embedding, created_at) VALUES ('B','fact B',NULL,'abc')",
            [],
        )
        .unwrap();

        // 阳性对照:确认该行确实映射失败(证明用例打到了真实故障面,而非空跑)
        assert!(
            super::memory_snapshot_one(&conn, "B").is_err(),
            "created_at='abc' 应使逐行映射失败(用例必须真的触发故障)"
        );

        // fail-closed:删除应报错
        let r = super::memory_remove_inner(&conn, &ring, "B");
        assert!(r.is_err(), "不能完整快照就不得销毁 → 应返回 Err");

        // ① B **未被删除**(DELETE 从未执行)
        let still: i64 = conn
            .query_row("SELECT COUNT(*) FROM memories WHERE id = 'B'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(still, 1, "fail-closed:B 不得被删除");

        // ② 撤销环**未被动过** —— A 那一次仍在,绝不会被「还原错记录」
        let g = ring.lock().unwrap();
        assert_eq!(g.len(), 1);
        assert!(g.has(&ta), "撤销环不得被这次失败的删除污染");
    }

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
            .query_row("SELECT created_at FROM memories WHERE id='m1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(restored_ts1, ts1); // 原时间保留(非 now)
    }

    #[test]
    fn doc_chunks_insert_all_remove_clear() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-docs");
        migrate(&mut conn, &tmp).unwrap();
        // doc_chunks 平台私有:不在 table_for(db_* 碰不到)。
        assert!(table_for("doc_chunks").is_err());
        super::doc_chunks_insert(
            &conn,
            "d1",
            "JD-字节",
            &[
                ("片段A".into(), vec![0.1, 0.2]),
                ("片段B".into(), vec![0.3, 0.4]),
            ],
        )
        .unwrap();
        super::doc_chunks_insert(&conn, "d2", "笔记", &[("片段C".into(), vec![0.5, 0.6])]).unwrap();
        // all:(doc_name, text, embedding)往返无损。
        let all = super::doc_chunks_all(&conn).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all
            .iter()
            .any(|(dn, txt, emb)| dn == "JD-字节" && txt == "片段A" && emb == &vec![0.1, 0.2]));
        // 删一篇 → 剩另一篇的块;清空 → 空。
        let n = conn
            .execute("DELETE FROM doc_chunks WHERE doc_id='d1'", [])
            .unwrap();
        assert_eq!(n, 2);
        assert_eq!(super::doc_chunks_all(&conn).unwrap().len(), 1);
        conn.execute("DELETE FROM doc_chunks", []).unwrap();
        assert_eq!(super::doc_chunks_all(&conn).unwrap().len(), 0);
    }

    #[test]
    fn doc_snapshot_restore_keeps_all_fields() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("seeker-test-backups-docundo");
        migrate(&mut conn, &tmp).unwrap();
        super::doc_chunks_insert(
            &conn,
            "d1",
            "JD",
            &[("a".into(), vec![0.1, 0.2]), ("b".into(), vec![0.3, 0.4])],
        )
        .unwrap();
        super::doc_chunks_insert(&conn, "d2", "笔记", &[("c".into(), vec![0.5, 0.6])]).unwrap();
        // 快照一篇 + 删 + 还原:字段/embedding 无损(doc_remove→doc_undo 的内部)。
        let snap1 = super::doc_snapshot(&conn, Some("d1")).unwrap();
        assert_eq!(snap1.len(), 2);
        conn.execute("DELETE FROM doc_chunks WHERE doc_id='d1'", [])
            .unwrap();
        assert_eq!(super::doc_chunks_all(&conn).unwrap().len(), 1);
        assert_eq!(super::doc_restore_rows(&conn, &snap1).unwrap(), 2);
        let all = super::doc_chunks_all(&conn).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all
            .iter()
            .any(|(dn, txt, emb)| dn == "JD" && txt == "a" && emb == &vec![0.1, 0.2]));
        // 快照全部 + 清空 + 还原全部(doc_clear→doc_undo 的内部)。
        let snap_all = super::doc_snapshot(&conn, None).unwrap();
        assert_eq!(snap_all.len(), 3);
        conn.execute("DELETE FROM doc_chunks", []).unwrap();
        assert_eq!(super::doc_restore_rows(&conn, &snap_all).unwrap(), 3);
        assert_eq!(super::doc_chunks_all(&conn).unwrap().len(), 3);
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
