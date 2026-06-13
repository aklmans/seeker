//! 极简 .docx 生成(平台层 · 业务无关的「文档模型 → .docx」渲染器)。
//!
//! .docx = OOXML 包(ZIP)。这里**零依赖**手写:
//! - stored(不压缩)ZIP 写入器 + 自带 CRC-32(避免引 zip / docx 库);
//! - 极简 OOXML(`[Content_Types].xml` + `_rels/.rels` + `word/document.xml`)。
//!
//! 业务(简历)只产出结构化「文档模型」喂进来,**本模块不懂简历**(可复用)。
//! 输出 base64(供前端 `atob` → Blob 下载;`base64` 已在依赖)。纯本地、不出网。

use base64::Engine as _;
use serde::Deserialize;

/// 文档模型(前端按此形状传入;业务无关)。
#[derive(Deserialize)]
pub struct DocModel {
    pub title: String,
    #[serde(default)]
    pub sections: Vec<DocSection>,
}

#[derive(Deserialize)]
pub struct DocSection {
    pub label: String,
    #[serde(default)]
    pub blocks: Vec<DocBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DocBlock {
    /// 普通段落(可含 `\n`,渲染为软换行)。
    Para {
        #[serde(default)]
        text: String,
    },
    /// 条目:标题 + 日期 + 要点列表(简历的经历 / 项目)。
    Entry {
        #[serde(default)]
        head: String,
        #[serde(default)]
        date: String,
        #[serde(default)]
        bullets: Vec<String>,
    },
}

// ── OOXML 文本 ─────────────────────────────────────────────────

fn xml_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // 控制字符(除 \t \n \r)在 XML 1.0 非法 → 丢弃,避免坏文档。
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => o.push(c),
        }
    }
    o
}

/// 一个 run:text 内的 `\n` 渲染成 `<w:br/>`;`bold` 控制加粗。
fn run(text: &str, bold: bool) -> String {
    let rpr = if bold { "<w:rPr><w:b/></w:rPr>" } else { "" };
    let parts: Vec<String> = text
        .split('\n')
        .map(|line| format!("<w:t xml:space=\"preserve\">{}</w:t>", xml_escape(line)))
        .collect();
    format!("<w:r>{rpr}{}</w:r>", parts.join("<w:br/>"))
}

fn para(text: &str, bold: bool) -> String {
    format!("<w:p>{}</w:p>", run(text, bold))
}

fn title_para(text: &str) -> String {
    format!(
        "<w:p><w:pPr><w:jc w:val=\"center\"/><w:spacing w:after=\"120\"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val=\"36\"/><w:szCs w:val=\"36\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        xml_escape(text)
    )
}

fn heading_para(text: &str) -> String {
    format!(
        "<w:p><w:pPr><w:spacing w:before=\"240\" w:after=\"60\"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val=\"26\"/><w:szCs w:val=\"26\"/></w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        xml_escape(text)
    )
}

fn bullet_para(text: &str) -> String {
    // 不引 numbering.xml:用「• 」前缀 + 缩进。ATS 读纯文本,等效且更简。
    format!(
        "<w:p><w:pPr><w:ind w:left=\"360\"/></w:pPr><w:r><w:t xml:space=\"preserve\">• {}</w:t></w:r></w:p>",
        xml_escape(text)
    )
}

fn document_xml(doc: &DocModel) -> String {
    let mut body = String::new();
    body.push_str(&title_para(&doc.title));
    for s in &doc.sections {
        body.push_str(&heading_para(&s.label));
        for b in &s.blocks {
            match b {
                DocBlock::Para { text } => body.push_str(&para(text, false)),
                DocBlock::Entry {
                    head,
                    date,
                    bullets,
                } => {
                    let h = if date.is_empty() {
                        head.clone()
                    } else {
                        format!("{head}  ({date})")
                    };
                    body.push_str(&para(&h, true));
                    for bu in bullets {
                        body.push_str(&bullet_para(bu));
                    }
                }
            }
        }
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr/></w:body></w:document>"
    )
}

const CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";

const RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";

// ── 零依赖 stored ZIP ──────────────────────────────────────────

/// CRC-32(IEEE,与 ZIP 一致)。
fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// 把若干 `(路径, 内容)` 打成一个 **stored(不压缩)** ZIP。足够 .docx 用。
fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for &(name, data) in files {
        let crc = crc32(data);
        let offset = out.len() as u32;
        let n = data.len() as u32;
        // —— 本地文件头(PK\x03\x04)——
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0u16.to_le_bytes()); // flags
        out.extend_from_slice(&0u16.to_le_bytes()); // method = stored
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&n.to_le_bytes()); // comp size
        out.extend_from_slice(&n.to_le_bytes()); // uncomp size
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra len
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);
        // —— 中央目录条目(PK\x01\x02),此刻 offset 已知 ——
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&0u16.to_le_bytes()); // flags
        central.extend_from_slice(&0u16.to_le_bytes()); // method
        central.extend_from_slice(&0u16.to_le_bytes()); // time
        central.extend_from_slice(&0u16.to_le_bytes()); // date
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&n.to_le_bytes()); // comp
        central.extend_from_slice(&n.to_le_bytes()); // uncomp
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // extra
        central.extend_from_slice(&0u16.to_le_bytes()); // comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk start
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let cd_offset = out.len() as u32;
    let cd_size = central.len() as u32;
    out.extend_from_slice(&central);
    // —— 中央目录结束记录(PK\x05\x06)——
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // disk num
    out.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    out.extend_from_slice(&(files.len() as u16).to_le_bytes()); // entries this disk
    out.extend_from_slice(&(files.len() as u16).to_le_bytes()); // total entries
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment len
    out
}

