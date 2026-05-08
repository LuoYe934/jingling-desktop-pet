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
Write-Host "Building QA executable into: $targetQa"
npx tauri build --no-bundle
