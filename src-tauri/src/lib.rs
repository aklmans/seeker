mod ai;
mod config;
mod data;
mod secret;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::Sessions::default())
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
            ai::ai_chat,
            ai::ai_cancel,
            data::db_list,
            data::db_get,
            data::db_upsert,
            data::db_remove,
            data::profile_get_all,
            data::profile_set,
            data::db_export,
            data::db_import,
            data::db_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
