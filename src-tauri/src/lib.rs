mod ai;
mod config;
mod secret;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ai::Sessions::default())
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
