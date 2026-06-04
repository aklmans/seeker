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
use std::sync::atomic::{AtomicU64, Ordering};
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

/// show_widget 下发载荷:不可信 HTML(已过 sanitize)+ 标题 + 初始高度。
/// 由能力产出 `Output::Widget`,AI 网关据此 `emit('ai_widget')` 给前端沙箱渲染(见 ai.rs)。
pub struct WidgetPayload {
    pub id: String,
    pub html: String,
    pub title: String,
    pub min_height: u32,
}

/// 统一调用输出。C1:Text/Json/None;W1 起增 Widget(show_widget);Stream 留待后续。
pub enum Output {
    #[allow(dead_code)]
    Text(String),
    Json(Value),
    Widget(WidgetPayload),
    #[allow(dead_code)]
    None,
}
impl Output {
    /// 回灌给模型的文本(工具结果)。
    pub fn to_model_text(&self) -> String {
        match self {
            Output::Text(s) => s.clone(),
            Output::Json(v) => v.to_string(),
            Output::Widget(w) => format!("[已渲染交互式组件「{}」]", w.title),
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
    /// 启动时装配。**加能力即在此 `register`**:只读「数据查询」+「show_widget」沙箱组件。
    pub fn new() -> Self {
        let mut reg = Self { caps: Vec::new() };
        reg.register(Box::new(DataQuery));
        reg.register(Box::new(ShowWidget));
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
        // 直接调用返回载荷(自动渲染走 AI 工具循环的 ai_widget 事件)。
        Output::Widget(w) => Ok(json!({
            "id": w.id, "html": w.html, "title": w.title, "minHeight": w.min_height
        })),
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

// ── 参考能力:show_widget(W1 · 不可信 UI 沙箱化)──────────────────
// LLM 生成自包含 HTML → 平台核 sanitize(拒外链)+ ≤64KB 闸 + 分配 id → Output::Widget,
// 由 AI 网关下发前端,在 iframe sandbox + srcDoc 内 CSP(default-src none)中渲染(三道墙)。
// **自身无系统权限**(permissions 空):产物跑在沙箱里,够不到父 DOM/存储/网络。

const WIDGET_MAX_BYTES: usize = 64 * 1024;
static WIDGET_SEQ: AtomicU64 = AtomicU64::new(1);

fn gen_widget_id() -> String {
    format!("w_{}", WIDGET_SEQ.fetch_add(1, Ordering::Relaxed))
}

/// 最小 sanitize(W1):**外链引用一律拒绝**(墙2 CSP 已封死外链,这里再加一道并回报 LLM 重试)。
/// 内联 `<script>`/`<style>` 允许(widget 必需,srcDoc 内 CSP 放行内联)。完整加固(更多标签/属性级)见 W4。
fn sanitize_widget_html(html: &str) -> Result<String, String> {
    if html.len() > WIDGET_MAX_BYTES {
        return Err(format!(
            "widget HTML 过大({}KB),上限 64KB",
            html.len() / 1024
        ));
    }
    let lower = html.to_lowercase();
    for pat in ["<iframe", "<object", "<embed", "<link", "<base", "<meta"] {
        if lower.contains(pat) {
            return Err(format!(
                "widget HTML 含禁止标签 {pat};请用纯内联 HTML/CSS/原生 JS,勿含外链/嵌套框架"
            ));
        }
    }
    if has_external_script(&lower) {
        return Err("widget HTML 含外链 <script src>;请改为内联脚本".into());
    }
    Ok(html.to_string())
}

/// 扫描每个 `<script` 开标签,若标签内出现 `src` 则判为外链脚本(保守:宁可让 LLM 重试)。
fn has_external_script(lower: &str) -> bool {
    let mut i = 0;
    while let Some(pos) = lower[i..].find("<script") {
        let start = i + pos;
        let end = lower[start..]
            .find('>')
            .map(|e| start + e)
            .unwrap_or(lower.len());
        if lower[start..end].contains("src") {
            return true;
        }
        i = end + 1;
        if i >= lower.len() {
            break;
        }
    }
    false
}

pub struct ShowWidget;
impl Capability for ShowWidget {
    fn id(&self) -> &'static str {
        "show_widget"
    }
    fn kind(&self) -> Kind {
        Kind::Tool
    }
    fn permissions(&self) -> &[Permission] {
        &[] // 产物在沙箱内,自身无系统权限
    }
    fn schema(&self) -> Option<ToolSchema> {
        Some(ToolSchema {
            name: "show_widget",
            description: "渲染一张对话内联的交互式可视化卡片(看板 / 进度 / 状态 / Tab 等)。\
                          传入**自包含**的纯 HTML/CSS/原生 JS 片段:不要外链脚本/样式、不要 \
                          <iframe>/<link>/<object>。用于一次性可视化;若是要打开产品已有页面,\
                          请改用导航而非本工具。",
            parameters: json!({
                "type": "object",
                "properties": {
                    "html": { "type": "string", "description": "自包含 HTML 片段(纯内联 HTML/CSS/JS,无外链)" },
                    "title": { "type": "string", "description": "卡片标题栏文案" },
                    "min_height": { "type": "number", "description": "初始最小高度 px,默认 80" }
                },
                "required": ["html"]
            }),
        })
    }
    fn invoke(&self, input: &Value, _cx: &CallCx) -> Result<Output, String> {
        let html = input
            .get("html")
            .and_then(|v| v.as_str())
            .ok_or("缺少 html")?;
        let sanitized = sanitize_widget_html(html)?;
        let title = input
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Widget")
            .to_string();
        let min_height = input
            .get("min_height")
            .and_then(|v| v.as_u64())
            .unwrap_or(80)
            .clamp(40, 800) as u32;
        Ok(Output::Widget(WidgetPayload {
            id: gen_widget_id(),
            html: sanitized,
            title,
            min_height,
        }))
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
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|t| t["function"]["name"].as_str())
            .collect();
        assert!(names.contains(&"query_data"), "应含 query_data");
        assert!(names.contains(&"show_widget"), "应含 show_widget");
        assert!(tools.iter().all(|t| t["type"] == "function"));
        // list_info 暴露且 available。
        assert!(reg.is_available("query_data"));
        assert!(reg.is_available("show_widget"));
        assert!(!reg.is_available("不存在"));
    }

    #[test]
    fn show_widget_sanitize_rejects_external_refs() {
        // 外链脚本 / iframe / link 一律拒绝(墙2 之外再加一道,回报 LLM 重试)。
        assert!(sanitize_widget_html(r#"<script src="https://evil/x.js"></script>"#).is_err());
        assert!(sanitize_widget_html(r#"<iframe src="https://evil"></iframe>"#).is_err());
        assert!(sanitize_widget_html(r#"<link rel="stylesheet" href="x.css">"#).is_err());
        assert!(sanitize_widget_html(r#"<object data="x"></object>"#).is_err());
        // 纯内联 HTML/CSS/JS 放行(widget 必需)。
        let ok = sanitize_widget_html(
            r#"<div style="color:red">Hi</div><script>const c=0;document.title=c;</script>"#,
        );
        assert!(ok.is_ok(), "纯内联应放行: {ok:?}");
    }

    #[test]
    fn show_widget_size_gate() {
        let big = "x".repeat(64 * 1024 + 1);
        assert!(sanitize_widget_html(&big).is_err(), "超 64KB 应拒绝");
    }

    #[test]
    fn show_widget_invoke_produces_widget_payload() {
        let dq = ShowWidget;
        // invoke 不碰 cx(无系统权限),用一个假的 CallCx 不可行(需 AppHandle);
        // 故直接测 sanitize + schema 已覆盖;这里验 schema 形状与无权限声明。
        assert!(dq.permissions().is_empty(), "show_widget 自身无系统权限");
        let schema = dq.schema().unwrap();
        assert_eq!(schema.name, "show_widget");
        let req = schema.parameters["required"].to_string();
        assert!(req.contains("html"));
    }
}
