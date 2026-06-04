//! 密钥保管(安全红线 · #4 S1)。
//!
//! API Key 等密钥**只进系统钥匙串**(Win 凭据管理器 / macOS Keychain),
//! 平台核短暂取用、用完即弃,**永不进前端、永不落明文文件、永不入日志**。
//!
//! 关键:对外暴露给前端的只有 `secret_set / secret_status / secret_clear` ——
//! **没有任何命令返回密钥明文**。`get` 仅为本进程内部(AI 网关)提供,非 `#[tauri::command]`,
//! 故前端无法 invoke → 明文从命令层面就拿不到。

use keyring::{Entry, Error as KeyringError};

/// 钥匙串 service 名(用 bundle identifier,避免与其它应用冲突)。
const SERVICE: &str = "dev.zhapar.seeker";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// 写入密钥(用户在设置页填写 → 直送钥匙串)。
#[tauri::command]
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

/// 前端只能查「是否已配置」,拿不到明文。
#[tauri::command]
pub fn secret_status(account: String) -> Result<String, String> {
    match entry(&account)?.get_password() {
        Ok(_) => Ok("configured".into()),
        Err(KeyringError::NoEntry) => Ok("empty".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_clear(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// **仅供平台核内部**(AI 网关)取用;不是命令,前端无法调用。
/// 调用方应尽快丢弃返回值(用完即弃)。
pub fn get_secret(account: &str) -> Result<String, String> {
    entry(account)?.get_password().map_err(|e| e.to_string())
}
