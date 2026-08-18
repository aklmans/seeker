//! 模型供应商协议适配器。
//!
//! `ai.rs` 内部继续使用一份稳定的 canonical message/tool 形状(OpenAI 风格仅作为内部
//! 表示,不等于线上协议)。本模块在出网边界把它翻译为各供应商的原生 wire format,
//! 并把流式事件归一成文本、工具参数与停止原因。密钥不进入任何返回值或日志。

use crate::config::ProviderProtocol;
use reqwest::RequestBuilder;
use serde_json::{json, Value};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u64 = 4096;

pub(crate) struct RequestSpec {
    pub url: String,
    pub body: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ArgumentsUpdate {
    Append(String),
    Replace(String),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ToolDelta {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments: Option<ArgumentsUpdate>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct StreamDelta {
    pub text: Vec<String>,
    pub tools: Vec<ToolDelta>,
    pub finish: Option<String>,
    pub done: bool,
}

fn append_endpoint(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = path.trim_start_matches('/');
    format!("{base}/{path}")
}

fn gemini_base(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1beta") || base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1beta")
    }
}

fn anthropic_messages_endpoint(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1") {
        append_endpoint(base, "messages")
    } else {
        append_endpoint(base, "v1/messages")
    }
}

fn anthropic_messages(messages: &[Value]) -> (Option<String>, Vec<Value>) {
    let mut system = Vec::new();
    let mut out = Vec::new();
    let mut tool_names = std::collections::HashMap::<String, String>::new();
    let mut i = 0;
    while i < messages.len() {
        let message = &messages[i];
        match message["role"].as_str().unwrap_or("") {
            "system" => {
                if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
                    system.push(text.to_string());
                }
            }
            "assistant" => {
                let mut blocks = Vec::new();
                if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                if let Some(calls) = message["tool_calls"].as_array() {
                    for call in calls {
                        let id = call["id"].as_str().unwrap_or("");
                        let name = call["function"]["name"].as_str().unwrap_or("");
                        let input = call["function"]["arguments"]
                            .as_str()
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                            .unwrap_or_else(|| json!({}));
                        if !id.is_empty() && !name.is_empty() {
                            tool_names.insert(id.to_string(), name.to_string());
                            blocks.push(json!({
                                "type": "tool_use", "id": id, "name": name, "input": input,
                            }));
                        }
                    }
                }
                if !blocks.is_empty() {
                    out.push(json!({ "role": "assistant", "content": blocks }));
                }
            }
            "tool" => {
                // Anthropic 要求同一 assistant turn 的 tool_result 紧邻且位于 user content
                // 开头；把连续 canonical tool 消息合成一个 user turn。
                let mut blocks = Vec::new();
                while i < messages.len() && messages[i]["role"] == "tool" {
                    let m = &messages[i];
                    let id = m["tool_call_id"].as_str().unwrap_or("");
                    let content = m["content"].as_str().unwrap_or("");
                    if !id.is_empty() {
                        blocks.push(json!({
                            "type": "tool_result", "tool_use_id": id, "content": content,
                        }));
                        // 读取映射是刻意的：若后续要在错误信息里显示工具名,不必再扫历史。
                        let _ = tool_names.get(id);
                    }
                    i += 1;
                }
                if !blocks.is_empty() {
                    out.push(json!({ "role": "user", "content": blocks }));
                }
                continue;
            }
            "user" => {
                out.push(json!({
                    "role": "user",
                    "content": message["content"].clone(),
                }));
            }
            _ => {}
        }
        i += 1;
    }
    let system = if system.is_empty() {
        None
    } else {
        Some(system.join("\n\n"))
    };
    (system, out)
}

fn anthropic_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|tool| {
            let f = tool.get("function")?;
            let name = f.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(json!({
                "name": name,
                "description": f.get("description").cloned().unwrap_or(Value::String(String::new())),
                "input_schema": f.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object" })),
            }))
        })
        .collect()
}

fn push_gemini_content(contents: &mut Vec<Value>, role: &str, parts: Vec<Value>) {
    if parts.is_empty() {
        return;
    }
    if let Some(last) = contents.last_mut().filter(|m| m["role"] == role) {
        if let Some(existing) = last["parts"].as_array_mut() {
            existing.extend(parts);
            return;
        }
    }
    contents.push(json!({ "role": role, "parts": parts }));
}

