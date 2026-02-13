# Creates a zip of the portable .exe for uploading to GitHub Releases.
# Run from repo root: .\scripts\create-release-zip.ps1
# Then go to https://github.com/omarborish/local-private-llm/releases/new

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$version = "0.1.0"
$exePath = "src-tauri\target\release\local-private-llm.exe"
# Tauri sometimes builds to target-tests when target is locked
$exePathAlt = "src-tauri\src-tauri\target-tests\release\local-private-llm.exe"
if (Test-Path (Join-Path $repoRoot $exePathAlt)) { $exePath = $exePathAlt }
$exePath = Join-Path $repoRoot $exePath
$zipName = "Local-Private-LLM-$version-win64.zip"
$zipPath = Join-Path $repoRoot $zipName

if (-not (Test-Path $exePath)) {
    Write-Error "Build the app first: npm run tauri build. Expected: src-tauri\target\release\local-private-llm.exe (or target-tests path)"
    exit 1
}

$dir = Split-Path $exePath -Parent
$exeName = Split-Path $exePath -Leaf
Push-Location $dir
Compress-Archive -Path $exeName -DestinationPath $zipPath -Force
Pop-Location

$fullZip = $zipPath
Write-Host "Created: $fullZip"
Write-Host ""
Write-Host "Next: Create a release on GitHub"
Write-Host "  Option A (recommended if web upload fails): .\scripts\publish-release-with-gh.ps1"
Write-Host "  Option B (web): https://github.com/omarborish/local-private-llm/releases/new"
Write-Host "    Tag: v$version, attach: $zipName, then Publish"
