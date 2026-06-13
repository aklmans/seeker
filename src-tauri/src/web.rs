//! 受控网页抓取(发现 agent · P0 · 平台层出口能力)。
//!
//! **网络出口红线**(仅次于密钥):出口只在 Rust 核(WebView `connect-src` 不松、前端不出网);
//! 仅 `http`/`https`;**SSRF 护栏**——解析主机后逐 IP 拒私网/环回/链路本地/云元数据/ULA,
//! 且**逐跳重定向复检**;重定向 ≤3、响应体 ≤2MB、超时 20s、仅收文本类 `content-type`;
//! 只抽**纯文本**、绝不在 WebView 渲染。抓回内容是**不可信外部数据**——调用方按「数据非指令」
//! 处理(P0 经现有 JD 录入的人审 + 抽取提示框定,不进系统提示、不直接喂工具循环)。
//! 无新依赖:URL 解析用 `reqwest::Url`,IP 段判定用 std。
//!
//! **DNS rebinding(TOCTOU)已收口(P2)**:`resolve_allowed` 解析校验后,fetch 用 reqwest
//! `.resolve(host, addr)` **按已校验 IP 直连**(Host/SNI 仍用 host),reqwest 不再二次解析该 host
//! → 关掉"校验与连接之间改绑"的窗口(P2 起 agent 自动抓搜索结果 URL,威胁升级,故必收)。
//! 6to4 / Teredo 隧道在 `is_blocked_ip` 拦。

use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;

const MAX_BODY: usize = 2 * 1024 * 1024; // 2MB
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 3;
/// 抓页面用的 UA(普通浏览器标识;与 AI 网关的可配置 UA 无关)。
const FETCH_UA: &str = "Mozilla/5.0 (compatible; Seeker/0.1; +local)";
/// 验链(verify_sources)上限:最多验 N 条、并发 K、每条读小额(够确认存活 + 抽 <title>)。
const VERIFY_MAX_URLS: usize = 20;
const VERIFY_CONCURRENCY: usize = 5;
const VERIFY_BODY: usize = 256 * 1024; // 256KB

// ── SSRF 护栏 ──────────────────────────────────────────────────

/// 该 IP 是否**禁止抓取**(私网 / 环回 / 链路本地 / 未指定 / 广播 / CGNAT / ULA / IPv4-mapped 私网)。
/// 防 SSRF:阻断内网与云元数据(169.254.169.254 落在链路本地)。(纯函数,可单测)
fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
                // 100.64/10 CGNAT
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (seg[0] == 0x2001 && seg[1] == 0x0000) // Teredo 2001:0::/32(可中继 IPv4)→ 拒
                || (seg[0] == 0x2002 // 6to4 2002::/16:校验内嵌 IPv4(防绕到内网)
                    && is_blocked_ip(&IpAddr::V4(std::net::Ipv4Addr::new(
                        (seg[1] >> 8) as u8,
                        (seg[1] & 0xff) as u8,
                        (seg[2] >> 8) as u8,
                        (seg[2] & 0xff) as u8,
                    ))))
                || v6.to_ipv4_mapped().is_some_and(|m| is_blocked_ip(&IpAddr::V4(m)))
        }
    }
}

/// 解析 `host:port` → IP 列表,**任一**落在禁止段即拒(保守);无法解析 / 无结果 → 拒。
/// 返回**钉定的已校验 `SocketAddr`**——供 fetch 按 IP 直连(关 DNS rebinding 窗口)。
/// 阻塞 DNS 调用放 `spawn_blocking`,不卡异步运行时。
async fn resolve_allowed(host: String, port: u16) -> Result<std::net::SocketAddr, String> {
    tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        let addrs: Vec<_> = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|e| format!("无法解析主机 {host}:{e}"))?
            .collect();
        let first = *addrs
            .first()
            .ok_or_else(|| format!("主机 {host} 无解析结果"))?;
        for a in &addrs {
            if is_blocked_ip(&a.ip()) {
                return Err(format!("拒绝抓取内网 / 保留地址({})", a.ip()));
            }
        }
        Ok(first) // 全部校验通过,钉首个
    })
    .await
    .map_err(|e| format!("解析任务失败:{e}"))?
}

/// 解析 + 校验抓取 URL:仅 `http`/`https`,且有主机。(纯函数,可单测)
fn validate_fetch_url(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|e| format!("URL 无法解析:{e}"))?;
    match u.scheme() {
        "http" | "https" => {}
        s => return Err(format!("仅支持 http / https,不支持 {s}")),
    }
    if u.host_str().is_none() {
        return Err("URL 缺少主机".into());
    }
    Ok(u)
}

