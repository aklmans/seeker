mod ai;
mod capability;
mod config;
mod data;
mod docs;
mod docx;
mod embed;
mod mcp;
mod memory;
mod prompts;
mod secret;
mod web;

use tauri::Manager;

/// ★前端热嵌依赖闩(见 build.rs):`generate_context!` 在 stable Rust 上无法追踪 `../web` 资产变更 ⇒
/// build.rs 把前端指纹经 `SEEKER_WEB_FP` 注入,这里 `env!` 依赖它 ⇒ 前端一变、指纹变、本 crate 重编译、
/// `generate_context!`(run() 内)重读 `../web` 重嵌。**勿删**:删了改前端 `cargo run` 又会嵌旧资产。
const _WEB_FP: &str = env!("SEEKER_WEB_FP");

/// 前端指纹较上次启动变化 → 清 WKWebView 的 HTTP 缓存(app_cache_dir),防更新后供旧资产。
/// 仅清缓存目录(可再生);localStorage(WebKit 数据存储)与 seeker.db(app_data_dir)**不动**。
/// 全 best-effort:任何一步失败都静默返回,绝不影响启动。
fn bust_stale_webview_cache(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&data_dir);
    let fp_file = data_dir.join(".web_fp");
    let stored = std::fs::read_to_string(&fp_file).unwrap_or_default();
    if stored.trim() == _WEB_FP {
        return; // 前端未变,零动作
    }
    // 变了(或首次):清 HTTP 缓存目录内容,再记录新指纹。
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        if cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&cache_dir);
        }
    }
    let _ = std::fs::write(&fp_file, _WEB_FP);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = _WEB_FP; // 触达常量,确保 env! 依赖不被优化掉
    tauri::Builder::default()
        .manage(ai::Sessions::default())
        .manage(ai::History::default())
        .manage(capability::Registry::new())
        .manage(capability::AiReadable::default())
        .manage(data::MemTrash::default())
        .manage(data::DocTrash::default())
        .manage(mcp::McpManager::default())
        .manage(mcp::PendingConfirms::default())
        .manage(ai::PendingAppTools::default())
        .setup(|app| {
            // ★前端缓存清扫(真机 bug 第二层):WKWebView 会把嵌入资产(tauri://localhost)缓存到磁盘,
            //   即便二进制重嵌了新前端,webview 仍可能供旧 HTML/JS ⇒ 更新后「看不到新功能」。
            //   修法:前端指纹(SEEKER_WEB_FP,见 build.rs)较上次启动变了 → 清 app_cache_dir(仅 HTTP 缓存、
            //   可再生;**不碰** localStorage / seeker.db)。未变则零动作。best-effort、绝不因它阻断启动。
            bust_stale_webview_cache(app.handle());
            // 打开本地数据库(失败则启动报错)并交由 State 持有。
            let conn = data::open(app.handle())?;
            app.manage(data::Db(std::sync::Mutex::new(conn)));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secret::secret_set,
            secret::secret_status,
            secret::secret_clear,
            config::ai_config_get,
            config::ai_config_set,
            config::ai_model_select,
            config::ai_model_remove,
            ai::ai_chat,
            ai::ai_cancel,
            ai::ai_extract,
            ai::ai_generate,
            ai::ai_app_tool_result,
            data::db_list,
            data::db_get,
            data::db_upsert,
            data::db_remove,
            data::profile_get_all,
            data::profile_set,
            data::db_export,
            data::db_import,
            data::db_backup,
            data::memory_list,
            data::memory_clear,
            data::memory_clear_undoable,
            data::memory_remove,
            data::memory_undo,
            docs::doc_add,
            docs::pdf_extract_text,
            docx::export_docx,
            web::web_fetch,
            web::open_external,
            web::verify_sources,
            data::doc_list,
            data::doc_remove,
            data::doc_clear,
            data::doc_clear_undoable,
            data::doc_remove_undoable,
            data::memory_remove_corrupt,
            data::doc_remove_corrupt,
            data::memory_repair_corrupt,
            data::doc_repair_corrupt,
            data::doc_undo,
            mcp::mcp_probe,
            mcp::mcp_list,
            mcp::mcp_add,
            mcp::mcp_set_auth,
            mcp::mcp_set_env,
            mcp::mcp_remove,
            mcp::mcp_set_enabled,
            mcp::mcp_confirm_resolve,
            capability::cap_list,
            capability::cap_available,
            capability::cap_invoke,
            capability::set_ai_readable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
