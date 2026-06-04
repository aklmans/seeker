//! AI 网关(#1 · G1 单协议直通 + #2 · C1 工具循环)。
//!
//! 职责:跟模型说话。前端只 invoke `ai_chat` 发文字、订阅事件收 token 流;
//! **密钥与出网都在这里**,前端不持 key、不组装系统提示。
//! G1:OpenAI 兼容协议 + 流式 + 取消/超时/错误。
//! C1:从能力层 registry 取 `kind=Tool` 的 schema 塞进请求;模型要调工具时,
//! 累积流式 tool_calls → 经 registry 统一执行(破坏性能力被拒,须走护栏)→ 结果回灌 → 续推。
//! 多协议(G4)、多轮历史与系统提示配置化(G2)后续。
//!
//! 事件:`ai_chunk{sessionId,text}` · `ai_tool{sessionId,id,name,ok}` ·
//!       `ai_done{sessionId,stopReason}` · `ai_error{sessionId,code,message,retriable}`

use crate::capability::{CallCx, Output, Registry};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

const KEY_ACCOUNT: &str = "provider.openai.key";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// 工具循环最多轮数;最后一轮强制不带 tools,逼模型给出最终文本(避免悬在工具调用上)。
const MAX_ROUNDS: usize = 4;

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
struct ToolEv {
    session_id: String,
    id: String,
    name: String,
    ok: bool,
}
/// show_widget 下发:前端据此在沙箱 iframe(sandbox + srcDoc 内 CSP)渲染不可信 UI。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WidgetEv {
    session_id: String,
    id: String,
    html: String,
    title: String,
    min_height: u32,
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

/// 网关内部错误:带 code 与是否可重试。配置/鉴权错**不可重试**(重试无益,引导去设置);
/// 超时/网络/429/5xx **可重试**。
struct ChatError {
    code: &'static str,
    message: String,
    retriable: bool,
}
impl ChatError {
    fn config(msg: impl Into<String>) -> Self {
        Self {
            code: "config",
            message: msg.into(),
            retriable: false,
        }
    }
    fn auth(msg: impl Into<String>) -> Self {
        Self {
            code: "auth",
            message: msg.into(),
            retriable: false,
        }
    }
    fn transient(code: &'static str, msg: impl Into<String>) -> Self {
        Self {
            code,
            message: msg.into(),
            retriable: true,
        }
    }
}

/// 一轮流式请求的结果。
enum RoundOutcome {
    /// 模型给出最终回答(finish_reason stop/length 或 [DONE] 且无工具调用)。
    Done(String),
    /// 被取消。
    Cancelled,
    /// 模型要求调用工具:`assistant` 是带 tool_calls 的助手消息(回灌历史),`calls` 待执行。
    ToolCalls {
        assistant: Value,
        calls: Vec<ToolCall>,
    },
}

/// 一次工具调用(累积完成后)。
struct ToolCall {
    id: String,
    name: String,
    args: String, // 原始 JSON 字符串(流式拼接而成)
}

/// 流式累积中的 tool_call(按 choices[].delta.tool_calls[].index 归位)。
#[derive(Default, Clone)]
struct ToolCallAcc {
    id: String,
    name: String,
    args: String,
}

/// 启动一次流式对话(可含工具循环)。立即返回;token 经 `ai_chunk` 回灌,结束发 `ai_done` / `ai_error`。
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    registry: State<'_, Registry>,
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

    let result = run_chat(
        &app,
        &session_id,
        &user_text,
        task.as_deref(),
        registry.inner(),
        token,
    )
    .await;

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
                    code: e.code.into(),
                    message: e.message,
                    retriable: e.retriable,
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

