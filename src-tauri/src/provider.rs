//! LLM provider trait for pluggable backends. Ollama implements this; future: llama.cpp, etc.

use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Placeholder for future pluggable backends (llama.cpp, etc.).
/// Ollama is used directly via ollama::OllamaClient for now.
#[allow(dead_code)]
pub trait LLMProvider: Send + Sync {
    fn name(&self) -> &str;
    fn health(&self) -> Result<bool, String>;
    fn list_models(&self) -> Result<Vec<String>, String>;
}
