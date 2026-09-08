//! User-triggered local text export. Paths and extensions are owned by the platform.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

fn filename(title: &str) -> String {
    let name: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(60)
        .collect();
    if name.is_empty() {
        "Seeker-note".into()
    } else {
        name
    }
}
fn write_markdown(dir: &Path, title: &str, text: &str) -> Result<PathBuf, String> {
    if text.trim().is_empty() || text.len() > 2_000_000 {
        return Err("内容为空或过长 / Empty or oversized content".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = dir.join(format!("{}-{stamp}.md", filename(title)));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if fs::read(&path).map_err(|e| e.to_string())? != text.as_bytes() {
            return Err("导出校验失败 / Export verification failed".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result.map(|()| path)
}

#[tauri::command]
pub fn export_markdown(app: AppHandle, title: String, text: String) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join("Seeker");
    write_markdown(&dir, &title, &text).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exported_text_is_exact_new_file_and_title_cannot_escape() {
        let dir = std::env::temp_dir().join(format!(
            "seeker-export-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let text = "# 原文\n\n中文和 emoji 🍊\n";
        let a = write_markdown(&dir, "../../unsafe/笔记.txt", text).unwrap();
        let b = write_markdown(&dir, "../../unsafe/笔记.txt", text).unwrap();
        assert_eq!(a.parent(), Some(dir.as_path()));
        assert_ne!(a, b);
        assert_eq!(fs::read_to_string(a).unwrap(), text);
        assert!(write_markdown(&dir, "empty", " ").is_err());
        assert!(write_markdown(&b, "blocked", text).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
