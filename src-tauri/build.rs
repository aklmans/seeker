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
    tauri_build::build();
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