/// 渲染 .docx 字节(零依赖)。`[Content_Types].xml` 置首(reader 约定)。
pub fn render_docx(doc: &DocModel) -> Vec<u8> {
    let document = document_xml(doc);
    make_zip(&[
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes()),
        ("_rels/.rels", RELS.as_bytes()),
        ("word/document.xml", document.as_bytes()),
    ])
}

/// 命令:文档模型 → .docx 的 base64(前端解码成 Blob 下载)。**纯本地、不出网。**
#[tauri::command]
pub fn export_docx(doc: DocModel) -> Result<String, String> {
    Ok(base64::engine::general_purpose::STANDARD.encode(render_docx(&doc)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_known_vector() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926); // 标准 CRC-32 测试向量
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn xml_escape_escapes_and_strips_control() {
        assert_eq!(xml_escape("a<b>&\"c"), "a&lt;b&gt;&amp;&quot;c");
        assert_eq!(xml_escape("ok\u{07}bad"), "okbad"); // 非法控制字符丢弃
        assert_eq!(xml_escape("keep\ttab"), "keep\ttab"); // \t 保留
    }

    fn sample() -> DocModel {
        DocModel {
            title: "张三 · for ACME".into(),
            sections: vec![DocSection {
                label: "技能".into(),
                blocks: vec![
                    DocBlock::Para {
                        text: "Rust · TypeScript".into(),
                    },
                    DocBlock::Entry {
                        head: "ACME".into(),
                        date: "2023".into(),
                        bullets: vec!["做了 X<>&".into()],
                    },
                ],
            }],
        }
    }

    #[test]
    fn document_xml_has_content_and_escapes() {
        let x = document_xml(&sample());
        assert!(x.contains("张三 · for ACME"));
        assert!(x.contains("技能"));
        assert!(x.contains("ACME  (2023)")); // head + date
        assert!(x.contains("• 做了 X&lt;&gt;&amp;")); // 要点 + 转义
        assert!(x.contains("<w:sectPr/>"));
    }

    #[test]
    fn render_docx_is_valid_zip_with_parts() {
        let z = render_docx(&sample());
        assert_eq!(&z[..4], b"PK\x03\x04"); // 本地头签名
        assert!(z.windows(4).any(|w| w == b"PK\x05\x06"), "缺 EOCD");
        assert!(z.windows(4).any(|w| w == b"PK\x01\x02"), "缺中央目录");
        for p in ["[Content_Types].xml", "_rels/.rels", "word/document.xml"] {
            assert!(z.windows(p.len()).any(|w| w == p.as_bytes()), "缺 part {p}");
        }
        // stored 不压缩:正文字节应原样可见。
        let needle = "• 做了 X&lt;&gt;&amp;";
        assert!(z.windows(needle.len()).any(|w| w == needle.as_bytes()));
    }

    #[test]
    fn first_local_header_crc_and_size_correct() {
        // 校验 zip 写入器:首条([Content_Types].xml)的 CRC / 大小 / 文件名字段。
        let z = render_docx(&DocModel {
            title: "T".into(),
            sections: vec![],
        });
        let crc = u32::from_le_bytes([z[14], z[15], z[16], z[17]]);
        let comp = u32::from_le_bytes([z[18], z[19], z[20], z[21]]);
        let uncomp = u32::from_le_bytes([z[22], z[23], z[24], z[25]]);
        let flen = u16::from_le_bytes([z[26], z[27]]) as usize;
        assert_eq!(crc, crc32(CONTENT_TYPES.as_bytes()));
        assert_eq!(comp as usize, CONTENT_TYPES.len());
        assert_eq!(uncomp as usize, CONTENT_TYPES.len());
        assert_eq!(flen, "[Content_Types].xml".len());
        assert_eq!(&z[30..30 + flen], b"[Content_Types].xml");
    }

    #[test]
    fn writes_openable_docx_to_tmp() {
        // 写一个真文件到临时目录,供验证步骤用 python/Word 实测可打开(端到端取证)。
        let z = render_docx(&sample());
        let p = std::env::temp_dir().join("seeker_resume_smoke.docx");
        std::fs::write(&p, &z).unwrap();
        assert!(std::fs::metadata(&p).unwrap().len() > 300);
    }
}
