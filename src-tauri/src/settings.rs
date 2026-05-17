use crate::{deepseek, memory};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::Child,
    sync::Mutex,
    time::Duration,
};
#[cfg(all(target_os = "windows", not(mobile)))]
use std::process::{Command, Stdio};
#[cfg(all(target_os = "windows", not(mobile)))]
use std::os::windows::process::CommandExt;
#[cfg(not(mobile))]
use tauri::{LogicalSize, Size};
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(not(mobile))]
use tauri_plugin_autostart::ManagerExt;

const PET_BASE_WIDTH: f64 = 300.0;
const PET_BASE_HEIGHT: f64 = 360.0;
const PET_MIN_SCALE: f64 = 0.35;
const PET_MAX_SCALE: f64 = 3.2;
#[cfg(all(target_os = "windows", not(mobile)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(not(mobile))]
const VISION_BRIDGE_HOST: &str = "127.0.0.1";
#[cfg(not(mobile))]
const VISION_BRIDGE_PORT: u16 = 8765;

#[derive(Default)]
pub struct TtsPreviewState {
    child: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowContext {
    pub title: String,
    pub process_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureOptions {
    pub reason: Option<String>,
    pub mode: Option<String>,
    pub region: Option<String>,
    pub region_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeScreenEnhancementSettings {
    pub ocr_enabled: bool,
    pub ui_read_enabled: bool,
    pub default_region: String,
    pub timeout_ms: u64,
}

impl Default for FreeModeScreenEnhancementSettings {
    fn default() -> Self {
        Self {
            ocr_enabled: true,
            ui_read_enabled: true,
            default_region: "full".to_string(),
            timeout_ms: 4500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeVisionConfig {
    pub enabled: bool,
    pub provider: String,
    pub service_url: String,
    pub station_url: String,
    pub qwen_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub send_image_base64: bool,
}

impl Default for FreeModeVisionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: "lm-studio".to_string(),
            service_url: "http://127.0.0.1:8765/vision".to_string(),
            station_url: "http://127.0.0.1:2020/v1".to_string(),
            qwen_url: "http://127.0.0.1:1234/v1/chat/completions".to_string(),
            model: "qwen2.5-vl-3b-instruct".to_string(),
            timeout_ms: 30000,
            send_image_base64: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeWatcherSettings {
    pub enabled: bool,
    pub interval_ms: u64,
    pub cooldown_ms: u64,
    pub region: String,
    pub mode: String,
    pub hidden_observation: bool,
    pub max_vision_calls_per_hour: u32,
}

impl Default for FreeModeWatcherSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_ms: 5000,
            cooldown_ms: 45000,
            region: "active-window".to_string(),
            mode: "gentle".to_string(),
            hidden_observation: true,
            max_vision_calls_per_hour: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeHttpToolConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub url: String,
    pub timeout_ms: u64,
    pub include_screen_context: bool,
}

impl Default for FreeModeHttpToolConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: false,
            url: String::new(),
            timeout_ms: 8000,
            include_screen_context: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeMcpReservedSettings {
    pub enabled: bool,
    pub default_timeout_ms: u64,
    pub servers: Vec<String>,
}

impl Default for FreeModeMcpReservedSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            default_timeout_ms: 30000,
            servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeEnhancementSettings {
    pub screen: FreeModeScreenEnhancementSettings,
    pub vision: FreeModeVisionConfig,
    pub watcher: FreeModeWatcherSettings,
    pub http_tools: Vec<FreeModeHttpToolConfig>,
    pub mcp: FreeModeMcpReservedSettings,
}

impl Default for FreeModeEnhancementSettings {
    fn default() -> Self {
        Self {
            screen: FreeModeScreenEnhancementSettings::default(),
            vision: FreeModeVisionConfig::default(),
            watcher: FreeModeWatcherSettings::default(),
            http_tools: Vec::new(),
            mcp: FreeModeMcpReservedSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeScreenContextOptions {
    pub user_input: Option<String>,
    pub prompt: Option<String>,
    pub reason: Option<String>,
    pub region: Option<String>,
    pub region_label: Option<String>,
    pub include_vision: Option<bool>,
    pub include_http_tools: Option<bool>,
    pub hide_overlay: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextResult {
    pub available: bool,
    pub message: String,
    pub text: String,
    pub image_path: String,
    pub image_hash: String,
    pub title: String,
    pub process_name: String,
    pub captured_at: String,
    pub region: String,
    pub region_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeContextResult {
    pub available: bool,
    pub message: String,
    pub screen: ScreenContextResult,
    pub ui_text: String,
    pub vision_text: String,
    pub tool_text: String,
    pub image_base64_sent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeToolResult {
    pub available: bool,
    pub message: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default = "default_reply_limit")]
    pub reply_limit: usize,
    #[serde(default)]
    pub free_mode_enhancement: FreeModeEnhancementSettings,
}

fn default_model() -> String {
    "deepseek-v4-flash".to_string()
}

fn default_scale() -> f64 {
    1.0
}

fn default_always_on_top() -> bool {
    true
}

fn default_reply_limit() -> usize {
    100
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model: default_model(),
            scale: default_scale(),
            always_on_top: default_always_on_top(),
            reply_limit: default_reply_limit(),
            free_mode_enhancement: FreeModeEnhancementSettings::default(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法读取应用数据目录: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用数据目录: {err}"))?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(path).map_err(|err| format!("无法读取设置: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("设置文件格式错误: {err}"))
}

fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let content = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| format!("无法保存设置: {err}"))
}

fn emit_settings_changed(app: &AppHandle, settings: &AppSettings) {
    let _ = app.emit("settings:changed", settings.clone());
}

#[cfg(not(mobile))]
fn apply_pet_size(app: &AppHandle, scale: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };

    let normalized = scale.clamp(PET_MIN_SCALE, PET_MAX_SCALE);
    window
        .set_size(Size::Logical(LogicalSize::new(
            PET_BASE_WIDTH * normalized,
            PET_BASE_HEIGHT * normalized,
        )))
        .map_err(|err| format!("调整桌宠大小失败: {err}"))
}

#[cfg(not(mobile))]
pub fn apply_saved_pet_size(app: &AppHandle) -> Result<(), String> {
    let settings = load_settings(app)?;
    apply_pet_size(app, settings.scale)
}

#[cfg(not(mobile))]
fn show_window(app: &AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.show().map_err(|err| format!("显示窗口失败: {err}"))?;
        window.set_focus().map_err(|err| format!("聚焦窗口失败: {err}"))?;
    }
    Ok(())
}

#[cfg(not(mobile))]
fn hide_window(app: &AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.hide().map_err(|err| format!("隐藏窗口失败: {err}"))?;
    }
    Ok(())
}

#[cfg(not(mobile))]
fn toggle_window(app: &AppHandle, label: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|err| format!("隐藏窗口失败: {err}"))?;
        } else {
            window.show().map_err(|err| format!("显示窗口失败: {err}"))?;
            window.set_focus().map_err(|err| format!("聚焦窗口失败: {err}"))?;
        }
    }
    Ok(())
}

#[cfg(not(mobile))]
fn temporarily_hide_free_mode_capture_overlays(app: &AppHandle) -> Result<(bool, bool), String> {
    let free_mode_was_visible = app
        .get_webview_window("free-mode")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let pet_was_visible = app
        .get_webview_window("pet")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if free_mode_was_visible {
        hide_window(app, "free-mode")?;
    }
    if pet_was_visible {
        hide_window(app, "pet")?;
    }
    if free_mode_was_visible || pet_was_visible {
        std::thread::sleep(Duration::from_millis(220));
    }

    Ok((free_mode_was_visible, pet_was_visible))
}

#[cfg(not(mobile))]
fn restore_free_mode_capture_overlays(
    app: &AppHandle,
    free_mode_was_visible: bool,
    pet_was_visible: bool,
) -> Result<(), String> {
    if pet_was_visible {
        show_window(app, "pet")?;
    }
    if free_mode_was_visible {
        show_window(app, "free-mode")?;
    }
    Ok(())
}

#[cfg(mobile)]
fn temporarily_hide_free_mode_capture_overlays(_app: &AppHandle) -> Result<(bool, bool), String> {
    Ok((false, false))
}

#[cfg(mobile)]
fn restore_free_mode_capture_overlays(
    _app: &AppHandle,
    _free_mode_was_visible: bool,
    _pet_was_visible: bool,
) -> Result<(), String> {
    Ok(())
}

fn qa_modes_enabled() -> bool {
    crate::web_bridge::qa_features_enabled()
}

fn ensure_qa_modes_enabled() -> Result<(), String> {
    if qa_modes_enabled() {
        Ok(())
    } else {
        Err("QA-only feature is not available in this build.".to_string())
    }
}

fn encode_url_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn limit_free_mode_context_text(value: &str, limit: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= limit {
        normalized
    } else {
        normalized.chars().take(limit).collect::<String>() + "..."
    }
}

fn looks_like_http_url(url: &str) -> bool {
    let value = url.trim().to_ascii_lowercase();
    value.starts_with("http://") || value.starts_with("https://")
}

fn is_loopback_http_url(url: &str) -> bool {
    let value = url.trim().to_ascii_lowercase();
    value.starts_with("http://127.0.0.1")
        || value.starts_with("http://localhost")
        || value.starts_with("http://[::1]")
}

#[cfg(not(mobile))]
fn is_default_vision_bridge_url(url: &str) -> bool {
    let value = url.trim().to_ascii_lowercase();
    value == "http://127.0.0.1:8765/vision" || value == "http://localhost:8765/vision"
}

#[cfg(not(mobile))]
fn vision_bridge_is_running() -> bool {
    let address = (VISION_BRIDGE_HOST, VISION_BRIDGE_PORT)
        .to_socket_addrs()
        .ok()
        .and_then(|mut items| items.next());
    let Some(address) = address else {
        return false;
    };
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

#[cfg(not(mobile))]
fn ensure_free_mode_vision_bridge(app: &AppHandle, config: &FreeModeVisionConfig) -> Result<(), String> {
    if !config.enabled || !is_default_vision_bridge_url(&config.service_url) || vision_bridge_is_running() {
        return Ok(());
    }

    let resource_bridge = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("scripts").join("moondream-vision-bridge.mjs"));
    let cwd_bridge = std::env::current_dir()
        .ok()
        .map(|dir| dir.join("scripts").join("moondream-vision-bridge.mjs"));
    let bridge_script = resource_bridge
        .filter(|path| path.exists())
        .or_else(|| cwd_bridge.filter(|path| path.exists()))
        .ok_or_else(|| "Moondream vision bridge script not found.".to_string())?;

    let mut command = Command::new("node");
    command
        .arg(&bridge_script)
        .env("MOONDREAM_STATION_URL", config.station_url.trim())
        .env("JINGLING_VISION_TIMEOUT_MS", config.timeout_ms.clamp(1000, 60000).to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(parent) = bridge_script.parent().and_then(|dir| dir.parent()) {
        command.current_dir(parent);
    }
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Failed to auto-start Moondream vision bridge: {err}"))
}

#[cfg(mobile)]
fn ensure_free_mode_vision_bridge(_app: &AppHandle, _config: &FreeModeVisionConfig) -> Result<(), String> {
    Ok(())
}

#[cfg(not(mobile))]
pub fn ensure_free_mode_vision_bridge_for_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    ensure_free_mode_vision_bridge(app, &settings.free_mode_enhancement.vision)
}

#[cfg(mobile)]
pub fn ensure_free_mode_vision_bridge_for_settings(_app: &AppHandle, _settings: &AppSettings) -> Result<(), String> {
    Ok(())
}

async fn post_free_mode_json(
    url: &str,
    payload: serde_json::Value,
    timeout_ms: u64,
) -> Result<FreeModeToolResult, String> {
    let target = url.trim();
    if target.is_empty() {
        return Ok(FreeModeToolResult {
            available: false,
            message: "URL is empty.".to_string(),
            text: String::new(),
        });
    }
    if !looks_like_http_url(target) {
        return Ok(FreeModeToolResult {
            available: false,
            message: "Only http/https tool URLs are supported.".to_string(),
            text: String::new(),
        });
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.clamp(1000, 60000)))
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))?;
    let response = client
        .post(target)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("HTTP tool request failed: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| String::new());
    if !status.is_success() {
        return Ok(FreeModeToolResult {
            available: false,
            message: format!("HTTP tool returned {status}: {}", limit_free_mode_context_text(&body, 500)),
            text: String::new(),
        });
    }
    let parsed_body = serde_json::from_str::<serde_json::Value>(&body).ok();
    let text = parsed_body
        .as_ref()
        .and_then(|value| {
            value
                .get("text")
                .and_then(|item| item.as_str())
                .or_else(|| value.get("result").and_then(|item| item.as_str()))
                .map(|item| item.to_string())
        })
        .unwrap_or_else(|| body.trim().to_string());
    let payload_message = parsed_body
        .as_ref()
        .and_then(|value| value.get("message").and_then(|item| item.as_str()))
        .map(str::to_string);
    let available = parsed_body
        .as_ref()
        .and_then(|value| value.get("available").and_then(|item| item.as_bool()))
        .unwrap_or_else(|| !text.trim().is_empty());
    Ok(FreeModeToolResult {
        available,
        message: payload_message.unwrap_or_else(|| if text.trim().is_empty() {
            "HTTP tool returned an empty response.".to_string()
        } else if available {
            "HTTP tool completed.".to_string()
        } else {
            "HTTP tool is not available.".to_string()
        }),
        text: limit_free_mode_context_text(&text, 1800),
    })
}

