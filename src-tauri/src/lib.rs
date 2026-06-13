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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::Sessions::default())
        .manage(ai::History::default())
        .manage(capability::Registry::new())
        .manage(data::MemTrash::default())
        .manage(data::DocTrash::default())
        .manage(mcp::McpManager::default())
        .manage(mcp::PendingConfirms::default())
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
            data::memory_remove,
            data::memory_undo,
            docs::doc_add,
            docs::pdf_extract_text,
            docx::export_docx,
            web::web_fetch,
            data::doc_list,
            data::doc_remove,
            data::doc_clear,
            data::doc_undo,
            mcp::mcp_probe,
            mcp::mcp_list,
            mcp::mcp_add,
            mcp::mcp_set_auth,
            mcp::mcp_remove,
            mcp::mcp_set_enabled,
            mcp::mcp_confirm_resolve,
            capability::cap_list,
            capability::cap_available,
            capability::cap_invoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
