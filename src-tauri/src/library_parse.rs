//! Local parser, also run in a child process so the parent can enforce a hard timeout.
//! No model, network, database or arbitrary filesystem paths are reachable here.
use base64::Engine;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Read, Write},
    time::{Duration, Instant},
};

pub(crate) const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const MAX_BASE64: usize = MAX_FILE_BYTES.div_ceil(3) * 4;
pub(crate) const MAX_CHARS: usize = 30_000;
pub(crate) const PARSE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_ZIP_ENTRIES: usize = 1000;
const MAX_ZIP_EXPANDED: u64 = 64 * 1024 * 1024;
const MAX_DOCUMENT_XML: u64 = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Fragment {
    pub id: String,
    pub text: String,
    pub page: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParsedDocument {
    pub format: String,
    pub characters: usize,
    pub fragments: Vec<Fragment>,
    pub warnings: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ParserInput {
    pub name: String,
    pub data_base64: String,
}
#[derive(Deserialize, Serialize)]
pub(crate) struct ParserReply {
    pub document: Option<ParsedDocument>,
    pub error: Option<String>,
}

pub(crate) fn decode(input: &ParserInput) -> Result<Vec<u8>, String> {
    if input.name.is_empty() || input.name.len() > 512 {
        return Err("文件名无效 / Invalid filename".into());
    }
    if input.data_base64.len() > MAX_BASE64 {
        return Err("文件超过 10 MB / File exceeds 10 MB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|_| "文件数据损坏 / Invalid file data")?;
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("文件为空或超过 10 MB / Empty file or file exceeds 10 MB".into());
    }
    Ok(bytes)
}

fn deadline(start: Instant) -> Result<(), String> {
    if start.elapsed() > PARSE_TIMEOUT {
        Err("文件解析超时 / File parsing timed out".into())
    } else {
        Ok(())
    }
}

pub(crate) fn parse(name: &str, bytes: &[u8]) -> Result<ParsedDocument, String> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("文件为空或超过 10 MB / Empty file or file exceeds 10 MB".into());
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let start = Instant::now();
    let mut warnings = Vec::new();
    let pages =
        match ext.as_str() {
            "txt" | "md" => vec![(None, decode_text(bytes)?)],
            "docx" => vec![(None, docx_text(bytes, start)?)],
            "pdf" => pdf_pages(bytes, start, &mut warnings)?,
            _ => return Err(
                "请选择 TXT、Markdown、文字型 PDF 或 DOCX / Choose TXT, Markdown, text PDF or DOCX"
                    .into(),
            ),
        };
    let mut chars = 0;
    let mut fragments = Vec::new();
    for (page, text) in pages {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        chars += normalized.chars().count();
        if chars > MAX_CHARS {
            return Err("提取文字超过 30,000 字符，请拆分文件 / Extracted text exceeds 30,000 characters. Split the file.".into());
        }
        for chunk in normalized.chars().collect::<Vec<_>>().chunks(800) {
            fragments.push(Fragment {
                id: format!("f{}", fragments.len() + 1),
                text: chunk.iter().collect(),
                page,
            });
        }
    }
    if fragments.iter().all(|f| f.text.trim().is_empty()) {
        return Err("未提取到文字；PDF 可能是扫描件或图片 / No text extracted; the PDF may be scanned or image-only".into());
    }
    deadline(start)?;
    Ok(ParsedDocument {
        format: ext,
        characters: chars,
        fragments,
        warnings,
    })
}

fn decode_text(bytes: &[u8]) -> Result<String, String> {
    let value = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if bytes.len() % 2 != 0 {
            return Err("UTF-16 文件不完整 / Incomplete UTF-16 file".into());
        }
        let little = bytes[0] == 0xff;
        let words: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| {
                if little {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        String::from_utf16(&words)
            .map_err(|_| "无法解码文字，请另存为 UTF-8 / Save this text as UTF-8")?
    } else {
        std::str::from_utf8(bytes)
            .map_err(|_| "无法解码文字，请另存为 UTF-8 / Save this text as UTF-8")?
            .trim_start_matches('\u{feff}')
            .to_string()
    };
    if value.contains('\0') {
        return Err(
            "文件含二进制数据，无法作为文字读取 / Binary data cannot be read as text".into(),
        );
    }
    Ok(value)
}

fn docx_text(bytes: &[u8], start: Instant) -> Result<String, String> {
    if bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) {
        return Err("DOCX 已加密或属于旧版 Word 格式，请另存为未加密 DOCX / Encrypted or legacy Word file. Save as unencrypted DOCX.".into());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "DOCX 损坏或不是有效文件 / Damaged or invalid DOCX")?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("DOCX 内部条目过多 / Too many entries in DOCX".into());
    }
    let mut expanded = 0u64;
    let mut has_document = false;
    for i in 0..archive.len() {
        deadline(start)?;
        let entry = archive
            .by_index(i)
            .map_err(|_| "DOCX 损坏或已加密 / Damaged or encrypted DOCX")?;
        if entry.encrypted() {
            return Err("不支持加密 DOCX / Encrypted DOCX is unsupported".into());
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("DOCX 解压体积过大 / DOCX expansion exceeds limit")?;
        if expanded > MAX_ZIP_EXPANDED {
            return Err("DOCX 解压体积超过 64 MB / DOCX expansion exceeds 64 MB".into());
        }
        if entry.name() == "word/document.xml" {
            if has_document || entry.size() > MAX_DOCUMENT_XML || entry.is_symlink() {
                return Err(
                    "DOCX 正文重复、过大或无效 / Duplicate, oversized or invalid DOCX body".into(),
                );
            }
            has_document = true;
        }
    }
    if !has_document {
        return Err("DOCX 缺少正文 / DOCX body is missing".into());
    }
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| "DOCX 正文不可读 / Unreadable DOCX body")?
        .take(MAX_DOCUMENT_XML + 1)
        .read_to_string(&mut xml)
        .map_err(|_| "DOCX 正文损坏 / Damaged DOCX body")?;
    if xml.len() as u64 > MAX_DOCUMENT_XML {
        return Err("DOCX 正文过大 / DOCX body exceeds limit".into());
    }
    let mut reader = Reader::from_str(&xml);
    let mut text = String::new();
    let mut in_text = false;
    let mut in_body = false;
    let mut seen_body = false;
    loop {
        deadline(start)?;
        match reader
            .read_event()
            .map_err(|_| "DOCX XML 损坏 / Damaged DOCX XML")?
        {
            Event::Start(e) => match e.local_name().as_ref() {
                b"body" => {
                    in_body = true;
                    seen_body = true;
                }
                b"t" if in_body => in_text = true,
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                b"body" => in_body = false,
                b"t" => in_text = false,
                b"p" | b"tr" if in_body => text.push('\n'),
                b"tc" if in_body => text.push('\t'),
                _ => {}
            },
            Event::Empty(e) if in_body => match e.local_name().as_ref() {
                b"tab" => text.push('\t'),
                b"br" | b"cr" => text.push('\n'),
                _ => {}
            },
            Event::Text(e) if in_text => text.push_str(
                &e.xml_content()
                    .map_err(|_| "DOCX 文字编码无效 / Invalid DOCX text encoding")?,
            ),
            Event::CData(e) if in_text => text.push_str(
                &e.decode()
                    .map_err(|_| "DOCX 文字编码无效 / Invalid DOCX text encoding")?,
            ),
            Event::GeneralRef(e) if in_text => {
                if let Some(c) = e
                    .resolve_char_ref()
                    .map_err(|_| "DOCX 字符引用无效 / Invalid DOCX character reference")?
                {
                    text.push(c);
                } else {
                    let name = e
                        .decode()
                        .map_err(|_| "DOCX 实体无效 / Invalid DOCX entity")?;
                    text.push_str(match name.as_ref() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "apos" => "'",
                        "quot" => "\"",
                        _ => {
                            return Err(
                                "不支持 DOCX 自定义实体 / Custom DOCX entities are unsupported"
                                    .into(),
                            )
                        }
                    });
                }
            }
            Event::DocType(_) => {
                return Err("不支持包含 DTD 的 DOCX / DOCX with DTD is unsupported".into())
            }
            Event::Eof => break,
            _ => {}
        }
        // Fast byte bound caps allocation before the final Unicode character check.
        if text.len() > MAX_CHARS * 4 {
            return Err(
                "提取文字过长，请拆分文件 / Extracted text is too long. Split the file.".into(),
            );
        }
    }
    if !seen_body || in_body || in_text {
        return Err("DOCX 正文结构不完整 / Incomplete DOCX body".into());
    }
    Ok(text)
}