#[cfg(all(target_os = "windows", not(mobile)))]
fn read_scaled_jpeg_base64(path: &str, max_side: u32, quality: u32) -> Result<(String, String), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok((String::new(), "image/jpeg".to_string()));
    }

    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = $env:JINGLING_VISION_SOURCE_IMAGE
$maxSide = [Math]::Max(128, [int]$env:JINGLING_VISION_MAX_SIDE)
$quality = [Math]::Min(92, [Math]::Max(35, [int]$env:JINGLING_VISION_JPEG_QUALITY))
$image = [System.Drawing.Image]::FromFile($source)
try {
  $scale = [Math]::Min(1.0, $maxSide / [double]([Math]::Max($image.Width, $image.Height)))
  $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($image, 0, 0, $width, $height)
    $stream = New-Object System.IO.MemoryStream
    try {
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
      $encoder = [System.Drawing.Imaging.Encoder]::Quality
      $params = New-Object System.Drawing.Imaging.EncoderParameters 1
      $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([int64]$quality)
      $bitmap.Save($stream, $codec, $params)
      [Convert]::ToBase64String($stream.ToArray())
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
  }
} finally {
  if ($image) { $image.Dispose() }
}
"#;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("JINGLING_VISION_SOURCE_IMAGE", trimmed)
        .env("JINGLING_VISION_MAX_SIDE", max_side.to_string())
        .env("JINGLING_VISION_JPEG_QUALITY", quality.to_string())
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to run screenshot resize helper: {err}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "Screenshot resize helper failed.".to_string()
        } else {
            format!("Screenshot resize helper failed: {error}")
        });
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("Screenshot resize helper returned empty image.".to_string());
    }
    Ok((text, "image/jpeg".to_string()))
}

