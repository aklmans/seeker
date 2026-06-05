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

use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
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

// ── stdio 客户端(IO;端到端需真实 server,CDP/集成覆盖)─────────────

/// 一个已连接的 MCP server(stdio)。Drop 即 kill 子进程(`kill_on_drop`)。
pub struct McpClient {
    _child: Child, // 仅持有以维持子进程生命周期 + Drop 时 kill
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl McpClient {
    /// `spawn command args...` 并完成 initialize 握手。失败 → Err(不 panic)。
    pub async fn connect(command: &str, args: &[String]) -> Result<Self, String> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("启动 MCP server 失败({command}): {e}"))?;
        let stdin = child.stdin.take().ok_or("无法取得 server stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("无法取得 server stdout")?);
        let mut client = McpClient {
            _child: child,
            stdin,
            stdout,
        };
        tokio::time::timeout(HANDSHAKE_TIMEOUT, client.initialize())
            .await
            .map_err(|_| "MCP 握手超时".to_string())??;
        Ok(client)
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

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = next_id();
        self.send(&rpc_request(id, method, params)).await?;
        tokio::time::timeout(REQUEST_TIMEOUT, self.read_response(id))
            .await
            .map_err(|_| format!("MCP 请求超时: {method}"))?
    }

    async fn initialize(&mut self) -> Result<(), String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "Seeker", "version": env!("CARGO_PKG_VERSION") }
            }),
        )
        .await?;
        // 握手后必须发 initialized 通知,server 方可服务后续请求。
        self.send(&rpc_notification("notifications/initialized", json!({})))
            .await?;
        Ok(())
    }

    /// 发现 server 暴露的工具。
    pub async fn list_tools(&mut self) -> Result<Vec<McpTool>, String> {
        let result = self.request("tools/list", json!({})).await?;
        Ok(parse_tools(&result))
    }
}

// ── Tauri 命令:连接测试(供 UI「添加 server」验证 + 列工具)────────

/// 连一个 MCP server、列出其工具、随即断开(drop 即 kill)。供设置页「测试连接」。
/// **command/args 来自用户配置**——这会在本机 `spawn` 一个程序,调用方(UI)须已取得用户知情同意。
#[tauri::command]
pub async fn mcp_probe(command: String, args: Vec<String>) -> Result<Value, String> {
    let mut client = McpClient::connect(&command, &args).await?;
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
        assert_eq!(tools[0].input_schema["properties"]["path"]["type"], "string");
        assert_eq!(tools[1].name, "write_file");
        assert!(!tools[1].read_only); // 默认非只读 → 集成层让它走 guardrail
        assert_eq!(tools[1].input_schema, json!({ "type": "object" }));
    }

    #[test]
    fn parse_tools_empty_when_missing_or_malformed() {
        assert!(parse_tools(&json!({})).is_empty());
        assert!(parse_tools(&json!({ "tools": "not-array" })).is_empty());
    }
}
