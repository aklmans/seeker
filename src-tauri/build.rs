use std::path::Path;
use std::time::UNIX_EPOCH;

/// ★前端热嵌修复(真机反馈:改 `web/` 后 `cargo run` 仍嵌旧资产、页面停留在几十轮前)。
///
/// 根因:Tauri 的 `generate_context!` 把 `frontendDist`(`../web`)在**编译期**嵌进二进制,
/// 但在 **stable Rust** 上无法用 `proc_macro::tracked_path`(nightly-only)告诉 cargo「资产变了要重编译」。
/// 本项目又没有 `devUrl`、一直走嵌入资产 ⇒ 只改前端文件时 cargo 认为 `src-tauri` 输入没变、
/// 复用旧 crate 编译产物、`generate_context!` 不重跑 ⇒ 二进制里是旧前端。
///
/// 修法(两步,缺一不可):
///   ① 递归声明 `rerun-if-changed`(文件 + 目录)⇒ 改/增删 `web/` 任意文件都会重跑本 build 脚本;
///   ② 把前端指纹(路径+mtime 的哈希)经 `rustc-env` 暴露给 `lib.rs`(它 `env!` 依赖它)⇒
///      指纹变 → `lib.rs` 必须重编译 → `generate_context!` 重读 `../web` 重嵌资产。
/// 前端未变时指纹不变、build 脚本不重跑 ⇒ 零额外开销(不会每次 `cargo run` 白重编)。
fn main() {
    let mut fp = String::new();
    track(Path::new("../web"), &mut fp);
    println!("cargo:rustc-env=SEEKER_WEB_FP={:016x}", fnv1a(&fp));
    println!("cargo:rerun-if-changed=build.rs");

    let attributes = if is_windows_msvc_target() {
        // `tauri-build` 默认把 Common Controls v6 manifest 只链接到应用 binary，
        // 不会链接到 `cargo test` 生成的 lib test harness；一旦启用 `tauri/test`，
        // harness 会在进入 Rust 测试前因缺少该依赖而报 STATUS_ENTRYPOINT_NOT_FOUND。
        // 手动传给 rustc 可覆盖所有本包产物；同时关闭 tauri-build 的默认 manifest，
        // 避免正式应用 binary 重复嵌入。上游问题：tauri-apps/tauri#13419。
        embed_windows_manifest();
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
    } else {
        tauri_build::Attributes::new()
    };

    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}

fn is_windows_msvc_target() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

fn embed_windows_manifest() {
    const WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

    let manifest = std::env::current_dir()
        .expect("failed to resolve the crate directory")
        .join(WINDOWS_MANIFEST_FILE);
    assert!(
        manifest.is_file(),
        "Windows application manifest is missing: {}",
        manifest.display()
    );

    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    println!("cargo:rustc-link-arg=/WX");
}

/// 递归:声明目录(捕获增删文件的 mtime 变化)与每个文件的 rerun-if-changed,并把文件路径+mtime 累进指纹。
fn track(dir: &Path, fp: &mut String) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut list: Vec<_> = entries.flatten().collect();
    list.sort_by_key(std::fs::DirEntry::path); // 稳定序 ⇒ 指纹确定性(与遍历顺序无关)
    for e in list {
        let p = e.path();
        if p.is_dir() {
            track(&p, fp);
        } else {
            println!("cargo:rerun-if-changed={}", p.display());
            if let Ok(ms) = e
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis())
            {
                fp.push_str(&p.to_string_lossy());
                fp.push(':');
                fp.push_str(&ms.to_string());
                fp.push('\n');
            }
        }
    }
}

/// FNV-1a 64-bit(std-only、无依赖;够做变更指纹、非密码学用途)。
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}
