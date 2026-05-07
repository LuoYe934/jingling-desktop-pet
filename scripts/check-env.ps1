Write-Host "Node:" -NoNewline
node -v
Write-Host "npm:" -NoNewline
npm -v

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

Write-Host "Rust:" -NoNewline
if (Get-Command rustc -ErrorAction SilentlyContinue) {
  rustc --version
} else {
  Write-Host " missing"
}

Write-Host "Cargo:" -NoNewline
if (Get-Command cargo -ErrorAction SilentlyContinue) {
  cargo --version
} else {
  Write-Host " missing"
}

Write-Host "WebView2 Runtime: check Windows Apps list if Tauri window fails to open."