/// 工具循环:逐轮流式请求,模型要调工具就执行并回灌,直到给出最终回答或达上限。
async fn run_chat(
    app: &AppHandle,
    session_id: &str,
    user_text: &str,
    _task: Option<&str>,
    registry: &Registry,
    token: CancellationToken,
) -> Result<String, ChatError> {
    let cfg = crate::config::load(app);
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        return Err(ChatError::config(
            "尚未配置模型(base_url / model),请在「数据设置」填写",
        ));
    }
    let key = crate::secret::get_secret(KEY_ACCOUNT)
        .map_err(|_| ChatError::config("尚未配置 API Key,请在「数据设置」填写"))?;

    // 系统提示。消息仅 system + user(+ 工具循环产生的 assistant/tool),**结构上不含 profile**
    // (ai_chat 命令签名只有 user_text,网关无从拿到 profile;工具结果只来自白名单业务集合)。
    // 系统提示配置化(domain/prompts)留待 G2。
    let system = "You are Seeker's local-first job-hunt assistant. Be concise and practical; \
                  reply in the user's language. You may call tools to read the user's local \
                  job-hunt data when helpful. Never ask for or store personal contact details.";
    let mut messages = build_messages(system, user_text);
    let tools = registry.tool_schemas();

    for round in 0..MAX_ROUNDS {
        // 最后一轮强制不带 tools,逼出最终文本(防止悬在工具调用上无回答)。
        let round_tools: &[Value] = if round + 1 == MAX_ROUNDS { &[] } else { &tools };
        let outcome = stream_round(
            app,
            session_id,
            &cfg.base_url,
            &cfg.model,
            &key,
            &messages,
            round_tools,
            &token,
        )
        .await?;
        match outcome {
            RoundOutcome::Cancelled => return Ok("cancelled".into()),
            RoundOutcome::Done(stop) => return Ok(stop),
            RoundOutcome::ToolCalls { assistant, calls } => {
                messages.push(assistant);
                let cx = CallCx { app };
                for call in calls {
                    let args: Value =
                        serde_json::from_str(&call.args).unwrap_or_else(|_| json!({}));
                    // 经 invoke_raw 统一执行(破坏性能力被拒);Widget 输出额外下发 ai_widget。
                    let (content, ok) = match registry.invoke_raw(&call.name, &args, &cx) {
                        Ok(Output::Widget(w)) => {
                            let title = w.title.clone();
                            let _ = app.emit(
                                "ai_widget",
                                WidgetEv {
                                    session_id: session_id.to_string(),
                                    id: w.id,
                                    html: w.html,
                                    title: w.title,
                                    min_height: w.min_height,
                                },
                            );
                            (
                                format!("已向用户渲染交互式组件「{title}」(用户可见)。"),
                                true,
                            )
                        }
                        Ok(out) => (out.to_model_text(), true),
                        Err(e) => (json!({ "error": e }).to_string(), false),
                    };
                    let _ = app.emit(
                        "ai_tool",
                        ToolEv {
                            session_id: session_id.to_string(),
                            id: call.id.clone(),
                            name: call.name.clone(),
                            ok,
                        },
                    );
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": content,
                    }));
                }
            }
        }
    }
    Ok("stop".into())
}

/// 单轮流式请求:发送 + 解析 SSE,累积 content(逐 token 回灌)与 tool_calls。
#[allow(clippy::too_many_arguments)]
async fn stream_round(
    app: &AppHandle,
    session_id: &str,
    base_url: &str,
    model: &str,
    key: &str,
    messages: &[Value],
    tools: &[Value],
    token: &CancellationToken,
) -> Result<RoundOutcome, ChatError> {
    let mut body = json!({ "model": model, "stream": true });
    body["messages"] = Value::Array(messages.to_vec());
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
    }
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let send = client.post(&url).bearer_auth(key).json(&body).send();

    let resp = tokio::select! {
        _ = token.cancelled() => return Ok(RoundOutcome::Cancelled),
        r = tokio::time::timeout(CONNECT_TIMEOUT, send) => match r {
            Err(_) => return Err(ChatError::transient("timeout", "连接模型端点超时")),
            Ok(x) => x.map_err(|e| ChatError::transient("network", e.to_string()))?,
        }
    };

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("模型返回 HTTP {} · {}", code, redact(&body));
        return Err(if code == 401 || code == 403 {
            ChatError::auth(msg)
        } else if code == 408 || code == 429 || code >= 500 {
            ChatError::transient("http", msg)
        } else {
            ChatError::config(msg)
        });
    }

    let mut stream = Box::pin(resp.bytes_stream());
    let mut buf = String::new();
    let mut content = String::new();
    let mut calls: Vec<ToolCallAcc> = Vec::new();
    let mut finish: Option<String> = None;

    loop {
        let next = tokio::select! {
            _ = token.cancelled() => return Ok(RoundOutcome::Cancelled),
            r = tokio::time::timeout(IDLE_TIMEOUT, stream.next()) => match r {
                Err(_) => return Err(ChatError::transient("timeout", "模型响应超时(空闲)")),
                Ok(n) => n,
            }
        };
        let Some(chunk) = next else { break };
        let bytes = chunk.map_err(|e| ChatError::transient("network", e.to_string()))?;
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
                return Ok(finalize(content, calls, finish));
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let choice = &v["choices"][0];
            // 文本增量:累积 + 逐 token 回灌。
            if let Some(t) = choice["delta"]["content"].as_str() {
                if !t.is_empty() {
                    content.push_str(t);
                    let _ = app.emit(
                        "ai_chunk",
                        Chunk {
                            session_id: session_id.to_string(),
                            text: t.to_string(),
                        },
                    );
                }
            }
            // 工具调用增量:按 index 累积 id / name / arguments。
            apply_tool_delta(&mut calls, choice);
            if let Some(fr) = choice["finish_reason"].as_str() {
                if !fr.is_empty() {
                    finish = Some(fr.to_string());
                }
            }
        }
    }
    Ok(finalize(content, calls, finish))
}