#[cfg(any(mobile, not(target_os = "windows")))]
fn read_scaled_jpeg_base64(path: &str, _max_side: u32, _quality: u32) -> Result<(String, String), String> {
    use base64::{engine::general_purpose, Engine as _};

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok((String::new(), "image/png".to_string()));
    }
    let bytes = fs::read(trimmed).map_err(|err| format!("Failed to read screenshot: {err}"))?;
    Ok((general_purpose::STANDARD.encode(bytes), "image/png".to_string()))
}

fn hash_file_sha256(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Ok(bytes) = fs::read(trimmed) else {
        return String::new();
    };
    let digest = Sha256::digest(&bytes);
    format!("{digest:x}")
}

#[cfg(not(mobile))]
fn open_browser_url(url: &str) -> Result<(), String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("URL is empty.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let script = "Start-Process -FilePath $env:JINGLING_OPEN_URL";
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
            .env("JINGLING_OPEN_URL", target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|err| format!("Failed to open browser: {err}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        Err("Opening browser from QA mode is currently only wired for Windows.".to_string())
    }
}

#[tauri::command]
pub fn save_api_key(api_key: String) -> Result<(), String> {
    deepseek::write_api_key(&api_key)
}

#[tauri::command]
pub fn has_api_key() -> Result<bool, String> {
    Ok(deepseek::read_api_key()?.is_some())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let next = AppSettings {
        scale: settings.scale.clamp(PET_MIN_SCALE, PET_MAX_SCALE),
        reply_limit: settings.reply_limit.clamp(20, 2000),
        ..settings
    };
    save_settings(&app, &next)?;
    #[cfg(not(mobile))]
    apply_pet_size(&app, next.scale)?;
    #[cfg(not(mobile))]
    for label in ["pet", "chat", "tavern"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_always_on_top(next.always_on_top)
                .map_err(|err| format!("设置置顶失败: {err}"))?;
        }
    }
    emit_settings_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn set_pet_scale(app: AppHandle, scale: f64) -> Result<f64, String> {
    let normalized = scale.clamp(PET_MIN_SCALE, PET_MAX_SCALE);
    let mut settings = load_settings(&app)?;
    settings.scale = normalized;
    save_settings(&app, &settings)?;
    #[cfg(not(mobile))]
    apply_pet_size(&app, normalized)?;
    emit_settings_changed(&app, &settings);
    Ok(normalized)
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<bool, String> {
    for label in ["pet", "chat", "tavern"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_always_on_top(enabled)
                .map_err(|err| format!("设置置顶失败: {err}"))?;
        }
    }
    let mut settings = load_settings(&app)?;
    settings.always_on_top = enabled;
    save_settings(&app, &settings)?;
    emit_settings_changed(&app, &settings);
    Ok(enabled)
}

#[tauri::command]
#[cfg(mobile)]
pub fn set_always_on_top(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let mut settings = load_settings(&app)?;
    settings.always_on_top = enabled;
    save_settings(&app, &settings)?;
    emit_settings_changed(&app, &settings);
    Ok(enabled)
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn toggle_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autostart = app.autolaunch();
    if enabled {
        autostart
            .enable()
            .map_err(|err| format!("启用开机自启失败: {err}"))?;
    } else {
        autostart
            .disable()
            .map_err(|err| format!("关闭开机自启失败: {err}"))?;
    }
    autostart
        .is_enabled()
        .map_err(|err| format!("读取开机自启状态失败: {err}"))
}

#[tauri::command]
#[cfg(mobile)]
pub fn toggle_autostart(_app: AppHandle, _enabled: bool) -> Result<bool, String> {
    Err("Autostart is not supported on mobile.".to_string())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn show_chat_window(app: AppHandle) -> Result<(), String> {
    show_window(&app, "chat")
}

#[tauri::command]
#[cfg(mobile)]
pub fn show_chat_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn hide_chat_window(app: AppHandle) -> Result<(), String> {
    hide_window(&app, "chat")
}

#[tauri::command]
#[cfg(mobile)]
pub fn hide_chat_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn toggle_chat_window(app: AppHandle) -> Result<(), String> {
    toggle_window(&app, "chat")
}

#[tauri::command]
#[cfg(mobile)]
pub fn toggle_chat_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn show_tavern_window(app: AppHandle) -> Result<(), String> {
    show_window(&app, "tavern")
}

#[tauri::command]
#[cfg(mobile)]
pub fn show_tavern_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn hide_tavern_window(app: AppHandle) -> Result<(), String> {
    hide_window(&app, "tavern")
}

#[tauri::command]
#[cfg(mobile)]
pub fn hide_tavern_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn toggle_tavern_window(app: AppHandle) -> Result<(), String> {
    toggle_window(&app, "tavern")
}

#[tauri::command]
#[cfg(mobile)]
pub fn toggle_tavern_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn show_free_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    let settings = load_settings(&app)?;
    let _ = ensure_free_mode_vision_bridge(&app, &settings.free_mode_enhancement.vision);
    hide_window(&app, "pet")?;
    show_window(&app, "free-mode")
}

#[tauri::command]
#[cfg(mobile)]
pub fn show_free_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn hide_free_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    hide_window(&app, "free-mode")
}

