//! 系统提示(平台 · 安全/行为基线 + 域 overlay)。
//!
//! 设计(评审定稿):**平台内置默认 = 安全/行为基线**(隐私规则 + 呈现方式决策判据 —— 后者引用
//! show_widget 等平台能力),平台**独立编译可运行**(删 domain 不崩);**域 overlay**
//! (`web/domain/prompts/prompts.json`)**运行时**加载、提供业务风味,缺失/解析失败 → 回退平台默认。
//! 前端只传受约束的 `task` 键(网关据键查表选取、组装下发);**task 绝不插值进提示文本**;
//! 未知 task → default。提示内**无任何 profile**(隐私从结构隔离,见单测 + ai.rs 组装单测)。

use tauri::{AppHandle, Manager};

/// 平台安全/行为基线 —— 永远存在、不可被"换业务"删除。隐私红线 + 呈现方式决策判据(引用平台能力 show_widget)。
const PROMPT_BASELINE: &str = "You are a local-first assistant. Be concise and practical; \
    reply in the user's language. You may call tools to read the user's local data when helpful. \
    Never ask for or store personal contact details.\n\n\
    Presentation — pick the clearest form yourself (the user won't ask for it):\n\
    - Default to Markdown prose for explanations, advice, and short answers; never wrap plain text in a widget.\n\
    - If the conversation gives a specific output-format instruction (e.g. append a structured block to render a built-in card), follow that.\n\
    - Otherwise, when an interactive or visual view communicates better than prose — a comparison, ranking, distribution/proportion, dashboard, chart, timeline, or an interactive checklist/calculator — proactively call the show_widget tool with a self-contained HTML snippet. Lead with one short sentence of context, then the widget (never reply with a bare widget). At most one widget per reply, and only when it clearly beats text.\n\
    - Widget styling: the widget canvas already loads the app's design system — CSS variables (--accent, --ink, --ink-2, --ink-3, --border, --bg-elevated, --font-sans, --font-mono) and styled base elements (h1–h6, p, ul, table, button, .card). Write plain SEMANTIC HTML and lean on those defaults; do NOT hardcode colors, fonts, or backgrounds — that keeps widgets consistent with the app. Use the warm accent sparingly (links, or a single primary button via class=\"btn-accent\").";

/// 组装系统提示:平台基线 +(域 overlay 的 task 风味,有则追加在基线**之后**)。**纯函数,可单测。**
/// `task` 仅作查表键(命中或回退 default),**绝不插值进文本**;解析失败/无风味 → 仅平台基线。
fn compose(baseline: &str, overlay_json: Option<&str>, task: &str) -> String {
    let flavor = overlay_json
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(s).ok())
        .and_then(|m| {
            m.get(task)
                .or_else(|| m.get("default"))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
        });
    match flavor {
        Some(f) if !f.is_empty() => format!("{baseline}\n\n{f}"),
        _ => baseline.to_string(),
    }
}

/// 运行时加载域 overlay(纯文本指令,与向量隔离无关)。prod 走 Tauri 资源,dev 走源文件;
/// 均失败(如删了 domain)→ None → 回退平台默认(平台仍可运行)。
fn load_overlay(app: &AppHandle) -> Option<String> {
    if let Ok(p) = app
        .path()
        .resolve("prompts/prompts.json", tauri::path::BaseDirectory::Resource)
    {
        if let Ok(s) = std::fs::read_to_string(&p) {
            return Some(s);
        }
    }
    #[cfg(debug_assertions)]
    {
        // 开发期(cargo build 无打包资源):从源文件读;删了 domain 则读失败 → 回退(平台不崩)。
        let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/domain/prompts/prompts.json");
        if let Ok(s) = std::fs::read_to_string(&dev) {
            return Some(s);
        }
    }
    None
}

/// 网关取系统提示:平台基线 + 域 overlay(按 task 选取)。task None → "default"。
pub fn system_prompt(app: &AppHandle, task: Option<&str>) -> String {
    compose(
        PROMPT_BASELINE,
        load_overlay(app).as_deref(),
        task.unwrap_or("default"),
    )
}

#[cfg(test)]
mod tests {
    use super::{compose, PROMPT_BASELINE};

    // 提示内绝不含 profile 痕迹(隐私基线落平台、纯静态指令、无身份信息)。
    fn assert_no_profile(s: &str) {
        for needle in ["phone", "email", "电话", "邮箱", "138"] {
            assert!(!s.contains(needle), "提示不应含 profile 痕迹: {needle}");
        }
    }

    #[test]
    fn baseline_alone_when_no_overlay() {
        // 删 domain / overlay 缺失 → 仅平台基线;安全基线(隐私 + 呈现判据)仍在。
        let s = compose(PROMPT_BASELINE, None, "default");
        assert_eq!(s, PROMPT_BASELINE);
        assert!(s.contains("Never ask for or store personal contact details"));
        assert!(s.contains("show_widget"));
        assert_no_profile(&s);
    }

    #[test]
    fn overlay_appends_flavor_with_baseline_first() {
        let ov = r#"{"default":"You are Seeker's job-hunt assistant."}"#;
        let s = compose(PROMPT_BASELINE, Some(ov), "default");
        assert!(s.starts_with(PROMPT_BASELINE)); // 安全基线在前、不可被 overlay 覆盖
        assert!(s.contains("job-hunt assistant"));
        assert!(s.contains("Never ask for or store personal contact details"));
        assert_no_profile(&s);
    }

    #[test]
    fn unknown_task_falls_back_to_default_overlay_never_interpolated() {
        let ov = r#"{"default":"flavorX"}"#;
        let s = compose(PROMPT_BASELINE, Some(ov), "__nope__");
        assert!(s.contains("flavorX")); // 未知 task → default 风味(非缺失)
        assert!(!s.contains("__nope__")); // **task 绝不插值进提示文本**
        assert_no_profile(&s);
    }

    #[test]
    fn malformed_overlay_falls_back_to_baseline() {
        let s = compose(PROMPT_BASELINE, Some("not json{{"), "default");
        assert_eq!(s, PROMPT_BASELINE); // 解析失败 → 平台基线(安全)
    }
}