fn gemini_messages(messages: &[Value]) -> (Option<Value>, Vec<Value>) {
    let mut systems = Vec::new();
    let mut contents = Vec::new();
    let mut tool_names = std::collections::HashMap::<String, String>::new();
    for message in messages {
        match message["role"].as_str().unwrap_or("") {
            "system" => {
                if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
                    systems.push(text.to_string());
                }
            }
            "user" => {
                if let Some(text) = message["content"].as_str() {
                    push_gemini_content(&mut contents, "user", vec![json!({ "text": text })]);
                }
            }
            "assistant" => {
                let mut parts = Vec::new();
                if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
                    parts.push(json!({ "text": text }));
                }
                if let Some(calls) = message["tool_calls"].as_array() {
                    for call in calls {
                        let id = call["id"].as_str().unwrap_or("");
                        let name = call["function"]["name"].as_str().unwrap_or("");
                        let args = call["function"]["arguments"]
                            .as_str()
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                            .unwrap_or_else(|| json!({}));
                        if !name.is_empty() {
                            if !id.is_empty() {
                                tool_names.insert(id.to_string(), name.to_string());
                            }
                            parts.push(json!({ "functionCall": { "name": name, "args": args } }));
                        }
                    }
                }
                push_gemini_content(&mut contents, "model", parts);
            }
            "tool" => {
                let id = message["tool_call_id"].as_str().unwrap_or("");
                let name = tool_names
                    .get(id)
                    .map(String::as_str)
                    .unwrap_or("unknown_tool");
                let raw = message["content"].as_str().unwrap_or("");
                let response = serde_json::from_str::<Value>(raw)
                    .ok()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({ "result": raw }));
                push_gemini_content(
                    &mut contents,
                    "user",
                    vec![json!({ "functionResponse": { "name": name, "response": response } })],
                );
            }
            _ => {}
        }
    }
    let system = if systems.is_empty() {
        None
    } else {
        Some(json!({ "parts": [{ "text": systems.join("\n\n") }] }))
    };
    (system, contents)
}

fn gemini_tools(tools: &[Value]) -> Vec<Value> {
    let declarations: Vec<Value> = tools
        .iter()
        .filter_map(|tool| {
            let f = tool.get("function")?;
            let name = f.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(json!({
                "name": name,
                "description": f.get("description").cloned().unwrap_or(Value::String(String::new())),
                "parameters": f.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object" })),
            }))
        })
        .collect();
    if declarations.is_empty() {
        Vec::new()
    } else {
        vec![json!({ "functionDeclarations": declarations })]
    }
}

pub(crate) fn stream_request(
    protocol: ProviderProtocol,
    base_url: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> RequestSpec {
    match protocol {
        ProviderProtocol::Openai | ProviderProtocol::Ollama => {
            let mut body = json!({
                "model": model, "stream": true, "messages": messages,
            });
            if !tools.is_empty() {
                body["tools"] = Value::Array(tools.to_vec());
            }
            RequestSpec {
                url: append_endpoint(base_url, "chat/completions"),
                body,
            }
        }
        ProviderProtocol::Anthropic => {
            let (system, messages) = anthropic_messages(messages);
            let mut body = json!({
                "model": model,
                "max_tokens": DEFAULT_MAX_TOKENS,
                "stream": true,
                "messages": messages,
            });
            if let Some(system) = system {
                body["system"] = Value::String(system);
            }
            let tools = anthropic_tools(tools);
            if !tools.is_empty() {
                body["tools"] = Value::Array(tools);
            }
            RequestSpec {
                url: anthropic_messages_endpoint(base_url),
                body,
            }
        }
        ProviderProtocol::Gemini => {
            let (system, contents) = gemini_messages(messages);
            let mut body = json!({ "contents": contents });
            if let Some(system) = system {
                body["systemInstruction"] = system;
            }
            let tools = gemini_tools(tools);
            if !tools.is_empty() {
                body["tools"] = Value::Array(tools);
            }
            let model = model.trim_start_matches("models/");
            RequestSpec {
                url: append_endpoint(
                    &gemini_base(base_url),
                    &format!("models/{model}:streamGenerateContent?alt=sse"),
                ),
                body,
            }
        }
    }
}

pub(crate) fn authorize(
    protocol: ProviderProtocol,
    request: RequestBuilder,
    key: &str,
) -> RequestBuilder {
    match protocol {
        ProviderProtocol::Anthropic => request
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION),
        ProviderProtocol::Gemini => request.header("x-goog-api-key", key),
        ProviderProtocol::Openai | ProviderProtocol::Ollama => request.bearer_auth(key),
    }
}

