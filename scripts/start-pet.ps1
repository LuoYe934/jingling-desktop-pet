$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaExe = Join-Path $repoRoot 'src-tauri\target-qa\release\jingling_desktop_pet.exe'
$releaseExe = Join-Path $repoRoot 'src-tauri\target\release\jingling_desktop_pet.exe'

if (Test-Path $qaExe) {
  $exe = $qaExe
} elseif (Test-Path $releaseExe) {
  $exe = $releaseExe
} else {
  Write-Host "Desktop pet executable was not found. Run: npm run tauri:build"
  exit 1
}

$running = Get-Process -Name 'jingling_desktop_pet' -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 300
}

Write-Host "Starting desktop pet: $exe"
Start-Process -FilePath $exe
