//! 能力层(#2 · C1 契约 + registry)。
//!
//! 平台复用价值最高的一层:一组实现**同一 Capability 契约**的可插拔能力,注册即生效。
//! AI 网关据 registry 汇总 `kind=Tool` 的 schema 给模型;模型决定调用后,工具循环
//! 统一执行并把结果回灌(见 `ai.rs`)。**加能力 = 写插件 + `register` —— 业务与前端零改动。**
//! 本阶段仅注册一个参考工具:只读「数据查询」。
//!
//! **隐私红线**:任何能力都拿不到 profile —— `DataQuery` 经数据仓库 `table_for` 白名单
//! (profile / secrets / meta / settings 不在内),从结构上碰不到隐私表;工具枚举亦不含 profile。
//! **破坏性红线**:声明 `Destructive` 的能力**不得**由工具循环 / `cap_invoke` 直接执行,
//! 必须走护栏(C3);C1 的工具均为只读。
//!
//! 契约演进(有意的小步):C1 的 `invoke` 为**同步**(本阶段能力均为本地、快速、无网络);
//! 待 C4 接入 MCP 等网络能力时再引入异步路径。`available` 暂无运行时 ctx(C1 能力恒 Ready);
//! C3 接双端降级时按 RuntimeCtx 扩展。`contribute`(Context 供料)/ Stream / Widget 自 C2 起接入。

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

/// 能力种类。Tool=LLM 可主动调用;Context=供提示组装(C2);Sink=纯副作用(C2)。
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Tool,
    #[allow(dead_code)] // C2 起用到
    Context,
    #[allow(dead_code)]
    Sink,
}

/// 运行时可用性。Unavailable/Degraded **不报错** —— 前端据此优雅显隐,网关据此过滤工具。
pub enum Availability {
    Ready,
    #[allow(dead_code)] // C3 双端降级用到
    Degraded(String),
    #[allow(dead_code)]
    Unavailable(String),
}
impl Availability {
    pub fn is_ready(&self) -> bool {
        matches!(self, Availability::Ready)
    }
}

/// 声明式权限(最小权限、可审计)。C1 仅用到 `Db`(只读)。
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    #[allow(dead_code)]
    Net,
    #[allow(dead_code)]
    Fs,
    Db,
    #[allow(dead_code)]
    Secret,
    Destructive,
}

/// 暴露给 LLM 的工具描述(OpenAI function 格式的 name/description/parameters)。
pub struct ToolSchema {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value, // JSON Schema
}

/// 统一调用输出。C1 仅 Text/Json/None;Stream/Widget 留待后续。
pub enum Output {
    #[allow(dead_code)]
    Text(String),
    Json(Value),
    #[allow(dead_code)]
    None,
}
impl Output {
    /// 回灌给模型的文本(工具结果)。
    pub fn to_model_text(&self) -> String {
        match self {
            Output::Text(s) => s.clone(),
            Output::Json(v) => v.to_string(),
            Output::None => String::new(),
        }
    }
}

/// 调用上下文:让能力够到平台资源(本阶段:`AppHandle` → 数据仓库 State)。
/// **不含 profile** —— 契约层面就没有隐私来源。
pub struct CallCx<'a> {
    pub app: &'a AppHandle,
}

/// 能力契约 —— 整层的「宪法」。所有能力实现它;registry 据此注册 / 发现 / 降级 / 调用。
pub trait Capability: Send + Sync {
    fn id(&self) -> &'static str;
    fn kind(&self) -> Kind;
    #[allow(dead_code)]
    fn version(&self) -> &'static str {
        "1"
    }
    /// 运行时可用性(C1 默认恒 Ready;C3 起按端 / 配置 / 依赖计算)。
    fn available(&self) -> Availability {
        Availability::Ready
    }
    /// 仅 `kind=Tool` 暴露;`None` = 不直接给 LLM 调。
    fn schema(&self) -> Option<ToolSchema> {
        None
    }
    fn permissions(&self) -> &[Permission] {
        &[]
    }
    /// 统一调用入口(C1 同步)。`input` = 工具参数 JSON。
    fn invoke(&self, _input: &Value, _cx: &CallCx) -> Result<Output, String> {
        Err("该能力不支持 invoke".into())
    }
}

