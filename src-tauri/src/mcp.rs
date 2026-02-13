//! Built-in MCP-style tools: filesystem (read, write, list), Obsidian vault, and web search.
//! All paths are validated and sandboxed to a user-configured root.
//! Models never execute tools; the app does.

use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use thiserror::Error;

const MAX_FILE_SIZE_BYTES: u64 = 512 * 1024; // 512 KiB
const MAX_READ_LINES: usize = 2000;


#[derive(Error, Debug)]
pub enum McpToolError {
    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),
    #[error("Root not configured")]
    RootNotConfigured,
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid argument: {0}")]
    InvalidArg(String),
    #[error("Tool not found: {0}")]
    UnknownTool(String),
    #[error("Network: {0}")]
    Network(String),
    #[error("Command execution failed: {0}")]
    CommandFailed(String),
}

/// Normalize and validate relative path (no "..", no leading /).
fn check_relative_path(requested: &str) -> Result<String, McpToolError> {
    let trimmed = requested.trim().replace('\\', "/");
    if trimmed.contains("..") || trimmed.starts_with('/') {
        return Err(McpToolError::PathNotAllowed(
            "Path must be relative and cannot contain '..'".into(),
        ));
    }
    Ok(trimmed)
}

/// Resolve and validate that `requested` is under `root`. Returns canonical path or error.
/// Path must exist (for read/list). Rejects ".." and symlink escape.
pub fn validate_path_under_root(root: &Path, requested: &str) -> Result<PathBuf, McpToolError> {
    let root = root
        .canonicalize()
        .map_err(|e| McpToolError::PathNotAllowed(format!("root invalid: {}", e)))?;
    let trimmed = check_relative_path(requested)?;
    let joined = root.join(&trimmed);
    let canonical = joined.canonicalize().map_err(|e| {
        McpToolError::PathNotAllowed(format!("path invalid or not found: {}", e))
    })?;
    if !canonical.starts_with(&root) {
        return Err(McpToolError::PathNotAllowed(
            "Resolved path is outside the allowed root".into(),
        ));
    }
    Ok(canonical)
}

/// Validate path for write: may not exist yet. Parent (if any) must be under root.
pub fn validate_path_under_root_for_write(root: &Path, requested: &str) -> Result<PathBuf, McpToolError> {
    let root = root
        .canonicalize()
        .map_err(|e| McpToolError::PathNotAllowed(format!("root invalid: {}", e)))?;
    let trimmed = check_relative_path(requested)?;
    let full = root.join(&trimmed);
    if full.exists() {
        let canonical = full.canonicalize().map_err(|e| {
            McpToolError::PathNotAllowed(format!("path invalid: {}", e))
        })?;
        if !canonical.starts_with(&root) {
            return Err(McpToolError::PathNotAllowed(
                "Resolved path is outside the allowed root".into(),
            ));
        }
        return Ok(canonical);
    }
    if let Some(parent) = full.parent() {
        if parent.exists() {
            let parent_canon = parent.canonicalize().map_err(|e| {
                McpToolError::PathNotAllowed(format!("parent path invalid: {}", e))
            })?;
            if !parent_canon.starts_with(&root) {
                return Err(McpToolError::PathNotAllowed(
                    "Path is outside the allowed root".into(),
                ));
            }
        }
    }
    Ok(full)
}

/// Read a text file (UTF-8). Optional head/tail line limits.
fn tool_read_file(
    root: &Path,
    path: &str,
    head: Option<u32>,
    tail: Option<u32>,
) -> Result<String, McpToolError> {
    let full = validate_path_under_root(root, path)?;
    if !full.is_file() {
        return Err(McpToolError::InvalidArg("Path is not a file".into()));
    }
    let meta = std::fs::metadata(&full).map_err(McpToolError::Io)?;
    if meta.len() > MAX_FILE_SIZE_BYTES {
        return Err(McpToolError::InvalidArg(format!(
            "File too large (max {} bytes)",
            MAX_FILE_SIZE_BYTES
        )));
    }
    let content = std::fs::read_to_string(&full).map_err(McpToolError::Io)?;
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    if total > MAX_READ_LINES && head.is_none() && tail.is_none() {
        return Ok(lines[..MAX_READ_LINES]
            .join("\n")
            .to_string()
            + "\n... (truncated, max 2000 lines)");
    }
    let result = if let Some(n) = head {
        let n = n.min(MAX_READ_LINES as u32) as usize;
        lines.into_iter().take(n).collect::<Vec<_>>().join("\n")
    } else if let Some(n) = tail {
        let n = n.min(MAX_READ_LINES as u32) as usize;
        let start = total.saturating_sub(n);
        lines[start..].join("\n")
    } else {
        content
    };
    Ok(result)
}

/// Write a text file (UTF-8). Creates parent dirs. Fails if path outside root.
fn tool_write_file(root: &Path, path: &str, content: &str) -> Result<String, McpToolError> {
    let full = validate_path_under_root_for_write(root, path)?;
    if full.is_dir() {
        return Err(McpToolError::InvalidArg("Path is a directory".into()));
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(McpToolError::Io)?;
    }
    std::fs::write(&full, content).map_err(McpToolError::Io)?;
    Ok(format!("Wrote {} bytes to {}", content.len(), full.display()))
}

/// List directory entries (names only). Optional depth (1 = direct children only).
fn tool_list_dir(root: &Path, path: &str, depth: Option<u32>) -> Result<String, McpToolError> {
    let full = validate_path_under_root(root, path)?;
    if !full.is_dir() {
        return Err(McpToolError::InvalidArg("Path is not a directory".into()));
    }
    let depth = depth.unwrap_or(1).min(3);
    let mut lines: Vec<String> = Vec::new();
    list_dir_inner(&full, root, 0, depth, &mut lines)?;
    Ok(lines.join("\n"))
}

fn list_dir_inner(
    dir: &Path,
    root: &Path,
    current: u32,
    max_depth: u32,
    out: &mut Vec<String>,
) -> Result<(), McpToolError> {
    if current >= max_depth {
        return Ok(());
    }
    let prefix = "  ".repeat(current as usize);
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(McpToolError::Io)?.collect();
    entries.sort_by(|a, b| {
        let a = a.as_ref().map(|e| e.file_name().to_string_lossy().to_string()).unwrap_or_default();
        let b = b.as_ref().map(|e| e.file_name().to_string_lossy().to_string()).unwrap_or_default();
        a.cmp(&b)
    });
    for e in entries {
        let e = e.map_err(McpToolError::Io)?;
        let name = e.file_name();
        let name_str = name.to_string_lossy();
        let path = e.path();
        let is_dir = path.is_dir();
        let marker = if is_dir { "/" } else { "" };
        out.push(format!("{}{}{}", prefix, name_str, marker));
        if is_dir && current + 1 < max_depth {
            list_dir_inner(&path, root, current + 1, max_depth, out)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
    pub risk: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_schema: Option<serde_json::Value>,
}

fn filesystem_tool_defs() -> Vec<McpToolDef> {
    vec![
        McpToolDef {
            id: "filesystem".to_string(),
            name: "read_file".to_string(),
            description: "Read a UTF-8 text file. Only within the selected root directory. Use relative path from root.".to_string(),
            scope: "Sandboxed to user-selected root".to_string(),
            risk: "read_only".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Relative path to file from root" },
                    "head": { "type": "integer", "minimum": 1, "description": "Return only first N lines" },
                    "tail": { "type": "integer", "minimum": 1, "description": "Return only last N lines" }
                },
                "additionalProperties": false
            })),
        },
        McpToolDef {
            id: "filesystem".to_string(),
            name: "write_file".to_string(),
            description: "Write a UTF-8 text file. Only within the selected root. Creates parent directories if needed.".to_string(),
            scope: "Sandboxed to user-selected root".to_string(),
            risk: "write".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": { "type": "string", "description": "Relative path from root" },
                    "content": { "type": "string", "description": "File content" }
                },
                "additionalProperties": false
            })),
        },
        McpToolDef {
            id: "filesystem".to_string(),
            name: "list_dir".to_string(),
            description: "List directory contents (names, with / for dirs). Only within the selected root.".to_string(),
            scope: "Sandboxed to user-selected root".to_string(),
            risk: "read_only".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Relative path to directory from root" },
                    "depth": { "type": "integer", "minimum": 1, "maximum": 3, "default": 1 }
                },
                "additionalProperties": false
            })),
        },
    ]
}

