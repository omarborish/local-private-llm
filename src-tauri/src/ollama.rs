//! Ollama HTTP API client: health, list models, pull, chat streaming.

// No response timeout: slow PCs can take as long as they need for Ollama.
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub size: u64,
    pub modified_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ChatOptions {
    pub temperature: Option<f64>,
    pub num_predict: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Option<Vec<TagModel>>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
    size: u64,
    modified_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PullEvent {
    pub status: Option<String>,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ChatChunk {
    message: Option<ChatChunkMessage>,
    #[allow(dead_code)]
    done: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ChatChunkMessage {
    content: Option<String>,
}

pub struct OllamaClient {
    base: String,
    client: Client,
}

impl OllamaClient {
    pub fn new(base: String) -> Self {
        let client = Client::builder()
            .build()
            .unwrap_or_default();
        Self { base, client }
    }

    pub async fn health(&self) -> Result<bool, String> {
        let url = format!("{}/api/tags", self.base);
        let res = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        Ok(res.status().is_success())
    }

    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        let url = format!("{}/api/tags", self.base);
        let res = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Ollama returned {}", res.status()));
        }
        let body: TagsResponse = res.json().await.map_err(|e| e.to_string())?;
        let models = body
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|m| ModelInfo {
                name: m.name,
                size: m.size,
                modified_at: m.modified_at,
            })
            .collect();
        Ok(models)
    }

    /// Delete a model by name (tag). Uses Ollama DELETE /api/delete.
    pub async fn delete_model(&self, model: &str) -> Result<(), String> {
        let url = format!("{}/api/delete", self.base);
        let body = serde_json::json!({ "model": model });
        let res = self
            .client
            .delete(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Ollama delete error {}: {}", status, text));
        }
        Ok(())
    }

    /// Show model details (optional). Uses Ollama POST /api/show.
    pub async fn show_model(&self, model: &str) -> Result<Option<serde_json::Value>, String> {
        let url = format!("{}/api/show", self.base);
        let body = serde_json::json!({ "model": model });
        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Ollama show error {}", res.status()));
        }
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(Some(json))
    }

    pub async fn pull(&self, model: &str) -> Result<impl futures_util::Stream<Item = Result<PullEvent, String>>, String> {
        let url = format!("{}/api/pull", self.base);
        let body = serde_json::json!({ "name": model });
        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Ollama pull error {}: {}", status, text));
        }
        let stream = res.bytes_stream();
        let stream = futures_util::stream::try_unfold(
            (stream, Vec::new()),
            |(mut stream, mut buf)| async move {
                use futures_util::StreamExt;
                loop {
                    while let Some(line_end) = buf.iter().position(|&b| b == b'\n') {
                        let line = buf.drain(..=line_end).collect::<Vec<_>>();
                        let line_str = String::from_utf8_lossy(&line);
                        let line_str = line_str.trim_end_matches('\n');
                        if line_str.is_empty() {
                            continue;
                        }
                        if let Ok(evt) = serde_json::from_str::<PullEvent>(line_str) {
                            return Ok(Some((evt, (stream, buf))));
                        }
                    }
                    let chunk = stream
                        .next()
                        .await
                        .ok_or("stream ended")?
                        .map_err(|e| e.to_string())?;
                    buf.extend_from_slice(&chunk);
                }
            },
        );
        Ok(stream)
    }

    pub async fn chat_stream(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
    ) -> Result<impl futures_util::Stream<Item = Result<String, String>>, String> {
        let url = format!("{}/api/chat", self.base);
        let mut body = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true
        });
        let mut opts = serde_json::json!({});
        if let Some(t) = options.temperature {
            opts["temperature"] = serde_json::json!(t);
        }
        if let Some(n) = options.num_predict {
            opts["num_predict"] = serde_json::json!(n);
        }
        if opts.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
            body["options"] = opts;
        }
        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Ollama error {}: {}", status, text));
        }
        let stream = res.bytes_stream();
        let stream = futures_util::stream::try_unfold(
            (stream, Vec::new()),
            |(mut stream, mut buf)| async move {
                loop {
                    while let Some(line_end) = buf.iter().position(|&b| b == b'\n') {
                        let line: Vec<u8> = buf.drain(..=line_end).collect();
                        let line_str = String::from_utf8_lossy(&line);
                        let line_str = line_str.trim_end_matches('\n');
                        if line_str.is_empty() {
                            continue;
                        }
                        if let Ok(chunk) = serde_json::from_str::<ChatChunk>(line_str) {
                            if let Some(msg) = chunk.message.and_then(|m| m.content) {
                                return Ok(Some((msg, (stream, buf))));
                            }
                        }
                    }
                    let chunk = match stream.next().await {
                        Some(Ok(c)) => c,
                        Some(Err(e)) => return Err(e.to_string()),
                        None => return Ok(None),
                    };
                    buf.extend_from_slice(&chunk);
                }
            },
        );
        Ok(stream)
    }
}