/// 前端 `rt.capability.list` 的条目:id / available / schema。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityInfo {
    pub id: String,
    pub available: bool,
    pub schema: Option<Value>,
}

/// 能力注册表:声明式装配、按 available 过滤工具清单、按 id 统一调用。
pub struct Registry {
    caps: Vec<Box<dyn Capability>>,
}
impl Registry {
    /// 启动时装配。**加能力即在此 `register`**;本阶段仅注册只读「数据查询」。
    pub fn new() -> Self {
        let mut reg = Self { caps: Vec::new() };
        reg.register(Box::new(DataQuery));
        reg
    }

    fn register(&mut self, cap: Box<dyn Capability>) {
        self.caps.push(cap);
    }

    fn find(&self, id: &str) -> Option<&dyn Capability> {
        self.caps.iter().find(|c| c.id() == id).map(|b| b.as_ref())
    }

    /// 仅 Ready 的 `kind=Tool` 的 schema,OpenAI `tools` 数组格式;供 AI 网关塞进请求。
    pub fn tool_schemas(&self) -> Vec<Value> {
        self.caps
            .iter()
            .filter(|c| c.kind() == Kind::Tool && c.available().is_ready())
            .filter_map(|c| c.schema())
            .map(|s| {
                json!({
                    "type": "function",
                    "function": {
                        "name": s.name,
                        "description": s.description,
                        "parameters": s.parameters,
                    }
                })
            })
            .collect()
    }

    /// 统一调用(含 availability + 破坏性护栏校验)。供工具循环与 `cap_invoke` 复用。
    pub fn invoke_raw(&self, id: &str, input: &Value, cx: &CallCx) -> Result<Output, String> {
        let cap = self.find(id).ok_or_else(|| format!("未知能力: {id}"))?;
        if !cap.available().is_ready() {
            return Err(format!("能力不可用: {id}"));
        }
        // 破坏性能力绝不在此自动执行 —— 必须经护栏(预览+确认+撤销,C3)。
        if cap.permissions().contains(&Permission::Destructive) {
            return Err(format!("破坏性能力须经护栏,不可直接执行: {id}"));
        }
        cap.invoke(input, cx)
    }

    /// 工具循环调用:执行并返回回灌模型的文本。
    pub fn invoke_tool(&self, name: &str, input: &Value, cx: &CallCx) -> Result<String, String> {
        Ok(self.invoke_raw(name, input, cx)?.to_model_text())
    }

    /// 能力清单(前端 `rt.capability.list`)。
    pub fn list_info(&self) -> Vec<CapabilityInfo> {
        self.caps
            .iter()
            .map(|c| CapabilityInfo {
                id: c.id().to_string(),
                available: c.available().is_ready(),
                schema: c.schema().map(|s| {
                    json!({
                        "name": s.name,
                        "description": s.description,
                        "parameters": s.parameters,
                    })
                }),
            })
            .collect()
    }

    fn is_available(&self, id: &str) -> bool {
        self.find(id)
            .map(|c| c.available().is_ready())
            .unwrap_or(false)
    }
}
impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

// ── 命令(前端 rt.capability)────────────────────────────────────

#[tauri::command]
pub fn cap_list(registry: State<'_, Registry>) -> Vec<CapabilityInfo> {
    registry.list_info()
}

#[tauri::command]
pub fn cap_available(registry: State<'_, Registry>, id: String) -> bool {
    registry.is_available(&id)
}