fn obsidian_tool_defs() -> Vec<McpToolDef> {
    vec![
        McpToolDef {
            id: "obsidian".to_string(),
            name: "obsidian_read_note".to_string(),
            description: "Read an Obsidian note (Markdown) from the vault. Path is vault-relative (e.g. 'Daily/2026-02-10.md'). Preserves frontmatter.".to_string(),
            scope: "Obsidian vault path".to_string(),
            risk: "read_only".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Vault-relative path, e.g. 'Daily/2026-02-10.md'" }
                },
                "additionalProperties": false
            })),
        },
        McpToolDef {
            id: "obsidian".to_string(),
            name: "obsidian_write_note".to_string(),
            description: "Write an Obsidian note (Markdown) to the vault. Preserve frontmatter if present in content.".to_string(),
            scope: "Obsidian vault path".to_string(),
            risk: "write".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": { "type": "string", "description": "Vault-relative path" },
                    "content": { "type": "string", "description": "Markdown content (include frontmatter if desired)" }
                },
                "additionalProperties": false
            })),
        },
        McpToolDef {
            id: "obsidian".to_string(),
            name: "obsidian_list_notes".to_string(),
            description: "List note files in a vault folder. Path is vault-relative.".to_string(),
            scope: "Obsidian vault path".to_string(),
            risk: "read_only".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Vault-relative path to directory" },
                    "depth": { "type": "integer", "minimum": 1, "maximum": 3, "default": 1 }
                },
                "additionalProperties": false
            })),
        },
    ]
}

fn web_search_tool_defs() -> Vec<McpToolDef> {
    vec![McpToolDef {
        id: "web_search".to_string(),
        name: "web_search".to_string(),
        description: "Search the web (DuckDuckGo). Returns title, snippet, URL, and optional page excerpts so you can summarize the pages (not just list links). Use for current info and to summarize what each result says. Cite results.".to_string(),
        scope: "Internet (opt-in)".to_string(),
        risk: "network".to_string(),
        json_schema: Some(serde_json::json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": { "type": "string", "description": "Search query" },
                "max_results": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
                "include_page_excerpts": { "type": "boolean", "default": true, "description": "When true (default), fetch each result URL and include a text excerpt so you can summarize the page content." }
            },
            "additionalProperties": false
        })),
    }]
}

fn terminal_tool_defs() -> Vec<McpToolDef> {
    vec![
        McpToolDef {
            id: "terminal".to_string(),
            name: "run_command".to_string(),
            description: "Execute a shell command. Returns stdout and stderr. One command per call. Use with caution—commands run with your user permissions.".to_string(),
            scope: "Local system (opt-in)".to_string(),
            risk: "high".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": { "type": "string", "description": "Command to execute (e.g. 'ls -la' or 'dir' on Windows)" },
                    "working_directory": { "type": "string", "description": "Optional: working directory (absolute path). Defaults to user home (root), not the app folder." }
                },
                "additionalProperties": false
            })),
        },
        McpToolDef {
            id: "terminal".to_string(),
            name: "open_terminal_and_run".to_string(),
            description: "Open a visible CLI and run a command. By default reuses the same terminal tab; set new_tab=true for a new tab. Default working directory is user home (root), not the app folder. Windows: PowerShell, cmd, or wt.".to_string(),
            scope: "Local system (opt-in)".to_string(),
            risk: "high".to_string(),
            json_schema: Some(serde_json::json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "shell": { "type": "string", "enum": ["powershell", "cmd", "wt"], "default": "powershell" },
                    "command": { "type": "string", "description": "Command to run in the terminal" },
                    "keep_open": { "type": "boolean", "default": true },
                    "working_directory": { "type": "string", "description": "Optional: working directory. Defaults to user home (root), not the app folder." },
                    "new_tab": { "type": "boolean", "default": false, "description": "If true, open a new terminal tab/window. If false (default), reuse the same terminal." }
                },
                "additionalProperties": false
            })),
        },
    ]
}

fn fetch_url_tool_defs() -> Vec<McpToolDef> {
    vec![McpToolDef {
        id: "web".to_string(),
        name: "fetch_url".to_string(),
        description: "Fetch a URL and return the page content as plain text. Use when the user asks to summarize a link, explain a page, or gives you a URL—you receive the content as context and summarize or answer from it; the user does not need to copy-paste anything.".to_string(),
        scope: "Internet (opt-in)".to_string(),
        risk: "network".to_string(),
        json_schema: Some(serde_json::json!({
            "type": "object",
            "required": ["url"],
            "properties": {
                "url": { "type": "string", "description": "Full URL to fetch (e.g. https://example.com/article)" },
                "max_chars": { "type": "integer", "minimum": 500, "maximum": 20000, "default": 12000, "description": "Max plain-text characters to return (for context window)" }
            },
            "additionalProperties": false
        })),
    }]
}

fn open_browser_search_tool_defs() -> Vec<McpToolDef> {
    vec![McpToolDef {
        id: "browser".to_string(),
        name: "open_browser_search".to_string(),
        description: "Open the default browser to a URL or search page. The app also fetches the opened page (or first DuckDuckGo result) and returns its text in the tool response—use that content as context to summarize or answer; do not ask the user to paste.".to_string(),
        scope: "Local (opens browser)".to_string(),
        risk: "low".to_string(),
        json_schema: Some(serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "Direct URL to open (e.g. https://duckduckgo.com/?q=...)" },
                "query": { "type": "string", "description": "Search query when using engine" },
                "engine": { "type": "string", "enum": ["duckduckgo", "bing", "google"], "default": "duckduckgo", "description": "Search engine when using query" }
            },
            "additionalProperties": false
        })),
    }]
}

pub fn all_tool_definitions() -> Vec<McpToolDef> {
    let mut out = filesystem_tool_defs();
    out.extend(obsidian_tool_defs());
    out.extend(web_search_tool_defs());
    out.extend(fetch_url_tool_defs());
    out.extend(terminal_tool_defs());
    out.extend(open_browser_search_tool_defs());
    out
}

/// Return only tool defs for enabled MCPs and with root configured where needed.
pub fn enabled_tool_definitions(
    filesystem_enabled: bool,
    filesystem_root: &str,
    obsidian_enabled: bool,
    obsidian_vault: &str,
    web_search_enabled: bool,
    terminal_enabled: bool,
) -> Vec<McpToolDef> {
    let mut out = Vec::new();
    if filesystem_enabled && !filesystem_root.trim().is_empty() {
        out.extend(filesystem_tool_defs());
    }
    if obsidian_enabled && !obsidian_vault.trim().is_empty() {
        out.extend(obsidian_tool_defs());
    }
    if web_search_enabled {
        out.extend(web_search_tool_defs());
        out.extend(fetch_url_tool_defs());
        out.extend(open_browser_search_tool_defs());
    }
    if terminal_enabled {
        out.extend(terminal_tool_defs());
    }
    out
}