fn normalized_finish(value: &str) -> String {
    match value {
        "end_turn" | "STOP" => "stop".to_string(),
        "max_tokens" | "MAX_TOKENS" => "length".to_string(),
        "tool_use" => "tool_calls".to_string(),
        other => other.to_ascii_lowercase(),
    }
}

pub(crate) fn parse_stream_delta(protocol: ProviderProtocol, value: &Value) -> StreamDelta {
    match protocol {
        ProviderProtocol::Openai | ProviderProtocol::Ollama => {
            let choice = &value["choices"][0];
            let mut out = StreamDelta::default();
            if let Some(text) = choice["delta"]["content"]
                .as_str()
                .filter(|s| !s.is_empty())
            {
                out.text.push(text.to_string());
            }
            if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
                for call in calls {
                    out.tools.push(ToolDelta {
                        index: call["index"].as_u64().unwrap_or(0) as usize,
                        id: call["id"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .map(str::to_string),
                        name: call["function"]["name"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .map(str::to_string),
                        arguments: call["function"]["arguments"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .map(|s| ArgumentsUpdate::Append(s.to_string())),
                    });
                }
            }
            out.finish = choice["finish_reason"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(normalized_finish);
            out
        }
        ProviderProtocol::Anthropic => {
            let mut out = StreamDelta::default();
            match value["type"].as_str().unwrap_or("") {
                "content_block_start" => {
                    let block = &value["content_block"];
                    if block["type"] == "text" {
                        if let Some(text) = block["text"].as_str().filter(|s| !s.is_empty()) {
                            out.text.push(text.to_string());
                        }
                    } else if block["type"] == "tool_use" {
                        let input = block
                            .get("input")
                            .filter(|v| {
                                !v.is_null() && !v.as_object().is_some_and(|m| m.is_empty())
                            })
                            .map(Value::to_string);
                        out.tools.push(ToolDelta {
                            index: value["index"].as_u64().unwrap_or(0) as usize,
                            id: block["id"].as_str().map(str::to_string),
                            name: block["name"].as_str().map(str::to_string),
                            arguments: input.map(ArgumentsUpdate::Replace),
                        });
                    }
                }
                "content_block_delta" => match value["delta"]["type"].as_str().unwrap_or("") {
                    "text_delta" => {
                        if let Some(text) =
                            value["delta"]["text"].as_str().filter(|s| !s.is_empty())
                        {
                            out.text.push(text.to_string());
                        }
                    }
                    "input_json_delta" => {
                        if let Some(json) = value["delta"]["partial_json"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                        {
                            out.tools.push(ToolDelta {
                                index: value["index"].as_u64().unwrap_or(0) as usize,
                                id: None,
                                name: None,
                                arguments: Some(ArgumentsUpdate::Append(json.to_string())),
                            });
                        }
                    }
                    _ => {}
                },
                "message_delta" => {
                    out.finish = value["delta"]["stop_reason"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(normalized_finish);
                }
                "message_stop" => out.done = true,
                "error" => {
                    out.finish = Some("error".to_string());
                    out.done = true;
                }
                _ => {}
            }
            out
        }
        ProviderProtocol::Gemini => {
            let mut out = StreamDelta::default();
            let Some(candidate) = value["candidates"].as_array().and_then(|a| a.first()) else {
                return out;
            };
            let mut tool_index = 0;
            if let Some(parts) = candidate["content"]["parts"].as_array() {
                for part in parts {
                    if let Some(text) = part["text"].as_str().filter(|s| !s.is_empty()) {
                        out.text.push(text.to_string());
                    }
                    if let Some(call) = part
                        .get("functionCall")
                        .or_else(|| part.get("function_call"))
                    {
                        let name = call["name"].as_str().unwrap_or("").to_string();
                        if !name.is_empty() {
                            out.tools.push(ToolDelta {
                                index: tool_index,
                                id: Some(format!("gemini-call-{tool_index}")),
                                name: Some(name),
                                arguments: Some(ArgumentsUpdate::Replace(
                                    call.get("args")
                                        .cloned()
                                        .unwrap_or_else(|| json!({}))
                                        .to_string(),
                                )),
                            });
                            tool_index += 1;
                        }
                    }
                }
            }
            out.finish = candidate["finishReason"]
                .as_str()
                .or_else(|| candidate["finish_reason"].as_str())
                .filter(|s| !s.is_empty())
                .map(normalized_finish);
            out
        }
    }
}

fn split_data_url(url: &str) -> Result<(&str, &str), String> {
    let (meta, data) = url
        .strip_prefix("data:")
        .and_then(|s| s.split_once(','))
        .ok_or_else(|| "图片必须是 data URL".to_string())?;
    let mime = meta
        .strip_suffix(";base64")
        .ok_or_else(|| "图片 data URL 必须使用 base64 编码".to_string())?;
    if mime.is_empty() || data.is_empty() {
        return Err("图片 data URL 为空".to_string());
    }
    Ok((mime, data))
}

pub(crate) fn extract_request(
    protocol: ProviderProtocol,
    base_url: &str,
    model: &str,
    prompt: &str,
    image_data_url: Option<&str>,
) -> Result<RequestSpec, String> {
    match protocol {
        ProviderProtocol::Openai | ProviderProtocol::Ollama => {
            let content = match image_data_url.filter(|s| !s.is_empty()) {
                Some(url) => json!([
                    { "type": "text", "text": prompt },
                    { "type": "image_url", "image_url": { "url": url } },
                ]),
                None => Value::String(prompt.to_string()),
            };
            Ok(RequestSpec {
                url: append_endpoint(base_url, "chat/completions"),
                body: json!({
                    "model": model, "stream": false,
                    "messages": [{ "role": "user", "content": content }],
                }),
            })
        }
        ProviderProtocol::Anthropic => {
            let mut content = vec![json!({ "type": "text", "text": prompt })];
            if let Some(url) = image_data_url.filter(|s| !s.is_empty()) {
                let (media_type, data) = split_data_url(url)?;
                content.insert(
                    0,
                    json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": media_type, "data": data },
                    }),
                );
            }
            Ok(RequestSpec {
                url: anthropic_messages_endpoint(base_url),
                body: json!({
                    "model": model, "max_tokens": DEFAULT_MAX_TOKENS,
                    "stream": false, "messages": [{ "role": "user", "content": content }],
                }),
            })
        }
        ProviderProtocol::Gemini => {
            let mut parts = vec![json!({ "text": prompt })];
            if let Some(url) = image_data_url.filter(|s| !s.is_empty()) {
                let (mime_type, data) = split_data_url(url)?;
                parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": data } }));
            }
            let model = model.trim_start_matches("models/");
            Ok(RequestSpec {
                url: append_endpoint(
                    &gemini_base(base_url),
                    &format!("models/{model}:generateContent"),
                ),
                body: json!({ "contents": [{ "role": "user", "parts": parts }] }),
            })
        }
    }
}

pub(crate) fn extract_text(protocol: ProviderProtocol, value: &Value) -> String {
    match protocol {
        ProviderProtocol::Openai | ProviderProtocol::Ollama => value["choices"][0]["message"]
            ["content"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        ProviderProtocol::Anthropic => value["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        ProviderProtocol::Gemini => value["candidates"][0]["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical_messages() -> Vec<Value> {
        vec![
            json!({ "role": "system", "content": "system rules" }),
            json!({ "role": "user", "content": "weather?" }),
            json!({ "role": "assistant", "content": null, "tool_calls": [{
                "id": "call-1", "type": "function",
                "function": { "name": "weather", "arguments": "{\"city\":\"LA\"}" }
            }] }),
            json!({ "role": "tool", "tool_call_id": "call-1", "content": "{\"temp\":22}" }),
        ]
    }

    fn canonical_tools() -> Vec<Value> {
        vec![json!({
            "type": "function",
            "function": {
                "name": "weather", "description": "Read weather",
                "parameters": { "type": "object", "properties": { "city": { "type": "string" } } }
            }
        })]
    }

    #[test]
    fn openai_and_ollama_preserve_compatible_wire_shape() {
        for protocol in [ProviderProtocol::Openai, ProviderProtocol::Ollama] {
            let spec = stream_request(
                protocol,
                "https://example.test/v1/",
                "model-x",
                &canonical_messages(),
                &canonical_tools(),
            );
            assert_eq!(spec.url, "https://example.test/v1/chat/completions");
            assert_eq!(spec.body["messages"][2]["tool_calls"][0]["id"], "call-1");
            assert_eq!(spec.body["tools"][0]["type"], "function");
        }
    }

    #[test]
    fn anthropic_request_moves_system_and_translates_tool_loop() {
        let spec = stream_request(
            ProviderProtocol::Anthropic,
            "https://api.anthropic.com/",
            "claude-test",
            &canonical_messages(),
            &canonical_tools(),
        );
        assert_eq!(spec.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(spec.body["system"], "system rules");
        assert_eq!(spec.body["messages"][1]["content"][0]["type"], "tool_use");
        assert_eq!(
            spec.body["messages"][2]["content"][0]["tool_use_id"],
            "call-1"
        );
        assert_eq!(spec.body["tools"][0]["input_schema"]["type"], "object");
        let with_versioned_base = stream_request(
            ProviderProtocol::Anthropic,
            "https://api.anthropic.com/v1",
            "claude-test",
            &canonical_messages(),
            &[],
        );
        assert_eq!(
            with_versioned_base.url,
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    fn gemini_request_translates_roles_tools_and_function_response() {
        let spec = stream_request(
            ProviderProtocol::Gemini,
            "https://generativelanguage.googleapis.com",
            "models/gemini-test",
            &canonical_messages(),
            &canonical_tools(),
        );
        assert_eq!(
            spec.url,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse"
        );
        assert_eq!(
            spec.body["systemInstruction"]["parts"][0]["text"],
            "system rules"
        );
        assert_eq!(spec.body["contents"][1]["role"], "model");
        assert_eq!(
            spec.body["contents"][2]["parts"][0]["functionResponse"]["name"],
            "weather"
        );
        assert_eq!(
            spec.body["tools"][0]["functionDeclarations"][0]["name"],
            "weather"
        );
    }

    #[test]
    fn provider_stream_events_normalize_to_one_shape() {
        let anthropic = parse_stream_delta(
            ProviderProtocol::Anthropic,
            &json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}),
        );
        assert_eq!(
            anthropic.tools[0].arguments,
            Some(ArgumentsUpdate::Append("{\"city\":".into()))
        );
        let gemini = parse_stream_delta(
            ProviderProtocol::Gemini,
            &json!({"candidates":[{"content":{"parts":[{"text":"hi"},{"functionCall":{"name":"weather","args":{"city":"LA"}}}]},"finishReason":"STOP"}]}),
        );
        assert_eq!(gemini.text, vec!["hi"]);
        assert_eq!(gemini.finish.as_deref(), Some("stop"));
        assert_eq!(gemini.tools[0].id.as_deref(), Some("gemini-call-0"));
    }

    #[test]
    fn native_extract_requests_encode_images_without_leaking_data_url_prefix() {
        let anthropic = extract_request(
            ProviderProtocol::Anthropic,
            "https://api.anthropic.com",
            "claude-test",
            "read",
            Some("data:image/png;base64,QUJD"),
        )
        .unwrap();
        assert_eq!(
            anthropic.body["messages"][0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(
            anthropic.body["messages"][0]["content"][0]["source"]["data"],
            "QUJD"
        );
        let gemini = extract_request(
            ProviderProtocol::Gemini,
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-test",
            "read",
            Some("data:image/jpeg;base64,REVG"),
        )
        .unwrap();
        assert_eq!(
            gemini.body["contents"][0]["parts"][1]["inlineData"]["mimeType"],
            "image/jpeg"
        );
    }

    #[test]
    fn extract_requests_are_single_user_turn_and_structurally_toolless() {
        for protocol in [
            ProviderProtocol::Openai,
            ProviderProtocol::Anthropic,
            ProviderProtocol::Gemini,
            ProviderProtocol::Ollama,
        ] {
            let spec = extract_request(
                protocol,
                "https://example.test/v1",
                "model-x",
                "extract only",
                None,
            )
            .unwrap();
            let serialized = spec.body.to_string();
            assert!(!serialized.contains("\"tools\""));
            assert!(!serialized.contains("\"system\""));
            assert!(!serialized.contains("profile"));
            let turns = spec
                .body
                .get("messages")
                .or_else(|| spec.body.get("contents"))
                .and_then(Value::as_array)
                .unwrap();
            assert_eq!(turns.len(), 1);
            assert_eq!(turns[0]["role"], "user");
        }
    }

    #[test]
    fn extracts_text_from_all_provider_response_shapes() {
        assert_eq!(
            extract_text(
                ProviderProtocol::Openai,
                &json!({"choices":[{"message":{"content":"openai"}}]})
            ),
            "openai"
        );
        assert_eq!(
            extract_text(
                ProviderProtocol::Anthropic,
                &json!({"content":[{"type":"text","text":"an"},{"type":"text","text":"thropic"}]})
            ),
            "anthropic"
        );
        assert_eq!(
            extract_text(
                ProviderProtocol::Gemini,
                &json!({"candidates":[{"content":{"parts":[{"text":"gem"},{"text":"ini"}]}}]})
            ),
            "gemini"
        );
    }
}
