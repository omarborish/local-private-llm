mod diagnostics;
mod gpu;
mod mcp;
mod ollama;
mod provider;
mod storage;

pub use ollama::OllamaClient;
pub use storage::Storage;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use thiserror::Error;
use tokio::sync::oneshot;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Storage error: {0}")]
    Storage(#[from] storage::StorageError),
    #[error("Ollama error: {0}")]
    Ollama(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("MCP tool error: {0}")]
    Mcp(#[from] mcp::McpToolError),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub ollama: OllamaClient,
    /// Sender to cancel the current chat stream. Set when stream starts, taken when cancel is requested.
    pub chat_cancel_tx: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationDto {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageDto {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsDto {
    pub theme: String,
    pub selected_model: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_tokens: i64,
    #[serde(default = "default_tool_calling_mode")]
    pub tool_calling_mode: bool,
    #[serde(default = "default_inference_device_preference")]
    pub inference_device_preference: String,
}

fn default_inference_device_preference() -> String {
    "auto".to_string()
}

fn default_tool_calling_mode() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpSettingsDto {
    pub filesystem_enabled: bool,
    pub filesystem_root: String,
    pub obsidian_enabled: bool,
    pub obsidian_vault_path: String,
    pub web_search_enabled: bool,
    pub terminal_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
    pub risk: String,
    pub json_schema: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticStepDto {
    pub level: String,
    pub message: String,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpToolResultDto {
    pub ok: bool,
    pub content: String,
    pub error: Option<String>,
    #[serde(default)]
    pub diagnostic_steps: Option<Vec<DiagnosticStepDto>>,
}

#[tauri::command]
fn get_conversations(state: State<AppState>) -> Result<Vec<ConversationDto>, AppError> {
    let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let convos = storage.list_conversations()?;
    Ok(convos
        .into_iter()
        .map(|c| ConversationDto {
            id: c.id,
            title: c.title,
            created_at: c.created_at,
            updated_at: c.updated_at,
            message_ids: c.message_ids,
        })
        .collect())
}

#[tauri::command]
fn get_conversation(state: State<AppState>, id: String) -> Result<Option<(ConversationDto, Vec<MessageDto>)>, AppError> {
    let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let out = storage.get_conversation_with_messages(&id)?;
    Ok(out.map(|(c, msgs)| {
        (
            ConversationDto {
                id: c.id,
                title: c.title,
                created_at: c.created_at,
                updated_at: c.updated_at,
                message_ids: c.message_ids,
            },
            msgs.into_iter()
                .map(|m| MessageDto {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                })
                .collect(),
        )
    }))
}

#[tauri::command]
fn create_conversation(state: State<AppState>, title: Option<String>) -> Result<ConversationDto, AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let title = title.unwrap_or_else(|| "New chat".to_string());
    let c = storage.create_conversation(&title)?;
    Ok(ConversationDto {
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_ids: c.message_ids,
    })
}

#[tauri::command]
fn update_conversation_title(state: State<AppState>, id: String, title: String) -> Result<(), AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    storage.update_conversation_title(&id, &title)?;
    Ok(())
}

#[tauri::command]
fn delete_conversation(state: State<AppState>, id: String) -> Result<(), AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    storage.delete_conversation(&id)?;
    Ok(())
}

#[tauri::command]
fn add_message(
    state: State<AppState>,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<MessageDto, AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let m = storage.add_message(&conversation_id, &role, &content)?;
    Ok(MessageDto {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
    })
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<SettingsDto, AppError> {
    let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let s = storage.get_settings()?;
    Ok(SettingsDto {
        theme: s.theme,
        selected_model: s.selected_model,
        system_prompt: s.system_prompt,
        temperature: s.temperature,
        max_tokens: s.max_tokens,
        tool_calling_mode: s.tool_calling_mode,
        inference_device_preference: s.inference_device_preference,
    })
}

#[tauri::command]
fn save_settings(
    state: State<AppState>,
    settings: SettingsDto,
    window: tauri::Window,
) -> Result<(), AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let prev = storage.get_settings().ok().map(|s| s.selected_model);
    let pref = settings
        .inference_device_preference
        .trim();
    let inference_device_preference = if matches!(pref, "auto" | "prefer_gpu" | "force_cpu") {
        pref.to_string()
    } else {
        "auto".to_string()
    };
    storage.save_settings(storage::Settings {
        theme: settings.theme,
        selected_model: settings.selected_model.clone(),
        system_prompt: settings.system_prompt,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
        tool_calling_mode: settings.tool_calling_mode,
        inference_device_preference,
    })?;
    if prev.as_deref() != Some(settings.selected_model.as_str()) {
        diagnostics::log(
            Some(&window),
            "INFO",
            "active_model change",
            Some(serde_json::json!({ "active_model": settings.selected_model })),
        );
    }
    Ok(())
}

#[tauri::command]
async fn ollama_health(state: State<'_, AppState>, window: tauri::Window) -> Result<bool, AppError> {
    let result = state.ollama.health().await;
    match &result {
        Ok(ok) => diagnostics::log(
            Some(&window),
            "INFO",
            "ollama health",
            Some(serde_json::json!({ "ok": *ok })),
        ),
        Err(e) => diagnostics::log(
            Some(&window),
            "WARN",
            "ollama health error",
            Some(serde_json::json!({ "error": e.to_string() })),
        ),
    }
    result.map_err(AppError::Ollama)
}

#[tauri::command]
async fn ollama_list_models(state: State<'_, AppState>) -> Result<Vec<ollama::ModelInfo>, AppError> {
    state.ollama.list_models().await.map_err(AppError::Ollama)
}

#[derive(Clone, Serialize)]
struct ModelPullProgressPayload {
    tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<u64>,
}

#[tauri::command]
async fn ollama_pull_model(
    state: State<'_, AppState>,
    model: String,
    window: tauri::Window,
) -> Result<(), AppError> {
    let tag = model.clone();
    let _ = window.emit(
        "model-pull-start",
        serde_json::json!({ "tag": tag }),
    );
    diagnostics::log(
        Some(&window),
        "INFO",
        "model pull start",
        Some(serde_json::json!({ "model": model })),
    );
    let stream = state.ollama.pull(&model).await.map_err(|e| {
        let _ = window.emit(
            "model-pull-error",
            serde_json::json!({ "tag": tag, "error": e.to_string() }),
        );
        diagnostics::log(
            Some(&window),
            "ERROR",
            "model pull error",
            Some(serde_json::json!({ "error": e })),
        );
        AppError::Ollama(e)
    })?;
    futures_util::pin_mut!(stream);
    let mut last_pct: Option<u64> = None;
    while let Some(evt) = stream.next().await {
        if let Ok(evt) = evt {
            let completed = evt.completed.unwrap_or(0);
            let total = evt.total.unwrap_or(0);
            let percent = if total > 0 { (100 * completed) / total } else { 0 };
            let payload = ModelPullProgressPayload {
                tag: tag.clone(),
                status: evt.status.clone(),
                completed: Some(completed),
                total: Some(total),
                percent: Some(percent),
            };
            let _ = window.emit("model-pull-progress", &payload);
            let _ = window.emit("ollama-pull-progress", &evt);
            if total > 0 && last_pct.map(|p| percent.saturating_sub(p) >= 10).unwrap_or(true) {
                last_pct = Some(percent);
                diagnostics::log(
                    Some(&window),
                    "INFO",
                    "model pull progress",
                    Some(serde_json::json!({ "model": model, "percent": percent, "completed": completed, "total": total })),
                );
            }
        }
    }
    let _ = window.emit(
        "model-pull-done",
        serde_json::json!({ "tag": tag }),
    );
    diagnostics::log(
        Some(&window),
        "INFO",
        "model pull complete",
        Some(serde_json::json!({ "model": model })),
    );
    Ok(())
}

#[tauri::command]
async fn ollama_delete_model(
    state: State<'_, AppState>,
    model: String,
    window: tauri::Window,
) -> Result<(), AppError> {
    diagnostics::log(
        Some(&window),
        "INFO",
        "model delete",
        Some(serde_json::json!({ "model": model })),
    );
    state.ollama.delete_model(&model).await.map_err(AppError::Ollama)
}

#[tauri::command]
async fn ollama_show_model(
    state: State<'_, AppState>,
    model: String,
) -> Result<Option<serde_json::Value>, AppError> {
    state.ollama.show_model(&model).await.map_err(AppError::Ollama)
}

#[derive(Clone, Serialize)]
struct ChatDonePayload {
    canceled: bool,
}

#[tauri::command]
async fn ollama_chat_stream(
    state: State<'_, AppState>,
    model: String,
    messages: Vec<ollama::ChatMessage>,
    options: Option<ollama::ChatOptions>,
    window: tauri::Window,
) -> Result<(), AppError> {
    let inference_preference = state
        .storage
        .lock()
        .ok()
        .and_then(|s| s.get_settings().ok())
        .map(|s| s.inference_device_preference)
        .unwrap_or_else(|| "auto".to_string());
    let gpu_info = gpu::detect_gpu();
    if inference_preference == "force_cpu" {
        diagnostics::log(
            Some(&window),
            "WARN",
            "Force CPU requested but not supported; Ollama-managed mode used.",
            Some(serde_json::json!({
                "message": "Ollama does not support per-request GPU disable. Start Ollama with OLLAMA_NUM_GPU=0 for CPU-only."
            })),
        );
    }
    diagnostics::log(
        Some(&window),
        "INFO",
        "inference request",
        Some(serde_json::json!({
            "inference_device_preference": inference_preference,
            "gpu_detected": gpu_info.detected,
            "gpu_name": gpu_info.name,
            "active_device": "unknown",
            "model": model
        })),
    );
    let stream = state
        .ollama
        .chat_stream(&model, messages.clone(), options.unwrap_or_default())
        .await
        .map_err(|e| {
            diagnostics::log(
                Some(&window),
                "ERROR",
                "chat stream error",
                Some(serde_json::json!({ "error": e })),
            );
            AppError::Ollama(e)
        })?;
    futures_util::pin_mut!(stream);
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    {
        let mut tx = state.chat_cancel_tx.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
        *tx = Some(cancel_tx);
    }
    let start = std::time::Instant::now();
    let mut chunk_count: u32 = 0;
    let mut first_token = true;
    let mut ttft_ms: u64 = 0;
    let mut canceled = false;
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                canceled = true;
                diagnostics::log(Some(&window), "INFO", "chat stream canceled", None);
                break;
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(text)) => {
                        if first_token {
                            first_token = false;
                            ttft_ms = start.elapsed().as_millis() as u64;
                            diagnostics::log(
                                Some(&window),
                                "INFO",
                                "first token received",
                                Some(serde_json::json!({ "time_to_first_token_ms": ttft_ms })),
                            );
                        }
                        chunk_count += 1;
                        let _ = window.emit("ollama-chat-delta", text);
                    }
                    Some(Err(e)) => {
                        diagnostics::log(
                            Some(&window),
                            "ERROR",
                            "stream chunk error",
                            Some(serde_json::json!({ "error": e })),
                        );
                        break;
                    }
                    None => break,
                }
            }
        }
    }
    {
        let mut tx = state.chat_cancel_tx.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
        *tx = None;
    }
    let duration_ms = start.elapsed().as_millis() as f64;
    let tokens_per_sec = if duration_ms > 0.0 && chunk_count > 0 {
        (chunk_count as f64) / (duration_ms / 1000.0)
    } else {
        0.0
    };
    diagnostics::log(
        Some(&window),
        if canceled { "WARN" } else { "INFO" },
        "chat stream done",
        Some(serde_json::json!({
            "canceled": canceled,
            "chunk_count": chunk_count,
            "duration_ms": duration_ms,
            "time_to_first_token_ms": ttft_ms,
            "tokens_per_sec": format!("{:.1}", tokens_per_sec),
            "inference_device_preference": inference_preference,
            "gpu_detected": gpu_info.detected,
            "gpu_name": gpu_info.name,
            "active_device": "unknown",
            "model": model
        })),
    );
    let _ = window.emit("ollama-chat-done", ChatDonePayload { canceled });
    Ok(())
}

