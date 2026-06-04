//! 嵌入(embedding)来源(#2 · C2)——**BYO**:复用用户自填的 OpenAI 兼容端点的 `/embeddings`。
//!
//! 隐私:仅调**用户自填的端点**(与对话同信任域,符合"联网只为调用户自填端点");
//! 文本不落第三方、不写日志。本地嵌入 sidecar 为日后可选实现(同一 `Embedder` 角色)。
//! 失败一律返回 `Err`(记忆/RAG 据此优雅降级,不报错给用户)。

use serde_json::json;
use std::time::Duration;
use tauri::AppHandle;

const KEY_ACCOUNT: &str = "provider.openai.key";
const EMBED_TIMEOUT: Duration = Duration::from_secs(30);

/// 批量把文本嵌入为向量。空输入 → 空结果。
pub async fn embed_texts(app: &AppHandle, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = crate::config::load(app);
    if cfg.base_url.is_empty() || cfg.embed_model.is_empty() {
        return Err("尚未配置嵌入模型(embed_model),请在「数据设置」填写".into());
    }
    let key = crate::secret::get_secret(KEY_ACCOUNT).map_err(|_| "尚未配置 API Key".to_string())?;
    let url = format!("{}/embeddings", cfg.base_url.trim_end_matches('/'));
    let body = json!({ "model": cfg.embed_model, "input": texts });
    let client = reqwest::Client::new();
    // key 用完即弃;不写日志。
    let resp = tokio::time::timeout(
        EMBED_TIMEOUT,
        client.post(&url).bearer_auth(&key).json(&body).send(),
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
    let data = v
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or("嵌入响应缺少 data")?;
    let mut out = Vec::with_capacity(data.len());
    for item in data {
        let arr = item
            .get("embedding")
            .and_then(|e| e.as_array())
            .ok_or("嵌入项缺少 embedding")?;
        out.push(
            arr.iter()
                .filter_map(|x| x.as_f64().map(|f| f as f32))
                .collect(),
        );
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