#[tauri::command]
#[cfg(mobile)]
pub fn hide_free_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn toggle_free_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    if let Some(window) = app.get_webview_window("free-mode") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|err| format!("闅愯棌绐楀彛澶辫触: {err}"))?;
        } else {
            let settings = load_settings(&app)?;
            let _ = ensure_free_mode_vision_bridge(&app, &settings.free_mode_enhancement.vision);
            hide_window(&app, "pet")?;
            window.show().map_err(|err| format!("鏄剧ず绐楀彛澶辫触: {err}"))?;
            window.set_focus().map_err(|err| format!("鑱氱劍绐楀彛澶辫触: {err}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
#[cfg(mobile)]
pub fn toggle_free_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn show_story_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    show_window(&app, "story-mode")
}

#[tauri::command]
#[cfg(mobile)]
pub fn show_story_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn hide_story_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    hide_window(&app, "story-mode")
}

#[tauri::command]
#[cfg(mobile)]
pub fn hide_story_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn toggle_story_mode_window(app: AppHandle) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    toggle_window(&app, "story-mode")
}

#[tauri::command]
#[cfg(mobile)]
pub fn toggle_story_mode_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(all(target_os = "windows", not(mobile)))]
pub fn get_active_window_context() -> Result<ActiveWindowContext, String> {
    ensure_qa_modes_enabled()?;
    let script = r#"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Foreground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$handle = [Win32Foreground]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][Win32Foreground]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
$processId = 0
[void][Win32Foreground]::GetWindowThreadProcessId($handle, [ref]$processId)
$processName = ""
if ($processId -gt 0) {
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[pscustomobject]@{
  title = $titleBuilder.ToString()
  processName = $processName
} | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to inspect active window: {err}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "Failed to inspect active window.".to_string()
        } else {
            error
        });
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str::<ActiveWindowContext>(&text)
        .map_err(|err| format!("Failed to parse active window context: {err}"))
}

