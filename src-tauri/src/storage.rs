//! SQLite-backed storage for conversations, messages, and settings.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("SQLite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug)]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_ids: Vec<String>,
}

#[derive(Debug)]
pub struct MessageRow {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone)]
pub struct Settings {
    pub theme: String,
    pub selected_model: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_tokens: i64,
    pub tool_calling_mode: bool,
    /// Inference device preference: "auto" | "prefer_gpu" | "force_cpu"
    pub inference_device_preference: String,
}

#[derive(Debug, Clone, Default)]
pub struct McpSettings {
    pub filesystem_enabled: bool,
    pub filesystem_root: String,
    pub obsidian_enabled: bool,
    pub obsidian_vault_path: String,
    pub web_search_enabled: bool,
    pub terminal_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            selected_model: "qwen2.5:3b-instruct".to_string(),
            system_prompt: "You are a local/offline assistant running in this app. You do not have access to the internet unless the web_search tool is enabled and you explicitly call it. Be direct, accurate, and concise.".to_string(),
            temperature: 0.7,
            max_tokens: 2048,
            tool_calling_mode: true,
            inference_device_preference: "auto".to_string(),
        }
    }
}

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn new(data_dir: &str) -> Result<Self, StorageError> {
        std::fs::create_dir_all(data_dir)?;
        let db_path = Path::new(data_dir).join("local_private_llm.db");
        let conn = Connection::open(&db_path)?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    fn migrate(conn: &Connection) -> Result<(), StorageError> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    pub fn list_conversations(&self) -> Result<Vec<ConversationRow>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC",
        )?;
        let rows: Vec<(String, String, i64, i64)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for (id, title, created_at, updated_at) in rows {
            let message_ids = self.get_message_ids_for_conversation(&id).unwrap_or_default();
            out.push(ConversationRow {
                id,
                title,
                created_at,
                updated_at,
                message_ids,
            });
        }
        Ok(out)
    }

    fn get_message_ids_for_conversation(&self, conversation_id: &str) -> Result<Vec<String>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| row.get(0))?;
        let mut ids = Vec::new();
        for id in rows {
            ids.push(id?);
        }
        Ok(ids)
    }

    pub fn get_conversation_with_messages(
        &self,
        id: &str,
    ) -> Result<Option<(ConversationRow, Vec<MessageRow>)>, StorageError> {
        let row: Option<(String, String, i64, i64)> = self
            .conn
            .query_row(
                "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let (id, title, created_at, updated_at) = match row {
            Some(r) => r,
            None => return Ok(None),
        };
        let message_ids = self.get_message_ids_for_conversation(&id).unwrap_or_default();
        let conv = ConversationRow {
            id: id.clone(),
            title,
            created_at,
            updated_at,
            message_ids,
        };
        let mut stmt = self.conn.prepare(
            "SELECT id, role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
        )?;
        let rows = stmt.query_map(params![id], |row| {
            Ok(MessageRow {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                timestamp: row.get(3)?,
            })
        })?;
        let mut messages = Vec::new();
        for m in rows {
            messages.push(m?);
        }
        Ok(Some((conv, messages)))
    }

    pub fn create_conversation(&mut self, title: &str) -> Result<ConversationRow, StorageError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, title, now],
        )?;
        Ok(ConversationRow {
            id: id.clone(),
            title: title.to_string(),
            created_at: now,
            updated_at: now,
            message_ids: vec![],
        })
    }

    pub fn update_conversation_title(&mut self, id: &str, title: &str) -> Result<(), StorageError> {
        let now = Utc::now().timestamp();
        self.conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&mut self, id: &str) -> Result<(), StorageError> {
        self.conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn add_message(
        &mut self,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<MessageRow, StorageError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, conversation_id, role, content, now],
        )?;
        self.conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )?;
        Ok(MessageRow {
            id,
            role: role.to_string(),
            content: content.to_string(),
            timestamp: now,
        })
    }

    fn get_setting_optional(&self, key: &str) -> Result<Option<String>, StorageError> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?;
        Ok(v)
    }

    pub fn get_settings(&self) -> Result<Settings, StorageError> {
        let theme: String = self
            .get_setting_optional("theme")?
            .unwrap_or_else(|| "system".to_string());
        let selected_model: String = self
            .get_setting_optional("selected_model")?
            .unwrap_or_else(|| "qwen2.5:3b-instruct".to_string());
        let system_prompt: String = self
            .get_setting_optional("system_prompt")?
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| Settings::default().system_prompt);
        let temperature: f64 = self
            .get_setting_optional("temperature")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.7);
        let max_tokens: i64 = self
            .get_setting_optional("max_tokens")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(2048);
        let tool_calling_mode: bool = self
            .get_setting_optional("tool_calling_mode")?
            .and_then(|s| s.parse().ok())
            .unwrap_or(true);
        let inference_device_preference: String = self
            .get_setting_optional("inference_device_preference")?
            .filter(|s| matches!(s.as_str(), "auto" | "prefer_gpu" | "force_cpu"))
            .unwrap_or_else(|| "auto".to_string());
        Ok(Settings {
            theme,
            selected_model,
            system_prompt,
            temperature,
            max_tokens,
            tool_calling_mode,
            inference_device_preference,
        })
    }

    pub fn get_mcp_settings(&self) -> Result<McpSettings, StorageError> {
        Ok(McpSettings {
            filesystem_enabled: self
                .get_setting_optional("mcp_filesystem_enabled")?
                .and_then(|s| s.parse().ok())
                .unwrap_or(false),
            filesystem_root: self
                .get_setting_optional("mcp_filesystem_root")?
                .unwrap_or_default(),
            obsidian_enabled: self
                .get_setting_optional("mcp_obsidian_enabled")?
                .and_then(|s| s.parse().ok())
                .unwrap_or(false),
            obsidian_vault_path: self
                .get_setting_optional("mcp_obsidian_vault_path")?
                .unwrap_or_default(),
            web_search_enabled: self
                .get_setting_optional("mcp_web_search_enabled")?
                .and_then(|s| s.parse().ok())
                .unwrap_or(false),
            terminal_enabled: self
                .get_setting_optional("mcp_terminal_enabled")?
                .and_then(|s| s.parse().ok())
                .unwrap_or(false),
        })
    }

    pub fn save_mcp_settings(&mut self, s: &McpSettings) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_filesystem_enabled', ?1)",
            params![s.filesystem_enabled.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_filesystem_root', ?1)",
            params![s.filesystem_root],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_obsidian_enabled', ?1)",
            params![s.obsidian_enabled.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_obsidian_vault_path', ?1)",
            params![s.obsidian_vault_path],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_web_search_enabled', ?1)",
            params![s.web_search_enabled.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('mcp_terminal_enabled', ?1)",
            params![s.terminal_enabled.to_string()],
        )?;
        Ok(())
    }

    pub fn save_settings(&mut self, s: Settings) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?1)",
            params![s.theme],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('selected_model', ?1)",
            params![s.selected_model],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('system_prompt', ?1)",
            params![s.system_prompt],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('temperature', ?1)",
            params![s.temperature.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('max_tokens', ?1)",
            params![s.max_tokens.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('tool_calling_mode', ?1)",
            params![s.tool_calling_mode.to_string()],
        )?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('inference_device_preference', ?1)",
            params![s.inference_device_preference],
        )?;
        Ok(())
    }
}
