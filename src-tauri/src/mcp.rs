//! MCP(Model Context Protocol)stdio 客户端 —— #2 C4 开放扩展第 1 块。
//!
//! 连用户**显式配置**的 MCP server(`spawn` 子进程),走 JSON-RPC 2.0 over 换行分隔 stdio:
//! `initialize` 握手 → `tools/list` 发现工具。（`tools/call` 与能力层/网关集成在后续提交接。）
//!
//! 安全立场(本块只做"连 + 列",集成层再接红线):
//! - **MCP server = 用户主动安装的不可信代码**(以 app 权限 `spawn`、非沙箱)→ 绝不自动添加;
//!   UI「添加 server」须取得用户知情同意(这会在本机运行一个程序)。
//! - 工具**结果**接入网关时将标 `Trust::Untrusted`(数据非指令、防注入);非只读工具经 `guardrail`。
//! - 本模块只负责协议管线;不碰密钥、不入提示、不自动执行任何工具。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

/// JSON-RPC 请求 id 自增(进程内唯一即可)。
static RPC_ID: AtomicI64 = AtomicI64::new(1);
fn next_id() -> i64 {
    RPC_ID.fetch_add(1, Ordering::Relaxed)
}

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// 我们声明的 MCP 协议版本(server 不符会在 initialize 阶段协商)。
const PROTOCOL_VERSION: &str = "2024-11-05";

// ── 纯协议助手(可单测,不碰 IO)──────────────────────────────────

/// 构造 JSON-RPC 2.0 请求对象。
fn rpc_request(id: i64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

/// 构造 JSON-RPC 2.0 通知(无 id,不期望响应)。
fn rpc_notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

/// 从 JSON-RPC 响应取 `result`;`error` → Err(可读消息)。
fn rpc_result(resp: &Value) -> Result<Value, String> {
    if let Some(e) = resp.get("error") {
        let msg = e
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        let code = e.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        return Err(format!("MCP server 报错({code}): {msg}"));
    }
    Ok(resp.get("result").cloned().unwrap_or(Value::Null))
}

/// 该 JSON 是否是"对 id 的响应"(匹配 id + 含 result/error)。用于读循环跳过通知 / 无关消息。
fn is_response_to(v: &Value, id: i64) -> bool {
    v.get("id").and_then(|i| i.as_i64()) == Some(id)
        && (v.get("result").is_some() || v.get("error").is_some())
}

/// 一个 MCP 工具的精简描述(后续翻译成 Capability 的 schema)。
#[derive(Debug, Clone, PartialEq)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    /// MCP `annotations.readOnlyHint`:true = server 自报只读。仅作"是否经 guardrail"的**提示**,不轻信。
    pub read_only: bool,
}

/// 解析 `tools/list` 的 result → Vec<McpTool>。容错:缺 name 的工具跳过、缺 schema 用空 object。
fn parse_tools(result: &Value) -> Vec<McpTool> {
    result
        .get("tools")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?.to_string();
                    if name.is_empty() {
                        return None;
                    }
                    let description = t
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input_schema = t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object" }));
                    let read_only = t
                        .get("annotations")
                        .and_then(|a| a.get("readOnlyHint"))
                        .and_then(|r| r.as_bool())
                        .unwrap_or(false);
                    Some(McpTool {
                        name,
                        description,
                        input_schema,
                        read_only,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ── 传输层抽象(stdio / http 共用协议层)──────────────────────────
//
// 协议层(initialize / tools-list / tools-call,见 McpClient)与具体传输解耦:
// stdio = spawn 子进程、换行分隔 JSON-RPC;http = Streamable HTTP(远程 MCP)。
// 加传输 = 实现 Transport,协议层与网关零改动。

/// 一个 MCP 传输通道:发请求(等响应)/ 发通知(不等)。JSON-RPC 帧由协议层构造。
#[async_trait::async_trait]
trait Transport: Send {
    /// 发一个 JSON-RPC 请求并取回 `result`(`error` → Err)。id 由传输内部分配。
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String>;
    /// 发一个 JSON-RPC 通知(无 id,不期望响应)。
    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String>;
}

/// stdio 传输:spawn 子进程,JSON-RPC over 换行分隔 stdin/stdout。Drop 即 kill(`kill_on_drop`)。
struct StdioTransport {
    _child: Child, // 仅持有以维持子进程生命周期 + Drop 时 kill
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl StdioTransport {
    /// `spawn command args...`(不含握手——握手由 McpClient 统一做)。
    async fn spawn(
        command: &str,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args);
        // 叠加配置的密钥环境变量(名在配置、值来自钥匙串);名再校验一层防注入。
        // 继承父进程环境(server 需 PATH 等)——仅在其上叠加。
        for (k, v) in env {
            if is_valid_env_name(k) {
                cmd.env(k, v);
            }
        }
        let mut child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("启动 MCP server 失败({command}): {e}"))?;
        let stdin = child.stdin.take().ok_or("无法取得 server stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("无法取得 server stdout")?);
        Ok(StdioTransport {
            _child: child,
            stdin,
            stdout,
        })
    }

    async fn send(&mut self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        line.push('\n'); // MCP stdio:换行分隔,消息内不得含换行
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写 MCP server 失败: {e}"))?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 读行直到匹配 id 的响应(跳过通知 / server 主动消息 / 非 JSON 行)。
    async fn read_response(&mut self, id: i64) -> Result<Value, String> {
        loop {
            let mut line = String::new();
            let n = self
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|e| format!("读 MCP server 失败: {e}"))?;
            if n == 0 {
                return Err("MCP server 关闭了连接".into());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(v) if is_response_to(&v, id) => return rpc_result(&v),
                _ => continue, // 通知 / 无关 id / 非 JSON → 跳过
            }
        }
    }
}

#[async_trait::async_trait]
impl Transport for StdioTransport {
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = next_id();
        self.send(&rpc_request(id, method, params)).await?;
        tokio::time::timeout(REQUEST_TIMEOUT, self.read_response(id))
            .await
            .map_err(|_| format!("MCP 请求超时: {method}"))?
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(&rpc_notification(method, params)).await
    }
}

// ── http 传输:Streamable HTTP(远程 MCP)─────────────────────────
//
// MCP 现行 spec 的远程传输:POST 一个 JSON-RPC 请求,响应为 `application/json`
// (单 JSON-RPC)或 `text/event-stream`(SSE)。我们只做**请求/响应**——不开常驻
// SSE GET 流(不消费 server 主动通知)。鉴权令牌只在内存里拼成头、随请求发出,
// **绝不记录**;若 server 在错误体回显令牌,经 `scrub` 脱敏。

/// 从一个 SSE 事件块拼接 `data:` 行 → 试解析为 JSON。非数据 / 非 JSON → None。(纯函数,可单测)
fn parse_sse_event(event: &str) -> Option<Value> {
    let mut data = String::new();
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    if data.is_empty() {
        return None;
    }
    serde_json::from_str(&data).ok()
}

/// 从 SSE 响应流读出匹配 `id` 的 JSON-RPC 响应(**找到即返回**——避免 server 持流不关时挂死)。
async fn read_sse_response(resp: reqwest::Response, id: i64) -> Result<Value, String> {
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读 MCP SSE 流失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        buf = buf.replace("\r\n", "\n"); // 归一化换行,便于按空行切事件
        while let Some(pos) = buf.find("\n\n") {
            let event: String = buf.drain(..pos + 2).collect();
            if let Some(v) = parse_sse_event(&event) {
                if is_response_to(&v, id) {
                    return rpc_result(&v);
                }
            }
        }
    }
    // 流结束:把剩余 buffer 当最后一个事件再试一次。
    if let Some(v) = parse_sse_event(&buf) {
        if is_response_to(&v, id) {
            return rpc_result(&v);
        }
    }
    Err("MCP SSE 流结束但未返回该请求的响应".into())
}

/// http 传输:Streamable HTTP。每次 `request`/`notify` 都 POST 一个 JSON-RPC 消息。
struct HttpTransport {
    client: reqwest::Client,
    url: String,
    /// 鉴权头 `(名, 值)`,值已含方案前缀(如 `Bearer xxx`);None = 无鉴权。**绝不记录。**
    auth: Option<(String, String)>,
    /// initialize 响应回带的 `Mcp-Session-Id`,后续请求须带(server 据此认会话)。
    session_id: Option<String>,
}

impl HttpTransport {
    fn new(url: String, auth: Option<(String, String)>) -> Result<Self, String> {
        // 不设全局 timeout——每次请求由 Transport 层用 tokio::time::timeout 包(与 stdio 一致)。
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
        Ok(HttpTransport {
            client,
            url,
            auth,
            session_id: None,
        })
    }

    /// 防御性脱敏:若 server 在错误体里回显了我们的令牌,从文本抹掉(令牌本不该外传)。
    fn scrub(&self, s: String) -> String {
        match &self.auth {
            Some((_, value)) => {
                let token = value.rsplit(' ').next().unwrap_or(value.as_str());
                s.replace(value.as_str(), "[已脱敏]")
                    .replace(token, "[已脱敏]")
            }
            None => s,
        }
    }

    /// POST 一个 JSON-RPC 消息。`expect_id=Some(id)` → 读回该 id 的响应;`None`(通知)→ 只验状态码。
    async fn post(&mut self, body: &Value, expect_id: Option<i64>) -> Result<Value, String> {
        let mut req = self
            .client
            .post(&self.url)
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", PROTOCOL_VERSION);
        if let Some((name, value)) = &self.auth {
            req = req.header(name.as_str(), value.as_str()); // 鉴权头——不记录
        }
        if let Some(sid) = &self.session_id {
            req = req.header("mcp-session-id", sid.as_str());
        }
        let resp = req
            .json(body)
            .send()
            .await
            .map_err(|e| format!("连接 MCP server 失败: {}", self.scrub(e.to_string())))?;
        // initialize 等响应可能回带会话 id;捕获以供后续请求。
        if let Some(sid) = resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            self.session_id = Some(sid.to_string());
        }
        let status = resp.status();
        let ctype = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let Some(id) = expect_id else {
            // 通知:无需响应体(202 Accepted 常见);仅非 2xx 报错。
            return if status.is_success() {
                Ok(Value::Null)
            } else {
                Err(format!("MCP server 返回 HTTP {}", status.as_u16()))
            };
        };
        if !status.is_success() {
            let body = self.scrub(resp.text().await.unwrap_or_default());
            let body: String = body.chars().take(300).collect();
            return Err(format!("MCP server 返回 HTTP {}: {body}", status.as_u16()));
        }
        if ctype.contains("text/event-stream") {
            read_sse_response(resp, id).await
        } else {
            let v: Value = resp
                .json()
                .await
                .map_err(|e| format!("解析 MCP 响应失败: {}", self.scrub(e.to_string())))?;
            rpc_result(&v)
        }
    }
}

