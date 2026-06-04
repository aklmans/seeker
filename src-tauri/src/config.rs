//! Provider 非密钥配置(base_url / model)。
//!
//! 这些**不是密钥**(设置页要显示),存 app 配置目录下的 `provider.json`。
//! 密钥仍只进钥匙串(见 `secret`)。`ai_config_get` 返回非密钥配置 + key 的
//! configured/empty 状态,**绝不返回 key 明文**。
//! #3 数据层就绪后可并入统一 settings。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const KEY_ACCOUNT: &str = "provider.openai.key";

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProviderConfig {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    /// 嵌入模型名(BYO `/embeddings`;长期记忆 / RAG 用)。空 = 未配置,记忆优雅降级。
    #[serde(default)]
    pub embed_model: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("provider.json"))
}

/// 供 AI 网关读取当前 provider 配置。
pub fn load(app: &AppHandle) -> ProviderConfig {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    base_url: String,
    model: String,
    embed_model: String,
    /// "configured" | "empty" —— key 是否已在钥匙串(不含明文)。
    key_status: String,
}

#[tauri::command]
pub fn ai_config_get(app: AppHandle) -> Result<ConfigView, String> {
    let c = load(&app);
    // 仅取存在性,立即丢弃明文。
    let key_status = match crate::secret::get_secret(KEY_ACCOUNT) {
        Ok(_) => "configured",
        Err(_) => "empty",
    }
    .to_string();
    Ok(ConfigView {
        base_url: c.base_url,
        model: c.model,
        embed_model: c.embed_model,
        key_status,
    })
}

#[tauri::command]
pub fn ai_config_set(
    app: AppHandle,
    base_url: Option<String>,
    model: Option<String>,
    embed_model: Option<String>,
) -> Result<(), String> {
    let mut c = load(&app);
    if let Some(b) = base_url {
        c.base_url = b.trim().to_string();
    }
    if let Some(m) = model {
        c.model = m.trim().to_string();
    }
    if let Some(em) = embed_model {
        c.embed_model = em.trim().to_string();
    }
    let p = config_path(&app)?;
    let json = serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}
