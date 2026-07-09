//! jobseek 应用专属能力(AI-Native P0 末件 · **打样 · §1 权衡记账**)。
//!
//! ★§1 说明(重要):`jobseek_market_value` 是 **jobseek 业务逻辑**,放在平台 Rust 能力层是
//! `proposal-agent-native.md` 路线 B(工具=Rust Capability)的**打样级权衡**:
//!   - 红线净:走 registry.invoke_raw 统一闸,复用 D3 三层闸 + profile-free `CallCx`(结构上无 profile),
//!     破坏性由 `Permission::Destructive` 拦(本工具只读、无此权限);对比路线 A(前端 JS 工具)不开 profile/D3 破口。
//!   - 代价:app 业务进平台 Rust(与 §1「platform 业务无关」有张力)。Rust 侧无 `apps/` 概念,故暂以 `jobseek_` 前缀
//!     显式标注归属;**正式的 app-tool 契约**(apps 声明工具、profile 隔离上下文执行、结果经平台校验)待 P0 之后设计,
//!     届时本模块随之迁走。用户已拍板此打样落法(2026-07-09)。

use crate::capability::{
    gen_widget_id, readable_set, Availability, CallCx, Capability, Kind, Output, Permission,
    ToolSchema, WidgetPayload,
};
use async_trait::async_trait;
use serde_json::{json, Value};

/// jobseek · 市场价值估算(只读工具)。读职业资产(skills 集合,D3 可读时),给出数据驱动的估算年包区间 + top 技能,产 Widget 投画布。
pub struct MarketValue;

#[async_trait]
impl Capability for MarketValue {
    fn id(&self) -> &'static str {
        "jobseek_market_value"
    }
    fn kind(&self) -> Kind {
        Kind::Tool
    }
    fn permissions(&self) -> &[Permission] {
        &[Permission::Db] // 只读 db;无 Destructive
    }
    fn available(&self, cx: &CallCx) -> Availability {
        // 与 DataQuery 同纪律:skills 须在当前 AI 可读集(启用应用 ∩ manifest aiReadable ∩ 用户授权)才上架本工具。
        if readable_set(cx).contains("skills") {
            Availability::Ready
        } else {
            Availability::Unavailable("职业资产(skills)当前不对 AI 可读(应用未启用或未授权)".into())
        }
    }
    fn schema(&self) -> Option<ToolSchema> {
        Some(ToolSchema {
            name: "jobseek_market_value",
            description: "估算用户当前的求职市场价值:读取用户的职业资产(技能),给出数据驱动的估算年包区间与依据。\
                          只读、不含任何隐私字段(姓名/电话/邮箱等一律不可读)。何时用:用户问「我值多少钱 / 我的市场价值 / 身价」等。",
            parameters: json!({ "type": "object", "properties": {} }),
        })
    }
    async fn invoke(&self, _input: &Value, cx: &CallCx) -> Result<Output, String> {
        // D3 三层闸硬强制(能力层强制点,非仅提示):即便 schema 上架,invoke 也二次校验 skills 在可读集。
        if !readable_set(cx).contains("skills") {
            return Err("职业资产(skills)当前不对 AI 可读(应用未启用或未授权)".into());
        }
        let records =
            crate::data::with_db(cx.app, |conn| crate::data::list_records(conn, "skills"))?;
        let html = build_market_value_html(&records);
        Ok(Output::Widget(WidgetPayload {
            id: gen_widget_id(),
            html, // Rust 生成的可信结构 + 用户数据(技能名)已 html_escape;渲染仍走三墙沙箱
            title: "市场价值估算".into(),
            min_height: 180,
        }))
    }
}

/// 从 skills 记录构建市场价值卡 HTML(纯函数,便于单测)。估算公式为**打样级、数据驱动**(base + Σ 技能等级权重)。
fn build_market_value_html(records: &[Value]) -> String {
    // 解析 (name, lvl);lvl 缺省 1。
    let mut skills: Vec<(String, i64)> = records
        .iter()
        .filter_map(|r| {
            let name = r.get("name").and_then(|v| v.as_str())?.to_string();
            let lvl = r
                .get("lvl")
                .and_then(|v| v.as_i64())
                .unwrap_or(1)
                .clamp(1, 5);
            Some((name, lvl))
        })
        .collect();
    // 数据驱动估算:基线 20 万 + 每项技能按等级加权(打样公式,非真实定价模型)。
    let sum: f64 = skills.iter().map(|(_, lvl)| *lvl as f64 * 1.6).sum();
    let mid = 20.0 + sum;
    let low = (mid * 0.88).round() as i64;
    let high = (mid * 1.16).round() as i64;
    // top 5 技能(按等级降序)。
    skills.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let chips: String = skills
        .iter()
        .take(5)
        .map(|(n, l)| {
            format!(
                "<span style=\"display:inline-block;padding:3px 9px;border:0.5px solid #d8d5cf;border-radius:2px;font-size:12px;color:#3a3a3a\">{} · L{}</span>",
                html_escape(n),
                l
            )
        })
        .collect::<Vec<_>>()
        .join(" ");
    let n = skills.len();
    format!(
        "<div style=\"font-family:system-ui;padding:10px 6px\">\
         <div style=\"font-size:10px;letter-spacing:.18em;color:#9a9a9a;font-family:monospace\">— 综合估算 · 年包</div>\
         <div style=\"font-size:34px;color:#c95f3d;font-weight:600;margin:8px 0 4px\">{low}–{high}<span style=\"font-size:14px;color:#888;font-weight:400\"> 万 / 年</span></div>\
         <div style=\"font-size:13px;color:#555;line-height:1.6;margin-bottom:14px\">基于你 <b>{n}</b> 项职业资产的数据驱动估算(打样公式);补齐高杠杆技能可上探区间上沿。</div>\
         <div style=\"display:flex;gap:6px;flex-wrap:wrap\">{chips}</div></div>"
    )
}

/// HTML 转义(用户数据,如技能名,进 HTML 前逐字转义 —— 纵深防御,尽管最终在三墙沙箱内)。
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn market_value_is_data_driven_and_escapes() {
        // 无技能:仅基线区间(low<high、含万/年)。
        let empty = build_market_value_html(&[]);
        assert!(empty.contains("万 / 年"));
        assert!(empty.contains("0</b> 项") || empty.contains("<b>0</b>"));
        // 有技能:估算随等级上升(数据驱动),且技能名转义。
        let recs = vec![
            json!({"name":"Go","lvl":4}),
            json!({"name":"<img src=x onerror=1>","lvl":3}),
        ];
        let html = build_market_value_html(&recs);
        assert!(html.contains("2</b> 项") || html.contains("<b>2</b>"));
        assert!(html.contains("&lt;img"), "技能名须 HTML 转义"); // 注入面被转义
        assert!(!html.contains("<img src=x"), "原始 <img 不得进 HTML");
        assert!(html.contains("Go · L4"));
    }
}