#[tauri::command]
#[cfg(any(mobile, not(target_os = "windows")))]
pub fn get_active_window_context() -> Result<ActiveWindowContext, String> {
    ensure_qa_modes_enabled()?;
    Ok(ActiveWindowContext {
        title: String::new(),
        process_name: String::new(),
    })
}

#[tauri::command]
#[cfg(all(target_os = "windows", not(mobile)))]
pub fn capture_screen_text_command(
    app: AppHandle,
    options: Option<ScreenCaptureOptions>,
) -> Result<ScreenContextResult, String> {
    ensure_qa_modes_enabled()?;
    let _ = options
        .as_ref()
        .and_then(|value| value.reason.as_deref())
        .unwrap_or("");
    let region = options
        .as_ref()
        .and_then(|value| value.region.as_deref())
        .unwrap_or("full")
        .to_string();
    let region_label = options
        .as_ref()
        .and_then(|value| value.region_label.as_deref())
        .unwrap_or("整个屏幕")
        .to_string();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?
        .join("screen-context");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create screen context directory: {err}"))?;
    let image_path = dir.join("screen-context-latest.png");
    let image_path_text = image_path.to_string_lossy().to_string();
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = [ordered]@{
  available = $false
  message = ""
  text = ""
  imagePath = $env:JINGLING_SCREEN_CONTEXT_IMAGE
  title = ""
  processName = ""
  capturedAt = [DateTimeOffset]::Now.ToString("o")
  region = $env:JINGLING_SCREEN_CONTEXT_REGION
  regionLabel = $env:JINGLING_SCREEN_CONTEXT_REGION_LABEL
}
try {
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32ScreenContext {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
  $handle = [Win32ScreenContext]::GetForegroundWindow()
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [void][Win32ScreenContext]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
  $result.title = $titleBuilder.ToString()
  $processId = 0
  [void][Win32ScreenContext]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -gt 0) {
    try { $result.processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, $bounds.Top, $bounds.Width, $bounds.Height
  $region = $env:JINGLING_SCREEN_CONTEXT_REGION
  if ($region -eq "active-window" -and $handle -ne [IntPtr]::Zero) {
    $rect = New-Object Win32ScreenContext+RECT
    if ([Win32ScreenContext]::GetWindowRect($handle, [ref]$rect)) {
      $x = [Math]::Max($bounds.Left, $rect.Left)
      $y = [Math]::Max($bounds.Top, $rect.Top)
      $right = [Math]::Min($bounds.Right, $rect.Right)
      $bottom = [Math]::Min($bounds.Bottom, $rect.Bottom)
      $w = [Math]::Max(1, $right - $x)
      $h = [Math]::Max(1, $bottom - $y)
      $captureBounds = New-Object System.Drawing.Rectangle $x, $y, $w, $h
    }
  }
  switch ($region) {
    "mouse" {
      $point = New-Object Win32ScreenContext+POINT
      if ([Win32ScreenContext]::GetCursorPos([ref]$point)) {
        $w = [Math]::Min(720, [Math]::Max(1, [int]($bounds.Width * 0.38)))
        $h = [Math]::Min(520, [Math]::Max(1, [int]($bounds.Height * 0.38)))
        $x = [Math]::Min([Math]::Max($bounds.Left, $point.X - [int]($w / 2)), $bounds.Right - $w)
        $y = [Math]::Min([Math]::Max($bounds.Top, $point.Y - [int]($h / 2)), $bounds.Bottom - $h)
        $captureBounds = New-Object System.Drawing.Rectangle $x, $y, $w, $h
      }
    }
    "top-left" {
      $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, $bounds.Top, ([Math]::Max(1, [int]($bounds.Width / 2))), ([Math]::Max(1, [int]($bounds.Height / 2)))
    }
    "top-right" {
      $w = [Math]::Max(1, [int]($bounds.Width / 2))
      $captureBounds = New-Object System.Drawing.Rectangle ($bounds.Left + $bounds.Width - $w), $bounds.Top, $w, ([Math]::Max(1, [int]($bounds.Height / 2)))
    }
    "bottom-left" {
      $h = [Math]::Max(1, [int]($bounds.Height / 2))
      $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, ($bounds.Top + $bounds.Height - $h), ([Math]::Max(1, [int]($bounds.Width / 2))), $h
    }
    "bottom-right" {
      $w = [Math]::Max(1, [int]($bounds.Width / 2))
      $h = [Math]::Max(1, [int]($bounds.Height / 2))
      $captureBounds = New-Object System.Drawing.Rectangle ($bounds.Left + $bounds.Width - $w), ($bounds.Top + $bounds.Height - $h), $w, $h
    }
    "center" {
      $w = [Math]::Max(1, [int]($bounds.Width * 0.5))
      $h = [Math]::Max(1, [int]($bounds.Height * 0.5))
      $captureBounds = New-Object System.Drawing.Rectangle ($bounds.Left + [int](($bounds.Width - $w) / 2)), ($bounds.Top + [int](($bounds.Height - $h) / 2)), $w, $h
    }
    "left" {
      $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, $bounds.Top, ([Math]::Max(1, [int]($bounds.Width / 2))), $bounds.Height
    }
    "right" {
      $w = [Math]::Max(1, [int]($bounds.Width / 2))
      $captureBounds = New-Object System.Drawing.Rectangle ($bounds.Left + $bounds.Width - $w), $bounds.Top, $w, $bounds.Height
    }
    "top" {
      $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, $bounds.Top, $bounds.Width, ([Math]::Max(1, [int]($bounds.Height / 2)))
    }
    "bottom" {
      $h = [Math]::Max(1, [int]($bounds.Height / 2))
      $captureBounds = New-Object System.Drawing.Rectangle $bounds.Left, ($bounds.Top + $bounds.Height - $h), $bounds.Width, $h
    }
  }
  $bitmap = New-Object System.Drawing.Bitmap $captureBounds.Width, $captureBounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($captureBounds.Left, $captureBounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($env:JINGLING_SCREEN_CONTEXT_IMAGE, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

    function Invoke-WinRtAsyncOperation($Operation, [Type]$ResultType) {
      $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
          $_.Name -eq "AsTask" -and
          $_.IsGenericMethodDefinition -and
          $_.GetParameters().Count -eq 1 -and
          $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
        } |
        Select-Object -First 1
      if ($null -eq $method) {
        throw "Windows Runtime AsTask helper was not found."
      }
      $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
      [void]$task.Wait()
      return $task.Result
    }

    $storageFile = Invoke-WinRtAsyncOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:JINGLING_SCREEN_CONTEXT_IMAGE)) ([Windows.Storage.StorageFile])
    $stream = Invoke-WinRtAsyncOperation ($storageFile.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    try {
      $decoder = Invoke-WinRtAsyncOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $softwareBitmap = Invoke-WinRtAsyncOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      if ($null -eq $engine) {
        $result.message = "Screen capture saved, but Windows OCR is unavailable for the current user languages."
      } else {
        $ocrResult = Invoke-WinRtAsyncOperation ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
        $result.text = $ocrResult.Text
        $result.available = -not [string]::IsNullOrWhiteSpace($result.text)
        if ($result.available) {
          $result.message = "Screen capture and OCR completed."
        } else {
          $result.message = "Screen capture saved, but OCR found no readable text."
        }
      }
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  } catch {
    $result.message = "Screen capture saved, but Windows OCR is unavailable: $($_.Exception.Message)"
  }
} catch {
  $result.message = "Screen capture failed: $($_.Exception.Message)"
}
[pscustomobject]$result | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("JINGLING_SCREEN_CONTEXT_IMAGE", &image_path_text)
        .env("JINGLING_SCREEN_CONTEXT_REGION", &region)
        .env("JINGLING_SCREEN_CONTEXT_REGION_LABEL", &region_label)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to run screen capture helper: {err}"))?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(ScreenContextResult {
            available: false,
            message: if error.is_empty() {
                "Screen capture helper returned no result.".to_string()
            } else {
                format!("Screen capture helper returned no result: {error}")
            },
            text: String::new(),
            image_path: image_path_text,
            image_hash: String::new(),
            title: String::new(),
            process_name: String::new(),
            captured_at: String::new(),
            region,
            region_label,
        });
    }
    let mut result = serde_json::from_str::<ScreenContextResult>(&text)
        .map_err(|err| format!("Failed to parse screen context result: {err}"))?;
    result.image_hash = hash_file_sha256(&result.image_path);
    Ok(result)
}