// ── 零依赖 HTML → 纯文本(Unicode 安全:char 级扫描)────────────────

fn ci_match(hay: &[char], at: usize, needle: &[char]) -> bool {
    at + needle.len() <= hay.len()
        && hay[at..at + needle.len()]
            .iter()
            .zip(needle)
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
}
fn ci_find(hay: &[char], from: usize, needle: &[char]) -> Option<usize> {
    (from..=hay.len().saturating_sub(needle.len())).find(|&k| ci_match(hay, k, needle))
}

/// 删除 `<tag ...>...</tag>` 整块(大小写不敏感;未闭合则丢弃其后)。
fn remove_block(html: &[char], tag: &str) -> Vec<char> {
    let open: Vec<char> = format!("<{tag}").chars().collect();
    let close: Vec<char> = format!("</{tag}>").chars().collect();
    let mut out = Vec::with_capacity(html.len());
    let mut i = 0;
    while i < html.len() {
        if ci_match(html, i, &open) {
            match ci_find(html, i + open.len(), &close) {
                Some(j) => i = j + close.len(),
                None => break,
            }
        } else {
            out.push(html[i]);
            i += 1;
        }
    }
    out
}

/// 极简 HTML → 纯文本:去 script/style、块标签转换行、去标签、解常见实体、压空白。
/// 不求完美排版,够人审 + 喂 AI 抽取即可。(纯函数,可单测)
fn html_to_text(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let chars = remove_block(&chars, "script");
    let chars = remove_block(&chars, "style");
    // 去标签:块级 / <br> 转换行,其余转空格。
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<' {
            let mut name = String::new();
            let mut j = i + 1;
            while j < chars.len() && chars[j] == '/' {
                j += 1;
            }
            while j < chars.len() && (chars[j].is_ascii_alphanumeric()) {
                name.push(chars[j].to_ascii_lowercase());
                j += 1;
            }
            // 跳到 '>' 之后
            while i < chars.len() && chars[i] != '>' {
                i += 1;
            }
            i += 1; // 跳过 '>'
            let block = matches!(
                name.as_str(),
                "br" | "p"
                    | "div"
                    | "li"
                    | "tr"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "section"
                    | "article"
                    | "ul"
                    | "ol"
                    | "table"
                    | "header"
                    | "footer"
                    | "nav"
            );
            out.push(if block { '\n' } else { ' ' });
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'");
    // 压空白:每行内多空白 → 单空格;多空行 → 至多一空行。
    let mut result: Vec<String> = Vec::new();
    let mut blank = false;
    for line in out.lines() {
        let l = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if l.is_empty() {
            if !blank {
                result.push(String::new());
            }
            blank = true;
        } else {
            result.push(l);
            blank = false;
        }
    }
    result.join("\n").trim().to_string()
}

// ── 抓取(逐跳 SSRF 复检 + 限额)──────────────────────────────────

/// 受控抓取核心(逐跳 SSRF 复检 + **钉 IP 直连** + 限额):返回 `(是否 html, 原始文本)`。
/// `max_body`:响应体读取上限(web_fetch 取全文 MAX_BODY;验链取小额省流)。
async fn fetch_raw(url: &str, max_body: usize) -> Result<(bool, String), String> {
    let mut current = validate_fetch_url(url)?;
    for _ in 0..=MAX_REDIRECTS {
        // 每一跳:校验 scheme + 解析主机 IP 校验 + **钉定 IP**(关 DNS rebinding:reqwest 不再二次解析该 host)。
        let parsed = validate_fetch_url(current.as_str())?;
        let host = parsed.host_str().unwrap_or("").to_string();
        let port = parsed
            .port_or_known_default()
            .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
        let addr = resolve_allowed(host.clone(), port).await?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none()) // 手动跟,逐跳复检 + 重新钉 IP
            .timeout(FETCH_TIMEOUT)
            .user_agent(FETCH_UA)
            .resolve(&host, addr) // 钉:host → 已校验 IP(Host/SNI 仍用 host),杜绝二次解析改绑
            .build()
            .map_err(|e| format!("构建抓取客户端失败:{e}"))?;

        let resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|e| format!("抓取失败:{e}"))?;
        let status = resp.status();

        if status.is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("重定向缺 Location 头")?;
            current = current
                .join(loc)
                .map_err(|e| format!("重定向目标无效:{e}"))?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("目标返回 HTTP {}", status.as_u16()));
        }
        // 内容类型:只接文本类(防二进制 / 可执行)。
        let ctype = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let is_html = ctype.contains("text/html") || ctype.contains("application/xhtml");
        let text_ok = is_html
            || ctype.contains("text/plain")
            || ctype.contains("application/json")
            || ctype.is_empty();
        if !text_ok {
            return Err(format!("不支持的内容类型:{ctype}(仅抓网页 / 文本)"));
        }
        // 大小上限:流式读到 max_body 即停。
        use futures_util::StreamExt;
        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取响应失败:{e}"))?;
            buf.extend_from_slice(&chunk);
            if buf.len() >= max_body {
                buf.truncate(max_body);
                break;
            }
        }
        return Ok((is_html, String::from_utf8_lossy(&buf).into_owned()));
    }
    Err("重定向次数过多".into())
}

