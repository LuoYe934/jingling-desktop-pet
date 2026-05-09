param(
  [ValidateSet('release', 'qa', 'auto')]
  [string]$Channel = 'release'
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaExe = Join-Path $repoRoot 'src-tauri\target-qa\release\jingling_desktop_pet.exe'
$releaseExe = Join-Path $repoRoot 'src-tauri\target\release\jingling_desktop_pet.exe'

function Select-DesktopPetExecutable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RequestedChannel
  )

  switch ($RequestedChannel) {
    'release' {
      if (Test-Path $releaseExe) {
        return @{ Channel = 'release'; Exe = $releaseExe }
      }

      Write-Host "Release executable was not found:"
      Write-Host "  $releaseExe"
      Write-Host "Build release with: npm run tauri:build:release"
      Write-Host "Or promote a tested QA build with: npm run tauri:promote"
      exit 1
    }
    'qa' {
      if (Test-Path $qaExe) {
        return @{ Channel = 'qa'; Exe = $qaExe }
      }

      Write-Host "QA executable was not found:"
      Write-Host "  $qaExe"
      Write-Host "Build QA with: npm run tauri:build:qa"
      exit 1
    }
    'auto' {
      if (Test-Path $releaseExe) {
        return @{ Channel = 'release'; Exe = $releaseExe }
      }
      if (Test-Path $qaExe) {
        return @{ Channel = 'qa'; Exe = $qaExe }
      }

      Write-Host "Desktop pet executable was not found."
      Write-Host "Build release with: npm run tauri:build:release"
      Write-Host "Or build QA with: npm run tauri:build:qa"
      exit 1
    }
  }
}

$selection = Select-DesktopPetExecutable -RequestedChannel $Channel
$exe = $selection.Exe

$running = Get-Process -Name 'jingling_desktop_pet' -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Stopping running desktop pet process before starting $($selection.Channel)..."
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 300
}

Write-Host "Starting desktop pet channel: $($selection.Channel)"
Write-Host "Executable: $exe"
Start-Process -FilePath $exe
