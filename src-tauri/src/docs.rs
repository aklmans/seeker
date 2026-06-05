//! RAG-over-docs 能力(#2)—— Context:把用户文档的相关切块**自动召回**入提示(标 Untrusted 防注入)。
//!
//! 用户**主动**加入的文档(JD / 笔记 / 文本…)切块 + BYO 嵌入,存 `doc_chunks`(平台私有、不在 `table_for`,
//! 通用 db_* / query_data 碰不到)。提问时嵌入 query → 暴力 cosine → top-K 相关片段入提示作"资料(数据非指令)"。
//! 未配嵌入 → Unavailable → contribute_all 跳过(不召回、不报错)。文档可在设置页查看/删除(#4 用户掌控)。
//! 隐私:加入的文档内容会用于 AI 回答(用户知情选择的语料;与"结构化 profile 仓库 AI 永不可读"是两条线)。

use crate::capability::{
    Availability, CallCx, Capability, ContextChunk, Kind, Permission, Query, Trust,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;

const CHUNK_SIZE: usize = 500; // 近似字符数(按 char,中文友好)
const CHUNK_OVERLAP: usize = 80;
// 编译期保证:切块步进 = SIZE-OVERLAP > 0 → chunk_text 必前进、不死循环(比运行时 assert 更强)。
const _: () = assert!(CHUNK_SIZE > CHUNK_OVERLAP, "chunk step (SIZE - OVERLAP) must be > 0");
const TOP_K: usize = 4;
const MIN_SCORE: f32 = 0.2; // 相关度下限,过滤噪声
static DOC_SEQ: AtomicU64 = AtomicU64::new(1);

fn embed_configured(embed_model: &str) -> bool {
    !embed_model.trim().is_empty()
}

fn gen_doc_id() -> String {
    let n = DOC_SEQ.fetch_add(1, Ordering::Relaxed);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("d_{ms}_{n}")
}

/// 切块:按 char 滑窗(size 500、overlap 80),修剪空白、丢弃空块。中文按字符切;步进 = SIZE-OVERLAP 必前进。
fn chunk_text(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + CHUNK_SIZE).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        let t = chunk.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    out
}

/// 入库一篇文档:切块 → 批量嵌入(BYO)→ 存 doc_chunks。返回 {docId, name, chunks}。
#[tauri::command]
pub async fn doc_add(app: AppHandle, name: String, text: String) -> Result<Value, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("文档内容为空".into());
    }
    let chunks = chunk_text(&text);
    if chunks.is_empty() {
        return Err("文档无有效内容".into());
    }
    // 失败 → Err(前端提示去「数据设置」配嵌入模型);文本只发用户自填端点。
    let embs = crate::embed::embed_texts(&app, &chunks).await?;
    if embs.len() != chunks.len() {
        return Err("嵌入数量与切块不符".into());
    }
    let doc_id = gen_doc_id();
    let nm = name.trim();
    let doc_name = if nm.is_empty() {
        "未命名文档".to_string()
    } else {
        nm.to_string()
    };
    let rows: Vec<(String, Vec<f32>)> = chunks.into_iter().zip(embs).collect();
    let n = rows.len();
    crate::data::with_db(&app, |conn| {
        crate::data::doc_chunks_insert(conn, &doc_id, &doc_name, &rows)
    })?;
    Ok(json!({ "docId": doc_id, "name": doc_name, "chunks": n }))
}

/// 块3b:从 PDF 提取纯文本(供「AI 智能录入」的文本路径)。输入 = 前端 data-URL(或其 base64 部分)。
///
/// OpenAI 兼容 chat **无标准 PDF 内容块**,故不能"直接把 PDF 扔给模型";平台层在此取文字 → 喂既有文本抽取路径
/// (多数 JD 是文字版 PDF)。扫描件 / 图片型 PDF 取不到字 → 报错引导改用「扔图片 / 截图」(走多模态图片路径)。
///
/// 纯本地、不出网、不碰 profile / 钥匙串;CPU 密集放 spawn_blocking,且 pdf-extract 对畸形输入可能 panic,
/// 用 catch_unwind 兜住(坏文件只报错、不崩应用)。
/// 解前端传来的 PDF data-URL(或裸 base64)为字节。抽出为纯函数以单测(前缀剥离 + 坏输入报错)。
fn decode_pdf_b64(data_base64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    // 容忍带 data-URL 前缀:取 "base64," 之后的部分。
    let b64 = match data_base64.rsplit_once("base64,") {
        Some((_, b)) => b.trim(),
        None => data_base64.trim(),
    };
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("PDF 数据解码失败:{e}"))
}