#[tauri::command]
fn cancel_chat_generation(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut tx = state.chat_cancel_tx.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    if let Some(send) = tx.take() {
        let _ = send.send(());
    }
    Ok(())
}

#[tauri::command]
fn emit_diagnostic_log(
    window: tauri::Window,
    level: String,
    message: String,
    meta: Option<serde_json::Value>,
) {
    diagnostics::log(Some(&window), &level, &message, meta);
}

#[derive(Debug, Serialize)]
pub struct GpuInfoDto {
    pub detected: bool,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct PerformanceStatusDto {
    pub gpu_detected: bool,
    pub gpu_name: String,
    pub active_device: String,
}

#[tauri::command]
fn get_gpu_info() -> GpuInfoDto {
    let info = gpu::detect_gpu();
    GpuInfoDto {
        detected: info.detected,
        name: info.name,
    }
}

#[tauri::command]
fn get_performance_status() -> PerformanceStatusDto {
    let gpu_info = gpu::detect_gpu();
    let device_info = gpu::get_ollama_device_info(gpu_info.detected);
    PerformanceStatusDto {
        gpu_detected: gpu_info.detected,
        gpu_name: gpu_info.name,
        active_device: device_info.active_device,
    }
}

#[tauri::command]
fn get_app_data_dir() -> Result<String, AppError> {
    let dir = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Ollama("Could not determine app data dir".into()))?;
    let app_dir = dir.join("Local Private LLM");
    std::fs::create_dir_all(&app_dir).map_err(AppError::Io)?;
    Ok(app_dir.to_string_lossy().to_string())
}

