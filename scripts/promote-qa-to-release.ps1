$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaRelease = Join-Path $repoRoot 'src-tauri\target-qa\release'
$targetRelease = Join-Path $repoRoot 'src-tauri\target\release'
$qaExe = Join-Path $qaRelease 'jingling_desktop_pet.exe'

if (-not (Test-Path $qaExe)) {
  Write-Host "QA executable was not found. Run: npm run tauri:build:qa"
  exit 1
}

New-Item -ItemType Directory -Force -Path $targetRelease | Out-Null

$running = Get-Process -Name 'jingling_desktop_pet' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$qaRelease*" -or $_.Path -like "$targetRelease*" }
if ($running) {
  Write-Host "Stopping desktop pet executable before promotion..."
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 500
}

Get-ChildItem -Path $qaRelease -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetRelease $_.Name) -Force
}

Write-Host "Promoted QA build to release target:"
Write-Host "  From: $qaRelease"
Write-Host "  To:   $targetRelease"
