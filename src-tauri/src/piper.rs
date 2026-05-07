use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MODEL_NAME: &str = "zh_CN-huayan-medium.onnx";
const MIN_MODEL_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperStatus {
    pub available: bool,
    pub message: String,
    pub piper_path: Option<String>,
    pub model_path: Option<String>,
    pub config_path: Option<String>,
    pub model_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperSynthesisResult {
    pub wav_path: String,
}

#[derive(Debug, Clone)]
struct PiperPaths {
    root: PathBuf,
    exe: PathBuf,
    model: PathBuf,
    config: PathBuf,
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn dev_resource_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("piper")
}

fn candidate_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir.join("piper"));
    }
    roots.push(dev_resource_root());
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.join("resources").join("piper"));
            roots.push(parent.join("piper"));
        }
    }
    roots
}

fn piper_paths(app: &AppHandle) -> PiperPaths {
    for root in candidate_roots(app) {
        let exe = root.join("piper.exe");
        let model = root.join("voices").join(MODEL_NAME);
        let config = root.join("voices").join(format!("{MODEL_NAME}.json"));
        if exe.exists() || model.exists() || config.exists() {
            return PiperPaths {
                root,
                exe,
                model,
                config,
            };
        }
    }

    let root = dev_resource_root();
    PiperPaths {
        exe: root.join("piper.exe"),
        model: root.join("voices").join(MODEL_NAME),
        config: root.join("voices").join(format!("{MODEL_NAME}.json")),
        root,
    }
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0)
}

fn status_from_paths(paths: &PiperPaths) -> PiperStatus {
    let model_bytes = file_size(&paths.model);
    let exe_ready = paths.exe.exists() && file_size(&paths.exe) > 0;
    let model_ready = paths.model.exists() && model_bytes >= MIN_MODEL_BYTES;
    let config_ready = paths.config.exists() && file_size(&paths.config) > 0;
    let available = exe_ready && model_ready && config_ready;

    let message = if available {
        "Piper 已就绪：中文 huayan medium 可用。".to_string()
    } else if !exe_ready {
        "Piper 未就绪：缺少 piper.exe。".to_string()
    } else if !model_ready {
        format!(
            "Piper 未就绪：中文模型未下载完整，目前 {} 字节。",
            model_bytes
        )
    } else {
        "Piper 未就绪：缺少 zh_CN-huayan-medium.onnx.json 配置文件。".to_string()
    };

    PiperStatus {
        available,
        message,
        piper_path: paths.exe.exists().then(|| paths.exe.display().to_string()),
        model_path: paths.model.exists().then(|| paths.model.display().to_string()),
        config_path: paths.config.exists().then(|| paths.config.display().to_string()),
        model_bytes,
    }
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法读取 TTS 缓存目录: {err}"))?
        .join("piper-wav");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建 TTS 缓存目录: {err}"))?;
    Ok(dir)
}

fn cleanup_cache(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut wavs = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("wav") {
                return None;
            }
            let modified = entry.metadata().and_then(|metadata| metadata.modified()).ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();
    wavs.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in wavs.into_iter().skip(20) {
        let _ = fs::remove_file(path);
    }
}

fn synthesize_blocking(paths: PiperPaths, output_path: PathBuf, text: String, rate: f64) -> Result<(), String> {
    let length_scale = (1.0 / rate.clamp(0.6, 1.8)).clamp(0.55, 1.8);
    let espeak_data = paths.root.join("espeak-ng-data");

    let mut command = Command::new(&paths.exe);
    command
        .current_dir(&paths.root)
        .args([
            "--model",
            &paths.model.display().to_string(),
            "--config",
            &paths.config.display().to_string(),
            "--output_file",
            &output_path.display().to_string(),
            "--length_scale",
            &format!("{length_scale:.3}"),
            "--sentence_silence",
            "0.15",
            "--quiet",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if espeak_data.exists() {
        command.args(["--espeak_data", &espeak_data.display().to_string()]);
    }
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|err| format!("启动 Piper 失败: {err}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .map_err(|err| format!("写入 Piper 文本失败: {err}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("等待 Piper 合成失败: {err}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        };
        return Err(format!("Piper 合成失败{suffix}"));
    }
    if !output_path.exists() || file_size(&output_path) == 0 {
        return Err("Piper 没有生成有效音频文件。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn piper_status(app: AppHandle) -> Result<PiperStatus, String> {
    Ok(status_from_paths(&piper_paths(&app)))
}

#[tauri::command]
pub async fn synthesize_piper_command(
    app: AppHandle,
    text: String,
    rate: f64,
) -> Result<PiperSynthesisResult, String> {
    let content = text.trim().to_string();
    if content.is_empty() {
        return Err("没有可合成的文本。".to_string());
    }

    let paths = piper_paths(&app);
    let status = status_from_paths(&paths);
    if !status.available {
        return Err(status.message);
    }

    let dir = cache_dir(&app)?;
    cleanup_cache(&dir);
    let output_path = dir.join(format!("jingling-{}.wav", now_stamp()));
    tokio::task::spawn_blocking({
        let output_path = output_path.clone();
        move || synthesize_blocking(paths, output_path, content, rate)
    })
    .await
    .map_err(|err| format!("Piper 合成任务失败: {err}"))??;

    Ok(PiperSynthesisResult {
        wav_path: output_path.display().to_string(),
    })
}
