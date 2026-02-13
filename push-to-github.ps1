# Run this script from the project root to push to GitHub.
# Usage: .\push-to-github.ps1
# If your GitHub username is not "omarb", edit $repoUrl below.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Replace with your GitHub username if different (e.g. "johndoe"):
$repoUrl = "https://github.com/omarborish/local-private-llm.git"

# Remove stale lock so git can run
$lock = ".git\index.lock"
if (Test-Path $lock) {
    Remove-Item $lock -Force
    Write-Host "Removed .git/index.lock"
}

git add .
git status --short | Select-Object -First 20
git commit -m "Initial commit: Local Private LLM v0.1.0"
git branch -M main
git remote add origin $repoUrl 2>$null
if ($LASTEXITCODE -ne 0) { git remote set-url origin $repoUrl }
git push -u origin main
Write-Host "Done. Repo: https://github.com/omarborish/local-private-llm"