#[async_trait::async_trait]
impl Transport for HttpTransport {
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = next_id();
        let body = rpc_request(id, method, params);
        tokio::time::timeout(REQUEST_TIMEOUT, self.post(&body, Some(id)))
            .await
            .map_err(|_| format!("MCP 请求超时: {method}"))?
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let body = rpc_notification(method, params);
        tokio::time::timeout(REQUEST_TIMEOUT, self.post(&body, None))
            .await
            .map_err(|_| format!("MCP 通知超时: {method}"))?
            .map(|_| ())
    }
}

// ── MCP 客户端(协议层;传输无关)──────────────────────────────────

/// 一个已连接的 MCP server。持有一个传输通道,跑 MCP 协议(握手 / 列工具 / 调用)。
pub struct McpClient {
    transport: Box<dyn Transport>,
}

impl McpClient {
    /// 连一个 stdio server:spawn + initialize 握手。失败 → Err(不 panic)。
    pub async fn connect(
        command: &str,
        args: &[String],
        env: &[(String, String)],
    ) -> Result<Self, String> {
        let transport = StdioTransport::spawn(command, args, env).await?;
        Self::with_transport(Box::new(transport)).await
    }

    /// 用已建好的传输完成 initialize 握手(stdio / http 共用)。
    async fn with_transport(transport: Box<dyn Transport>) -> Result<Self, String> {
        let mut client = McpClient { transport };
        tokio::time::timeout(HANDSHAKE_TIMEOUT, client.initialize())
            .await
            .map_err(|_| "MCP 握手超时".to_string())??;
        Ok(client)
    }

    async fn initialize(&mut self) -> Result<(), String> {
        self.transport
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "Seeker", "version": env!("CARGO_PKG_VERSION") }
                }),
            )
            .await?;
        // 握手后必须发 initialized 通知,server 方可服务后续请求。
        self.transport
            .notify("notifications/initialized", json!({}))
            .await?;
        Ok(())
    }

    /// 发现 server 暴露的工具。
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let result = self.transport.request("tools/list", json!({})).await?;
        Ok(parse_tools(&result))
    }

    /// 调用一个工具(tools/call)。返回 server 的原始 result(含 content / isError)。
    pub async fn call_tool(&mut self, name: &str, args: Value) -> Result<Value, String> {
        self.transport
            .request("tools/call", json!({ "name": name, "arguments": args }))
            .await
    }
}

/// 把 `tools/call` 的 result 展平成给模型的纯文本(拼接 content[].text;非文本类型标注占位)。
/// 注:返回值是**不可信外部数据**,调用方(网关)须以"数据非指令"包裹后再回灌(防注入)。
pub fn flatten_content(result: &Value) -> String {
    let Some(items) = result.get("content").and_then(|c| c.as_array()) else {
        return result.to_string();
    };
    let parts: Vec<String> = items
        .iter()
        .map(|it| match it.get("type").and_then(|t| t.as_str()) {
            Some("text") => it
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            Some(other) => format!("[{other} 内容]"),
            None => it.to_string(),
        })
        .collect();
    parts.join("\n")
}

// ── Tauri 命令:连接测试(供 UI「添加 server」验证 + 列工具)────────

/// 连一个 MCP server、列出其工具、随即断开(drop 即 kill / http 即丢)。供设置页「测试连接」。
/// 本地(command/args):会在本机 `spawn` 一个程序;远程(url/auth):会连用户自填的 HTTP 端点。
/// 调用方(UI)须已取得用户知情同意。`token`:远程存盘前测试用的**临时**令牌(不持久化、不记录)。
#[tauri::command]
pub async fn mcp_probe(
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    auth: Option<McpAuth>,
    token: Option<String>,
) -> Result<Value, String> {
    let command = command.unwrap_or_default().trim().to_string();
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    let is_remote = validate_transport(&command, url.as_deref())?;
    let cfg = if is_remote {
        McpServerConfig {
            name: "probe".into(),
            command: String::new(),
            args: Vec::new(),
            env: Vec::new(),
            url,
            auth,
            enabled: true,
        }
    } else {
        McpServerConfig {
            name: "probe".into(),
            command,
            args: args.unwrap_or_default(),
            env: Vec::new(),
            url: None,
            auth: None,
            enabled: true,
        }
    };
    let mut client = connect_client(&cfg, token.as_deref()).await?;
    let tools = client.list_tools().await?;
    Ok(json!({
        "ok": true,
        "toolCount": tools.len(),
        "tools": tools.iter().map(|t| json!({
            "name": t.name,
            "description": t.description,
            "inputSchema": t.input_schema,
            "readOnly": t.read_only,
        })).collect::<Vec<_>>(),
    }))
}

