//! Validated image exports; file type and destination are fixed by the platform.
use base64::{engine::general_purpose::STANDARD, Engine};
use lopdf::{dictionary, Document, Object, Stream};
use std::{borrow::Cow, io::Cursor};
use tauri::AppHandle;

struct DecodedPng {
    bytes: Vec<u8>,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}
fn decode(data_url: &str) -> Result<DecodedPng, String> {
    if data_url.len() > 32_000_000 {
        return Err("图片过大 / Image too large".into());
    }
    let body = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or("仅支持 PNG / PNG required")?;
    let bytes = STANDARD.decode(body).map_err(|e| e.to_string())?;
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let (width, height) = (reader.info().width, reader.info().height);
    if width == 0
        || height == 0
        || width > 4800
        || height > 32000
        || u64::from(width) * u64::from(height) > 24_000_000
    {
        return Err("图片尺寸超出限制 / Image dimensions exceed limits".into());
    }
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
    let pixels = &buffer[..info.buffer_size()];
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    match info.color_type {
        png::ColorType::Rgba => rgba.extend_from_slice(pixels),
        png::ColorType::Rgb => {
            for p in pixels.chunks_exact(3) {
                rgba.extend_from_slice(&[p[0], p[1], p[2], 255]);
            }
        }
        png::ColorType::Grayscale => {
            for p in pixels {
                rgba.extend_from_slice(&[*p, *p, *p, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for p in pixels.chunks_exact(2) {
                rgba.extend_from_slice(&[p[0], p[0], p[0], p[1]]);
            }
        }
        _ => return Err("不支持的图片编码 / Unsupported PNG encoding".into()),
    }
    if rgba.len() != width as usize * height as usize * 4 {
        return Err("图片解码不完整 / Incomplete PNG".into());
    }
    Ok(DecodedPng {
        bytes,
        rgba,
        width,
        height,
    })
}

fn pdf(image: &DecodedPng) -> Result<Vec<u8>, String> {
    let mut rgb = Vec::with_capacity(image.width as usize * image.height as usize * 3);
    for pixel in image.rgba.chunks_exact(4) {
        let alpha = u32::from(pixel[3]);
        for &channel in &pixel[..3] {
            rgb.push(((u32::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8);
        }
    }
    let mut document = Document::with_version("1.4");
    let pages = document.new_object_id();
    let mut stream = Stream::new(
        dictionary! {"Type"=>"XObject","Subtype"=>"Image","Width"=>image.width,"Height"=>image.height,"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8},
        rgb,
    );
    stream.compress().map_err(|e| e.to_string())?;
    let image_id = document.add_object(stream);
    let width = 595.28_f32.min(14400.0 * image.width as f32 / image.height as f32);
    let height = width * image.height as f32 / image.width as f32;
    let content = document.add_object(Stream::new(
        dictionary! {},
        format!("q {width} 0 0 {height} 0 0 cm /Im0 Do Q").into_bytes(),
    ));
    let page=document.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),Object::Real(width),Object::Real(height)],"Resources"=>dictionary!{"XObject"=>dictionary!{"Im0"=>image_id}},"Contents"=>content});
    document.objects.insert(
        pages,
        dictionary! {"Type"=>"Pages","Kids"=>vec![page.into()],"Count"=>1}.into(),
    );
    let root = document.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
    document.trailer.set("Root", root);
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).map_err(|e| e.to_string())?;
    if Document::load_mem(&bytes)
        .map_err(|e| e.to_string())?
        .get_pages()
        .len()
        != 1
    {
        return Err("PDF 校验失败 / PDF verification failed".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn export_creation_image(
    app: AppHandle,
    title: String,
    png_data_url: String,
    format: String,
) -> Result<String, String> {
    if !["png", "pdf"].contains(&format.as_str()) {
        return Err("不支持的导出格式 / Unsupported format".into());
    }
    let image = decode(&png_data_url)?;
    let bytes = if format == "pdf" {
        pdf(&image)?
    } else {
        image.bytes
    };
    crate::exports::export_verified_document(&app, &title, &format, &bytes)
}

#[tauri::command]
pub fn copy_creation_image(png_data_url: String) -> Result<(), String> {
    let image = decode(&png_data_url)?;
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: image.width as usize,
            height: image.height as usize,
            bytes: Cow::Owned(image.rgba),
        })
        .map_err(|e| e.to_string())
}

fn validate_svg(svg: &str) -> Result<(), String> {
    use quick_xml::{events::Event, Reader};
    let error = "不支持的 SVG 内容 / Unsupported SVG content";
    if svg.is_empty() || svg.len() > 2_000_000 || svg.contains("<!") || svg.contains("<?") {
        return Err(error.into());
    }
    let mut reader = Reader::from_str(svg);
    let mut depth = 0;
    let mut seen = false;
    loop {
        match reader.read_event().map_err(|_| error)? {
            event @ (Event::Start(_) | Event::Empty(_)) => {
                let empty = matches!(event, Event::Empty(_));
                let e = match event {
                    Event::Start(e) | Event::Empty(e) => e,
                    _ => unreachable!(),
                };
                let name = e.name();
                let name = std::str::from_utf8(name.as_ref()).map_err(|_| error)?;
                if depth == 0 {
                    if seen || name != "svg" {
                        return Err(error.into());
                    }
                    seen = true;
                }
                if !["svg", "g", "rect", "path", "text", "tspan"].contains(&name) {
                    return Err(error.into());
                }
                for attr in e.attributes() {
                    let attr = attr.map_err(|_| error)?;
                    let key = std::str::from_utf8(attr.key.as_ref()).map_err(|_| error)?;
                    if ![
                        "xmlns",
                        "width",
                        "height",
                        "viewBox",
                        "x",
                        "y",
                        "rx",
                        "fill",
                        "stroke",
                        "stroke-width",
                        "stroke-dasharray",
                        "font-family",
                        "font-size",
                        "text-anchor",
                        "d",
                        "data-mind-node",
                        "tabindex",
                        "role",
                        "aria-label",
                    ]
                    .contains(&key)
                    {
                        return Err(error.into());
                    }
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| error)?;
                    if (key == "xmlns" && value != "http://www.w3.org/2000/svg")
                        || (["fill", "stroke"].contains(&key)
                            && value != "none"
                            && !(value.len() == 7
                                && value.starts_with('#')
                                && value[1..].bytes().all(|b| b.is_ascii_hexdigit())))
                    {
                        return Err(error.into());
                    }
                }
                if !empty {
                    depth += 1;
                    if depth > 32 {
                        return Err(error.into());
                    }
                }
            }
            Event::End(_) => {
                if depth == 0 {
                    return Err(error.into());
                }
                depth -= 1;
            }
            Event::Text(t) => {
                if depth == 0 && !t.iter().all(u8::is_ascii_whitespace) {
                    return Err(error.into());
                }
            }
            Event::GeneralRef(reference) => {
                let name: &[u8] = reference.as_ref();
                if depth == 0
                    || (!matches!(name, b"lt" | b"gt" | b"amp" | b"quot" | b"apos")
                        && reference.resolve_char_ref().map_err(|_| error)?.is_none())
                {
                    return Err(error.into());
                }
            }
            Event::Eof => {
                return if seen && depth == 0 {
                    Ok(())
                } else {
                    Err(error.into())
                }
            }
            _ => return Err(error.into()),
        }
    }
}

#[tauri::command]
pub fn export_creation_svg(app: AppHandle, title: String, svg: String) -> Result<String, String> {
    validate_svg(&svg)?;
    crate::exports::export_verified_document(&app, &title, "svg", svg.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png_url() -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 2);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&[
                    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255,
                ])
                .unwrap();
        }
        format!("data:image/png;base64,{}", STANDARD.encode(bytes))
    }
    #[test]
    fn png_decodes_and_pdf_contains_only_local_raster() {
        let image = decode(&png_url()).unwrap();
        assert_eq!((image.width, image.height), (2, 2));
        assert_eq!(image.rgba.len(), 16);
        let bytes = pdf(&image).unwrap();
        let doc = Document::load_mem(&bytes).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        assert!(doc.objects.values().any(|o| o.as_stream().is_ok_and(|s| s
            .dict
            .get(b"Subtype")
            .is_ok_and(|v| v.as_name().is_ok_and(|name| name == b"Image")))));
        assert!(decode("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(decode("data:image/png;base64,bm90LXB uZw==").is_err());
        let truncated = png_url();
        assert!(decode(&truncated[..truncated.len() - 20]).is_err());
    }
    #[test]
    fn svg_keeps_plain_labels_but_never_active_content() {
        assert!(validate_svg("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"400\"><rect fill=\"#ffffff\"/><g data-mind-node=\"n_a\"><text>&lt;script&gt;中文</text></g></svg>").is_ok());
        for bad in [
            "<svg><text>&unknown;</text></svg>",
            "<svg><text>&#xZZ;</text></svg>",
            "<svg><script>alert(1)</script></svg>",
            "<svg onload=\"alert(1)\"/>",
            "<svg><image href=\"https://example.com\"/></svg>",
            "<svg><rect fill=\"url(https://example.com)\"/></svg>",
            "<!DOCTYPE svg><svg/>",
            "<svg><g></svg>",
            "<svg/><svg/>",
        ] {
            assert!(validate_svg(bad).is_err(), "{bad}");
        }
    }
}
