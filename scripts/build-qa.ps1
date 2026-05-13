$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetQa = Join-Path $repoRoot 'src-tauri\target-qa'

$runningQa = Get-Process -Name 'jingling_desktop_pet' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$targetQa*" }
if ($runningQa) {
  Write-Host "Stopping running QA executable before build..."
  $runningQa | Stop-Process -Force
  Start-Sleep -Milliseconds 500
}

$env:CARGO_TARGET_DIR = $targetQa
$env:JINGLING_QA_FEATURES = '1'
Write-Host "Building QA executable into: $targetQa"
Write-Host "QA feature gate: JINGLING_QA_FEATURES=1"
Write-Host "QA Tauri config: src-tauri\tauri.qa.conf.json"
Write-Host "This does not update the release executable in src-tauri\target\release."
Write-Host "Run QA with: npm run start:pet:qa"
Write-Host "Promote QA to release after verification with: npm run tauri:promote"
npx tauri build --no-bundle --config src-tauri/tauri.qa.conf.json
