# Local Private LLM

**A free, privacy-first desktop AI assistant that runs 100% locally.**

No accounts. No cloud. No telemetry. Powered by open-weight models via [Ollama](https://ollama.com).

Version 0.1.0 | MIT License | Windows (macOS/Linux planned)

---

## What It Is

Local Private LLM is a desktop ChatGPT-style application that keeps everything on your machine. Conversations are stored in a local SQLite database, inference runs through Ollama on your own hardware, and no data ever leaves your device. The default model is **Qwen 2.5 7B Instruct** (open-weight), but you can download and switch to any model Ollama supports.

---

## For End Users (Download & Run)

**What you need**

- **Windows 10 or 11** (64-bit).
- **Ollama** — the app does *not* install it. Install once from [ollama.com/download](https://ollama.com/download), then leave it running (it often runs as a background service).
- **A model** — after Ollama is installed, the app can download the default model (Qwen 2.5 7B) for you from the first-run screen or from **Models** in the sidebar. No terminal required.

**Steps**

1. Download the app (portable `.exe` zip or installer from the [Releases](https://github.com/omarborish/local-private-llm/releases) page).
2. Install and start **Ollama** from [ollama.com](https://ollama.com) if you haven’t already.
3. Run **Local Private LLM**. On first run it will check Ollama and offer to download the default model; you can also use **Models** in the app to add or switch models.
4. Chat. Everything runs on your machine; no account or cloud.

The app does **not** install LLMs or Ollama for you — you install Ollama once, then the app uses it and can pull models through it.

---

## Why It Is Interesting

Most local LLM tools stop at "run a model and chat with it." This project goes further:

- **Local-first, not cloud-optional.** There is no server, no account creation, and no fallback to a remote API. If Ollama is running, the app works.
- **Tool layer.** The assistant can read and write files, search the web via DuckDuckGo, run terminal commands, and interact with an Obsidian vault -- all through an MCP-style tool system that works with any Ollama model (no native function-calling required).
- **Truthfulness enforcement.** The assistant cannot claim it "searched the web" or "looked it up" unless it actually invoked the `web_search` tool in that request. Responses that make false tool-use claims are blocked and replaced with a correction.
- **Provenance tracking.** Every file written through the assistant gets an automatic provenance footer: timestamp, list of tools used, web source URLs (or "None (offline)"), and a note about the assistant's actual capabilities.
- **Per-chat diagnostics.** A built-in diagnostics panel shows timestamped logs, tool request/response JSON, and web search step traces for every conversation turn.

---

## Key Features

- **Real-time streaming** -- token-by-token output from local models, not fake simulated streaming
- **Model Library** -- browse a curated catalog, download models, switch active model, remove models (similar to LM Studio's model management)
- **MCP-style tools** -- opt-in tool categories, each sandboxed:
  - **Filesystem** -- read, write, and list files under a user-selected root directory
  - **Obsidian vault** -- read, write, and list Markdown notes in your vault
  - **Web search** -- DuckDuckGo-backed search with page excerpt fetching for summarization
  - **URL fetch** -- retrieve and summarize any webpage the user provides
  - **Terminal / CLI** -- execute shell commands, open persistent terminal sessions (PowerShell/cmd/Windows Terminal)
  - **Browser search** -- open the default browser to a search results page as a fallback
- **Truthful tool use enforcement** -- regex-based detection of false web-search claims; blocked responses are replaced with an honest correction message
- **Provenance footers** on all written files -- timestamp, tools used, source URLs, and capability disclaimer
- **Diagnostics panel** -- per-conversation log viewer with timestamps, severity levels, and copyable tool invocation JSON
- **Dark / Light / System themes**
- **First-run onboarding** -- detects whether Ollama is installed and running, guides the user through model download
- **Zero telemetry** -- no analytics, no crash reporting, no network calls except to Ollama (localhost) and opt-in web search

---

## How It Compares to Alternatives

| | LM Studio | Ollama CLI | Local Private LLM (this app) |
|---|---|---|---|
| **What it is** | Model launcher + chat UI | Command-line model server | Assistant platform built on Ollama |
| **Model management** | Download, run, and chat with models locally | Pull and serve models from the terminal | Same model management, plus a curated catalog with RAM requirements and tool-readiness tags |
| **Tool use** | None | None | File read/write, web search, terminal, Obsidian vault, URL fetch, browser fallback |
| **Truthfulness checks** | None | None | Blocks responses that falsely claim web search; provenance tracking on written files |
| **Diagnostics** | Basic | Server logs | Per-chat diagnostics panel with tool request/response traces |
| **Privacy model** | Local inference, optional telemetry | Local inference | Local inference, zero telemetry, sandboxed filesystem, DuckDuckGo for search |
| **Best for** | Exploring and benchmarking models | Developers integrating LLMs into pipelines | Using a local LLM as a day-to-day assistant with tools |

Think of this project as the "application layer" on top of what Ollama provides: the model runs in Ollama, and this app adds the assistant experience -- tools, truthfulness, diagnostics, and a clean desktop UI.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Radix UI (shadcn-style components) |
| Backend | Rust, Tauri 2 |
| Storage | SQLite via rusqlite (bundled), stored in OS app data directory |
| LLM runtime | Ollama HTTP API (localhost:11434), default model `qwen2.5:7b-instruct` |
| Networking | reqwest (Rust) for web search and page fetching |
| Icons | Lucide React |
| Build | Vite 6, TypeScript, cargo / tauri-cli |
| Tests | Vitest (frontend), cargo test (backend) |

---

## How to Run (Development)

**Prerequisites:**
- Node.js 18+
- Rust (stable, 1.70+)
- [Ollama](https://ollama.com) installed and running (`ollama serve`)

**Steps:**

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the app:
   ```bash
   npm run tauri dev
   ```
   This starts the Vite dev server and opens the Tauri window.

3. (Optional) Pull the default model if you have not already:
   ```bash
   ollama pull qwen2.5:7b-instruct
   ```

4. Run tests:
   ```bash
   npm test                                          # Frontend (Vitest)
   cargo test --manifest-path src-tauri/Cargo.toml   # Backend (Rust)
   ```

---

## How to Build the Installer (Windows)

1. Install the Tauri CLI if you have not already:
   ```bash
   cargo install tauri-cli --version "^2"
   ```

2. Build:
   ```bash
   npm run tauri build
   ```
   Or use the included script:
   ```powershell
   .\scripts\build-windows.ps1
   ```

3. Output:
   - **MSI installer:** `src-tauri/target/release/bundle/msi/`
   - **NSIS installer:** `src-tauri/target/release/bundle/nsis/`

   Double-click the installer. No Python, pip, or terminal is required for end users.

---

## Project Structure

| Path | Description |
|------|-------------|
| `src/` | React frontend (TypeScript, Tailwind, shadcn-style components) |
| `src/components/chat/` | Chat view, message bubbles, tool cards |
| `src/components/models/` | Model Library modal (browse, download, remove) |
| `src/components/diagnostics/` | Diagnostics panel (per-chat log viewer) |
| `src/components/onboarding/` | First-run onboarding flow |
| `src/components/sidebar/` | Conversation sidebar |
| `src/lib/toolLedger.ts` | Tool runtime ledger: truthfulness enforcement and provenance |
| `src/lib/toolPrompt.ts` | System prompt construction for tool-enabled sessions |
| `src/lib/modelCatalog.ts` | Curated model catalog with RAM and tag metadata |
| `src/lib/api.ts` | Frontend API layer (Tauri command invocations) |
| `src-tauri/` | Tauri (Rust) backend |
| `src-tauri/src/main.rs` | App entry point and Tauri command handlers |
| `src-tauri/src/ollama.rs` | Ollama HTTP API client: health, list, pull, chat stream |
| `src-tauri/src/storage.rs` | SQLite storage: conversations, messages, settings |
| `src-tauri/src/mcp.rs` | MCP-style tool definitions and execution (filesystem, Obsidian, web search, terminal) |
| `src-tauri/src/diagnostics.rs` | Diagnostic logging: event emission to frontend + file rotation |
| `src-tauri/src/gpu.rs` | GPU detection utilities |
| `src-tauri/src/provider.rs` | LLM provider trait (stub for future backends) |
| `scripts/` | Build and utility scripts |
| `tests/` | Test files |

---

## Safety Model

- **No telemetry.** The app makes zero network calls except to Ollama on localhost and (when the user explicitly enables it) DuckDuckGo for web search.
- **Tool permissions are opt-in.** Each tool category (filesystem, Obsidian, web search, terminal) must be individually enabled in Settings. Nothing is active by default.
- **Filesystem is sandboxed.** File operations are restricted to a user-selected root directory. Path traversal (`..`) is blocked; symlink escapes are detected. File size is capped at 512 KiB for reads.
- **Terminal commands are logged.** Every `run_command` invocation records the command, working directory, exit code, stdout, and stderr.
- **Web search uses DuckDuckGo.** No Google, no Bing by default. DuckDuckGo is a privacy-respecting search engine that does not track users.
- **Dangerous commands are visible.** Terminal tool invocations are exposed in the diagnostics panel with full request/response traces. The tool risk level is labeled ("high" for terminal, "read_only" for file reads, "write" for file writes, "network" for web).
- **Truthfulness enforcement.** The assistant cannot fabricate tool usage. If it claims it searched the web but the tool ledger shows no `web_search` invocation, the response is blocked.
- **Provenance on written files.** Every file written through the assistant includes a footer documenting what tools were used and what web sources (if any) informed the content.

---

## License

MIT. See [LICENSE](LICENSE).