struct LimitedOutput {
    bytes: Vec<u8>,
    max: usize,
}
impl Write for LimitedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len() + bytes.len() > self.max {
            return Err(std::io::Error::other("PDF extracted text exceeds limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn pdf_pages(
    bytes: &[u8],
    start: Instant,
    warnings: &mut Vec<String>,
) -> Result<Vec<(Option<u32>, String)>, String> {
    if !bytes.starts_with(b"%PDF-") {
        return Err("不是有效的 PDF / Invalid PDF".into());
    }
    let doc = lopdf::Document::load_mem(bytes)
        .map_err(|_| "PDF 损坏或无法解析 / Damaged or unreadable PDF")?;
    // Reject even malformed/direct encryption dictionaries: absence of a resolvable
    // reference is not proof that the source is unencrypted.
    if doc.trailer.has(b"Encrypt") {
        return Err("不支持加密 PDF，请先解密 / Decrypt the PDF before importing".into());
    }
    let pages = doc.get_pages();
    if pages.is_empty() || pages.len() > 200 {
        return Err("PDF 无页面或超过 200 页，请拆分文件 / Empty PDF or more than 200 pages. Split the file.".into());
    }
    let mut result = Vec::new();
    let mut characters = 0;
    for number in pages.keys() {
        deadline(start)?;
        let mut output = LimitedOutput {
            bytes: Vec::new(),
            max: (MAX_CHARS - characters) * 4,
        };
        let mut writer = pdf_extract::PlainTextOutput::new(&mut output as &mut dyn Write);
        pdf_extract::output_doc_page(&doc,&mut writer,*number).map_err(|_|"PDF 页面无法完整提取或文字超限 / A PDF page could not be fully extracted or text exceeds the limit")?;
        let text = String::from_utf8(output.bytes)
            .map_err(|_| "PDF 文字编码无效 / Invalid PDF text encoding")?;
        characters += text.chars().count();
        if characters > MAX_CHARS {
            return Err("提取文字超过 30,000 字符，请拆分 PDF / Extracted text exceeds 30,000 characters. Split the PDF.".into());
        }
        if text.trim().is_empty() {
            warnings.push(format!("第 {number} 页未提取到文字（可能为空白或图片） / No text on page {number} (possibly blank or image-only)"));
        }
        result.push((Some(*number), text));
    }
    Ok(result)
}

/// The child accepts one bounded JSON request on stdin and emits one JSON reply on stdout.
pub(crate) fn cli() {
    let outcome = std::panic::catch_unwind(|| -> Result<ParsedDocument, String> {
        let mut input = String::new();
        std::io::stdin()
            .take((MAX_BASE64 + 2049) as u64)
            .read_to_string(&mut input)
            .map_err(|_| "无法读取文件 / Could not read file")?;
        if input.len() > MAX_BASE64 + 2048 {
            return Err("文件数据过大 / Oversized file data".into());
        }
        let input: ParserInput =
            serde_json::from_str(&input).map_err(|_| "文件请求无效 / Invalid file request")?;
        parse(&input.name, &decode(&input)?)
    })
    .unwrap_or_else(|_| {
        Err("解析失败，文件可能损坏 / Parsing failed; the file may be damaged".into())
    });
    let reply = match outcome {
        Ok(document) => ParserReply {
            document: Some(document),
            error: None,
        },
        Err(error) => ParserReply {
            document: None,
            error: Some(error),
        },
    };
    let _ = serde_json::to_writer(std::io::stdout(), &reply);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pdf(text: Option<&str>, encrypted: bool) -> Vec<u8> {
        use lopdf::{
            content::{Content, Operation},
            dictionary, Document, Object, Stream,
        };
        let mut doc = Document::with_version("1.5");
        let pages = doc.new_object_id();
        let font =
            doc.add_object(dictionary! {"Type"=>"Font", "Subtype"=>"Type1", "BaseFont"=>"Courier"});
        let operations = text
            .map(|s| {
                vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("Td", vec![20.into(), 100.into()]),
                    Operation::new("Tj", vec![Object::string_literal(s)]),
                    Operation::new("ET", vec![]),
                ]
            })
            .unwrap_or_default();
        let content = doc.add_object(Stream::new(
            dictionary! {},
            Content { operations }.encode().unwrap(),
        ));
        let page =
            doc.add_object(dictionary! {"Type"=>"Page", "Parent"=>pages, "Contents"=>content});
        doc.objects.insert(pages, dictionary! {"Type"=>"Pages", "Kids"=>vec![Object::Reference(page)], "Count"=>1, "Resources"=>dictionary! {"Font"=>dictionary! {"F1"=>font}}, "MediaBox"=>vec![0.into(), 0.into(), 300.into(), 200.into()]}.into());
        let root = doc.add_object(dictionary! {"Type"=>"Catalog", "Pages"=>pages});
        doc.trailer.set("Root", root);
        if encrypted {
            doc.trailer.set(
                "Encrypt",
                dictionary! {"Filter"=>"Standard", "V"=>1, "R"=>2},
            );
        }
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }
    #[test]
    fn pdf_text_has_real_page_and_empty_encrypted_corrupt_files_fail() {
        let parsed = parse("source.pdf", &pdf(Some("The price is 120."), false)).unwrap();
        assert!(parsed.fragments.iter().all(|f| f.page == Some(1)));
        assert!(parsed
            .fragments
            .iter()
            .any(|f| f.text.contains("The price is 120.")));
        assert!(parse("image.pdf", &pdf(None, false))
            .unwrap_err()
            .contains("未提取到文字"));
        assert!(parse("encrypted.pdf", &pdf(Some("private"), true)).is_err());
        assert!(parse("broken.pdf", b"%PDF-1.5\nbroken").is_err());
        assert!(parse("long.pdf", &pdf(Some(&"a".repeat(MAX_CHARS + 1)), false)).is_err());
    }
    fn docx(xml: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn text_and_unicode_fragments_retain_all_input() {
        let text = "中文🍊\n".repeat(600);
        let doc = parse("text.md", text.as_bytes()).unwrap();
        assert_eq!(
            doc.fragments
                .iter()
                .map(|f| f.text.as_str())
                .collect::<String>(),
            text
        );
        assert!(doc.fragments.len() > 1);
        assert!(doc.fragments.iter().all(|f| f.page.is_none()));
        assert!(parse("text.txt", "a".repeat(MAX_CHARS + 1).as_bytes()).is_err());
        assert!(parse("binary.txt", b"a\0b").is_err());
        assert!(parse("empty.txt", b" \n").is_err());
        assert!(parse("unsafe.html", b"text").is_err());
    }
    #[test]
    fn docx_paragraphs_tables_and_entities_are_extracted_as_text() {
        let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alpha &amp; Beta &#x1F34A;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let text = parse("test.docx", &docx(xml))
            .unwrap()
            .fragments
            .into_iter()
            .map(|f| f.text)
            .collect::<String>();
        assert!(text.contains("Alpha & Beta 🍊"));
        assert!(text.contains("Cell one"));
        assert!(text.contains("Cell two"));
        assert!(text.contains('\t'));
        assert!(parse("bad.docx", b"not zip").is_err());
        assert!(parse("encrypted.docx", &[0xd0, 0xcf, 0x11, 0xe0])
            .unwrap_err()
            .contains("加密"));
        assert!(parse("bad.docx",&docx("<!DOCTYPE x [<!ENTITY p SYSTEM 'file:///private'>]><w:body><w:t>&p;</w:t></w:body>")).is_err());
        assert!(parse("bad.docx", &docx("<w:body><w:t>unfinished")).is_err());
    }
    #[test]
    fn docx_rejects_zip_bomb_and_excess_entries_before_expansion() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(&vec![b'x'; (MAX_DOCUMENT_XML + 1) as usize])
            .unwrap();
        assert!(parse("large.docx", &zip.finish().unwrap().into_inner()).is_err());
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for i in 0..=MAX_ZIP_ENTRIES {
            zip.start_file(format!("{i}"), options).unwrap();
        }
        assert!(parse("entries.docx", &zip.finish().unwrap().into_inner()).is_err());
    }
}
