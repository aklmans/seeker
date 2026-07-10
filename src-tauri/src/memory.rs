//! 长期记忆能力(#2 · C2)—— Tool(remember / recall)+ Context(自动召回入提示)。
//!
//! 记忆 = 对话中值得长期保留的结论 / 偏好(模型主动 `remember`)。**不是 profile**:
//! 姓名 / 电话 / 邮箱等仍由独立 profile 隔离、AI 永不可读;记忆只存模型选择记住的非 PII 结论。
//! 经 BYO 嵌入 + 暴力 cosine 检索,存 `memories` 表(不在 db_* 白名单 —— 平台能力私有)。
//! 产出片段标 `trust=Untrusted`(数据非指令,防注入)。嵌入未配置/失败 → 优雅降级(不召回、不报错)。

use crate::capability::{
    Availability, CallCx, Capability, ContextChunk, Kind, Output, Permission, Query, ToolSchema,
    Trust,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

const TOP_K_RECALL: usize = 5;
const TOP_K_CONTRIBUTE: usize = 3;
const MIN_SCORE: f32 = 0.2; // 相关度下限,过滤噪声
static MEM_SEQ: AtomicU64 = AtomicU64::new(1);

/// 记忆是否可用 = 是否配了嵌入模型(无嵌入则无法写入/检索)。
fn embed_configured(embed_model: &str) -> bool {
    !embed_model.trim().is_empty()
}

fn gen_id() -> String {
    let n = MEM_SEQ.fetch_add(1, Ordering::Relaxed);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("m_{ms}_{n}")
}

pub struct LongTermMemory;

impl LongTermMemory {
    /// 嵌入 query → 暴力 cosine → 取 ≥MIN_SCORE 的 top-k `(fact, score)`(降序)。
    async fn search(
        &self,
        app: &tauri::AppHandle,
        text: &str,
        k: usize,
    ) -> Result<Vec<(String, f32)>, String> {
        let q = crate::embed::embed_one(app, text).await?;
        let all = crate::data::with_db(app, crate::data::memory_all)?;
        let mut scored: Vec<(String, f32)> = all
            .into_iter()
            .map(|(_, fact, emb)| (fact, crate::embed::cosine(&q, &emb)))
            .filter(|(_, s)| *s >= MIN_SCORE)
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(k);
        Ok(scored)
    }
}

#[async_trait]
impl Capability for LongTermMemory {
    fn id(&self) -> &'static str {
        "memory"
    }
    fn kind(&self) -> Kind {
        Kind::Tool // 主性:LLM 可调;同时 override contribute 作 Context 供料
    }
    /// 运行时降级(C3):未配置嵌入模型 → Unavailable;网关据此不暴露 memory 工具、不召回
    /// (避免给模型一个必然报错的工具),前端可据此提示去配置。
    fn available(&self, cx: &CallCx) -> Availability {
        if embed_configured(&crate::config::load(cx.app).embed_model) {
            Availability::Ready
        } else {
            Availability::Unavailable("未配置嵌入模型".into())
        }
    }
    fn permissions(&self) -> &[Permission] {
        &[Permission::Db, Permission::Net] // Db:记忆表;Net:BYO 嵌入(仅用户自填端点)
    }
    fn schema(&self) -> Option<ToolSchema> {
        Some(ToolSchema {
            name: "memory",
            description: "长期记忆。op=remember 记住一条值得长期保留的结论 / 偏好(text=要记的事实);\
                          op=recall 回忆与 text 相关的历史记忆。相关记忆也会自动带入对话,通常无需显式 recall。\
                          不要用它存姓名 / 电话 / 邮箱等个人联系方式。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "op": { "type": "string", "enum": ["remember", "recall"], "description": "remember=写入,recall=回忆" },
                    "text": { "type": "string", "description": "remember:要记住的事实;recall:回忆主题" }
                },
                "required": ["op", "text"]
            }),
        })
    }
    async fn invoke(&self, input: &Value, cx: &CallCx) -> Result<Output, String> {
        let op = input.get("op").and_then(|v| v.as_str()).unwrap_or("");
        let text = input
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            return Err("缺少 text".into());
        }
        match op {
            "remember" => {
                let emb = crate::embed::embed_one(cx.app, text).await?;
                let id = gen_id();
                let fact = text.to_string();
                crate::data::with_db(cx.app, |conn| {
                    crate::data::memory_add(conn, &id, &fact, &emb)
                })?;
                Ok(Output::Text(format!("已记住:{fact}")))
            }
            "recall" => {
                let hits = self.search(cx.app, text, TOP_K_RECALL).await?;
                let facts: Vec<Value> = hits
                    .into_iter()
                    .map(|(f, s)| json!({ "fact": f, "score": (s * 100.0).round() / 100.0 }))
                    .collect();
                // 记忆可能被外部内容投毒(经带工具的循环写入)⇒ Untrusted:回灌自动框定「数据,不是指令」。
                Ok(Output::Untrusted(json!({ "memories": facts })))
            }
            other => Err(format!("未知 op: {other}(应为 remember | recall)")),
        }
    }
    async fn contribute(&self, q: &Query, cx: &CallCx) -> Vec<ContextChunk> {
        // 嵌入失败(未配置 / 网络)→ 空召回(优雅降级,不报错)。
        match self.search(cx.app, &q.text, TOP_K_CONTRIBUTE).await {
            Ok(hits) => hits
                .into_iter()
                .map(|(fact, _)| ContextChunk {
                    text: fact,
                    source: "长期记忆".to_string(),
                    trust: Trust::Untrusted,
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_shape_and_no_pii_guidance() {
        let m = LongTermMemory;
        assert_eq!(m.id(), "memory");
        assert_eq!(m.permissions(), &[Permission::Db, Permission::Net]);
        let s = m.schema().unwrap();
        let p = s.parameters["properties"]["op"]["enum"].to_string();
        assert!(p.contains("remember") && p.contains("recall"));
        assert!(s.description.contains("不要用它存")); // 引导不存 PII
    }

    #[test]
    fn availability_depends_on_embed_config() {
        assert!(!embed_configured(""));
        assert!(!embed_configured("   "));
        assert!(embed_configured("text-embedding-3-small"));
    }

    #[test]
    fn ids_unique() {
        assert_ne!(gen_id(), gen_id());
    }
}