fn default_filesystem_root() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| String::new())
}

#[tauri::command]
fn get_mcp_settings(state: State<AppState>) -> Result<McpSettingsDto, AppError> {
    let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let s = storage.get_mcp_settings()?;
    let filesystem_root = if s.filesystem_root.trim().is_empty() {
        default_filesystem_root()
    } else {
        s.filesystem_root
    };
    Ok(McpSettingsDto {
        filesystem_enabled: s.filesystem_enabled,
        filesystem_root,
        obsidian_enabled: s.obsidian_enabled,
        obsidian_vault_path: s.obsidian_vault_path,
        web_search_enabled: s.web_search_enabled,
        terminal_enabled: s.terminal_enabled,
    })
}

#[tauri::command]
fn save_mcp_settings(state: State<AppState>, settings: McpSettingsDto) -> Result<(), AppError> {
    let mut storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    storage.save_mcp_settings(&storage::McpSettings {
        filesystem_enabled: settings.filesystem_enabled,
        filesystem_root: settings.filesystem_root,
        obsidian_enabled: settings.obsidian_enabled,
        obsidian_vault_path: settings.obsidian_vault_path,
        web_search_enabled: settings.web_search_enabled,
        terminal_enabled: settings.terminal_enabled,
    })?;
    Ok(())
}