// ── MCP server 配置(mcp.json,非密钥)+ 连接缓存(McpManager)──────

/// 一个 MCP server 的配置(**非密钥**,设置页可显示)。`name` 唯一,作 server id。
/// `url` 有值 → 远程 http(Streamable)传输;否则 → 本地 stdio(command/args)。
/// 远程鉴权**令牌不在此**——只在钥匙串(见 [`mcp_token_account`]);这里只存非密钥的鉴权方案。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// stdio server 要注入的**环境变量名**(如 `["BRAVE_API_KEY"]`);**值只在钥匙串**
    /// (`mcp.<name>.env.<VAR>`)、**绝不入配置**。远程 server 走 header 式 `auth`,不用此字段。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<String>,
    /// 远程 server 的 HTTP 端点;`Some` = http 传输。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 远程鉴权方案(令牌在钥匙串,不在配置)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<McpAuth>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}
fn default_true() -> bool {
    true
}

/// 远程 MCP 的鉴权方案(**绝不含令牌**——令牌只进钥匙串,见 [`mcp_token_account`])。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpAuth {
    /// 鉴权头名,默认 `Authorization`。
    #[serde(default = "default_auth_header")]
    pub header: String,
    /// 方案前缀,拼成 `<scheme> <token>`;空串 = 直接用 token 作头值。默认 `Bearer`。
    #[serde(default = "default_auth_scheme")]
    pub scheme: String,
}
fn default_auth_header() -> String {
    "Authorization".into()
}
fn default_auth_scheme() -> String {
    "Bearer".into()
}

/// 远程 MCP server 鉴权令牌在钥匙串里的 account 名。
/// **令牌只进钥匙串,绝不入 mcp.json / 前端 / 日志**(红线①;套 `secret.rs` 通用模式)。
fn mcp_token_account(name: &str) -> String {
    format!("mcp.{name}.token")
}

/// stdio server 某环境变量在钥匙串里的 account(`mcp.<name>.env.<VAR>`)。
/// **值只进钥匙串,绝不入 mcp.json / 前端 / 日志**(红线①);配置里只留变量名。
fn mcp_env_account(name: &str, var: &str) -> String {
    format!("mcp.{name}.env.{var}")
}

/// 环境变量名是否合法(`^[A-Za-z_][A-Za-z0-9_]*$`)——防 `.env(k, v)` 里 k 含 `=` / null 的注入。
/// (纯函数,可单测)
fn is_valid_env_name(var: &str) -> bool {
    let mut cs = var.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// server 名是否可安全嵌入钥匙串 account(`mcp.<name>.token` / `mcp.<name>.env.<VAR>`)。
/// 拒 `.`(账户分隔符,防歧义)与控制字符;其余(含空格 / CJK 等展示字符)放行。(纯函数,可单测)
fn is_valid_server_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('.') && !name.chars().any(|c| c.is_control())
}

/// 解析 stdio server 声明的密钥环境变量:对 `cfg.env` 每个名从钥匙串取值。
/// **值用完即弃、绝不记录**;取不到的跳过(由 server 端处理缺失)。
fn resolve_env(cfg: &McpServerConfig) -> Vec<(String, String)> {
    cfg.env
        .iter()
        .filter(|v| is_valid_env_name(v))
        .filter_map(|v| {
            crate::secret::get_secret(&mcp_env_account(&cfg.name, v))
                .ok()
                .map(|val| (v.clone(), val))
        })
        .collect()
}

/// 拼鉴权头值:`<scheme> <token>`;scheme 空 → 裸 token。(纯函数,可单测)
fn auth_header_value(scheme: &str, token: &str) -> String {
    if scheme.is_empty() {
        token.to_string()
    } else {
        format!("{scheme} {token}")
    }
}

/// 校验传输:command(本地)与 url(远程)**恰好一个**非空。返回 `is_remote`。
fn validate_transport(command: &str, url: Option<&str>) -> Result<bool, String> {
    let has_url = url.map(|u| !u.trim().is_empty()).unwrap_or(false);
    let has_cmd = !command.trim().is_empty();
    match (has_cmd, has_url) {
        (true, false) => Ok(false),
        (false, true) => Ok(true),
        (false, false) => Err("请填命令(本地 stdio)或 URL(远程 http)".into()),
        (true, true) => Err("命令(本地)与 URL(远程)只能填一个".into()),
    }
}

/// `url` 是否「明文 http 发往非本机地址」(令牌经此外发会明文上网,触出口红线)。
/// 环回(127.x / localhost / ::1)放行(本地网关常见);https / 非 http 一律放行。(纯函数,可单测)
fn is_plaintext_remote(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("http://") else {
        return false; // https / 非 http → 不算明文外发
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or(authority); // 去 userinfo@
    let host = match hostport.strip_prefix('[') {
        Some(h) => h.split(']').next().unwrap_or(h), // [::1]:port → ::1
        None => hostport.split(':').next().unwrap_or(hostport), // host:port → host
    };
    !(host == "localhost" || host == "::1" || host.starts_with("127."))
}

/// 据 config 选传输建立连接:有 `url` → http(拼鉴权头),否则 → stdio。
/// `transient_token`:存盘前「测试连接」用的临时令牌(优先于钥匙串;不持久化)。
async fn connect_client(
    cfg: &McpServerConfig,
    transient_token: Option<&str>,
) -> Result<McpClient, String> {
    if let Some(url) = &cfg.url {
        let auth = resolve_auth_header(cfg, transient_token);
        // 红线:鉴权令牌绝不经明文 http 发往非本机地址(令牌只进钥匙串、绝不外发)。
        if auth.is_some() && is_plaintext_remote(url) {
            return Err(
                "远程 MCP 鉴权令牌不会经明文 http 发往非本机地址;请改用 https(本机 127.0.0.1 / localhost 例外)".into(),
            );
        }
        let transport = HttpTransport::new(url.clone(), auth)?;
        McpClient::with_transport(Box::new(transport)).await
    } else {
        let env = resolve_env(cfg); // 从钥匙串取声明的 env 值(用完即弃、不记录)
        McpClient::connect(&cfg.command, &cfg.args, &env).await
    }
}

/// 由(可选)令牌拼远程鉴权头 `(名, 值)`。**无令牌 → `None`**(不带鉴权,由 server 决定是否放行——
/// 无鉴权 server 正常连,需鉴权 server 会回 401)。头名 / 方案:`config.auth` 覆盖(供 `X-Api-Key` 等),
/// 缺省 `Authorization` / `Bearer`。(纯函数,可单测——不碰钥匙串)
fn build_auth_header(cfg: &McpServerConfig, token: Option<&str>) -> Option<(String, String)> {
    let token = token.map(str::trim).filter(|t| !t.is_empty())?;
    let (header, scheme) = match &cfg.auth {
        Some(a) => (a.header.as_str(), a.scheme.as_str()),
        None => ("Authorization", "Bearer"),
    };
    Some((header.to_string(), auth_header_value(scheme, token)))
}

/// 解析远程鉴权头:令牌优先用 `transient_token`(存盘前测试),否则从钥匙串取
/// (account=`mcp.<name>.token`)。**令牌只在此短暂取用拼头,用完即弃,不外传、不记录**。
fn resolve_auth_header(
    cfg: &McpServerConfig,
    transient_token: Option<&str>,
) -> Option<(String, String)> {
    match transient_token {
        Some(t) if !t.trim().is_empty() => build_auth_header(cfg, Some(t)),
        _ => {
            let token = crate::secret::get_secret(&mcp_token_account(&cfg.name)).ok();
            build_auth_header(cfg, token.as_deref())
        }
    }
}

fn mcp_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mcp.json"))
}

