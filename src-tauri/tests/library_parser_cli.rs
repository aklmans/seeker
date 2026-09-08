//! Exercise the same compiled, non-GUI parser mode used by desktop file import.
use base64::Engine;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn parse(name: &str, bytes: &[u8]) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_app"))
        .arg("--seeker-parse-library")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let request =
        json!({"name":name,"dataBase64":base64::engine::general_purpose::STANDARD.encode(bytes)});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.to_string().as_bytes())
        .unwrap();
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if started.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            panic!("compiled parser did not return");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    serde_json::from_str(&output).unwrap()
}

#[test]
fn executable_parses_without_opening_gui_and_returns_typed_errors() {
    let result = parse("example.md", "本地正文 🍊\nSecond line".as_bytes());
    assert!(result["error"].is_null());
    assert_eq!(
        result["document"]["fragments"][0]["text"],
        "本地正文 🍊\nSecond line"
    );
    for (name, bytes) in [
        ("empty.txt", b"".as_slice()),
        ("broken.pdf", b"%PDF-1.5 broken".as_slice()),
        ("broken.docx", b"bad zip".as_slice()),
        ("unsupported.exe", b"content".as_slice()),
    ] {
        let result = parse(name, bytes);
        assert!(result["document"].is_null());
        assert!(result["error"].as_str().is_some_and(|s| !s.is_empty()));
    }
}
