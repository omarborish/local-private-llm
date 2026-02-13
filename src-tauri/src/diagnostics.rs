//! Diagnostic logging: emit events to frontend and persist to app data dir with rotation.

use serde::Serialize;
use tauri::Emitter;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

const LOG_DIR_NAME: &str = "Local Private LLM";
const LOG_SUBDIR: &str = "logs";
const LOG_FILE: &str = "app.log";
const ROTATE_SIZE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB

#[derive(Clone, Debug, Serialize)]
pub struct DiagnosticPayload {
    pub ts: u64,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

fn log_dir() -> Option<PathBuf> {
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.join(LOG_DIR_NAME).join(LOG_SUBDIR))
}

fn ensure_log_dir() -> Option<PathBuf> {
    let dir = log_dir()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

fn log_path() -> Option<PathBuf> {
    ensure_log_dir().map(|d| d.join(LOG_FILE))
}

fn rotate_if_needed(path: &PathBuf) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() >= ROTATE_SIZE_BYTES {
            let old = path.with_extension("log.old");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(path, &old);
        }
    }
}

fn write_to_file(payload: &DiagnosticPayload) {
    let path = match log_path() {
        Some(p) => p,
        None => return,
    };
    rotate_if_needed(&path);
    let line = if let Some(ref m) = payload.meta {
        format!("{} [{}] {} {}\n", payload.ts, payload.level, payload.message, m)
    } else {
        format!("{} [{}] {}\n", payload.ts, payload.level, payload.message)
    };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Emit diagnostic log to frontend and persist to logs/app.log.
/// window: use for emitting; if None, only file log (e.g. before window exists).
pub fn log(
    window: Option<&tauri::Window>,
    level: &str,
    message: &str,
    meta: Option<serde_json::Value>,
) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let payload = DiagnosticPayload {
        ts,
        level: level.to_string(),
        message: message.to_string(),
        meta: meta.clone(),
    };
    write_to_file(&payload);
    if let Some(w) = window {
        let _ = w.emit("diagnostic-log", &payload);
    }
}
