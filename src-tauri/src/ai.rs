//! AI 网关(#1 · G1 单协议直通)。
//!
//! 职责:跟模型说话。前端只 invoke `ai_chat` 发文字、订阅事件收 token 流;
//! **密钥与出网都在这里**,前端不持 key、不组装系统提示。
//! G1 仅 OpenAI 兼容协议 + 流式 + 取消/超时/错误;多协议(G4)与工具循环(G3)后续。
//!
//! 事件:`ai_chunk{sessionId,text}` · `ai_done{sessionId,stopReason}` · `ai_error{sessionId,code,message,retriable}`

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

const KEY_ACCOUNT: &str = "provider.openai.key";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// 进程内会话注册表:sessionId → 取消令牌(供 ai_cancel 中断流)。
#[derive(Default)]
pub struct Sessions(pub Mutex<HashMap<String, CancellationToken>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Chunk {
    session_id: String,
    text: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DoneEv {
    session_id: String,
    stop_reason: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ErrEv {
    session_id: String,
    code: String,
    message: String,
    retriable: bool,
}

/// 启动一次流式对话。立即返回;token 经 `ai_chunk` 回灌,结束发 `ai_done` / `ai_error`。
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    session_id: String,
    user_text: String,
    task: Option<String>,
) -> Result<(), String> {
    let token = CancellationToken::new();
    sessions
        .0
        .lock()
        .unwrap()
        .insert(session_id.clone(), token.clone());

    let result = stream_openai(&app, &session_id, &user_text, task.as_deref(), token).await;

    sessions.0.lock().unwrap().remove(&session_id);
    match result {
        Ok(stop) => {
            let _ = app.emit(
                "ai_done",
                DoneEv {
                    session_id,
                    stop_reason: stop,
                },
            );
        }
        Err(e) => {
            let _ = app.emit(
                "ai_error",
                ErrEv {
                    session_id,
                    code: "gateway".into(),
                    message: e,
                    retriable: true,
                },
            );
        }
    }
    Ok(())
}

/// 取消指定会话的流式生成。
#[tauri::command]
pub fn ai_cancel(sessions: State<'_, Sessions>, session_id: String) -> Result<(), String> {
    if let Some(tok) = sessions.0.lock().unwrap().get(&session_id) {
        tok.cancel();
    }
    Ok(())
}

async fn stream_openai(
    app: &AppHandle,
    session_id: &str,
    user_text: &str,
    _task: Option<&str>,
    token: CancellationToken,
) -> Result<String, String> {
    let cfg = crate::config::load(app);
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        return Err("尚未配置模型(base_url / model),请在「数据设置」填写".into());
    }
    let key = crate::secret::get_secret(KEY_ACCOUNT)
        .map_err(|_| "尚未配置 API Key,请在「数据设置」填写".to_string())?;

    // 系统提示。G2:消息仅 system + user 两类,**结构上不含 profile 隐私字段**
    // (ai_chat 命令签名只有 user_text,网关无从拿到 profile)。系统提示配置化(domain/prompts)留待后续细化。
    let system = "You are Seeker's local-first job-hunt assistant. Be concise and practical; \
                  reply in the user's language. Never ask for or store personal contact details.";
    let body = json!({
        "model": cfg.model,
        "stream": true,
        "messages": build_messages(system, user_text),
    });
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let send = client.post(&url).bearer_auth(&key).json(&body).send();
    // key 自此不再使用,函数结束即丢弃(用完即弃)。

    let resp = tokio::select! {
        _ = token.cancelled() => return Ok("cancelled".into()),
        r = tokio::time::timeout(CONNECT_TIMEOUT, send) => match r {
            Err(_) => return Err("连接模型端点超时".into()),
            Ok(x) => x.map_err(|e| e.to_string())?,
        }
    };

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("模型返回 HTTP {} · {}", code, redact(&body)));
    }

    let mut stream = Box::pin(resp.bytes_stream());
    let mut buf = String::new();
    loop {
        let next = tokio::select! {
            _ = token.cancelled() => return Ok("cancelled".into()),
            r = tokio::time::timeout(IDLE_TIMEOUT, stream.next()) => match r {
                Err(_) => return Err("模型响应超时(空闲)".into()),
                Ok(n) => n,
            }
        };
        let Some(chunk) = next else { break };
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        // 逐行解析 SSE:`data: {json}` / `data: [DONE]`
        while let Some(pos) = buf.find('\n') {
            let line: String = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                return Ok("stop".into());
            }
            if let Some(text) = extract_content_delta(data) {
                if !text.is_empty() {
                    let _ = app.emit(
                        "ai_chunk",
                        Chunk {
                            session_id: session_id.to_string(),
                            text,
                        },
                    );
                }
            }
        }
    }
    Ok("stop".into())
}

/// 组装发给模型的消息:**只有 system + user**,绝不夹带 profile 等隐私字段
/// (网关无 profile 来源;隐私从结构上隔离 —— 见 privacy 单测)。
fn build_messages(system: &str, user_text: &str) -> serde_json::Value {
    json!([
        {"role": "system", "content": system},
        {"role": "user", "content": user_text},
    ])
}

/// 从 OpenAI 兼容 SSE 的 data 行抽取增量内容;`[DONE]`/无内容 → None。
fn extract_content_delta(data: &str) -> Option<String> {
    if data == "[DONE]" {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    v["choices"][0]["delta"]["content"]
        .as_str()
        .map(|s| s.to_string())
}

/// 错误回报脱敏:截断响应体,避免把可能含敏感串的内容整体外泄。
fn redact(s: &str) -> String {
    s.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::{build_messages, extract_content_delta};

    #[test]
    fn messages_are_only_system_and_user_no_profile() {
        let m = build_messages("SYS", "我和字节那个岗位匹配吗?");
        let arr = m.as_array().expect("array");
        assert_eq!(arr.len(), 2, "只应有 system + user 两条");
        assert_eq!(arr[0]["role"], "system");
        assert_eq!(arr[1]["role"], "user");
        // 隐私红线:组装结果绝不含隐私字段键(姓名/电话/邮箱/profile)。
        let s = m.to_string();
        for k in ["profile", "phone", "email", "\"name\""] {
            assert!(!s.contains(k), "组装消息不应含隐私键: {k}");
        }
    }

    #[test]
    fn parses_openai_delta() {
        let d = r#"{"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(extract_content_delta(d), Some("你好".into()));
    }

    #[test]
    fn ignores_done_and_empty() {
        assert_eq!(extract_content_delta("[DONE]"), None);
        assert_eq!(extract_content_delta("{}"), None);
        assert_eq!(extract_content_delta(r#"{"choices":[{"delta":{}}]}"#), None);
    }
}