#[tauri::command]
#[cfg(any(mobile, not(target_os = "windows")))]
pub fn capture_screen_text_command(
    _app: AppHandle,
    _options: Option<ScreenCaptureOptions>,
) -> Result<ScreenContextResult, String> {
    Ok(ScreenContextResult {
        available: false,
        message: "Screen OCR is only available in Windows QA desktop builds.".to_string(),
        text: String::new(),
        image_path: String::new(),
        image_hash: String::new(),
        title: String::new(),
        process_name: String::new(),
        captured_at: String::new(),
        region: String::new(),
        region_label: String::new(),
    })
}

#[cfg(all(target_os = "windows", not(mobile)))]
fn capture_active_window_ui_text(timeout_ms: u64) -> String {
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$items = New-Object System.Collections.Generic.List[string]
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32UiRead {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $handle = [Win32UiRead]::GetForegroundWindow()
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($null -eq $root) {
    $root = [System.Windows.Automation.AutomationElement]::FocusedElement
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($root)
  $deadline = [DateTime]::UtcNow.AddMilliseconds([double]$env:JINGLING_UI_READ_TIMEOUT_MS)
  while ($queue.Count -gt 0 -and $items.Count -lt 80 -and [DateTime]::UtcNow -lt $deadline) {
    $node = $queue.Dequeue()
    if ($null -eq $node) { continue }
    $name = ""
    try { $name = $node.Current.Name } catch {}
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      $items.Add($name.Trim())
    }
    try {
      $child = $walker.GetFirstChild($node)
      while ($null -ne $child -and $queue.Count -lt 160) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
    } catch {}
  }
} catch {}
$items | Select-Object -Unique | Select-Object -First 80 | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env(
            "JINGLING_UI_READ_TIMEOUT_MS",
            timeout_ms.clamp(500, 5000).to_string(),
        )
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else {
        return String::new();
    };
    if !output.status.success() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return String::new();
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Array(values)) => {
            let mut seen = HashSet::new();
            values
                .into_iter()
                .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
                .filter(|value| !value.is_empty() && seen.insert(value.clone()))
                .collect::<Vec<_>>()
                .join("\n")
        }
        Ok(serde_json::Value::String(value)) => value.trim().to_string(),
        _ => String::new(),
    }
}

#[cfg(any(mobile, not(target_os = "windows")))]
fn capture_active_window_ui_text(_timeout_ms: u64) -> String {
    String::new()
}

