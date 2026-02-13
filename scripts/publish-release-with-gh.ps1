# Creates the v0.1.0 release and uploads the zip via GitHub CLI (avoids web upload errors).
# Prereqs: gh installed and logged in (gh auth login). Run from repo root.
# Usage: .\scripts\publish-release-with-gh.ps1

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$version = "0.1.0"
$zipName = "Local-Private-LLM-$version-win64.zip"
$zipPath = Join-Path $repoRoot $zipName

if (-not (Test-Path $zipPath)) {
    Write-Host "Zip not found. Run first: .\scripts\create-release-zip.ps1"
    exit 1
}

$tag = "v$version"
$notes = @"
Windows 64-bit portable build. Requires [Ollama](https://ollama.com) installed; the app will guide you to install and pull a model.
"@

# Create release and upload asset in one go (creates tag if missing)
gh release create $tag $zipPath --repo omarborish/local-private-llm --title $tag --notes $notes

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Release published: https://github.com/omarborish/local-private-llm/releases/tag/$tag"
} else {
    Write-Host "If the tag already exists, upload the asset only:"
    Write-Host "  gh release upload $tag $zipPath --repo omarborish/local-private-llm"
    exit 1
}