#[derive(Debug, Deserialize)]
pub struct ToolCallArgs {
    pub path: Option<String>,
    pub content: Option<String>,
    pub head: Option<u32>,
    pub tail: Option<u32>,
    pub depth: Option<u32>,
    pub query: Option<String>,
    pub max_results: Option<u32>,
    /// When true (default), fetch result URLs and add page_excerpt to each result for summarization.
    pub include_page_excerpts: Option<bool>,
    pub command: Option<String>,
    pub working_directory: Option<String>,
    pub shell: Option<String>,
    pub keep_open: Option<bool>,
    /// If true, open a new terminal tab/window. If false or unset, reuse the same terminal.
    pub new_tab: Option<bool>,
    /// For open_browser_search: direct URL to open.
    pub url: Option<String>,
    /// For open_browser_search: search engine when using query (duckduckgo | bing | google).
    pub engine: Option<String>,
    /// For fetch_url: max plain-text characters to return.
    pub max_chars: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoResult {
    #[serde(rename = "Abstract")]
    abstract_text: Option<String>,
    #[serde(rename = "AbstractURL")]
    abstract_url: Option<String>,
    #[serde(rename = "RelatedTopics")]
    related_topics: Option<Vec<serde_json::Value>>,
}

/// Single search result for structured web_search output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchResultItem {
    pub title: String,
    pub snippet: String,
    pub url: String,
    /// Fetched page text excerpt (when include_page_excerpts is true) for the assistant to summarize.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_excerpt: Option<String>,
}

/// One step in web_search diagnostics (name, ok, detail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchStep {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Structured web_search tool output (JSON). result_count must equal results.len().
#[derive(Debug, Serialize, Deserialize)]
pub struct WebSearchOutput {
    pub ok: bool,
    pub provider: String,
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_original: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_rewritten: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recency_days: Option<u32>,
    pub status: u16,
    pub results: Vec<WebSearchResultItem>,
    pub result_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<WebSearchStep>,
    /// When true, assistant should call open_browser_search and ask user to paste the top result (do not claim we scraped).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggest_open_browser_search: Option<bool>,
}

fn one_result_from_obj(obj: &serde_json::Map<String, serde_json::Value>) -> Option<WebSearchResultItem> {
    let text = obj.get("Text").and_then(|x| x.as_str()).filter(|s| !s.is_empty())?;
    let url = obj.get("FirstURL").and_then(|x| x.as_str()).filter(|s| !s.is_empty())?;
    let title = text.lines().next().unwrap_or(text).trim();
    let title = if title.len() > 120 { format!("{}…", &title[..117]) } else { title.to_string() };
    Some(WebSearchResultItem {
        title,
        snippet: text.to_string(),
        url: url.to_string(),
        page_excerpt: None,
    })
}

/// Strip HTML tags to get plain text for page excerpts. Replaces tags with space and collapses whitespace.
fn strip_html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    let bytes = html.as_bytes();
    let n = bytes.len();
    while i < n {
        if bytes[i] == b'<' {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
            i += 1;
            while i < n && bytes[i] != b'>' {
                i += 1;
            }
            if i < n {
                i += 1;
            }
            continue;
        }
        let c = bytes[i];
        if c.is_ascii_whitespace() {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
        } else {
            out.push(c as char);
        }
        i += 1;
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

const PAGE_EXCERPT_MAX_CHARS: usize = 2200;
const PAGE_EXCERPT_FETCH_TIMEOUT_SECS: u64 = 8;
const PAGE_EXCERPT_MAX_RESULTS: usize = 4;
/// Max chars for page content when open_browser_search fetches the page into context.
const OPEN_BROWSER_FETCH_MAX_CHARS: usize = 12000;

/// Fetch a URL and return plain-text excerpt for the assistant to summarize.
fn fetch_page_excerpt(client: &reqwest::blocking::Client, url: &str) -> Option<String> {
    fetch_url_content_impl(client, url, PAGE_EXCERPT_MAX_CHARS)
}

/// Fetch a URL and return plain text (for fetch_url tool). Uses same timeout/size limits; max_chars caps output.
fn fetch_url_content(client: &reqwest::blocking::Client, url: &str, max_chars: usize) -> Result<String, McpToolError> {
    fetch_url_content_impl(client, url, max_chars)
        .ok_or_else(|| McpToolError::Network("fetch failed or returned no text".to_string()))
}

fn fetch_url_content_impl(client: &reqwest::blocking::Client, url: &str, max_chars: usize) -> Option<String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let res = client
        .get(url)
        .timeout(Duration::from_secs(PAGE_EXCERPT_FETCH_TIMEOUT_SECS))
        .send()
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let body = res.bytes().ok()?;
    if body.len() > 512 * 1024 {
        return None;
    }
    let text = String::from_utf8_lossy(&body);
    let stripped = strip_html_to_text(&text);
    if stripped.is_empty() {
        return None;
    }
    Some(if stripped.len() > max_chars {
        format!("{}…", stripped.chars().take(max_chars).collect::<String>().trim())
    } else {
        stripped
    })
}

/// Parse DuckDuckGo response into a list of results (abstract + related topics, including nested Topics).
fn parse_duckduckgo_results(body: &DuckDuckGoResult, max_results: usize) -> Vec<WebSearchResultItem> {
    let mut results = Vec::new();
    if let (Some(ref t), Some(ref u)) = (&body.abstract_text, &body.abstract_url) {
        if !t.trim().is_empty() && !u.trim().is_empty() {
            let title = t.lines().next().unwrap_or(t).trim();
            let title = if title.len() > 120 { format!("{}…", &title[..117]) } else { title.to_string() };
            results.push(WebSearchResultItem {
                title,
                snippet: t.trim().to_string(),
                url: u.trim().to_string(),
                page_excerpt: None,
            });
        }
    }
    if let Some(ref topics) = body.related_topics {
        for v in topics.iter() {
            if results.len() >= max_results {
                break;
            }
            if let Some(obj) = v.as_object() {
                if obj.contains_key("Topics") {
                    if let Some(arr) = obj.get("Topics").and_then(|x| x.as_array()) {
                        for item in arr {
                            if results.len() >= max_results {
                                break;
                            }
                            if let Some(ref o) = item.as_object() {
                                if let Some(r) = one_result_from_obj(o) {
                                    results.push(r);
                                }
                            }
                        }
                    }
                } else if let Some(item) = one_result_from_obj(obj) {
                    results.push(item);
                }
            }
        }
    }
    results
}

/// Call DuckDuckGo API and return the first result URL, if any. Used to fetch first result page when opening browser search.
fn duckduckgo_first_result_url(client: &reqwest::blocking::Client, query: &str) -> Option<String> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    let res = client
        .get("https://api.duckduckgo.com/")
        .query(&[("q", query), ("format", "json")])
        .send()
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let body: DuckDuckGoResult = res.json().ok()?;
    let results = parse_duckduckgo_results(&body, 1);
    results.into_iter().next().map(|r| r.url)
}

/// True if the query implies recency (today, few days ago, latest, current, this week, etc.).
fn is_time_sensitive_query(q: &str) -> bool {
    let lower = q.to_lowercase();
    let patterns = [
        "today",
        "yesterday",
        "few days ago",
        "a few days ago",
        "latest",
        "current",
        "this week",
        "this month",
        "this year",
        "recent",
        "just",
        "super bowl",
        "superbowl",
        "winner",
        "champion",
        "score",
        "result",
    ];
    patterns.iter().any(|p| lower.contains(p))
}

/// Rewrite query for recency: append year when time-sensitive. Returns (rewritten_query, recency_days).
fn rewrite_web_search_query(query: &str, recency_days_default: u32) -> (String, u32) {
    let q = query.trim();
    if q.is_empty() {
        return (q.to_string(), recency_days_default);
    }
    if !is_time_sensitive_query(q) {
        return (q.to_string(), recency_days_default);
    }
    let year = chrono::Utc::now().year();
    let rewritten = format!("{} {}", q, year);
    (rewritten, recency_days_default)
}