#[tauri::command]
pub async fn test_free_mode_vision_command(
    app: AppHandle,
    config: FreeModeVisionConfig,
) -> Result<FreeModeToolResult, String> {
    ensure_qa_modes_enabled()?;
    ensure_free_mode_vision_bridge(&app, &config)?;
    let bridge_payload = json!({
        "prompt": "health check",
        "userInput": "health check",
        "region": "none",
        "title": "",
        "processName": "",
        "ocrText": "",
        "imageBase64": "",
        "imageMimeType": "image/png",
        "model": config.model,
        "provider": config.provider,
        "stationUrl": config.station_url,
        "qwenUrl": config.qwen_url,
        "timeoutMs": config.timeout_ms,
        "healthCheck": true,
    });
    let mut bridge_result = post_free_mode_json(&config.service_url, bridge_payload, config.timeout_ms).await?;
    if !is_loopback_http_url(&config.service_url) {
        bridge_result.message = format!("{} 注意：这是非本机 URL，可能发送隐私数据。", bridge_result.message);
    }
    Ok(bridge_result)
}

#[tauri::command]
pub async fn call_free_mode_http_tool_command(
    tool_config: FreeModeHttpToolConfig,
    payload: serde_json::Value,
) -> Result<FreeModeToolResult, String> {
    ensure_qa_modes_enabled()?;
    if !tool_config.enabled {
        return Ok(FreeModeToolResult {
            available: false,
            message: "HTTP tool is disabled.".to_string(),
            text: String::new(),
        });
    }
    post_free_mode_json(&tool_config.url, payload, tool_config.timeout_ms).await
}

#[tauri::command]
pub async fn capture_free_mode_context_command(
    app: AppHandle,
    options: Option<FreeModeScreenContextOptions>,
    enhancement_settings: Option<FreeModeEnhancementSettings>,
) -> Result<FreeModeContextResult, String> {
    ensure_qa_modes_enabled()?;
    let settings = enhancement_settings.unwrap_or_default();
    let options = options.unwrap_or_default();
    let include_vision = options.include_vision.unwrap_or(true);
    let include_http_tools = options.include_http_tools.unwrap_or(true);
    let hide_overlay = options.hide_overlay.unwrap_or(false);
    let region = options
        .region
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| settings.screen.default_region.clone());
    let region_label = options
        .region_label
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| region.clone());
    let (free_mode_was_visible, pet_was_visible) = if hide_overlay {
        temporarily_hide_free_mode_capture_overlays(&app)?
    } else {
        (false, false)
    };
    let capture_result = capture_screen_text_command(
        app.clone(),
        Some(ScreenCaptureOptions {
            reason: options.reason.clone().or(options.user_input.clone()),
            mode: Some(if region == "active-window" { "active-window" } else { "screen" }.to_string()),
            region: Some(region.clone()),
            region_label: Some(region_label.clone()),
        }),
    );
    let window_ui_text = if settings.screen.ui_read_enabled {
        capture_active_window_ui_text(settings.screen.timeout_ms)
    } else {
        String::new()
    };
    let restore_result = if hide_overlay {
        restore_free_mode_capture_overlays(&app, free_mode_was_visible, pet_was_visible)
    } else {
        Ok(())
    };
    let mut screen = match capture_result {
        Ok(screen) => screen,
        Err(err) => {
            let _ = restore_result;
            return Err(err);
        }
    };
    restore_result?;
    if !settings.screen.ocr_enabled {
        screen.available = false;
        screen.text.clear();
        if !screen.image_path.trim().is_empty() {
            screen.message = "Screen capture saved, but OCR is disabled in Free Mode enhancement settings.".to_string();
        }
    }

    let ui_text = if settings.screen.ui_read_enabled {
        let label = [screen.process_name.as_str(), screen.title.as_str()]
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" - ");
        [
            if label.trim().is_empty() {
                String::new()
            } else {
                format!("活动窗口：{label}")
            },
            if window_ui_text.trim().is_empty() {
                String::new()
            } else {
                format!(
                    "控件文字：{}",
                    limit_free_mode_context_text(&window_ui_text, 1200)
                )
            },
        ]
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
    } else {
        String::new()
    };

    let mut vision_text = String::new();
    let mut image_base64_sent = false;
    if settings.vision.enabled && include_vision {
        ensure_free_mode_vision_bridge(&app, &settings.vision)?;
        let mut image_mime_type = "image/png".to_string();
        let image_base64 = if settings.vision.send_image_base64 {
            match read_scaled_jpeg_base64(&screen.image_path, 896, 88) {
                Ok((value, mime_type)) => {
                    image_mime_type = mime_type;
                    image_base64_sent = !value.is_empty();
                    value
                }
                Err(err) => {
                    vision_text = format!("视觉服务未调用：{err}");
                    String::new()
                }
            }
        } else {
            String::new()
        };
        if image_base64.trim().is_empty() {
            vision_text = "视觉服务未调用：没有可发送的截图 base64。".to_string();
        }
        if vision_text.is_empty() {
            let payload = json!({
                "prompt": options.prompt.clone().or(options.user_input.clone()).unwrap_or_else(|| "describe the screen".to_string()),
                "userInput": options.user_input.clone().unwrap_or_default(),
                "region": region,
                "title": screen.title,
                "processName": screen.process_name,
                "ocrText": screen.text,
                "imageBase64": image_base64,
                "imageMimeType": image_mime_type,
                "model": settings.vision.model,
                "provider": settings.vision.provider,
                "stationUrl": settings.vision.station_url,
                "qwenUrl": settings.vision.qwen_url,
                "timeoutMs": settings.vision.timeout_ms,
            });
            match post_free_mode_json(&settings.vision.service_url, payload, settings.vision.timeout_ms).await {
                Ok(result) if result.available => {
                    vision_text = result.text;
                }
                Ok(result) => {
                    vision_text = format!("视觉服务不可用：{}", result.message);
                }
                Err(err) => {
                    vision_text = format!("视觉服务调用失败：{err}");
                }
            }
        }
    }

    let mut tool_parts: Vec<String> = Vec::new();
    if include_http_tools {
        for tool in settings.http_tools.iter().filter(|tool| tool.enabled) {
            let payload = json!({
                "toolId": tool.id,
                "toolName": tool.name,
                "userInput": options.user_input.clone().unwrap_or_default(),
                "region": screen.region,
                "regionLabel": screen.region_label,
                "title": screen.title,
                "processName": screen.process_name,
                "ocrText": if tool.include_screen_context { screen.text.as_str() } else { "" },
                "visionText": if tool.include_screen_context { vision_text.as_str() } else { "" },
            });
            match post_free_mode_json(&tool.url, payload, tool.timeout_ms).await {
                Ok(result) if result.available => {
                    tool_parts.push(format!("{}：{}", tool.name.trim(), result.text));
                }
                Ok(result) => {
                    tool_parts.push(format!("{}：{}", tool.name.trim(), result.message));
                }
                Err(err) => {
                    tool_parts.push(format!("{}：{err}", tool.name.trim()));
                }
            }
        }
    }
    let tool_text = limit_free_mode_context_text(&tool_parts.join("\n"), 2400);
    let available = !screen.text.trim().is_empty()
        || !ui_text.trim().is_empty()
        || !vision_text.trim().is_empty()
        || !tool_text.trim().is_empty();
    let message = if available {
        "Free Mode context captured.".to_string()
    } else {
        "No readable Free Mode context was captured.".to_string()
    };
    Ok(FreeModeContextResult {
        available,
        message,
        screen,
        ui_text,
        vision_text,
        tool_text,
        image_base64_sent,
    })
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn open_browser_search(query: String) -> Result<(), String> {
    ensure_qa_modes_enabled()?;
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query is empty.".to_string());
    }
    let url = format!("https://www.bing.com/search?q={}", encode_url_component(trimmed));
    open_browser_url(&url)
}