#[tauri::command]
pub fn cap_invoke(
    app: AppHandle,
    registry: State<'_, Registry>,
    id: String,
    input: Value,
) -> Result<Value, String> {
    let cx = CallCx { app: &app };
    match registry.invoke_raw(&id, &input, &cx)? {
        Output::Text(s) => Ok(Value::String(s)),
        Output::Json(v) => Ok(v),
        Output::None => Ok(Value::Null),
    }
}

// ── 参考能力:只读数据查询(C1)──────────────────────────────────
// 让模型能读用户本地的求职数据(岗位 / 技能 / 行动…),**只读、无破坏性、绝不含 profile**。

/// 工具可见的业务集合(与 `data::table_for` 白名单一致;**profile / secrets / settings 不在内**)。
const QUERYABLE: &[&str] = &[
    "jobs",
    "skills",
    "actions",
    "resumes",
    "iv_records",
    "messages",
];

fn is_queryable(collection: &str) -> bool {
    QUERYABLE.contains(&collection)
}

pub struct DataQuery;
impl Capability for DataQuery {
    fn id(&self) -> &'static str {
        "query_data"
    }
    fn kind(&self) -> Kind {
        Kind::Tool
    }
    fn permissions(&self) -> &[Permission] {
        &[Permission::Db]
    }
    fn schema(&self) -> Option<ToolSchema> {
        Some(ToolSchema {
            name: "query_data",
            description: "查询用户本地的求职数据(只读)。可列出某集合的全部记录,或按 id 取一条。\
                          不可写、不可删。个人隐私字段(姓名 / 电话 / 邮箱等)一律不可读取。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "collection": {
                        "type": "string",
                        "enum": QUERYABLE,
                        "description": "要查询的集合"
                    },
                    "id": {
                        "type": "string",
                        "description": "可选:只取该 id 的一条记录;省略则返回该集合全部"
                    }
                },
                "required": ["collection"]
            }),
        })
    }
    fn invoke(&self, input: &Value, cx: &CallCx) -> Result<Output, String> {
        let collection = input
            .get("collection")
            .and_then(|v| v.as_str())
            .ok_or("缺少 collection")?;
        // 双保险:工具枚举 + 数据层 table_for 白名单都排除 profile。
        if !is_queryable(collection) {
            return Err(format!("不可查询的集合: {collection}"));
        }
        let result = crate::data::with_db(cx.app, |conn| {
            match input.get("id").and_then(|v| v.as_str()) {
                Some(id) => {
                    let one = crate::data::get_record(conn, collection, id)?;
                    Ok(json!({ "collection": collection, "record": one }))
                }
                None => {
                    let all = crate::data::list_records(conn, collection)?;
                    Ok(json!({ "collection": collection, "count": all.len(), "records": all }))
                }
            }
        })?;
        Ok(Output::Json(result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_query_excludes_profile_and_secrets() {
        // 隐私红线:工具可查集合排除 profile / secrets / settings。
        assert!(!is_queryable("profile"));
        assert!(!is_queryable("secrets"));
        assert!(!is_queryable("settings"));
        assert!(!is_queryable("meta"));
        assert!(is_queryable("jobs"));
        assert!(is_queryable("messages"));
        // 暴露给 LLM 的工具枚举同样不含 profile。
        let schema = DataQuery.schema().unwrap();
        let en = schema.parameters["properties"]["collection"]["enum"].to_string();
        assert!(!en.contains("profile"), "工具枚举不应含 profile");
        assert!(en.contains("jobs"));
    }

    #[test]
    fn registry_exposes_only_ready_tools_in_openai_format() {
        let reg = Registry::new();
        let tools = reg.tool_schemas();
        assert_eq!(tools.len(), 1, "C1 仅一个工具");
        assert_eq!(tools[0]["type"], "function");
        assert_eq!(tools[0]["function"]["name"], "query_data");
        // list_info 暴露 query_data 且 available。
        let info = reg.list_info();
        assert!(info.iter().any(|i| i.id == "query_data" && i.available));
        assert!(reg.is_available("query_data"));
        assert!(!reg.is_available("不存在"));
    }
}