/// True if the query asks for current officeholder (president, prime minister, leader of X).
fn is_officeholder_query(q: &str) -> bool {
    let lower = q.to_lowercase();
    let patterns = [
        "current president of",
        "who is the president of",
        "president of the",
        "current prime minister of",
        "who is the prime minister of",
        "prime minister of the",
        "current leader of",
        "who is the leader of",
        "leader of the",
    ];
    patterns.iter().any(|p| lower.contains(p))
}

/// If this is an officeholder query, return (country_search_term, wikidata_property, office_label).
/// P35 = head of state (president), P6 = head of government (prime minister).
fn normalize_officeholder_query(q: &str) -> Option<(String, &'static str, &'static str)> {
    let lower = q.to_lowercase().trim().to_string();
    let (property, office_label, rest): (&str, &str, _) = if lower.contains("prime minister") {
        ("P6", "prime minister", lower.replace("current prime minister of", "").replace("who is the prime minister of", "").replace("prime minister of the", ""))
    } else if lower.contains("president") {
        ("P35", "president", lower
            .replace("current president of", "")
            .replace("who is the president of", "")
            .replace("president of the", ""))
    } else if lower.contains("leader") {
        ("P35", "leader", lower
            .replace("current leader of", "")
            .replace("who is the leader of", "")
            .replace("leader of the", ""))
    } else {
        return None;
    };
    let country = rest
        .trim()
        .trim_matches(|c: char| c == '.' || c == '?' || c == ',')
        .trim()
        .strip_prefix("the ")
        .unwrap_or(rest.trim())
        .trim();
    if country.is_empty() {
        return None;
    }
    let normalized = match country.to_lowercase().as_str() {
        "usa" | "us" | "u.s." | "u.s.a." | "united states" | "america" => "United States",
        "uk" | "u.k." | "united kingdom" | "britain" | "england" => "United Kingdom",
        "france" => "France",
        "germany" => "Germany",
        "canada" => "Canada",
        "australia" => "Australia",
        "india" => "India",
        "japan" => "Japan",
        _ => country, // use as-is for others
    };
    Some((normalized.to_string(), property, office_label))
}

