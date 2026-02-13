// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let data_dir = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.join("Local Private LLM"))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let _ = std::fs::create_dir_all(&data_dir);
    let db_path = data_dir.join("local_private_llm.db");
    let storage = local_private_llm::Storage::new(db_path.parent().unwrap().to_str().unwrap())
        .expect("Failed to initialize storage");
    let ollama = local_private_llm::OllamaClient::new("http://127.0.0.1:11434".to_string());
    let state = local_private_llm::AppState {
        storage: std::sync::Mutex::new(storage),
        ollama,
        chat_cancel_tx: std::sync::Mutex::new(None),
    };

    local_private_llm::run(state)
}