/// 读 MCP server 配置列表(mcp.json)。缺失 / 损坏 → 空列表。
pub fn load_servers(app: &AppHandle) -> Vec<McpServerConfig> {
    mcp_config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_servers(app: &AppHandle, servers: &[McpServerConfig]) -> Result<(), String> {
    let p = mcp_config_path(app)?;
    let json = serde_json::to_string_pretty(servers).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}

struct ConnectedServer {
    // 持有 live 连接以**复用**(避免重 spawn)+ Drop 时 kill 子进程;`call` 经它发 tools/call。
    // client 包 per-server 锁:同一 server 的调用串行(单 stdio 管线不可交错),跨 server 并发。
    client: tokio::sync::Mutex<McpClient>,
    // tools 连接后不变 → 读不需锁(tool_descriptors 无锁快照,不阻塞在飞调用)。
    tools: Vec<McpTool>,
}

/// 规整成 OpenAI 工具名约束 `^[a-zA-Z0-9_-]{1,64}$`:非法字符 → `_`、截断 ≤64、非空。
/// MCP server / 工具名可能含中文 / 空格 / 超长 → 模型 API 会拒不合规名,故必须规整。
/// 路由用 map(qualified_name → 描述符)不靠解析,规整后仍能回路由,故安全。
fn sanitize_tool_name(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    s.truncate(64); // 规整后全 ASCII,按字节截断即按字符,无边界问题
    if s.is_empty() {
        s.push('_');
    }
    s
}

/// 规整 + 去重:sanitize / 截断后可能撞名 → 加 `_<n>` 后缀(保证 ≤64 且唯一),避免工具被静默遮蔽。
fn unique_tool_name(raw: &str, seen: &mut HashSet<String>) -> String {
    let mut qn = sanitize_tool_name(raw);
    let mut n = 2;
    while seen.contains(&qn) {
        let suffix = format!("_{n}");
        let mut base = sanitize_tool_name(raw);
        base.truncate(64usize.saturating_sub(suffix.len())); // 留出后缀位
        qn = format!("{base}{suffix}");
        n += 1;
    }
    seen.insert(qn.clone());
    qn
}

/// 一个可调用的 MCP 工具描述符(网关组装工具表 + 路由用)。
/// `qualified_name` = 规整后的 `mcp__<server>__<tool>`,模型所见 + 回传;按它路由回 (server, tool)。
#[derive(Debug, Clone)]
pub struct McpToolDescriptor {
    pub qualified_name: String,
    pub server: String,
    pub tool: String,
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
}

/// 已连接 MCP server 的运行时缓存(name → 连接 + 工具)。spawn 昂贵故缓存复用;
/// Drop / disconnect 即 kill 子进程。**进程内**状态,重启重连。
/// 外锁只护「映射」、短持即放;每个 server 自带锁 → 慢端点只串行化自己,不阻塞其余。
#[derive(Default)]
pub struct McpManager {
    inner: tokio::sync::Mutex<HashMap<String, Arc<ConnectedServer>>>,
}

impl McpManager {
    /// 确保 server 已连接(未连则按 config 连 + 列工具);返回工具。失败不缓存。
    async fn ensure_connected(&self, cfg: &McpServerConfig) -> Result<Vec<McpTool>, String> {
        // 已连:短持外锁取 Arc,释外锁后返回工具(tools 不变,无需 per-server 锁)。
        if let Some(cs) = self.inner.lock().await.get(&cfg.name).cloned() {
            return Ok(cs.tools.clone());
        }
        // 未连:**不持外锁**地连接 + 列工具(慢端点不阻塞别的 server)。
        let mut client = connect_client(cfg, None).await?;
        let tools = client.list_tools().await?;
        let mut map = self.inner.lock().await;
        // 双检:并发下可能别人已插入 → 复用既有、丢弃本次(避免重 spawn 泄漏)。
        if let Some(cs) = map.get(&cfg.name) {
            return Ok(cs.tools.clone());
        }
        map.insert(
            cfg.name.clone(),
            Arc::new(ConnectedServer {
                client: tokio::sync::Mutex::new(client),
                tools: tools.clone(),
            }),
        );
        Ok(tools)
    }

    /// 断开并清除某 server 连接(丢弃 Arc → 最后引用释放时 Drop → kill 子进程)。
    async fn disconnect(&self, name: &str) {
        self.inner.lock().await.remove(name);
    }

    /// 确保所有 enabled server 已连接(单个失败忽略 → 该 server 工具不暴露,优雅降级)。
    /// 网关在每轮对话组装工具表前调用。
    pub async fn ensure_all_connected(&self, app: &AppHandle) {
        for s in load_servers(app).iter().filter(|s| s.enabled) {
            let _ = self.ensure_connected(s).await;
        }
    }

    /// 当前已连接 server 的全部工具描述符(网关组装工具表 + 调用路由)。
    pub async fn tool_descriptors(&self) -> Vec<McpToolDescriptor> {
        // 短持外锁快照 (name, Arc),释外锁后读各自 tools(不变,无锁;不阻塞在飞调用)。
        let servers: Vec<(String, Arc<ConnectedServer>)> = {
            let map = self.inner.lock().await;
            map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        };
        let mut out = Vec::new();
        let mut seen: HashSet<String> = HashSet::new(); // 跨 server 工具名去重(规整后)
        for (server, cs) in &servers {
            for t in &cs.tools {
                let qualified_name =
                    unique_tool_name(&format!("mcp__{server}__{}", t.name), &mut seen);
                out.push(McpToolDescriptor {
                    qualified_name,
                    server: server.clone(),
                    tool: t.name.clone(),
                    description: t.description.clone(),
                    input_schema: t.input_schema.clone(),
                    read_only: t.read_only,
                });
            }
        }
        out
    }

    /// 调用某 server 的某工具(经缓存的 live 连接发 tools/call)。
    /// 短持外锁取该 server 的 Arc,释外锁;再持 **per-server 锁** await(同 server 串行、跨 server 并发)。
    pub async fn call(&self, server: &str, tool: &str, args: Value) -> Result<Value, String> {
        let cs = {
            let map = self.inner.lock().await;
            map.get(server).cloned()
        };
        let cs = cs.ok_or_else(|| format!("MCP server 未连接:{server}"))?;
        let mut client = cs.client.lock().await;
        client.call_tool(tool, args).await
    }
}

/// 模型调用 MCP 工具时,网关挂起等待用户确认的通道表(confirmId → oneshot 发送端)。
#[derive(Default)]
pub struct PendingConfirms(
    pub std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
);

/// 前端确认结果回传:唤醒挂起的网关。approved=true 执行、false 拒绝。
#[tauri::command]
pub fn mcp_confirm_resolve(
    pending: State<'_, PendingConfirms>,
    confirm_id: String,
    approved: bool,
) -> Result<(), String> {
    if let Some(tx) = pending.0.lock().unwrap().remove(&confirm_id) {
        let _ = tx.send(approved);
    }
    Ok(())
}

/// 设置页:列出配置的 server + 各自实时工具 / 状态(enabled 的会尝试连接)。
#[tauri::command]
pub async fn mcp_list(app: AppHandle, mgr: State<'_, McpManager>) -> Result<Value, String> {
    let servers = load_servers(&app);
    let mut out = Vec::new();
    for s in &servers {
        let auth_configured = s.auth.is_some()
            && crate::secret::secret_status(mcp_token_account(&s.name))
                .map(|st| st == "configured")
                .unwrap_or(false);
        // env 变量的状态:只报**变量名 + configured/empty**,永不回值(红线①)。
        let env_configured: Vec<Value> = s
            .env
            .iter()
            .map(|v| {
                let configured = crate::secret::secret_status(mcp_env_account(&s.name, v))
                    .map(|st| st == "configured")
                    .unwrap_or(false);
                json!({ "var": v, "status": if configured { "configured" } else { "empty" } })
            })
            .collect();
        let mut entry = json!({
            "name": s.name, "command": s.command, "args": s.args, "enabled": s.enabled,
            "transport": if s.url.is_some() { "http" } else { "stdio" },
            "url": s.url, "authConfigured": auth_configured, "envConfigured": env_configured,
            "connected": false, "toolCount": 0, "tools": [], "error": Value::Null,
        });
        if s.enabled {
            match mgr.ensure_connected(s).await {
                Ok(tools) => {
                    entry["connected"] = json!(true);
                    entry["toolCount"] = json!(tools.len());
                    entry["tools"] = json!(tools
                        .iter()
                        .map(|t| json!({
                            "name": t.name, "description": t.description, "readOnly": t.read_only,
                        }))
                        .collect::<Vec<_>>());
                }
                Err(e) => entry["error"] = json!(e),
            }
        }
        out.push(entry);
    }
    Ok(json!(out))
}

/// 添加一个 MCP server。本地(command/args)= 在本机 spawn 程序;远程(url/auth)= 连用户自填 HTTP 端点。
/// 调用方(UI)须已取得用户知情同意。**此命令不收令牌**——远程令牌经 `mcp_set_auth` 单独入钥匙串。
#[tauri::command]
pub async fn mcp_add(
    app: AppHandle,
    name: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    auth: Option<McpAuth>,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if !is_valid_server_name(&name) {
        // 名嵌入钥匙串 account(token/env);拒 `.`(分隔符)与控制字符,防 account 串歧义。
        return Err("server 名称不能为空,且不能含 '.'(保留作钥匙串账户分隔)或控制字符".into());
    }
    let command = command.unwrap_or_default().trim().to_string();
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    let is_remote = validate_transport(&command, url.as_deref())?;
    // 红线:配了鉴权方案又用明文 http 到非本机 → 早拒(令牌会明文上网;连接处亦有兜底)。
    if is_remote && auth.is_some() && url.as_deref().is_some_and(is_plaintext_remote) {
        return Err(
            "远程 MCP 用 https 才能带鉴权令牌(本机 127.0.0.1 / localhost 可用 http)".into(),
        );
    }
    let mut servers = load_servers(&app);
    if servers.iter().any(|s| s.name == name) {
        return Err(format!("已存在同名 server:{name}"));
    }
    let cfg = if is_remote {
        McpServerConfig {
            name,
            command: String::new(),
            args: Vec::new(),
            env: Vec::new(),
            url,
            auth,
            enabled: true,
        }
    } else {
        McpServerConfig {
            name,
            command,
            args: args.unwrap_or_default(),
            env: Vec::new(),
            url: None,
            auth: None,
            enabled: true,
        }
    };
    servers.push(cfg);
    save_servers(&app, &servers)
}

/// 为某远程 server 设置 / 清除鉴权令牌。**令牌直送系统钥匙串**(account=`mcp.<name>.token`),
/// 绝不入 mcp.json / 前端 / 日志(红线①,套 `secret.rs` 通用模式)。空令牌 = 清除。
/// 前端只能查 `authConfigured`(见 `mcp_list`),无任何命令返回令牌明文。
#[tauri::command]
pub fn mcp_set_auth(name: String, token: String) -> Result<(), String> {
    let account = mcp_token_account(name.trim());
    if token.trim().is_empty() {
        crate::secret::secret_clear(account)
    } else {
        crate::secret::secret_set(account, token)
    }
}

/// 为某 **stdio** server 设置 / 清除一个环境变量(如 `BRAVE_API_KEY`)。变量**名**入 `mcp.json`
/// (非密钥),**值直送钥匙串**(account=`mcp.<name>.env.<VAR>`),绝不入配置 / 前端 / 日志(红线①)。
/// 空值 = 清除(变量名一并移除)。远程 server 走 header 式 `mcp_set_auth`、此命令拒之;变量名须合法(防注入)。
#[tauri::command]
pub fn mcp_set_env(app: AppHandle, name: String, var: String, value: String) -> Result<(), String> {
    let name = name.trim().to_string();
    let var = var.trim().to_string();
    if !is_valid_env_name(&var) {
        return Err(format!(
            "非法环境变量名:{var}(须匹配 ^[A-Za-z_][A-Za-z0-9_]*$)"
        ));
    }
    let mut servers = load_servers(&app);
    let idx = servers
        .iter()
        .position(|s| s.name == name)
        .ok_or_else(|| format!("未找到 server:{name}"))?;
    if servers[idx].url.is_some() {
        return Err("远程 server 用 header 鉴权(mcp_set_auth),不支持环境变量注入".into());
    }
    let account = mcp_env_account(&name, &var);
    if value.trim().is_empty() {
        servers[idx].env.retain(|v| v != &var);
        save_servers(&app, &servers)?;
        crate::secret::secret_clear(account)
    } else {
        if !servers[idx].env.contains(&var) {
            servers[idx].env.push(var.clone());
        }
        save_servers(&app, &servers)?;
        crate::secret::secret_set(account, value)
    }
}

/// 删除一个 MCP server(移出配置 + 断开连接)。可重新添加,UI 走 guardrail 确认。
#[tauri::command]
pub async fn mcp_remove(
    app: AppHandle,
    mgr: State<'_, McpManager>,
    name: String,
) -> Result<(), String> {
    let mut servers = load_servers(&app);
    let before = servers.len();
    // 删除前留存其 env 变量名,以便清对应钥匙串条目(retain 后配置里就没了)。
    let removed_env: Vec<String> = servers
        .iter()
        .find(|s| s.name == name)
        .map(|s| s.env.clone())
        .unwrap_or_default();
    servers.retain(|s| s.name != name);
    if servers.len() == before {
        return Err(format!("未找到 server:{name}"));
    }
    save_servers(&app, &servers)?;
    mgr.disconnect(&name).await;
    // 顺带清除该 server 的钥匙串令牌 + 所有 env 值(可重新添加,不留孤儿密钥)。
    let _ = crate::secret::secret_clear(mcp_token_account(&name));
    for var in &removed_env {
        let _ = crate::secret::secret_clear(mcp_env_account(&name, var));
    }
    Ok(())
}

/// 启用 / 停用一个 server(停用即断开、不再暴露其工具)。
#[tauri::command]
pub async fn mcp_set_enabled(
    app: AppHandle,
    mgr: State<'_, McpManager>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let mut servers = load_servers(&app);
    let s = servers
        .iter_mut()
        .find(|s| s.name == name)
        .ok_or_else(|| format!("未找到 server:{name}"))?;
    s.enabled = enabled;
    save_servers(&app, &servers)?;
    if !enabled {
        mgr.disconnect(&name).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_request_shape() {
        let r = rpc_request(7, "tools/list", json!({ "a": 1 }));
        assert_eq!(r["jsonrpc"], "2.0");
        assert_eq!(r["id"], 7);
        assert_eq!(r["method"], "tools/list");
        assert_eq!(r["params"]["a"], 1);
    }

    #[test]
    fn rpc_notification_has_no_id() {
        let n = rpc_notification("notifications/initialized", json!({}));
        assert_eq!(n["jsonrpc"], "2.0");
        assert!(n.get("id").is_none());
        assert_eq!(n["method"], "notifications/initialized");
    }

    #[test]
    fn rpc_result_ok_and_error() {
        let ok = json!({ "jsonrpc": "2.0", "id": 1, "result": { "tools": [] } });
        assert!(rpc_result(&ok).is_ok());
        let err = json!({ "jsonrpc": "2.0", "id": 1, "error": { "code": -32601, "message": "Method not found" } });
        let e = rpc_result(&err).unwrap_err();
        assert!(e.contains("Method not found"));
        assert!(e.contains("-32601"));
    }

    #[test]
    fn is_response_skips_notifications_and_other_ids() {
        let resp = json!({ "jsonrpc": "2.0", "id": 5, "result": {} });
        assert!(is_response_to(&resp, 5));
        assert!(!is_response_to(&resp, 6)); // 别的 id
        let notif = json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": {} });
        assert!(!is_response_to(&notif, 5)); // 通知无 id
        let req_echo = json!({ "jsonrpc": "2.0", "id": 5, "method": "x" }); // 无 result/error
        assert!(!is_response_to(&req_echo, 5));
    }

    #[test]
    fn parse_tools_normal_and_tolerant() {
        let result = json!({
            "tools": [
                { "name": "read_file", "description": "读文件", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } }, "annotations": { "readOnlyHint": true } },
                { "name": "write_file", "description": "写文件" }, // 无 inputSchema/annotations → 默认 object / 非只读
                { "description": "无名工具" },                       // 缺 name → 跳过
                { "name": "" }                                       // 空 name → 跳过
            ]
        });
        let tools = parse_tools(&result);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_file");
        assert!(tools[0].read_only);
        assert_eq!(
            tools[0].input_schema["properties"]["path"]["type"],
            "string"
        );
        assert_eq!(tools[1].name, "write_file");
        assert!(!tools[1].read_only); // 默认非只读 → 集成层让它走 guardrail
        assert_eq!(tools[1].input_schema, json!({ "type": "object" }));
    }

    #[test]
    fn parse_tools_empty_when_missing_or_malformed() {
        assert!(parse_tools(&json!({})).is_empty());
        assert!(parse_tools(&json!({ "tools": "not-array" })).is_empty());
    }

    #[test]
    fn flatten_content_joins_text_and_marks_nontext() {
        let r = json!({ "content": [
            { "type": "text", "text": "第一段" },
            { "type": "image", "data": "..." },
            { "type": "text", "text": "第二段" }
        ] });
        assert_eq!(flatten_content(&r), "第一段\n[image 内容]\n第二段");
        // 无 content → 回退到整体 JSON 字符串(不丢数据)。
        let weird = json!({ "isError": true });
        assert!(flatten_content(&weird).contains("isError"));
    }

    #[test]
    fn sanitize_tool_name_conforms_to_openai() {
        let ok = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        };
        // 合法名原样保留
        assert_eq!(
            sanitize_tool_name("mcp__fs__read_file"),
            "mcp__fs__read_file"
        );
        // 非法字符 → _
        assert_eq!(
            sanitize_tool_name("mcp__fs__read file!"),
            "mcp__fs__read_file_"
        );
        // 中文 / 超长 / 全非法 → 仍合规、非空、保前缀
        let cn = sanitize_tool_name("mcp__本地__工具");
        assert!(ok(&cn) && cn.starts_with("mcp__"));
        let long = sanitize_tool_name(&("mcp__s__".to_string() + &"a".repeat(100)));
        assert!(long.len() == 64 && ok(&long));
        assert!(ok(&sanitize_tool_name("中文"))); // 全非法 ASCII → 不空、合规
    }

    #[test]
    fn unique_tool_name_dedups_collisions() {
        let mut seen = HashSet::new();
        let a = unique_tool_name("mcp__s__tool!", &mut seen); // → mcp__s__tool_
        let b = unique_tool_name("mcp__s__tool?", &mut seen); // 规整后同名 → 撞 → 加后缀
        assert_ne!(a, b);
        assert!(b.len() <= 64);
        assert!(seen.contains(&a) && seen.contains(&b));
    }

    #[test]
    fn server_config_serde_roundtrip_and_default_enabled() {
        // 无 enabled 字段 → 默认启用(default_true)。
        let json = r#"[{"name":"fs","command":"node","args":["server.js"]}]"#;
        let servers: Vec<McpServerConfig> = serde_json::from_str(json).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "fs");
        assert_eq!(servers[0].command, "node");
        assert_eq!(servers[0].args, vec!["server.js"]);
        assert!(servers[0].enabled);
        // 往返:enabled 显式序列化。
        let out = serde_json::to_string(&servers).unwrap();
        assert!(out.contains("\"enabled\":true"));
        // 缺 args → 空 vec(serde default)。
        let no_args: Vec<McpServerConfig> =
            serde_json::from_str(r#"[{"name":"x","command":"y","enabled":false}]"#).unwrap();
        assert!(no_args[0].args.is_empty());
        assert!(!no_args[0].enabled);
    }

    // ── 远程 MCP(http 传输 + 鉴权)──────────────────────────────

    #[test]
    fn parse_sse_event_extracts_json() {
        // event: 行被忽略,单条 data: 行解析为 JSON。
        let e = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
        assert_eq!(parse_sse_event(e).unwrap()["id"], 1);
        // 多条 data: 行按换行拼接再解析(SSE 规范)。
        let e2 = "data: {\"a\":\ndata: 1}\n";
        assert_eq!(parse_sse_event(e2).unwrap()["a"], 1);
        // data:{...} 无空格也吃。
        assert_eq!(parse_sse_event("data:{\"b\":2}").unwrap()["b"], 2);
        // 无 data / 非 JSON → None。
        assert!(parse_sse_event("event: ping\nid: 7\n").is_none());
        assert!(parse_sse_event("data: not json").is_none());
    }

    #[test]
    fn auth_header_value_scheme_and_bare() {
        assert_eq!(auth_header_value("Bearer", "tok"), "Bearer tok");
        assert_eq!(auth_header_value("", "tok"), "tok"); // 空 scheme = 裸 token 作头值
    }

    #[test]
    fn mcp_token_account_is_namespaced() {
        assert_eq!(mcp_token_account("github"), "mcp.github.token");
    }

    #[test]
    fn remote_config_serde_roundtrip_no_token_leak() {
        // 远程 server:url + 自定义鉴权方案显式 round-trip;command/args 省略。
        let json = r#"[{"name":"remote","url":"https://x/mcp","auth":{"header":"X-Api-Key","scheme":""}}]"#;
        let servers: Vec<McpServerConfig> = serde_json::from_str(json).unwrap();
        assert_eq!(servers[0].url.as_deref(), Some("https://x/mcp"));
        assert!(servers[0].command.is_empty());
        assert!(servers[0].enabled); // 默认启用
        let auth = servers[0].auth.as_ref().unwrap();
        assert_eq!(auth.header, "X-Api-Key");
        assert_eq!(auth.scheme, ""); // 显式空串保留(default 仅在字段缺失时生效)
                                     // auth 字段缺省 → header/scheme 取默认(Authorization / Bearer)。
        let s2: Vec<McpServerConfig> =
            serde_json::from_str(r#"[{"name":"r2","url":"https://y/mcp","auth":{}}]"#).unwrap();
        let a2 = s2[0].auth.as_ref().unwrap();
        assert_eq!(a2.header, "Authorization");
        assert_eq!(a2.scheme, "Bearer");
        // 序列化:url/auth 在,**令牌(token)绝不在配置里**,stdio 字段省略。
        let out = serde_json::to_string(&servers).unwrap();
        assert!(out.contains("\"url\":\"https://x/mcp\""));
        assert!(!out.contains("token"), "令牌绝不能出现在 mcp.json:{out}");
        assert!(!out.contains("\"command\""));
    }

    #[test]
    fn stdio_config_omits_remote_fields_when_serialized() {
        let servers = vec![McpServerConfig {
            name: "fs".into(),
            command: "node".into(),
            args: vec!["s.js".into()],
            env: vec![],
            url: None,
            auth: None,
            enabled: true,
        }];
        let out = serde_json::to_string(&servers).unwrap();
        assert!(!out.contains("\"url\"")); // 无 url → 省略
        assert!(!out.contains("\"auth\"")); // 无 auth → 省略
        assert!(out.contains("\"command\":\"node\""));
    }

    #[test]
    fn scrub_redacts_token_from_text() {
        // server 即使在错误体回显令牌,也被抹掉(令牌本不该外传)。
        let t = HttpTransport::new(
            "https://x".into(),
            Some(("Authorization".into(), "Bearer SECRET123".into())),
        )
        .unwrap();
        let out = t.scrub("HTTP 401: 'Bearer SECRET123' / SECRET123 invalid".into());
        assert!(!out.contains("SECRET123"), "令牌不得残留:{out}");
        assert!(out.contains("[已脱敏]"));
        // 无鉴权 → 原样返回。
        let t2 = HttpTransport::new("https://x".into(), None).unwrap();
        assert_eq!(t2.scrub("plain text".into()), "plain text");
    }

    #[test]
    fn validate_transport_exactly_one() {
        assert!(!validate_transport("node", None).unwrap()); // 仅命令 → 本地
        assert!(validate_transport("", Some("https://x")).unwrap()); // 仅 url → 远程
        assert!(validate_transport("", None).is_err()); // 都没填
        assert!(validate_transport("node", Some("https://x")).is_err()); // 都填
        assert!(validate_transport("  ", Some("  ")).is_err()); // 空白视作未填
    }

    #[test]
    fn is_plaintext_remote_flags_http_to_nonloopback() {
        // 明文 http 到非本机 → true(令牌会明文上网)。
        assert!(is_plaintext_remote("http://example.com/mcp"));
        assert!(is_plaintext_remote("http://10.0.0.5:3000"));
        assert!(is_plaintext_remote("HTTP://API.EXAMPLE.COM")); // 大小写不敏感
        assert!(is_plaintext_remote("http://user:pw@evil.com/x")); // userinfo 不影响主机判定
                                                                   // https / 环回 → false(放行)。
        assert!(!is_plaintext_remote("https://example.com/mcp"));
        assert!(!is_plaintext_remote("http://localhost:8080"));
        assert!(!is_plaintext_remote("http://127.0.0.1:3000/mcp"));
        assert!(!is_plaintext_remote("http://[::1]:9000"));
    }

    #[test]
    fn build_auth_header_token_gated() {
        let remote = McpServerConfig {
            name: "r".into(),
            command: String::new(),
            args: vec![],
            env: vec![],
            url: Some("https://x/mcp".into()),
            auth: None, // 缺省方案
            enabled: true,
        };
        // 无令牌 / 空白令牌 → 不带鉴权(None)。
        assert!(build_auth_header(&remote, None).is_none());
        assert!(build_auth_header(&remote, Some("  ")).is_none());
        // 有令牌、缺省方案 → Authorization: Bearer(令牌被 trim)。
        assert_eq!(
            build_auth_header(&remote, Some("  tok ")).unwrap(),
            ("Authorization".to_string(), "Bearer tok".to_string())
        );
        // config.auth 覆盖头名 / 方案(X-Api-Key + 空 scheme = 裸 token)。
        let custom = McpServerConfig {
            name: "r2".into(),
            command: String::new(),
            args: vec![],
            env: vec![],
            url: Some("https://x".into()),
            auth: Some(McpAuth {
                header: "X-Api-Key".into(),
                scheme: String::new(),
            }),
            enabled: true,
        };
        assert_eq!(
            build_auth_header(&custom, Some("KEY")).unwrap(),
            ("X-Api-Key".to_string(), "KEY".to_string())
        );
    }

    // ── http 传输端到端(进程内 mock server;真打 socket,覆盖 reqwest 路径)──
    //
    // 用 std::net 起一个最小 HTTP server(独立线程),客户端在 tokio 上跑,经真实 TCP
    // 往返。覆盖单测覆盖不到的:请求头组装(鉴权 / Accept / 会话 id)、initialize 握手、
    // application/json 与 text/event-stream 两路响应解析、会话 id 捕获并回带。

    fn find_sub(h: &[u8], n: &[u8]) -> Option<usize> {
        h.windows(n.len()).position(|w| w == n)
    }

    /// 读一个 HTTP 请求(headers 小写键 + body)。
    fn read_request(
        stream: &mut std::net::TcpStream,
    ) -> Option<(std::collections::HashMap<String, String>, String)> {
        use std::io::Read;
        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        let hend = loop {
            let n = stream.read(&mut tmp).ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(p) = find_sub(&buf, b"\r\n\r\n") {
                break p;
            }
        };
        let head = String::from_utf8_lossy(&buf[..hend]).to_string();
        let mut headers = std::collections::HashMap::new();
        for line in head.lines().skip(1) {
            if let Some((k, v)) = line.split_once(':') {
                headers.insert(k.trim().to_lowercase(), v.trim().to_string());
            }
        }
        let clen: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut body = buf[hend + 4..].to_vec();
        while body.len() < clen {
            let n = stream.read(&mut tmp).ok()?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
        Some((headers, String::from_utf8_lossy(&body).to_string()))
    }

    fn write_response(
        stream: &mut std::net::TcpStream,
        status: &str,
        ctype: &str,
        extra: &str,
        body: &str,
    ) {
        use std::io::Write;
        let resp = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();
    }

    type SeenReq = (String, Option<String>, Option<String>); // (method, authorization, mcp-session-id)

    /// 起一个最小 Streamable-HTTP MCP mock(`sse_tools=true` 则 tools/list 回 SSE)。返回端口。
    /// 每个请求记录到 `record`(供断言);响应均 `Connection: close`(一请求一连接)。
    fn spawn_mock_mcp(
        sse_tools: bool,
        record: std::sync::Arc<std::sync::Mutex<Vec<SeenReq>>>,
    ) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(mut stream) = conn else { continue };
                let Some((headers, body)) = read_request(&mut stream) else {
                    continue;
                };
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let method = v
                    .get("method")
                    .and_then(|m| m.as_str())
                    .unwrap_or("")
                    .to_string();
                let id = v.get("id").cloned().unwrap_or(Value::Null);
                record.lock().unwrap().push((
                    method.clone(),
                    headers.get("authorization").cloned(),
                    headers.get("mcp-session-id").cloned(),
                ));
                match method.as_str() {
                    "initialize" => {
                        let r = json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":PROTOCOL_VERSION,"capabilities":{},"serverInfo":{"name":"mock","version":"0"}}});
                        write_response(
                            &mut stream,
                            "200 OK",
                            "application/json",
                            "Mcp-Session-Id: sess-1\r\n",
                            &r.to_string(),
                        );
                    }
                    "notifications/initialized" => {
                        write_response(&mut stream, "202 Accepted", "text/plain", "", "");
                    }
                    "tools/list" => {
                        let r = json!({"jsonrpc":"2.0","id":id,"result":{"tools":[{"name":"echo","description":"回声","inputSchema":{"type":"object"}}]}});
                        if sse_tools {
                            let sse = format!("event: message\r\ndata: {}\r\n\r\n", r);
                            write_response(&mut stream, "200 OK", "text/event-stream", "", &sse);
                        } else {
                            write_response(
                                &mut stream,
                                "200 OK",
                                "application/json",
                                "",
                                &r.to_string(),
                            );
                        }
                    }
                    "tools/call" => {
                        let r = json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":"echoed"}]}});
                        write_response(
                            &mut stream,
                            "200 OK",
                            "application/json",
                            "",
                            &r.to_string(),
                        );
                    }
                    _ => write_response(&mut stream, "404 Not Found", "text/plain", "", ""),
                }
            }
        });
        port
    }

    #[tokio::test]
    async fn http_transport_e2e_json_auth_and_session() {
        let record = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let port = spawn_mock_mcp(false, record.clone());
        // 直接建 HttpTransport(带鉴权头)——绕开钥匙串,只测传输机制。
        let transport = HttpTransport::new(
            format!("http://127.0.0.1:{port}/mcp"),
            Some(("Authorization".to_string(), "Bearer testtoken".to_string())),
        )
        .unwrap();
        let mut client = McpClient::with_transport(Box::new(transport))
            .await
            .expect("握手");
        let tools = client.list_tools().await.expect("list_tools");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        let result = client
            .call_tool("echo", json!({"x":1}))
            .await
            .expect("call_tool");
        assert_eq!(flatten_content(&result), "echoed");

        let seen = record.lock().unwrap().clone();
        assert!(seen.iter().any(|(m, _, _)| m == "initialize"));
        // 每个请求都带正确鉴权头。
        for (m, auth, _) in &seen {
            assert_eq!(
                auth.as_deref(),
                Some("Bearer testtoken"),
                "method {m} 缺鉴权头"
            );
        }
        // initialize 之后的请求带回 server 下发的 session id。
        let after: Vec<_> = seen
            .iter()
            .filter(|(m, _, _)| m == "tools/list" || m == "tools/call")
            .collect();
        assert_eq!(after.len(), 2);
        for (m, _, sess) in after {
            assert_eq!(sess.as_deref(), Some("sess-1"), "method {m} 缺 session id");
        }
    }

    #[tokio::test]
    async fn http_transport_reads_sse_response_and_no_auth() {
        let record = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let port = spawn_mock_mcp(true, record.clone()); // tools/list 回 text/event-stream
        let transport = HttpTransport::new(format!("http://127.0.0.1:{port}/mcp"), None).unwrap();
        let mut client = McpClient::with_transport(Box::new(transport))
            .await
            .expect("握手");
        let tools = client.list_tools().await.expect("list via sse");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
        // 无令牌 → 不发 Authorization 头。
        for (m, auth, _) in record.lock().unwrap().iter() {
            assert!(auth.is_none(), "method {m} 不该带鉴权头");
        }
    }

    #[tokio::test]
    async fn manager_connects_remote_and_routes_call() {
        // 网关实际走的路径(McpManager):连远程 → 缓存 → 命名空间工具 → 路由调用,
        // 与 stdio 一视同仁(ai.rs 不感知传输)。no-auth 远程(钥匙串无令牌即不带鉴权)。
        let record = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let port = spawn_mock_mcp(false, record);
        let cfg = McpServerConfig {
            name: "mock".into(),
            command: String::new(),
            args: vec![],
            env: vec![],
            url: Some(format!("http://127.0.0.1:{port}/mcp")),
            auth: None,
            enabled: true,
        };
        let mgr = McpManager::default();
        let tools = mgr.ensure_connected(&cfg).await.expect("ensure_connected");
        assert_eq!(tools.len(), 1);
        // 工具描述符带 mcp__<server>__ 命名空间(网关据此组装工具表 + 路由)。
        let descs = mgr.tool_descriptors().await;
        assert!(descs
            .iter()
            .any(|d| d.qualified_name.starts_with("mcp__mock__")));
        // 经缓存的 live 连接路由 tools/call。
        let result = mgr.call("mock", "echo", json!({})).await.expect("call");
        assert_eq!(flatten_content(&result), "echoed");
    }

    // stdio spawn 路径冒烟:用 Seeker 自己的 McpClient 连一个真实子进程 server(可信本地
    // mock 搜索 MCP),走 initialize→tools/list→tools/call 全握手。这正是搜索 MCP(stdio 型)
    // 实际走的路径——补上"连真实子进程"的覆盖(HTTP 路径已有进程内 mock)。
    // `#[ignore]`:spawn python3 + fixture,CI 不跑;
    // 手动 `cargo test -- --ignored stdio_search_mcp_smoke` 验。
    #[tokio::test]
    #[ignore]
    async fn stdio_search_mcp_smoke() {
        let fixture = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mock_search_mcp.py"
        );
        let mut client = McpClient::connect("python3", &[fixture.to_string()], &[])
            .await
            .expect("连 mock 搜索 MCP");
        let tools = client.list_tools().await.expect("list_tools");
        assert!(
            tools.iter().any(|t| t.name == "web_search"),
            "应暴露 web_search 工具"
        );
        let result = client
            .call_tool("web_search", json!({ "query": "remote rust jobs" }))
            .await
            .expect("call web_search");
        let text = flatten_content(&result);
        assert!(text.contains("https://"), "应返回真实 URL:{text}");
        eprintln!("stdio search mcp → {text}");
    }

    // env 注入(切核):经 McpClient 传合成 env 对 → spawn 用 .env 注入 → mock 的 env_echo 工具回显。
    // 证注入生效,**不碰真钥匙串**(合成对绕开钥匙串读,避免测试污染登录钥匙串)。
    // `#[ignore]`:spawn python3,CI 不跑;手动 `cargo test -- --ignored stdio_env_injection` 验。
    #[tokio::test]
    #[ignore]
    async fn stdio_env_injection() {
        let fixture = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mock_search_mcp.py"
        );
        let env = vec![("SEEKER_TEST_ENV".to_string(), "injected-42".to_string())];
        let mut client = McpClient::connect("python3", &[fixture.to_string()], &env)
            .await
            .expect("连 mock");
        let result = client.call_tool("env_echo", json!({})).await.expect("call");
        assert_eq!(
            flatten_content(&result),
            "injected-42",
            "应回显注入的 env 值"
        );
    }

    #[test]
    fn is_valid_env_name_gates_injection() {
        assert!(is_valid_env_name("BRAVE_API_KEY"));
        assert!(is_valid_env_name("_x"));
        assert!(is_valid_env_name("A1_b2"));
        assert!(!is_valid_env_name("")); // 空
        assert!(!is_valid_env_name("1ABC")); // 数字开头
        assert!(!is_valid_env_name("A=B")); // 含 =(防注入)
        assert!(!is_valid_env_name("A-B")); // 含 -
        assert!(!is_valid_env_name("A B")); // 含空格
        assert!(!is_valid_env_name("A\0B")); // 含 null
    }

    #[test]
    fn server_name_gates_account_ambiguity() {
        assert!(is_valid_server_name("brave"));
        assert!(is_valid_server_name("我的搜索")); // CJK 展示名放行
        assert!(is_valid_server_name("dev server")); // 空格放行
        assert!(!is_valid_server_name("")); // 空
        assert!(!is_valid_server_name("a.env.FOO")); // 含 .(账户分隔)→ 歧义
        assert!(!is_valid_server_name("x.token")); // 含 .
        assert!(!is_valid_server_name("a\nb")); // 控制字符
    }

    #[test]
    fn config_env_roundtrip_names_only() {
        // env 变量名 round-trip;配置里**只有名、绝无值**(值只在钥匙串)。
        let json =
            r#"[{"name":"brave","command":"npx","args":["-y","x"],"env":["BRAVE_API_KEY"]}]"#;
        let servers: Vec<McpServerConfig> = serde_json::from_str(json).unwrap();
        assert_eq!(servers[0].env, vec!["BRAVE_API_KEY".to_string()]);
        let out = serde_json::to_string(&servers).unwrap();
        assert!(out.contains("\"env\":[\"BRAVE_API_KEY\"]"));
        // 无 env → 序列化省略(skip_serializing_if)。
        let s2: Vec<McpServerConfig> =
            serde_json::from_str(r#"[{"name":"x","command":"y"}]"#).unwrap();
        assert!(s2[0].env.is_empty());
        assert!(!serde_json::to_string(&s2).unwrap().contains("env"));
    }
}