#[tauri::command]
fn get_mcp_tool_definitions(
    state: State<AppState>,
    enabled_only: bool,
) -> Result<Vec<McpToolDefDto>, AppError> {
    let defs = if enabled_only {
        let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
        let s = storage.get_mcp_settings()?;
        let fs_root = if s.filesystem_root.trim().is_empty() {
            default_filesystem_root()
        } else {
            s.filesystem_root.clone()
        };
        mcp::enabled_tool_definitions(
            s.filesystem_enabled,
            &fs_root,
            s.obsidian_enabled,
            &s.obsidian_vault_path,
            s.web_search_enabled,
            s.terminal_enabled,
        )
    } else {
        mcp::all_tool_definitions()
    };
    Ok(defs
        .into_iter()
        .map(|d| McpToolDefDto {
            id: d.id,
            name: d.name,
            description: d.description,
            scope: d.scope,
            risk: d.risk,
            json_schema: d.json_schema,
        })
        .collect())
}

#[tauri::command]
fn execute_mcp_tool(
    state: State<AppState>,
    name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResultDto, AppError> {
    let storage = state.storage.lock().map_err(|e| AppError::Ollama(e.to_string()))?;
    let s = storage.get_mcp_settings()?;
    let root = if s.filesystem_enabled {
        let r = if s.filesystem_root.trim().is_empty() {
            default_filesystem_root()
        } else {
            s.filesystem_root.clone()
        };
        if r.is_empty() { None } else { Some(r) }
    } else {
        None
    };
    let fs_root = root.as_deref();
    let obs_root = if s.obsidian_enabled && !s.obsidian_vault_path.is_empty() {
        Some(s.obsidian_vault_path.as_str())
    } else {
        None
    };
    match mcp::execute_tool(&name, &arguments, fs_root, obs_root) {
        Ok(r) => Ok(McpToolResultDto {
            ok: r.ok,
            content: r.content,
            error: r.error,
            diagnostic_steps: r.diagnostic_steps.map(|steps| {
                steps
                    .into_iter()
                    .map(|s| DiagnosticStepDto {
                        level: s.level,
                        message: s.message,
                        meta: s.meta,
                    })
                    .collect()
            }),
        }),
        Err(e) => Ok(McpToolResultDto {
            ok: false,
            content: String::new(),
            error: Some(e.to_string()),
            diagnostic_steps: None,
        }),
    }
}

/// Run the Tauri app with the given state.
pub fn run(state: AppState) {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_conversations,
            get_conversation,
            create_conversation,
            update_conversation_title,
            delete_conversation,
            add_message,
            get_settings,
            save_settings,
            get_mcp_settings,
            save_mcp_settings,
            get_mcp_tool_definitions,
            execute_mcp_tool,
            get_gpu_info,
            get_performance_status,
            ollama_health,
            ollama_list_models,
            ollama_pull_model,
            ollama_delete_model,
            ollama_show_model,
            ollama_chat_stream,
            cancel_chat_generation,
            emit_diagnostic_log,
            get_app_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local Private LLM");
}

#[cfg(test)]
mod tests {
    use super::storage::Storage;

    #[test]
    fn test_storage_conversation_crud() {
        let dir = std::env::temp_dir().join("lpllm_test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut storage = Storage::new(dir.to_str().unwrap()).unwrap();
        let c = storage.create_conversation("Test").unwrap();
        assert!(!c.id.is_empty());
        assert_eq!(c.title, "Test");
        let convos = storage.list_conversations().unwrap();
        assert_eq!(convos.len(), 1);
        let (conv, msgs) = storage.get_conversation_with_messages(&c.id).unwrap().unwrap();
        assert_eq!(conv.title, "Test");
        assert!(msgs.is_empty());
        storage.add_message(&c.id, "user", "Hello").unwrap();
        let (_, msgs) = storage.get_conversation_with_messages(&c.id).unwrap().unwrap();
        assert_eq!(msgs.len(), 1);
        storage.delete_conversation(&c.id).unwrap();
    }
}