/// 抓取并抽纯文本(web_fetch 用):全文 + html→text。
async fn fetch_guarded(url: &str) -> Result<String, String> {
    let (is_html, raw) = fetch_raw(url, MAX_BODY).await?;
    Ok(if is_html { html_to_text(&raw) } else { raw })
}

/// 从 HTML 抽 `<title>`(验链展示用;Unicode 安全 char 级)。无 / 空 → None。
fn extract_title(html: &str) -> Option<String> {
    let chars: Vec<char> = html.chars().collect();
    let start = ci_find(&chars, 0, &['<', 't', 'i', 't', 'l', 'e'])?;
    let content_start = (start..chars.len()).find(|&k| chars[k] == '>')? + 1;
    let content_end = ci_find(&chars, content_start, &['<', '/', 't', 'i', 't', 'l', 'e', '>'])?;
    let raw: String = chars[content_start..content_end].iter().collect();
    let t = raw
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty()).then_some(t)
}

/// 命令:抓取用户自填的 URL(JD / 招聘页),返回**纯文本**(不可信外部数据)。
/// 出口只在此 Rust 核;全套 SSRF / 限额护栏见模块头。供发现 agent · P0「扔回 URL」。
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<String, String> {
    let text = fetch_guarded(&url).await?;
    if text.trim().is_empty() {
        return Err("抓取成功但未提取到文本(可能是脚本渲染页 / 非文本)".into());
    }
    Ok(text)
}

/// 命令:批量验链——逐个经受控抓取(复用 SSRF / 钉 IP / 限额)验存活 + 抽 `<title>`。
/// 单条失败 / 被拒不影响其余;并发 + 数量上限。供发现 agent · P2「自动验链」:
/// **由 domain 调用,非 AI 能力**(模型不能 fetch);验的是模型已产出、来自搜索的 source URL。
/// 返回 `[{url, ok, title?|error?}]`。
#[tauri::command]
pub async fn verify_sources(urls: Vec<String>) -> Result<Value, String> {
    use futures_util::{stream, StreamExt};
    let urls: Vec<String> = urls.into_iter().take(VERIFY_MAX_URLS).collect();
    let results: Vec<Value> = stream::iter(urls)
        .map(|url| async move {
            match fetch_raw(&url, VERIFY_BODY).await {
                Ok((is_html, raw)) => {
                    let title = if is_html { extract_title(&raw) } else { None };
                    json!({ "url": url, "ok": true, "title": title })
                }
                Err(e) => json!({ "url": url, "ok": false, "error": e }),
            }
        })
        .buffer_unordered(VERIFY_CONCURRENCY)
        .collect()
        .await;
    Ok(Value::Array(results))
}

// ── 在系统浏览器打开外链(发现 agent · P0/P1)─────────────────────

/// 命令:在**系统默认浏览器**打开用户选定的 URL(仅 http/https,拒 `file:`/`javascript:`/`data:`)。
/// 用户主动点击触发;Seeker **不在应用内 / WebView 打开外链**——守「用户在自己浏览器浏览」+
/// 不可信外链不进 WebView。复用 `validate_fetch_url` 作 scheme 闸。
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let u = validate_fetch_url(&url)?; // 仅 http/https + 有主机(拒 file/javascript/data/ftp)
    open_in_browser(u.as_str())
}