/// Wikidata: find country entity, get head of state (P35) or head of government (P6), return name + URLs.
fn wikidata_officeholder_fallback(query: &str) -> Vec<WebSearchResultItem> {
    let (country_search, property, office_label) = match normalize_officeholder_query(query) {
        Some(t) => t,
        None => return vec![],
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("LocalPrivateLLM/1.0 (Wikidata officeholder)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let search_url = "https://www.wikidata.org/w/api.php";
    let search_params = [
        ("action", "wbsearchentities"),
        ("format", "json"),
        ("language", "en"),
        ("type", "item"),
        ("search", country_search.as_str()),
        ("limit", "1"),
    ];
    let search_res = match client.get(search_url).query(&search_params).send() {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !search_res.status().is_success() {
        return vec![];
    }
    let search_body: serde_json::Value = match search_res.json() {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let country_id = search_body
        .get("search")
        .and_then(|s| s.as_array())
        .and_then(|a| a.first())
        .and_then(|e| e.get("id").and_then(|i| i.as_str()));
    let country_id = match country_id {
        Some(id) => id,
        None => return vec![],
    };
    let entity_params = [
        ("action", "wbgetentities"),
        ("format", "json"),
        ("ids", country_id),
        ("props", "claims"),
        ("languages", "en"),
    ];
    let entity_res = match client.get(search_url).query(&entity_params).send() {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !entity_res.status().is_success() {
        return vec![];
    }
    let entity_body: serde_json::Value = match entity_res.json() {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let claims = entity_body
        .get("entities")
        .and_then(|e| e.get(country_id))
        .and_then(|e| e.get("claims"))
        .and_then(|c| c.get(property));
    let person_id = claims
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|st| st.get("mainsnak"))
        .and_then(|s| s.get("datavalue"))
        .and_then(|d| d.get("value"))
        .and_then(|v| v.get("id"))
        .and_then(|i| i.as_str());
    let person_id = match person_id {
        Some(id) => id,
        None => return vec![],
    };
    let person_params = [
        ("action", "wbgetentities"),
        ("format", "json"),
        ("ids", person_id),
        ("props", "labels|sitelinks"),
        ("languages", "en"),
    ];
    let person_res = match client.get(search_url).query(&person_params).send() {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !person_res.status().is_success() {
        return vec![];
    }
    let person_body: serde_json::Value = match person_res.json() {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let person_entity = person_body
        .get("entities")
        .and_then(|e| e.get(person_id));
    let name = person_entity
        .and_then(|e| e.get("labels"))
        .and_then(|l| l.get("en"))
        .and_then(|l| l.get("value"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");
    let wiki_url = person_entity
        .and_then(|e| e.get("sitelinks"))
        .and_then(|s| s.get("enwiki"))
        .and_then(|s| s.get("title"))
        .and_then(|t| t.as_str())
        .map(|title| format!("https://en.wikipedia.org/wiki/{}", title.replace(' ', "_")));
    let wikidata_url = format!("https://www.wikidata.org/wiki/{}", person_id);
    let snippet = match &wiki_url {
        Some(w) => format!("Current {} of {} is {}. Source: {}", office_label, country_search, name, w),
        None => format!("Current {} of {} is {}. Source: {}", office_label, country_search, name, wikidata_url),
    };
    let url = wiki_url.unwrap_or(wikidata_url);
    vec![WebSearchResultItem {
        title: name.to_string(),
        snippet,
        url,
        page_excerpt: None,
    }]
}

/// Wikipedia REST: search then page summary. Prefer office/summary pages; skip "List of ...".
fn wikipedia_fallback_impl(query: &str, prefer_office_not_list: bool) -> Vec<WebSearchResultItem> {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("LocalPrivateLLM/1.0 (Wikipedia fallback)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let q = query.trim();
    if q.is_empty() {
        return vec![];
    }
    let search_term = if prefer_office_not_list && is_officeholder_query(q) {
        normalize_officeholder_query(q)
            .map(|(country, _prop, office_label)| match office_label {
                "president" => format!("President of {}", country),
                "prime minister" => format!("Prime Minister of {}", country),
                _ => format!("{} of {}", office_label, country),
            })
            .unwrap_or_else(|| q.to_string())
    } else {
        q.to_string()
    };
    let search_res = match client
        .get("https://en.wikipedia.org/w/rest.php/v1/search/page")
        .query(&[("q", search_term.as_str()), ("limit", "10")])
        .send()
    {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !search_res.status().is_success() {
        return vec![];
    }
    let search_body: serde_json::Value = match search_res.json() {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let pages = search_body
        .get("pages")
        .and_then(|p| p.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    let page_title = if prefer_office_not_list {
        pages
            .iter()
            .find_map(|p| p.get("title").and_then(|t| t.as_str()))
            .filter(|t| !t.to_lowercase().starts_with("list of "))
    } else {
        pages.first().and_then(|p| p.get("title").and_then(|t| t.as_str()))
    };
    let page_title = match page_title {
        Some(t) => t,
        None => return vec![],
    };
    let slug = page_title.replace(' ', "_");
    let summary_url = format!("https://en.wikipedia.org/api/rest_v1/page/summary/{}", slug);
    let summary_res = match client.get(&summary_url).send() {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    if !summary_res.status().is_success() {
        return vec![];
    }
    let summary_body: serde_json::Value = match summary_res.json() {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let extract = summary_body.get("extract").and_then(|e| e.as_str()).unwrap_or("");
    let content_url = format!("https://en.wikipedia.org/wiki/{}", slug);
    vec![WebSearchResultItem {
        title: page_title.to_string(),
        snippet: extract.to_string(),
        url: content_url,
        page_excerpt: None,
    }]
}

/// Default working directory for terminal commands: user home (root), not the app folder.
fn default_working_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Commands blocked by default for safety. These patterns are checked case-insensitively.
const BLOCKED_COMMAND_PATTERNS: &[&str] = &[
    "rm -rf /",
    "rm -rf /*",
    "del /s /q c:\\",
    "format c:",
    "format d:",
    "mkfs",
    ":(){:|:&};:",          // fork bomb
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init 0",
    "init 6",
    "dd if=",               // raw disk write
    "diskpart",
    "bcdedit",
    "reg delete",
    "net user",              // user account manipulation
    "net localgroup",
    "schtasks /delete",
    "wmic os delete",
    "cipher /w:",            // secure wipe
];

/// Check if a command matches any blocked pattern.
fn is_command_blocked(command: &str) -> bool {
    let lower = command.to_lowercase().trim().to_string();
    BLOCKED_COMMAND_PATTERNS.iter().any(|p| lower.contains(p))
}

fn tool_run_command(command: &str, working_directory: Option<&str>) -> Result<String, McpToolError> {
    if is_command_blocked(command) {
        return Err(McpToolError::CommandFailed(
            "Command blocked: this command is on the safety blocklist. Dangerous system commands are not allowed.".into()
        ));
    }
    #[cfg(windows)]
    let shell = "cmd";
    #[cfg(windows)]
    let shell_flag = "/C";
    #[cfg(not(windows))]
    let shell = "sh";
    #[cfg(not(windows))]
    let shell_flag = "-c";
    
    let mut cmd = Command::new(shell);
    cmd.arg(shell_flag).arg(command);
    
    let wd_path: PathBuf = match working_directory {
        Some(wd) if !wd.trim().is_empty() => {
            let p = Path::new(wd.trim());
            if !p.exists() {
                return Err(McpToolError::InvalidArg(format!("Working directory does not exist: {}", wd)));
            }
            if !p.is_dir() {
                return Err(McpToolError::InvalidArg(format!("Working directory is not a directory: {}", wd)));
            }
            p.to_path_buf()
        }
        _ => default_working_dir(),
    };
    cmd.current_dir(&wd_path);
    
    let output = cmd
        .output()
        .map_err(|e| McpToolError::CommandFailed(format!("Failed to execute command: {}", e)))?;
    
    let mut result = Vec::new();
    result.push(format!("Command: {}", command));
    result.push(format!("Working directory: {}", wd_path.display()));
    result.push(format!("Exit code: {}", output.status.code().unwrap_or(-1)));
    
    if !output.stdout.is_empty() {
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        result.push(format!("STDOUT:\n{}", stdout_str));
    }
    
    if !output.stderr.is_empty() {
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        result.push(format!("STDERR:\n{}", stderr_str));
    }
    
    if output.stdout.is_empty() && output.stderr.is_empty() {
        result.push("(No output)".to_string());
    }
    
    Ok(result.join("\n\n"))
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticStep {
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

#[cfg(windows)]
static PERSISTENT_TERMINAL: OnceLock<Mutex<Option<(Child, ChildStdin)>>> = OnceLock::new();

/// Last working directory we sent to the persistent terminal. Used so the next command without an explicit working_directory stays in the same folder.
#[cfg(windows)]
static PERSISTENT_TERMINAL_LAST_WD: OnceLock<Mutex<String>> = OnceLock::new();

#[cfg(windows)]
fn persistent_terminal_lock() -> &'static Mutex<Option<(Child, ChildStdin)>> {
    PERSISTENT_TERMINAL.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
fn persistent_terminal_last_wd() -> &'static Mutex<String> {
    PERSISTENT_TERMINAL_LAST_WD.get_or_init(|| Mutex::new(String::new()))
}

/// Open a visible CLI window and run a command. Windows-only. Default: reuse same tab; working dir = user home.
#[cfg(windows)]
fn tool_open_terminal_and_run(
    shell: &str,
    command: &str,
    keep_open: bool,
    working_directory: Option<&str>,
    new_tab: bool,
) -> Result<(String, String, Vec<DiagnosticStep>), McpToolError> {
    if is_command_blocked(command) {
        return Err(McpToolError::CommandFailed(
            "Command blocked: this command is on the safety blocklist. Dangerous system commands are not allowed.".into()
        ));
    }

    use std::os::windows::process::CommandExt;

    const CREATE_NEW_CONSOLE: u32 = 0x10;

    let mut steps = Vec::new();
    steps.push(DiagnosticStep {
        level: "INFO".to_string(),
        message: "open_terminal_and_run: validating arguments".to_string(),
        meta: Some(serde_json::json!({
            "shell": shell,
            "keep_open": keep_open,
            "new_tab": new_tab,
            "working_directory": working_directory
        })),
    });

    let command = command.trim();
    if command.is_empty() {
        steps.push(DiagnosticStep {
            level: "ERROR".to_string(),
            message: "open_terminal_and_run: command cannot be empty".to_string(),
            meta: None,
        });
        return Err(McpToolError::InvalidArg("command cannot be empty".into()));
    }

    let default_wd = default_working_dir().display().to_string();
    let last_wd_value = persistent_terminal_last_wd().lock().ok().map(|g| g.clone()).unwrap_or_default();
    let _used_last_wd = working_directory.filter(|s| !s.trim().is_empty()).is_none() && !last_wd_value.is_empty();
    let wd: String = working_directory
        .filter(|s| !s.trim().is_empty())
        .map(std::string::ToString::to_string)
        .or_else(|| {
            if !last_wd_value.is_empty() {
                Some(last_wd_value.clone())
            } else {
                None
            }
        })
        .unwrap_or_else(|| default_wd.clone());


    if !new_tab {
        if let Ok(mut guard) = persistent_terminal_lock().lock() {
            if let Some((ref mut child, ref mut stdin)) = *guard {
                if child.try_wait().map(|o| o.is_none()).unwrap_or(false) {
                    // When reusing, do NOT prepend Set-Location: shell stays in current directory
                    // so follow-up commands (e.g. cd Screenshots; dir) work from previous cwd.
                    let cmd_ps = command.replace(" && ", "; ");
                    let full = format!("{}\r\n", cmd_ps);
                    let _ = stdin.write_all(full.as_bytes());
                    let _ = stdin.flush();
                    steps.push(DiagnosticStep {
                        level: "INFO".to_string(),
                        message: "Reused existing terminal; command sent (no Set-Location).".to_string(),
                        meta: Some(serde_json::json!({ "command": cmd_ps })),
                    });
                    let content = format!(
                        "Ran in existing terminal (PowerShell).\nCommand: {}",
                        cmd_ps
                    );
                    return Ok((content, "powershell".to_string(), steps));
                }
            }
        }
    }

    if new_tab {
        let (shell_used, child) = match shell.to_lowercase().as_str() {
            "wt" => {
                steps.push(DiagnosticStep {
                    level: "INFO".to_string(),
                    message: "Step: Windows Terminal (wt)".to_string(),
                    meta: None,
                });
                let mut cmd = Command::new("wt");
                cmd.args(["powershell", "-NoExit", "-Command", command])
                    .creation_flags(CREATE_NEW_CONSOLE);
                match cmd.spawn() {
                    Ok(c) => ("wt".to_string(), c),
                    Err(e) => {
                        steps.push(DiagnosticStep {
                            level: "WARN".to_string(),
                            message: format!("wt failed ({}), falling back to powershell", e),
                            meta: None,
                        });
                        let mut fallback = Command::new("powershell");
                        fallback
                            .args(["-NoExit", "-Command", command])
                            .creation_flags(CREATE_NEW_CONSOLE);
                        let c = fallback
                            .spawn()
                            .map_err(|e2| McpToolError::CommandFailed(format!("wt and powershell failed: {}", e2)))?;
                        ("powershell".to_string(), c)
                    }
                }
            }
            "cmd" => {
                steps.push(DiagnosticStep {
                    level: "INFO".to_string(),
                    message: "Step: cmd /k".to_string(),
                    meta: None,
                });
                let mut cmd = Command::new("cmd");
                cmd.args(["/k", command]).creation_flags(CREATE_NEW_CONSOLE);
                let c = cmd
                    .spawn()
                    .map_err(|e| McpToolError::CommandFailed(format!("cmd spawn failed: {}", e)))?;
                ("cmd".to_string(), c)
            }
            _ => {
                steps.push(DiagnosticStep {
                    level: "INFO".to_string(),
                    message: "Step: PowerShell -NoExit -Command".to_string(),
                    meta: None,
                });
                let mut cmd = Command::new("powershell");
                if keep_open {
                    cmd.args(["-NoExit", "-Command", command]);
                } else {
                    cmd.args(["-Command", command]);
                }
                cmd.creation_flags(CREATE_NEW_CONSOLE);
                let c = cmd
                    .spawn()
                    .map_err(|e| McpToolError::CommandFailed(format!("powershell spawn failed: {}", e)))?;
                ("powershell".to_string(), c)
            }
        };
        std::mem::forget(child);
        steps.push(DiagnosticStep {
            level: "INFO".to_string(),
            message: format!("Opened new terminal tab. Shell: {}", shell_used),
            meta: Some(serde_json::json!({ "shell_used": shell_used })),
        });
        let content = format!(
            "Opened new terminal window.\nShell: {}\nCommand: {}\nWorking directory: {}",
            shell_used, command, wd
        );
        return Ok((content, shell_used, steps));
    }

    steps.push(DiagnosticStep {
        level: "INFO".to_string(),
        message: "Step: starting persistent PowerShell (reuse same tab)".to_string(),
        meta: None,
    });
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoExit"])
        .creation_flags(CREATE_NEW_CONSOLE)
        .stdin(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| McpToolError::CommandFailed(format!("powershell spawn failed: {}", e)))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| McpToolError::CommandFailed("could not take stdin".into()))?;
    let cmd_ps = command.replace(" && ", "; ");
    let cd_ps = format!("Set-Location '{}'\r\n", wd.replace('\'', "''"));
    let full = format!("{}{}\r\n", cd_ps, cmd_ps);
    stdin.write_all(full.as_bytes()).map_err(|e| {
        McpToolError::CommandFailed(format!("write to terminal failed: {}", e))
    })?;
    stdin.flush().map_err(|e| McpToolError::CommandFailed(format!("flush failed: {}", e)))?;
    {
        let mut guard = persistent_terminal_lock().lock().map_err(|e| {
            McpToolError::CommandFailed(format!("terminal lock poisoned: {}", e))
        })?;
        *guard = Some((child, stdin));
    }
    if let Ok(mut last_wd) = persistent_terminal_last_wd().lock() {
        *last_wd = wd.clone();
    }
    steps.push(DiagnosticStep {
        level: "INFO".to_string(),
        message: "Persistent terminal started; future commands will reuse this tab.".to_string(),
        meta: Some(serde_json::json!({ "working_directory": wd })),
    });
    let content = format!(
        "Opened terminal (reuse same tab for next commands).\nWorking directory: {}\nCommand: {}",
        wd, command
    );
    Ok((content, "powershell".to_string(), steps))
}

#[cfg(not(windows))]
fn tool_open_terminal_and_run(
    _shell: &str,
    command: &str,
    _keep_open: bool,
    _working_directory: Option<&str>,
    _new_tab: bool,
) -> Result<(String, String, Vec<DiagnosticStep>), McpToolError> {
    let mut steps = Vec::new();
    steps.push(DiagnosticStep {
        level: "WARN".to_string(),
        message: "open_terminal_and_run: Windows-only; use run_command on this OS".to_string(),
        meta: None,
    });
    Err(McpToolError::InvalidArg(format!(
        "open_terminal_and_run is only supported on Windows. Use run_command for: {}",
        command
    )))
}

/// Open a URL in the default browser. Returns the opened URL.
fn open_url_in_browser(url: &str) -> Result<String, McpToolError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(McpToolError::InvalidArg("url cannot be empty".into()));
    }
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| McpToolError::CommandFailed(format!("failed to open browser: {}", e)))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(url).spawn().map_err(|e| {
            McpToolError::CommandFailed(format!("failed to open browser: {}", e))
        })?;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Command::new("xdg-open").arg(url).spawn().map_err(|e| {
            McpToolError::CommandFailed(format!("failed to open browser: {}", e))
        })?;
    }
    Ok(url.to_string())
}

fn tool_open_browser_search(args: &ToolCallArgs) -> Result<String, McpToolError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(PAGE_EXCERPT_FETCH_TIMEOUT_SECS + 4))
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::USER_AGENT,
                reqwest::header::HeaderValue::from_static(
                    "Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0",
                ),
            );
            h
        })
        .build()
        .map_err(|e| McpToolError::Network(e.to_string()))?;

    let (opened_msg, url_to_fetch): (String, Option<String>) = if let Some(ref u) = args.url {
        let u = u.trim();
        if u.is_empty() {
            return Err(McpToolError::InvalidArg(
                "open_browser_search requires non-empty url or query".into(),
            ));
        }
        let opened = open_url_in_browser(u)?;
        (format!("Opened browser: {}", opened), Some(u.to_string()))
    } else {
        let query = args.query.as_deref().unwrap_or("").trim();
        if query.is_empty() {
            return Err(McpToolError::InvalidArg(
                "open_browser_search requires url or query".into(),
            ));
        }
        let engine = args.engine.as_deref().unwrap_or("duckduckgo").to_lowercase();
        let encoded = urlencoding::encode(query);
        let search_url = match engine.as_str() {
            "bing" => format!("https://www.bing.com/search?q={}", encoded),
            "google" => format!("https://www.google.com/search?q={}", encoded),
            _ => format!("https://duckduckgo.com/?q={}", encoded),
        };
        open_url_in_browser(&search_url)?;
        let first_result_url = if engine == "duckduckgo" {
            duckduckgo_first_result_url(&client, query)
        } else {
            None
        };
        (
            format!("Opened browser: {}", search_url),
            first_result_url,
        )
    };

    let mut out = opened_msg;
    if let Some(ref url) = url_to_fetch {
        if let Some(content) = fetch_url_content_impl(&client, url, OPEN_BROWSER_FETCH_MAX_CHARS) {
            if !content.trim().is_empty() {
                out.push_str("\n\nPage content (use this as context to summarize or answer; user did not paste this):\n\n");
                out.push_str(&content);
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct ToolResult {
    pub ok: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_steps: Option<Vec<DiagnosticStep>>,
}

pub fn execute_tool(
    name: &str,
    args: &serde_json::Value,
    filesystem_root: Option<&str>,
    obsidian_vault: Option<&str>,
) -> Result<ToolResult, McpToolError> {
    let args: ToolCallArgs = serde_json::from_value(args.clone()).map_err(|e| {
        McpToolError::InvalidArg(format!("Invalid arguments: {}", e))
    })?;

    let result = match name {
        "read_file" => {
            let root = filesystem_root
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.ok_or(McpToolError::InvalidArg("path required".into()))?;
            let content = tool_read_file(Path::new(root), &path, args.head, args.tail)?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: None,
            }
        }
        "write_file" => {
            let root = filesystem_root
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.ok_or(McpToolError::InvalidArg("path required".into()))?;
            let content = args.content.unwrap_or_default();
            let msg = tool_write_file(Path::new(root), &path, &content)?;
            ToolResult {
                ok: true,
                content: msg,
                error: None,
                diagnostic_steps: None,
            }
        }
        "list_dir" => {
            let root = filesystem_root
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.unwrap_or_else(|| ".".to_string());
            let content = tool_list_dir(Path::new(root), &path, args.depth)?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: None,
            }
        }
        "obsidian_read_note" => {
            let root = obsidian_vault
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.ok_or(McpToolError::InvalidArg("path required".into()))?;
            let content = tool_read_file(Path::new(root), &path, None, None)?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: None,
            }
        }
        "obsidian_write_note" => {
            let root = obsidian_vault
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.ok_or(McpToolError::InvalidArg("path required".into()))?;
            let content = args.content.unwrap_or_default();
            let msg = tool_write_file(Path::new(root), &path, &content)?;
            ToolResult {
                ok: true,
                content: msg,
                error: None,
                diagnostic_steps: None,
            }
        }
        "obsidian_list_notes" => {
            let root = obsidian_vault
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::RootNotConfigured)?;
            let path = args.path.unwrap_or_else(|| ".".to_string());
            let content = tool_list_dir(Path::new(root), &path, args.depth)?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: None,
            }
        }
        "web_search" => {
            let query = args.query.ok_or(McpToolError::InvalidArg("query required".into()))?;
            let max_results = args.max_results.unwrap_or(5).min(10).max(1);
            let (query_rewritten, recency_days) = rewrite_web_search_query(&query, 30);
            let mut diag_steps = Vec::new();
            let mut output_steps = Vec::new();
            let mut suggest_open_browser_search: Option<bool> = None;

            diag_steps.push(DiagnosticStep {
                level: "INFO".to_string(),
                message: "Step 1: validate config (provider: DuckDuckGo, no API key required)".to_string(),
                meta: Some(serde_json::json!({
                    "query_original": query,
                    "query_rewritten": query_rewritten,
                    "recency_days": recency_days,
                    "max_results": max_results,
                    "provider": "duckduckgo"
                })),
            });
            output_steps.push(WebSearchStep { name: "validate".to_string(), ok: true, detail: "config ok".to_string() });

            diag_steps.push(DiagnosticStep {
                level: "INFO".to_string(),
                message: "Step 2: network check / request start".to_string(),
                meta: None,
            });

            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent("Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0")
                .default_headers({
                    let mut h = reqwest::header::HeaderMap::new();
                    h.insert(reqwest::header::ACCEPT_LANGUAGE, reqwest::header::HeaderValue::from_static("en-US,en;q=0.9"));
                    h
                })
                .build()
                .map_err(|e| McpToolError::Network(e.to_string()))?;

            let res = match client
                .get("https://api.duckduckgo.com/")
                .query(&[("q", query_rewritten.trim()), ("format", "json")])
                .send()
            {
                Ok(r) => r,
                Err(e) => {
                    output_steps.push(WebSearchStep { name: "request".to_string(), ok: false, detail: e.to_string() });
                    output_steps.push(WebSearchStep { name: "done".to_string(), ok: false, detail: "request failed".to_string() });
                    diag_steps.push(DiagnosticStep { level: "ERROR".to_string(), message: format!("Step 2 failed: {}", e), meta: None });
                    diag_steps.push(DiagnosticStep { level: "INFO".to_string(), message: "Step 5: done (with error)".to_string(), meta: None });
                    let out = WebSearchOutput {
                        ok: false,
                        provider: "duckduckgo".to_string(),
                        query: query_rewritten.clone(),
                        query_original: Some(query.clone()),
                        query_rewritten: Some(query_rewritten.clone()),
                        recency_days: Some(recency_days),
                        status: 0,
                        results: vec![],
                        result_count: 0,
                        error: Some(format!("web_search request failed: {}", e)),
                        steps: output_steps,
                        suggest_open_browser_search: None,
                    };
                    return Ok(ToolResult {
                        ok: false,
                        content: serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string()),
                        error: Some(format!("web_search request failed: {}", e)),
                        diagnostic_steps: Some(diag_steps),
                    });
                }
            };

            let status = res.status().as_u16();
            diag_steps.push(DiagnosticStep {
                level: "INFO".to_string(),
                message: format!("Step 3: response status {}", status),
                meta: Some(serde_json::json!({ "status": status })),
            });
            output_steps.push(WebSearchStep {
                name: "request".to_string(),
                ok: true,
                detail: format!("HTTP {}", status),
            });

            if !res.status().is_success() {
                output_steps.push(WebSearchStep { name: "parse".to_string(), ok: false, detail: "HTTP error".to_string() });
                output_steps.push(WebSearchStep { name: "done".to_string(), ok: false, detail: "status not success".to_string() });
                diag_steps.push(DiagnosticStep { level: "ERROR".to_string(), message: "web_search disabled or request failed".to_string(), meta: Some(serde_json::json!({ "status": status })) });
                diag_steps.push(DiagnosticStep { level: "INFO".to_string(), message: "Step 5: done (with error)".to_string(), meta: None });
                let out = WebSearchOutput {
                    ok: false,
                    provider: "duckduckgo".to_string(),
                    query: query_rewritten.clone(),
                    query_original: Some(query.clone()),
                    query_rewritten: Some(query_rewritten.clone()),
                    recency_days: Some(recency_days),
                    status,
                    results: vec![],
                    result_count: 0,
                    error: Some(format!("HTTP {}", status)),
                    steps: output_steps,
                    suggest_open_browser_search: None,
                };
                return Ok(ToolResult {
                    ok: false,
                    content: serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string()),
                    error: Some(format!("HTTP {}", status)),
                    diagnostic_steps: Some(diag_steps),
                });
            }

            let body: DuckDuckGoResult = match res.json() {
                Ok(b) => b,
                Err(e) => {
                    output_steps.push(WebSearchStep { name: "parse".to_string(), ok: false, detail: e.to_string() });
                    output_steps.push(WebSearchStep { name: "done".to_string(), ok: false, detail: "parse failed".to_string() });
                    diag_steps.push(DiagnosticStep { level: "ERROR".to_string(), message: format!("Step 4: parse failed: {}", e), meta: None });
                    diag_steps.push(DiagnosticStep { level: "INFO".to_string(), message: "Step 5: done (with error)".to_string(), meta: None });
                    let out = WebSearchOutput {
                        ok: false,
                        provider: "duckduckgo".to_string(),
                        query: query_rewritten.clone(),
                        query_original: Some(query.clone()),
                        query_rewritten: Some(query_rewritten.clone()),
                        recency_days: Some(recency_days),
                        status,
                        results: vec![],
                        result_count: 0,
                        error: Some(e.to_string()),
                        steps: output_steps,
                        suggest_open_browser_search: None,
                    };
                    return Ok(ToolResult {
                        ok: false,
                        content: serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string()),
                        error: Some(e.to_string()),
                        diagnostic_steps: Some(diag_steps),
                    });
                }
            };

            let mut results = parse_duckduckgo_results(&body, max_results as usize);
            let mut provider = "duckduckgo".to_string();

            diag_steps.push(DiagnosticStep {
                level: "INFO".to_string(),
                message: format!("Step 4: parse results count {}", results.len()),
                meta: Some(serde_json::json!({ "result_count": results.len() })),
            });
            output_steps.push(WebSearchStep {
                name: "parse".to_string(),
                ok: true,
                detail: format!("result_count {}", results.len()),
            });

            if results.is_empty() {
                diag_steps.push(DiagnosticStep {
                    level: "INFO".to_string(),
                    message: "Step 4b: fallback selection (DDG returned 0 results)".to_string(),
                    meta: None,
                });
                let time_sensitive = is_time_sensitive_query(&query);
                let officeholder = is_officeholder_query(&query);
                if time_sensitive && !officeholder {
                    suggest_open_browser_search = Some(true);
                    output_steps.push(WebSearchStep {
                        name: "fallback_skipped".to_string(),
                        ok: false,
                        detail: "time-sensitive query: Wikipedia not used; suggest open_browser_search".to_string(),
                    });
                } else if officeholder {
                    let wd_results = wikidata_officeholder_fallback(&query);
                    if !wd_results.is_empty() {
                        results = wd_results;
                        provider = "wikidata_officeholder".to_string();
                        output_steps.push(WebSearchStep {
                            name: "wikidata_officeholder".to_string(),
                            ok: true,
                            detail: format!("{} result(s)", results.len()),
                        });
                    } else {
                        let wiki_results = wikipedia_fallback_impl(&query, true);
                        if !wiki_results.is_empty() {
                            results = wiki_results;
                            provider = "wikipedia_fallback".to_string();
                            output_steps.push(WebSearchStep {
                                name: "wikipedia_fallback".to_string(),
                                ok: true,
                                detail: format!("{} result(s), office summary", results.len()),
                            });
                        } else {
                            output_steps.push(WebSearchStep {
                                name: "wikidata_officeholder".to_string(),
                                ok: false,
                                detail: "no results".to_string(),
                            });
                        }
                    }
                }
                if results.is_empty() && suggest_open_browser_search.is_none() {
                    let wiki_results = wikipedia_fallback_impl(&query, false);
                    if !wiki_results.is_empty() {
                        results = wiki_results;
                        provider = "wikipedia_fallback".to_string();
                        output_steps.push(WebSearchStep {
                            name: "wikipedia_fallback".to_string(),
                            ok: true,
                            detail: format!("{} result(s)", results.len()),
                        });
                    } else if !officeholder {
                        output_steps.push(WebSearchStep {
                            name: "wikipedia_fallback".to_string(),
                            ok: false,
                            detail: "no results".to_string(),
                        });
                    }
                }
            }

            let include_excerpts = args.include_page_excerpts.unwrap_or(true);
            if include_excerpts && !results.is_empty() {
                for r in results.iter_mut().take(PAGE_EXCERPT_MAX_RESULTS) {
                    if let Some(excerpt) = fetch_page_excerpt(&client, &r.url) {
                        r.page_excerpt = Some(excerpt);
                    }
                }
                let with_excerpts = results.iter().filter(|r| r.page_excerpt.is_some()).count();
                diag_steps.push(DiagnosticStep {
                    level: "INFO".to_string(),
                    message: format!("Step 4c: page excerpts fetched for {} result(s)", with_excerpts),
                    meta: Some(serde_json::json!({ "include_page_excerpts": true, "with_excerpts": with_excerpts })),
                });
            }

            let result_count = results.len();
            diag_steps.push(DiagnosticStep {
                level: "INFO".to_string(),
                message: "Step 5: done".to_string(),
                meta: Some(serde_json::json!({
                    "result_count": result_count,
                    "provider": provider,
                    "suggest_open_browser_search": suggest_open_browser_search
                })),
            });
            output_steps.push(WebSearchStep {
                name: "done".to_string(),
                ok: true,
                detail: format!("{} result(s)", result_count),
            });

            let out = WebSearchOutput {
                ok: true,
                provider,
                query: query_rewritten.clone(),
                query_original: Some(query.clone()),
                query_rewritten: Some(query_rewritten.clone()),
                recency_days: Some(recency_days),
                status,
                results: results.clone(),
                result_count,
                error: None,
                steps: output_steps,
                suggest_open_browser_search,
            };
            let content = serde_json::to_string(&out).map_err(|e| McpToolError::InvalidArg(format!("serialize: {}", e)))?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: Some(diag_steps),
            }
        }
        "fetch_url" => {
            let url = args
                .url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or(McpToolError::InvalidArg("url required".into()))?;
            let max_chars = args
                .max_chars
                .unwrap_or(12000)
                .min(20000)
                .max(500) as usize;
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(PAGE_EXCERPT_FETCH_TIMEOUT_SECS))
                .default_headers({
                    let mut h = reqwest::header::HeaderMap::new();
                    h.insert(
                        reqwest::header::USER_AGENT,
                        reqwest::header::HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0"),
                    );
                    h
                })
                .build()
                .map_err(|e| McpToolError::Network(e.to_string()))?;
            match fetch_url_content(&client, url.trim(), max_chars) {
                Ok(text) => ToolResult {
                    ok: true,
                    content: format!("Page content (use this as context to summarize or answer; user did not paste this):\n\n{}", text),
                    error: None,
                    diagnostic_steps: None,
                },
                Err(e) => ToolResult {
                    ok: false,
                    content: String::new(),
                    error: Some(e.to_string()),
                    diagnostic_steps: None,
                },
            }
        }
        "run_command" => {
            let command = args.command.ok_or(McpToolError::InvalidArg("command required".into()))?;
            if command.trim().is_empty() {
                return Err(McpToolError::InvalidArg("command cannot be empty".into()));
            }
            let content = tool_run_command(command.trim(), args.working_directory.as_deref())?;
            ToolResult {
                ok: true,
                content,
                error: None,
                diagnostic_steps: None,
            }
        }
        "open_terminal_and_run" => {
            let command = args.command.ok_or(McpToolError::InvalidArg("command required".into()))?;
            let shell = args.shell.as_deref().unwrap_or("powershell");
            let keep_open = args.keep_open.unwrap_or(true);
            let new_tab = args.new_tab.unwrap_or(false);
            let working_directory = args.working_directory.as_deref();
            match tool_open_terminal_and_run(shell, command.trim(), keep_open, working_directory, new_tab) {
                Ok((content, _shell_used, steps)) => ToolResult {
                    ok: true,
                    content,
                    error: None,
                    diagnostic_steps: Some(steps),
                },
                Err(e) => {
                    let msg = e.to_string();
                    ToolResult {
                        ok: false,
                        content: String::new(),
                        error: Some(msg.clone()),
                        diagnostic_steps: None,
                    }
                }
            }
        }
        "open_browser_search" => {
            match tool_open_browser_search(&args) {
                Ok(content) => ToolResult {
                    ok: true,
                    content,
                    error: None,
                    diagnostic_steps: None,
                },
                Err(e) => ToolResult {
                    ok: false,
                    content: String::new(),
                    error: Some(e.to_string()),
                    diagnostic_steps: None,
                },
            }
        }
        _ => return Err(McpToolError::UnknownTool(name.to_string())),
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_duckduckgo_abstract_returns_one_result() {
        let body = DuckDuckGoResult {
            abstract_text: Some("Joe Biden is the 46th president.".to_string()),
            abstract_url: Some("https://example.com/president".to_string()),
            related_topics: None,
        };
        let results = parse_duckduckgo_results(&body, 5);
        assert!(!results.is_empty(), "Abstract + AbstractURL should yield at least 1 result");
        assert_eq!(results[0].url, "https://example.com/president");
        assert_eq!(results[0].snippet, "Joe Biden is the 46th president.");
    }

    #[test]
    fn parse_duckduckgo_related_topics_direct() {
        let body = DuckDuckGoResult {
            abstract_text: None,
            abstract_url: None,
            related_topics: Some(vec![serde_json::json!({
                "Text": "Current president of the United States - Joe Biden",
                "FirstURL": "https://en.wikipedia.org/wiki/Joe_Biden"
            })]),
        };
        let results = parse_duckduckgo_results(&body, 5);
        assert!(!results.is_empty(), "RelatedTopics with Text/FirstURL should yield at least 1 result");
        assert!(results[0].url.contains("wikipedia"));
    }

    #[test]
    fn parse_duckduckgo_related_topics_nested() {
        let body = DuckDuckGoResult {
            abstract_text: None,
            abstract_url: None,
            related_topics: Some(vec![serde_json::json!({
                "Name": "Category",
                "Topics": [
                    { "Text": "Summary of the topic.", "FirstURL": "https://example.com/1" }
                ]
            })]),
        };
        let results = parse_duckduckgo_results(&body, 5);
        assert!(!results.is_empty(), "Nested Topics should be parsed");
        assert_eq!(results[0].url, "https://example.com/1");
    }
}
