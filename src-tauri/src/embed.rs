//! 嵌入(embedding)来源(#2 · C2)——**BYO**:OpenAI/Ollama 兼容 `/embeddings`,
//! Gemini 原生 `batchEmbedContents`;Anthropic 无原生嵌入能力时明确降级。
//!
//! 隐私:仅调**用户自填的端点**(与对话同信任域,符合"联网只为调用户自填端点");
//! 文本不落第三方、不写日志。本地嵌入 sidecar 为日后可选实现(同一 `Embedder` 角色)。
//! 失败一律返回 `Err`(记忆/RAG 据此优雅降级,不报错给用户)。

use std::time::Duration;
use tauri::AppHandle;

const EMBED_TIMEOUT: Duration = Duration::from_secs(30);

/// 批量把文本嵌入为向量。空输入 → 空结果。
pub async fn embed_texts(app: &AppHandle, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = crate::config::load(app);
    if cfg.base_url.is_empty() {
        return Err("尚未配置模型 base_url,请在「数据设置」填写".into());
    }
    if let Some(reason) = cfg.embedding_unavailable_reason() {
        return Err(reason.to_string());
    }
    let key = crate::provider::load_api_key(cfg.protocol)?;
    let spec =
        crate::provider::embedding_request(cfg.protocol, &cfg.base_url, &cfg.embed_model, texts)?;
    let client = reqwest::Client::new();
    let request = client.post(&spec.url);
    // key 用完即弃;不写日志。
    let resp = tokio::time::timeout(
        EMBED_TIMEOUT,
        crate::provider::authorize(cfg.protocol, request, &key)
            .json(&spec.body)
            .send(),
    )
    .await
    .map_err(|_| "嵌入请求超时".to_string())?
    .map_err(|e| format!("嵌入请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("嵌入端点返回 HTTP {}", resp.status().as_u16()));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("嵌入响应解析失败: {e}"))?;
    let out = crate::provider::embedding_vectors(cfg.protocol, &v)?;
    if out.len() != texts.len() {
        return Err(format!(
            "嵌入响应数量不符:请求 {},返回 {}",
            texts.len(),
            out.len()
        ));
    }
    Ok(out)
}

/// 单条便捷。
pub async fn embed_one(app: &AppHandle, text: &str) -> Result<Vec<f32>, String> {
    let mut v = embed_texts(app, std::slice::from_ref(&text.to_string())).await?;
    v.pop().ok_or_else(|| "嵌入返回为空".to_string())
}

/// 余弦相似度(维度不符 / 空 / 零向量 → -1,即"不相关")。
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return -1.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return -1.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

#[cfg(test)]
mod tests {
    use super::cosine;

    #[test]
    fn cosine_basics() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6); // 同向 = 1
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6); // 正交 ≈ 0
        assert_eq!(cosine(&[1.0], &[1.0, 0.0]), -1.0); // 维度不符
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), -1.0); // 零向量
    }
}
