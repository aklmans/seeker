//! Provider 非密钥配置(protocol / base_url / model)。
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

/// 模型供应商的线上协议。旧版 `provider.json` 没有该字段,反序列化时必须保持原来的
/// OpenAI-compatible 行为,不能因升级改变现有端点的请求格式。
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderProtocol {
    #[default]
    Openai,
    Anthropic,
    Gemini,
    /// Ollama 当前走其官方 OpenAI-compatible `/v1/chat/completions` 接口；单独保留枚举值,
    /// 便于能力矩阵给出本地模型特有的提示与限制。
    Ollama,
}

impl ProviderProtocol {
    /// Anthropic Messages API 没有原生 embeddings 端点；其余三类由 provider adapter 支持。
    pub fn supports_embeddings(self) -> bool {
        self != Self::Anthropic
    }

    pub fn requires_api_key(self) -> bool {
        self != Self::Ollama
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ProviderConfig {
    /// 线上协议。`serde(default)` 令无此字段的旧配置无损迁移为 OpenAI-compatible。
    #[serde(default)]
    pub protocol: ProviderProtocol,
    #[serde(default)]
    pub base_url: String,
    /// 当前启用的模型(active)。必在 `models` 内(get 时兜底补入)。
    #[serde(default)]
    pub model: String,
    /// 嵌入模型名(BYO `/embeddings`;长期记忆 / RAG 用)。空 = 未配置,记忆优雅降级。
    #[serde(default)]
    pub embed_model: String,
    /// 同一协议下保存的多个模型名(一协议多模型);除非用户删除否则保留。
    #[serde(default)]
    pub models: Vec<String>,
    /// 请求 User-Agent(高级)。某些供应商(如 Kimi For Coding)按 UA 限定「编程 agent」,
    /// 默认 UA 会被 403 拒;空 = 用默认(见 `ai.rs` DEFAULT_USER_AGENT)。**非密钥**,可显示。
    #[serde(default)]
    pub user_agent: String,
}

impl ProviderConfig {
    /// 能力层统一使用这一判据，避免“填了模型名但当前协议根本没有嵌入 API”时误上架。
    pub fn embedding_unavailable_reason(&self) -> Option<&'static str> {
        if !self.protocol.supports_embeddings() {
            Some("Anthropic 协议不提供嵌入 API")
        } else if self.embed_model.trim().is_empty() {
            Some("未配置嵌入模型")
        } else {
            None
        }
    }
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

fn save(app: &AppHandle, c: &ProviderConfig) -> Result<(), String> {
    let p = config_path(app)?;
    let json = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    protocol: ProviderProtocol,
    embedding_supported: bool,
    key_required: bool,
    base_url: String,
    model: String,
    embed_model: String,
    /// 同一协议下已保存的模型名(active = `model`,必在此列表内)。
    models: Vec<String>,
    /// "configured" | "empty" —— key 是否已在钥匙串(不含明文)。
    key_status: String,
    /// 请求 User-Agent(高级;空 = 用默认)。
    user_agent: String,
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
    // 兜底:当前 active 模型必在列表里(兼容旧单模型 provider.json)。
    let mut models = c.models.clone();
    if !c.model.is_empty() && !models.contains(&c.model) {
        models.insert(0, c.model.clone());
    }
    Ok(ConfigView {
        protocol: c.protocol,
        embedding_supported: c.protocol.supports_embeddings(),
        key_required: c.protocol.requires_api_key(),
        base_url: c.base_url,
        model: c.model,
        embed_model: c.embed_model,
        models,
        key_status,
        user_agent: c.user_agent,
    })
}

#[tauri::command]
pub fn ai_config_set(
    app: AppHandle,
    protocol: Option<ProviderProtocol>,
    base_url: Option<String>,
    model: Option<String>,
    embed_model: Option<String>,
    user_agent: Option<String>,
) -> Result<(), String> {
    let mut c = load(&app);
    if let Some(p) = protocol {
        c.protocol = p;
    }
    if let Some(b) = base_url {
        c.base_url = b.trim().to_string();
    }
    if let Some(m) = model {
        // 配置一个模型 = 加入列表(去重)+ 设为当前;配置完不清理(除非删除)。
        let m = m.trim().to_string();
        if !m.is_empty() {
            if !c.models.contains(&m) {
                c.models.push(m.clone());
            }
            c.model = m;
        }
    }
    if let Some(em) = embed_model {
        c.embed_model = em.trim().to_string();
    }
    if let Some(ua) = user_agent {
        c.user_agent = ua.trim().to_string();
    }
    save(&app, &c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_provider_config_defaults_to_openai_compatible() {
        let c: ProviderConfig = serde_json::from_str(
            r#"{"base_url":"https://example.test/v1","model":"legacy-model"}"#,
        )
        .unwrap();
        assert_eq!(c.protocol, ProviderProtocol::Openai);
        assert_eq!(c.model, "legacy-model");
    }

    #[test]
    fn provider_protocol_round_trips_as_stable_lowercase_value() {
        let c = ProviderConfig {
            protocol: ProviderProtocol::Anthropic,
            ..ProviderConfig::default()
        };
        let json = serde_json::to_value(c).unwrap();
        assert_eq!(json["protocol"], "anthropic");
        let restored: ProviderConfig = serde_json::from_value(json).unwrap();
        assert_eq!(restored.protocol, ProviderProtocol::Anthropic);
    }

    #[test]
    fn embedding_capability_matrix_is_fail_closed() {
        let mut c = ProviderConfig {
            protocol: ProviderProtocol::Anthropic,
            embed_model: "text-embedding-x".into(),
            ..ProviderConfig::default()
        };
        assert_eq!(
            c.embedding_unavailable_reason(),
            Some("Anthropic 协议不提供嵌入 API")
        );
        c.protocol = ProviderProtocol::Gemini;
        assert_eq!(c.embedding_unavailable_reason(), None);
        c.embed_model.clear();
        assert_eq!(c.embedding_unavailable_reason(), Some("未配置嵌入模型"));
        assert!(!ProviderProtocol::Ollama.requires_api_key());
    }
}

/// 选当前使用的模型(从已保存列表;不在列表则容错补入)。
#[tauri::command]
pub fn ai_model_select(app: AppHandle, model: String) -> Result<(), String> {
    let m = model.trim().to_string();
    if m.is_empty() {
        return Err("模型名为空".into());
    }
    let mut c = load(&app);
    if !c.models.contains(&m) {
        c.models.push(m.clone());
    }
    c.model = m;
    save(&app, &c)
}

/// 删除一个已保存的模型;若删的是当前 active,则改用剩余第一个(无则清空)。
#[tauri::command]
pub fn ai_model_remove(app: AppHandle, model: String) -> Result<(), String> {
    let m = model.trim().to_string();
    let mut c = load(&app);
    c.models.retain(|x| x != &m);
    if c.model == m {
        c.model = c.models.first().cloned().unwrap_or_default();
    }
    save(&app, &c)
}