/// 把一条 choice 的 `delta.tool_calls` 累积进 `calls`(流式分片:首片带 id/name,后续仅 arguments)。
fn apply_tool_delta(calls: &mut Vec<ToolCallAcc>, choice: &Value) {
    let Some(tcs) = choice["delta"]["tool_calls"].as_array() else {
        return;
    };
    for tc in tcs {
        let idx = tc["index"].as_u64().unwrap_or(0) as usize;
        while calls.len() <= idx {
            calls.push(ToolCallAcc::default());
        }
        let slot = &mut calls[idx];
        if let Some(id) = tc["id"].as_str() {
            if !id.is_empty() {
                slot.id = id.to_string();
            }
        }
        if let Some(n) = tc["function"]["name"].as_str() {
            slot.name.push_str(n);
        }
        if let Some(a) = tc["function"]["arguments"].as_str() {
            slot.args.push_str(a);
        }
    }
}

/// 收尾:有有效 tool_calls → ToolCalls(并重建助手消息);否则 → Done(stop)。
fn finalize(content: String, calls: Vec<ToolCallAcc>, finish: Option<String>) -> RoundOutcome {
    let valid: Vec<ToolCallAcc> = calls.into_iter().filter(|c| !c.name.is_empty()).collect();
    if valid.is_empty() {
        return RoundOutcome::Done(finish.unwrap_or_else(|| "stop".into()));
    }
    let tool_calls_json: Vec<Value> = valid
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "type": "function",
                "function": { "name": c.name, "arguments": c.args },
            })
        })
        .collect();
    let assistant = json!({
        "role": "assistant",
        "content": if content.is_empty() { Value::Null } else { Value::String(content) },
        "tool_calls": tool_calls_json,
    });
    let calls = valid
        .into_iter()
        .map(|c| ToolCall {
            id: c.id,
            name: c.name,
            args: c.args,
        })
        .collect();
    RoundOutcome::ToolCalls { assistant, calls }
}

/// 组装发给模型的消息:**只有 system + user**,绝不夹带 profile 等隐私字段
/// (网关无 profile 来源;隐私从结构上隔离 —— 见 privacy 单测)。
fn build_messages(system: &str, user_text: &str) -> Vec<Value> {
    vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user_text }),
    ]
}

/// 错误回报脱敏:截断响应体,避免把可能含敏感串的内容整体外泄。
fn redact(s: &str) -> String {
    s.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_only_system_and_user_no_profile() {
        let m = build_messages("SYS", "我和字节那个岗位匹配吗?");
        assert_eq!(m.len(), 2, "初始消息只应有 system + user 两条");
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[1]["role"], "user");
        // 隐私红线:组装结果绝不含隐私字段键(姓名/电话/邮箱/profile)。
        let s = serde_json::to_string(&m).unwrap();
        for k in ["profile", "phone", "email", "\"name\""] {
            assert!(!s.contains(k), "组装消息不应含隐私键: {k}");
        }
    }

    #[test]
    fn accumulates_streamed_tool_call() {
        // 模拟 OpenAI 流式 tool_call 分片:首片带 id/name + 半截 arguments,次片续 arguments。
        let mut calls = Vec::new();
        apply_tool_delta(
            &mut calls,
            &json!({"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function",
                "function":{"name":"query_data","arguments":"{\"col"}}]}}),
        );
        apply_tool_delta(
            &mut calls,
            &json!({"delta":{"tool_calls":[{"index":0,
                "function":{"arguments":"lection\":\"jobs\"}"}}]}}),
        );
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "query_data");
        let parsed: Value = serde_json::from_str(&calls[0].args).expect("args 应拼成合法 JSON");
        assert_eq!(parsed["collection"], "jobs");
    }

    #[test]
    fn finalize_done_when_no_tool_calls() {
        match finalize("你好".into(), Vec::new(), Some("stop".into())) {
            RoundOutcome::Done(s) => assert_eq!(s, "stop"),
            _ => panic!("无工具调用应为 Done"),
        }
    }

    #[test]
    fn finalize_builds_assistant_tool_message() {
        let acc = ToolCallAcc {
            id: "call_1".into(),
            name: "query_data".into(),
            args: "{\"collection\":\"jobs\"}".into(),
        };
        match finalize(String::new(), vec![acc], Some("tool_calls".into())) {
            RoundOutcome::ToolCalls { assistant, calls } => {
                assert_eq!(assistant["role"], "assistant");
                assert_eq!(assistant["tool_calls"][0]["function"]["name"], "query_data");
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].name, "query_data");
            }
            _ => panic!("有工具调用应为 ToolCalls"),
        }
    }

    #[test]
    fn parses_openai_content_delta() {
        let mut calls = Vec::new();
        let choice = json!({"delta":{"content":"你好"}});
        apply_tool_delta(&mut calls, &choice); // 无 tool_calls → 不动
        assert!(calls.is_empty());
        assert_eq!(choice["delta"]["content"].as_str(), Some("你好"));
    }
}
