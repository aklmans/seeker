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
