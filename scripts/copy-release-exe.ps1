$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseExe = Join-Path $projectRoot "src-tauri\target\release\vibe-rider.exe"
$rootExe = Join-Path $projectRoot "vibe-rider.exe"

if (-not (Test-Path -LiteralPath $releaseExe)) {
    throw "Release executable not found: $releaseExe"
}

Copy-Item -LiteralPath $releaseExe -Destination $rootExe -Force
Write-Host "Portable executable copied to $rootExe"