#[tauri::command]
#[cfg(mobile)]
pub fn open_browser_search(_query: String) -> Result<(), String> {
    ensure_qa_modes_enabled()
}

#[tauri::command]
#[cfg(mobile)]
pub fn speak_text_command(
    _state: State<'_, TtsPreviewState>,
    _text: String,
    _voice_name: Option<String>,
    _lang: Option<String>,
    _rate: f64,
    _volume: f64,
) -> Result<(), String> {
    Err("System TTS is not supported on mobile.".to_string())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn speak_text_command(
    state: State<'_, TtsPreviewState>,
    text: String,
    voice_name: Option<String>,
    lang: Option<String>,
    rate: f64,
    volume: f64,
) -> Result<(), String> {
    let content = text.trim();
    if content.is_empty() {
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        let _ = (voice_name, lang, rate, volume);
        return Err("当前原生试听只支持 Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut child_slot = state
            .child
            .lock()
            .map_err(|_| "TTS state lock failed".to_string())?;
        if let Some(mut child) = child_slot.take() {
            match child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let _ = child.kill();
                }
                Err(_) => {}
            }
            let _ = child.wait();
        }

        let sapi_rate = ((rate.clamp(0.6, 1.8) - 1.0) * 10.0)
            .round()
            .clamp(-10.0, 10.0) as i32;
        let sapi_volume = (volume.clamp(0.0, 1.0) * 100.0)
            .round()
            .clamp(0.0, 100.0) as i32;
        let script = r#"
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = [int]$env:JINGLING_TTS_RATE
$speaker.Volume = [int]$env:JINGLING_TTS_VOLUME
$voiceName = $env:JINGLING_TTS_VOICE
$lang = $env:JINGLING_TTS_LANG
$voices = $speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo }
$selected = $null
if ($voiceName) {
  $simpleName = $voiceName -replace ' - .*$', ''
  $selected = $voices | Where-Object {
    $_.Name -eq $voiceName -or
    $_.Name -like "$voiceName*" -or
    $voiceName -like "$($_.Name)*" -or
    $_.Name -like "$simpleName*" -or
    $simpleName -like "$($_.Name)*"
  } | Select-Object -First 1
}
if (-not $selected -and $lang) {
  if ($lang.ToLower().StartsWith('zh')) {
    $selected = $voices | Where-Object { $_.Culture.Name -like 'zh*' -or $_.Name -like '*Huihui*' } | Select-Object -First 1
  } elseif ($lang.ToLower().StartsWith('en')) {
    $selected = $voices | Where-Object { $_.Culture.Name -like 'en*' } | Select-Object -First 1
  }
}
if ($selected) {
  $speaker.SelectVoice($selected.Name)
}
$speaker.Speak($env:JINGLING_TTS_TEXT)
$speaker.Dispose()
"#;

        let mut command = Command::new("powershell");
        command
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ])
            .env("JINGLING_TTS_TEXT", content)
            .env("JINGLING_TTS_VOICE", voice_name.unwrap_or_default())
            .env("JINGLING_TTS_LANG", lang.unwrap_or_default())
            .env("JINGLING_TTS_RATE", sapi_rate.to_string())
            .env("JINGLING_TTS_VOLUME", sapi_volume.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);

        let child = command
            .spawn()
            .map_err(|err| format!("启动系统语音试听失败: {err}"))?;
        *child_slot = Some(child);
        Ok(())
    }
}

#[tauri::command]
pub fn clear_memory_command(app: AppHandle) -> Result<(), String> {
    memory::clear_memory(&app)
}
