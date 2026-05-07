$exe = Join-Path $PSScriptRoot '..\src-tauri\target\release\jingling_desktop_pet.exe'
$exe = [System.IO.Path]::GetFullPath($exe)

if (-not (Test-Path $exe)) {
  Write-Host "未找到桌宠程序，请先运行：npm run tauri:build"
  exit 1
}

Start-Process -FilePath $exe
