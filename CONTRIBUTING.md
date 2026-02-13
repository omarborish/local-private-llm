# Contributing to Local Private LLM

Thanks for your interest in contributing.

## Development setup

1. **Prerequisites**
   - Node.js 18+
   - Rust (stable)
   - [Ollama](https://ollama.com) installed and running (for chat features)
   - Tauri CLI: `cargo install tauri-cli --version "^2"`

2. **Clone and install**
   ```bash
   git clone <repo-url>
   cd "Local Private LLM"
   npm install
   ```

3. **Run in development**
   ```bash
   npm run tauri dev
   ```
   This starts the Vite dev server and the Tauri window.

4. **Run tests**
   - Rust: `cargo test --manifest-path src-tauri/Cargo.toml`
   - Frontend: add and run your preferred test runner (e.g. Vitest) if needed.

## Code structure

- **Frontend**: `src/` — React + TypeScript, Tailwind, shadcn-style components.
- **Backend**: `src-tauri/src/` — Rust; Ollama client, SQLite storage, Tauri commands.
- **Storage**: SQLite in OS app data dir; schema in `storage.rs`.

## Pull requests

- Keep changes focused; prefer small PRs.
- Ensure the app still runs with `npm run tauri dev` and that Rust tests pass.
- For new features (e.g. a new LLM backend), follow the existing patterns (e.g. provider trait in `provider.rs`).

## Code of conduct

Be respectful and constructive. This project is privacy-first and does not include telemetry.