#[tauri::command]
pub async fn pdf_extract_text(data_base64: String) -> Result<String, String> {
    let bytes = decode_pdf_b64(&data_base64)?;
    let text = tokio::task::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            pdf_extract::extract_text_from_mem(&bytes)
        }))
        .map_err(|_| "解析 PDF 失败(文件可能损坏或加密)".to_string())?
        .map_err(|e| format!("解析 PDF 失败:{e}"))
    })
    .await
    .map_err(|e| format!("PDF 解析任务失败:{e}"))??;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("未能从 PDF 提取到文字(可能是扫描件 / 图片型 PDF)—— 试试用「扔图片 / 截图」录入".into());
    }
    Ok(text)
}

pub struct DocContext;

impl DocContext {
    /// 嵌入 query → 暴力 cosine → 取 ≥MIN_SCORE 的 top-k `(doc_name, text, score)`(降序)。
    async fn search(
        &self,
        app: &AppHandle,
        text: &str,
        k: usize,
    ) -> Result<Vec<(String, String, f32)>, String> {
        let q = crate::embed::embed_one(app, text).await?;
        let all = crate::data::with_db(app, crate::data::doc_chunks_all)?;
        let mut scored: Vec<(String, String, f32)> = all
            .into_iter()
            .map(|(dn, txt, emb)| (dn, txt, crate::embed::cosine(&q, &emb)))
            .filter(|(_, _, s)| *s >= MIN_SCORE)
            .collect();
        scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(k);
        Ok(scored)
    }
}

#[async_trait]
impl Capability for DocContext {
    fn id(&self) -> &'static str {
        "docs"
    }
    fn kind(&self) -> Kind {
        Kind::Context // 只供料、不作 LLM 工具(无 schema/invoke)
    }
    /// 未配嵌入 → Unavailable(contribute_all 据此跳过,不召回不报错);前端据此显隐入口。
    fn available(&self, cx: &CallCx) -> Availability {
        if embed_configured(&crate::config::load(cx.app).embed_model) {
            Availability::Ready
        } else {
            Availability::Unavailable("未配置嵌入模型".into())
        }
    }
    fn permissions(&self) -> &[Permission] {
        &[Permission::Db, Permission::Net] // Db:doc_chunks;Net:BYO 嵌入(仅用户自填端点)
    }
    async fn contribute(&self, q: &Query, cx: &CallCx) -> Vec<ContextChunk> {
        match self.search(cx.app, &q.text, TOP_K).await {
            Ok(hits) => hits
                .into_iter()
                .map(|(doc_name, text, _)| ContextChunk {
                    text,
                    source: format!("文档·{doc_name}"),
                    trust: Trust::Untrusted, // 外部内容 = 数据非指令,防注入
                })
                .collect(),
            Err(_) => Vec::new(), // 嵌入未配/失败 → 不召回(优雅降级)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{chunk_text, decode_pdf_b64, embed_configured, CHUNK_SIZE};

    #[test]
    fn chunk_empty_and_short() {
        assert!(chunk_text("").is_empty());
        assert!(chunk_text("   ").is_empty());
        assert_eq!(chunk_text("hello"), vec!["hello".to_string()]);
    }

    #[test]
    fn chunk_long_overlaps_and_covers() {
        // 步进>0 已由模块级编译期 const _ 断言保证;此处验切块行为。
        let long: String = "字".repeat(CHUNK_SIZE * 2 + 50);
        let cs = chunk_text(&long);
        assert!(cs.len() >= 3, "长文本应切多块"); // 1050 字 / 步进 420 ≈ 3 块
        assert!(cs.iter().all(|c| c.chars().count() <= CHUNK_SIZE));
    }

    #[test]
    fn availability_depends_on_embed() {
        assert!(!embed_configured(""));
        assert!(!embed_configured("   "));
        assert!(embed_configured("text-embedding-3-small"));
    }

    #[test]
    fn pdf_b64_strips_data_url_prefix() {
        // "hi" 的 base64 = aGk=
        assert_eq!(decode_pdf_b64("data:application/pdf;base64,aGk=").unwrap(), b"hi");
        assert_eq!(decode_pdf_b64("aGk=").unwrap(), b"hi"); // 裸 base64 也接受
        assert_eq!(decode_pdf_b64("  aGk=  ").unwrap(), b"hi"); // 容忍前后空白
    }

    #[test]
    fn pdf_b64_bad_input_errs_not_panics() {
        // 不可信输入坏 base64 → Err(不 panic);畸形 PDF 的 panic 另由命令体 catch_unwind 兜。
        assert!(decode_pdf_b64("!!!not-base64!!!").is_err());
    }
}
