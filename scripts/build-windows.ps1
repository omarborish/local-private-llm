# Build Local Private LLM Windows installer
# Requires: Node.js, Rust, Tauri CLI (cargo install tauri-cli --version "^2")
Set-Location $PSScriptRoot\..

Write-Host "Installing frontend dependencies..."
npm ci

Write-Host "Building Windows installer..."
npm run tauri build

Write-Host "Output: src-tauri\target\release\bundle\"
Get-ChildItem -Path "src-tauri\target\release\bundle" -Recurse -Include "*.msi","*.exe" | ForEach-Object { $_.FullName }