#[cfg(target_os = "macos")]
fn open_in_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败:{e}"))
}
#[cfg(target_os = "windows")]
fn open_in_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败:{e}"))
}
#[cfg(target_os = "linux")]
fn open_in_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败:{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn blocks_private_and_meta_ips() {
        let b = |s: &str| is_blocked_ip(&s.parse::<IpAddr>().unwrap());
        assert!(b("127.0.0.1")); // 环回
        assert!(b("10.0.0.5")); // 私网
        assert!(b("192.168.1.1"));
        assert!(b("172.16.0.1"));
        assert!(b("169.254.169.254")); // 云元数据(链路本地)
        assert!(b("0.0.0.0"));
        assert!(b("100.64.0.1")); // CGNAT
        assert!(b("::1")); // IPv6 环回
        assert!(b("fc00::1")); // ULA
        assert!(b("fe80::1")); // 链路本地
        assert!(is_blocked_ip(&IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0xffff, 0x7f00, 1
        )))); // ::ffff:127.0.0.1
        assert!(b("2002:c0a8:0101::1")); // 6to4 内嵌 192.168.1.1 → 私网
        assert!(b("2001:0:abcd::1")); // Teredo 2001:0::/32
        assert!(!b("2002:0808:0808::1")); // 6to4 内嵌 8.8.8.8 → 公网,放行
                                          // 公网放行
        assert!(!b("8.8.8.8"));
        assert!(!b("1.1.1.1"));
        assert!(!is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)))); // example.com
        assert!(!b("2606:4700:4700::1111")); // 公网 IPv6
    }

    #[test]
    fn validate_url_scheme() {
        assert!(validate_fetch_url("https://example.com/jd").is_ok());
        assert!(validate_fetch_url("http://example.com").is_ok());
        assert!(validate_fetch_url("file:///etc/passwd").is_err());
        assert!(validate_fetch_url("ftp://x/y").is_err());
        assert!(validate_fetch_url("data:text/html,<b>x</b>").is_err());
        assert!(validate_fetch_url("javascript:alert(1)").is_err()); // open_external 的 XSS 闸
        assert!(validate_fetch_url("not a url").is_err());
    }

    #[test]
    fn html_to_text_strips_and_keeps_text() {
        let html = "<html><head><style>.a{color:red}</style><script>alert('x'&&1)</script></head>\
            <body><h1>标题</h1><p>第一段 &amp; 要点</p><div>第二段</div><a href=\"#\">链接</a></body></html>";
        let t = html_to_text(html);
        assert!(t.contains("标题"));
        assert!(t.contains("第一段 & 要点")); // 实体解码
        assert!(t.contains("第二段"));
        assert!(t.contains("链接"));
        assert!(!t.contains("alert")); // script 去除
        assert!(!t.contains("color:red")); // style 去除
        assert!(!t.contains('<')); // 标签去除
        assert!(t.contains('\n')); // 块标签转换行
    }

    #[test]
    fn html_to_text_unicode_safe_no_panic() {
        // 含多字节字符 + 未闭合 script,不应 panic、不留脚本。
        let t = html_to_text("中文<script>恶意</script>更多中文<p>段落</p>");
        assert!(t.contains("中文"));
        assert!(t.contains("更多中文"));
        assert!(!t.contains("恶意"));
    }

    #[tokio::test]
    async fn fetch_guarded_blocks_loopback() {
        // SSRF 实拦:loopback 在连接前就被护栏拒(不需真 server)。
        let err = fetch_guarded("http://127.0.0.1:9/jd").await.unwrap_err();
        assert!(
            err.contains("内网") || err.contains("保留"),
            "应被 SSRF 拒:{err}"
        );
    }

    #[test]
    fn extract_title_finds_and_decodes() {
        assert_eq!(
            extract_title("<html><head><title> Jobs &amp; Careers </title></head>"),
            Some("Jobs & Careers".into())
        );
        assert_eq!(extract_title("<TITLE>大写标签</TITLE>"), Some("大写标签".into())); // 大小写不敏感
        assert!(extract_title("<p>no title</p>").is_none());
        assert!(extract_title("<title></title>").is_none()); // 空 → None
    }

    #[tokio::test]
    async fn verify_sources_blocks_loopback() {
        // loopback 被 SSRF 拒 → ok:false;不 panic、条目独立返回。
        let v = verify_sources(vec!["http://127.0.0.1:9/x".into()])
            .await
            .unwrap();
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["ok"], false);
        let e = arr[0]["error"].as_str().unwrap_or("");
        assert!(e.contains("内网") || e.contains("保留"), "应记 SSRF 拒因:{e}");
    }

    // 真实抓取 happy-path(打公网 example.com):验证 fetch + html→text 全链路。
    // `#[ignore]`:依赖联网,CI 不跑;手动 `cargo test -- --ignored fetch_guarded_live` 验。
    #[tokio::test]
    #[ignore]
    async fn fetch_guarded_live_example() {
        let text = fetch_guarded("https://example.com")
            .await
            .expect("抓取 example.com");
        assert!(text.contains("Example Domain"), "应抽到正文:{text}");
        assert!(!text.contains('<'), "应已去标签");
    }
}
