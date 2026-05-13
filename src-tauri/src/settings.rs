use crate::{deepseek, memory};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::Child,
    sync::Mutex,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub model: String,
    pub scale: f64,
    pub always_on_top: bool,
    pub reply_limit: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model: "deepseek-v4-flash".to_string(),
            scale: 1.0,
            always_on_top: true,
            reply_limit: 100,
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
    toggle_window(&app, "free-mode")
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
