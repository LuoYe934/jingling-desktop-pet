use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const WAV_SAMPLE_RATE: u32 = 32_000;
const WAV_CHANNELS: u16 = 1;
const WAV_BITS_PER_SAMPLE: u16 = 16;
const GENIE_TTS_TIMEOUT_SECS: u64 = 20;
const GENIE_DIRECT_TIMEOUT_SECS: u64 = 90;
const ONNX_V2_FILES: [&str; 7] = [
    "t2s_encoder_fp32.bin",
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp16.bin",
    "vits_fp32.onnx",
];
const ONNX_V2_PRO_PLUS_FILES: [&str; 9] = [
    "prompt_encoder_fp16.bin",
    "prompt_encoder_fp32.onnx",
    "t2s_encoder_fp32.bin",
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp16.bin",
    "vits_fp32.onnx",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenieConfig {
    pub server_url: String,
    pub work_path: String,
    pub character_name: String,
    pub onnx_model_dir: String,
    pub gpt_model_path: String,
    pub sovits_model_path: String,
    pub reference_audio_path: String,
    pub reference_text: String,
    pub language: String,
    pub reference_language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenieStatus {
    pub available: bool,
    pub message: String,
    pub server_url: Option<String>,
    pub work_path: Option<String>,
    pub character_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenieSynthesisResult {
    pub wav_path: String,
}

#[derive(Default)]
struct GenieInner {
    child: Option<Child>,
    loaded_key: Option<String>,
    reference_key: Option<String>,
}

#[derive(Default, Clone)]
pub struct GenieState {
    inner: Arc<Mutex<GenieInner>>,
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn normalize_server_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        "http://127.0.0.1:9880/".to_string()
    } else {
        format!("{}/", trimmed.trim_end_matches('/'))
    }
}

fn encode_character_name(name: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bytes = name.as_bytes();
    let mut encoded = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = bytes.get(index + 1).copied();
        let b2 = bytes.get(index + 2).copied();
        encoded.push(TABLE[(b0 >> 2) as usize] as char);
        encoded.push(TABLE[(((b0 & 0b0000_0011) << 4) | b1.unwrap_or(0) >> 4) as usize] as char);
        if let Some(b1) = b1 {
            encoded.push(TABLE[(((b1 & 0b0000_1111) << 2) | b2.unwrap_or(0) >> 6) as usize] as char);
        }
        if let Some(b2) = b2 {
            encoded.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        }
        index += 3;
    }
    encoded
}

fn sanitized_name(name: &str) -> String {
    let filtered = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = filtered.trim_matches('_');
    if trimmed.is_empty() {
        encode_character_name(name)
    } else {
        trimmed.to_string()
    }
}

fn has_onnx_files(path: &Path) -> bool {
    path.is_dir()
        && (ONNX_V2_FILES.iter().all(|name| path.join(name).exists())
            || ONNX_V2_PRO_PLUS_FILES.iter().all(|name| path.join(name).exists()))
}

fn derived_onnx_dir(app: &AppHandle, config: &GenieConfig, encoded_name: &str) -> Result<PathBuf, String> {
    let name = if config.character_name.trim().is_empty() {
        encoded_name.to_string()
    } else {
        sanitized_name(&config.character_name)
    };
    app.path()
        .app_data_dir()
        .map_err(|err| format!("无法读取 Genie ONNX 缓存目录: {err}"))
        .map(|dir| dir.join("genie-onnx").join(name))
}

fn resolve_onnx_dir(app: &AppHandle, config: &GenieConfig, encoded_name: &str) -> Result<PathBuf, String> {
    let configured = config.onnx_model_dir.trim();
    if !configured.is_empty() {
        return Ok(PathBuf::from(configured));
    }
    let name = if config.character_name.trim().is_empty() {
        encoded_name.to_string()
    } else {
        sanitized_name(&config.character_name)
    };
    app.path()
        .app_data_dir()
        .map_err(|err| format!("无法读取 Genie ONNX 缓存目录: {err}"))
        .map(|dir| dir.join("genie-onnx").join(name))
}

fn resolve_onnx_conversion_dir(app: &AppHandle, config: &GenieConfig, encoded_name: &str) -> Result<PathBuf, String> {
    let configured = resolve_onnx_dir(app, config, encoded_name)?;
    if config.onnx_model_dir.trim().is_empty() || has_onnx_files(&configured) {
        return Ok(configured);
    }
    let derived = derived_onnx_dir(app, config, encoded_name)?;
    if has_onnx_files(&derived) {
        return Ok(derived);
    }
    Ok(derived)
}

fn cache_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法读取 Genie 缓存目录: {err}"))?
        .join(name);
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建 Genie 缓存目录: {err}"))?;
    Ok(dir)
}

fn cleanup_wav_cache(dir: &Path) {
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
    for (path, _) in wavs.into_iter().skip(40) {
        let _ = fs::remove_file(path);
    }
}

fn work_paths(config: &GenieConfig) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let work = PathBuf::from(config.work_path.trim());
    if config.work_path.trim().is_empty() {
        return Err("Genie 根目录为空。".to_string());
    }
    let python = work.join("runtime").join("python.exe");
    let start = work.join("start.py");
    let convert = work.join("convert.py");
    Ok((work, python, start, convert))
}

async fn is_server_alive(client: &reqwest::Client, server_url: &str) -> bool {
    let url = format!("{}docs", normalize_server_url(server_url));
    match client.get(url).timeout(Duration::from_millis(1500)).send().await {
        Ok(response) => response.status().is_success() || response.status().as_u16() == 404,
        Err(_) => false,
    }
}

async fn stop_genie_tts(client: &reqwest::Client, server_url: &str) {
    let _ = client
        .post(format!("{server_url}stop"))
        .timeout(Duration::from_secs(3))
        .send()
        .await;
}

async fn ensure_server(client: &reqwest::Client, state: &GenieState, config: &GenieConfig) -> Result<(), String> {
    let server_url = normalize_server_url(&config.server_url);
    if is_server_alive(client, &server_url).await {
        return Ok(());
    }

    let (work, python, start, _) = work_paths(config)?;
    if !python.exists() {
        return Err(format!("Genie runtime 不存在: {}", python.display()));
    }
    if !start.exists() {
        return Err(format!("Genie start.py 不存在: {}", start.display()));
    }

    {
        let mut inner = state.inner.lock().await;
        if let Some(child) = inner.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {}
                Ok(Some(_)) | Err(_) => {
                    inner.child = None;
                    inner.loaded_key = None;
                    inner.reference_key = None;
                }
            }
        }
        if inner.child.is_none() {
            let mut command = Command::new(&python);
            command
                .current_dir(&work)
                .arg(&start)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);
            inner.child = Some(
                command
                    .spawn()
                    .map_err(|err| format!("启动 Genie TTS Server 失败: {err}"))?,
            );
        }
    }

    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_server_alive(client, &server_url).await {
            return Ok(());
        }
    }
    Err("Genie TTS Server 启动超时。".to_string())
}

fn convert_model(config: GenieConfig, onnx_dir: PathBuf) -> Result<(), String> {
    let (work, python, _, convert) = work_paths(&config)?;
    if !python.exists() {
        return Err(format!("Genie runtime 不存在: {}", python.display()));
    }
    if !convert.exists() {
        return Err(format!("Genie convert.py 不存在: {}", convert.display()));
    }
    if config.gpt_model_path.trim().is_empty() || config.sovits_model_path.trim().is_empty() {
        return Err("ONNX 不完整，且未配置 GPT/SoVITS 模型用于自动转换。".to_string());
    }
    fs::create_dir_all(&onnx_dir).map_err(|err| format!("无法创建 ONNX 输出目录: {err}"))?;

    let mut command = Command::new(&python);
    command
        .current_dir(work)
        .arg(convert)
        .args(["--pth", config.sovits_model_path.trim()])
        .args(["--ckpt", config.gpt_model_path.trim()])
        .args(["--out", &onnx_dir.display().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|err| format!("启动 Genie ONNX 转换失败: {err}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Genie ONNX 转换失败。".to_string()
        } else {
            format!("Genie ONNX 转换失败: {detail}")
        });
    }
    if !has_onnx_files(&onnx_dir) {
        return Err(format!("转换结束但 ONNX 文件不完整: {}", onnx_dir.display()));
    }
    Ok(())
}

async fn ensure_onnx(app: &AppHandle, config: &GenieConfig, encoded_name: &str) -> Result<PathBuf, String> {
    let onnx_dir = resolve_onnx_dir(app, config, encoded_name)?;
    if has_onnx_files(&onnx_dir) {
        return Ok(onnx_dir);
    }
    let onnx_dir = resolve_onnx_conversion_dir(app, config, encoded_name)?;
    if has_onnx_files(&onnx_dir) {
        return Ok(onnx_dir);
    }
    let config_snapshot = config.clone();
    let onnx_snapshot = onnx_dir.clone();
    tokio::task::spawn_blocking(move || convert_model(config_snapshot, onnx_snapshot))
        .await
        .map_err(|err| format!("Genie ONNX 转换任务失败: {err}"))??;
    Ok(onnx_dir)
}

async fn ensure_character_loaded(
    client: &reqwest::Client,
    state: &GenieState,
    config: &GenieConfig,
    encoded_name: &str,
    onnx_dir: &Path,
) -> Result<(), String> {
    let server_url = normalize_server_url(&config.server_url);
    let language = config.language.trim();
    let language = if language.is_empty() { "ja" } else { language };
    let load_key = format!("{encoded_name}|{}|{language}", onnx_dir.display());
    let reference_language = config.reference_language.trim();
    let reference_language = if reference_language.is_empty() {
        language
    } else {
        reference_language
    };
    let reference_key = format!(
        "{encoded_name}|{}|{}|{reference_language}",
        config.reference_audio_path.trim(),
        config.reference_text.trim()
    );

    let (needs_load, needs_reference) = {
        let inner = state.inner.lock().await;
        (
            inner.loaded_key.as_deref() != Some(load_key.as_str()),
            !config.reference_audio_path.trim().is_empty()
                && !config.reference_text.trim().is_empty()
                && inner.reference_key.as_deref() != Some(reference_key.as_str()),
        )
    };

    if needs_load {
        let payload = serde_json::json!({
            "character_name": encoded_name,
            "onnx_model_dir": onnx_dir.display().to_string(),
            "language": language,
        });
        client
            .post(format!("{server_url}load_character"))
            .json(&payload)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|err| format!("加载 Genie 角色失败: {err}"))?
            .error_for_status()
            .map_err(|err| format!("加载 Genie 角色失败: {err}"))?;
        let mut inner = state.inner.lock().await;
        inner.loaded_key = Some(load_key);
        inner.reference_key = None;
    }

    if needs_reference {
        let payload = serde_json::json!({
            "character_name": encoded_name,
            "audio_path": config.reference_audio_path.trim(),
            "audio_text": config.reference_text.trim(),
            "language": reference_language,
        });
        client
            .post(format!("{server_url}set_reference_audio"))
            .json(&payload)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|err| format!("设置 Genie 参考音频失败: {err}"))?
            .error_for_status()
            .map_err(|err| format!("设置 Genie 参考音频失败: {err}"))?;
        let mut inner = state.inner.lock().await;
        inner.reference_key = Some(reference_key);
    }

    Ok(())
}

fn write_pcm_as_wav(path: &Path, pcm: &[u8]) -> io::Result<()> {
    let byte_rate = WAV_SAMPLE_RATE * WAV_CHANNELS as u32 * WAV_BITS_PER_SAMPLE as u32 / 8;
    let block_align = WAV_CHANNELS * WAV_BITS_PER_SAMPLE / 8;
    let data_len = pcm.len() as u32;
    let mut file = fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36 + data_len).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&WAV_CHANNELS.to_le_bytes())?;
    file.write_all(&WAV_SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&WAV_BITS_PER_SAMPLE.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;
    file.write_all(pcm)?;
    Ok(())
}

fn direct_character_name(config: &GenieConfig, encoded_name: &str) -> String {
    let trimmed = config.character_name.trim();
    if trimmed.is_empty() {
        encoded_name.to_string()
    } else if trimmed.starts_with("gpt_sovits_") || trimmed.is_ascii() {
        trimmed.to_string()
    } else {
        format!("gpt_sovits_{}", sanitized_name(trimmed))
    }
}

fn python_string_literal(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| format!("无法编码 Python 字符串: {err}"))
}

fn synthesize_direct_to_file(
    config: GenieConfig,
    encoded_name: String,
    onnx_dir: PathBuf,
    output_path: PathBuf,
    text: String,
) -> Result<PathBuf, String> {
    let (work, python, _, _) = work_paths(&config)?;
    if !python.exists() {
        return Err(format!("Genie runtime 不存在: {}", python.display()));
    }
    fs::create_dir_all(output_path.parent().unwrap_or_else(|| Path::new(".")))
        .map_err(|err| format!("无法创建 Genie WAV 目录: {err}"))?;

    let language = if config.language.trim().is_empty() { "ja" } else { config.language.trim() };
    let reference_language = if config.reference_language.trim().is_empty() {
        language
    } else {
        config.reference_language.trim()
    };
    let character_name = direct_character_name(&config, &encoded_name);
    let script = format!(
        "import os, sys\n\
os.environ['GENIE_DATA_DIR'] = {data_dir}\n\
sys.path.insert(0, {runtime_dir})\n\
import genie_tts\n\
genie_tts.load_character({character_name}, {onnx_dir}, {language})\n\
genie_tts.set_reference_audio({character_name}, {reference_audio}, {reference_text}, {reference_language})\n\
genie_tts.tts({character_name}, {text}, play=False, split_sentence=False, save_path={output_path})\n",
        data_dir = python_string_literal(&work.join("GenieData").display().to_string())?,
        runtime_dir = python_string_literal(&work.join("runtime").display().to_string())?,
        character_name = python_string_literal(&character_name)?,
        onnx_dir = python_string_literal(&onnx_dir.display().to_string())?,
        language = python_string_literal(language)?,
        reference_audio = python_string_literal(config.reference_audio_path.trim())?,
        reference_text = python_string_literal(config.reference_text.trim())?,
        reference_language = python_string_literal(reference_language)?,
        text = python_string_literal(&text)?,
        output_path = python_string_literal(&output_path.display().to_string())?,
    );

    let mut command = Command::new(&python);
    command
        .current_dir(work)
        .args(["-X", "utf8", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|err| format!("启动 Genie direct 合成失败: {err}"))?;
    let started = SystemTime::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|err| format!("读取 Genie direct 输出失败: {err}"))?;
                if !status.success() {
                    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(if detail.is_empty() {
                        "Genie direct 合成失败。".to_string()
                    } else {
                        format!("Genie direct 合成失败: {detail}")
                    });
                }
                break;
            }
            Ok(None) => {
                let elapsed = started.elapsed().unwrap_or_default();
                if elapsed > Duration::from_secs(GENIE_DIRECT_TIMEOUT_SECS) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Genie direct 合成超时。".to_string());
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err(err) => return Err(format!("等待 Genie direct 合成失败: {err}")),
        }
    }

    let size = fs::metadata(&output_path).map(|metadata| metadata.len()).unwrap_or(0);
    if size <= 44 {
        return Err("Genie direct 没有生成有效 WAV。".to_string());
    }
    Ok(output_path)
}

async fn synthesize_direct_fallback(
    config: &GenieConfig,
    encoded_name: &str,
    onnx_dir: &Path,
    output_path: &Path,
    text: &str,
    reason: String,
) -> Result<PathBuf, String> {
    let config_snapshot = config.clone();
    let encoded_snapshot = encoded_name.to_string();
    let onnx_snapshot = onnx_dir.to_path_buf();
    let output_snapshot = output_path.to_path_buf();
    let text_snapshot = text.to_string();
    tokio::task::spawn_blocking(move || {
        synthesize_direct_to_file(config_snapshot, encoded_snapshot, onnx_snapshot, output_snapshot, text_snapshot)
    })
    .await
    .map_err(|err| format!("Genie direct 合成任务失败: {err}"))?
    .map_err(|err| format!("{reason}; direct fallback 也失败: {err}"))
}

async fn synthesize_to_file(
    app: &AppHandle,
    client: &reqwest::Client,
    config: &GenieConfig,
    encoded_name: &str,
    onnx_dir: &Path,
    text: &str,
) -> Result<PathBuf, String> {
    let server_url = normalize_server_url(&config.server_url);
    let dir = cache_dir(app, "genie-wav")?;
    cleanup_wav_cache(&dir);
    let output_path = dir.join(format!("jingling-genie-{}.wav", now_stamp()));
    let payload = serde_json::json!({
        "character_name": encoded_name,
        "text": text,
        "split_sentence": false,
    });
    let response = match client
        .post(format!("{server_url}tts"))
        .json(&payload)
        .timeout(Duration::from_secs(GENIE_TTS_TIMEOUT_SECS))
        .send()
        .await
        .inspect_err(|_| {
            let client = client.clone();
            let server_url = server_url.clone();
            tokio::spawn(async move {
                stop_genie_tts(&client, &server_url).await;
            });
        }) {
            Ok(response) => response.error_for_status().map_err(|err| format!("Genie 合成失败: {err}")),
            Err(err) => Err(format!("Genie 合成请求失败: {err}")),
        };
    let response = match response {
        Ok(response) => response,
        Err(http_error) => {
            return synthesize_direct_fallback(config, encoded_name, onnx_dir, &output_path, text, http_error).await;
        }
    };

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    let read_result = tokio::time::timeout(Duration::from_secs(GENIE_TTS_TIMEOUT_SECS), async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| format!("读取 Genie 音频流失败: {err}"))?;
            bytes.extend_from_slice(&chunk);
        }
        Ok::<(), String>(())
    })
    .await;
    match read_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            stop_genie_tts(client, &server_url).await;
            return synthesize_direct_fallback(config, encoded_name, onnx_dir, &output_path, text, err).await;
        }
        Err(_) => {
            stop_genie_tts(client, &server_url).await;
            return synthesize_direct_fallback(
                config,
                encoded_name,
                onnx_dir,
                &output_path,
                text,
                "Genie 音频流读取超时".to_string(),
            )
            .await;
        }
    }
    if bytes.is_empty() {
        return Err("Genie 返回了空音频。".to_string());
    }

    if bytes.starts_with(b"RIFF") {
        fs::write(&output_path, bytes).map_err(|err| format!("写入 Genie WAV 失败: {err}"))?;
    } else {
        write_pcm_as_wav(&output_path, &bytes).map_err(|err| format!("封装 Genie PCM 为 WAV 失败: {err}"))?;
    }
    let size = fs::metadata(&output_path).map(|metadata| metadata.len()).unwrap_or(0);
    if size <= 44 {
        return Err("Genie 没有生成有效 WAV。".to_string());
    }
    Ok(output_path)
}

fn validate_config(config: &GenieConfig) -> Result<String, String> {
    let character = config.character_name.trim();
    if character.is_empty() {
        return Err("Genie 角色名为空。".to_string());
    }
    let encoded = encode_character_name(character);
    if encoded.is_empty() {
        return Err("Genie 角色名无效。".to_string());
    }
    let _ = work_paths(config)?;
    Ok(encoded)
}

fn reference_ready(config: &GenieConfig) -> bool {
    !config.reference_audio_path.trim().is_empty() && !config.reference_text.trim().is_empty()
}

#[tauri::command]
pub async fn genie_status(
    app: AppHandle,
    state: State<'_, GenieState>,
    config: GenieConfig,
) -> Result<GenieStatus, String> {
    let server_url = normalize_server_url(&config.server_url);
    let client = reqwest::Client::new();
    let encoded_name = validate_config(&config)?;
    ensure_server(&client, &state, &config).await?;
    let onnx_dir = resolve_onnx_dir(&app, &config, &encoded_name)?;
    let onnx_ready = has_onnx_files(&onnx_dir);
    let convertible = !config.gpt_model_path.trim().is_empty() && !config.sovits_model_path.trim().is_empty();
    let server_ready = is_server_alive(&client, &server_url).await;
    let reference_ready = reference_ready(&config);
    let available = server_ready && (onnx_ready || convertible) && reference_ready;
    let message = if available && onnx_ready {
        format!("Genie 已就绪：{}。", config.character_name.trim())
    } else if available {
        format!("Genie 服务可用；首次合成会转换 ONNX：{}。", config.character_name.trim())
    } else if !onnx_ready && !convertible {
        "Genie 未就绪：ONNX 不完整，且未配置 ckpt/pth 自动转换。".to_string()
    } else if !reference_ready {
        "Genie 未就绪：需要参考音频和参考文本。".to_string()
    } else {
        "Genie 未就绪。".to_string()
    };
    Ok(GenieStatus {
        available,
        message,
        server_url: Some(server_url),
        work_path: Some(config.work_path),
        character_name: Some(config.character_name),
    })
}

#[tauri::command]
pub async fn synthesize_genie_command(
    app: AppHandle,
    state: State<'_, GenieState>,
    text: String,
    rate: f64,
    config: GenieConfig,
) -> Result<GenieSynthesisResult, String> {
    let content = text.trim().to_string();
    if content.is_empty() {
        return Err("没有可合成的 Genie 文本。".to_string());
    }
    let encoded_name = validate_config(&config)?;
    let client = reqwest::Client::new();
    ensure_server(&client, &state, &config).await?;
    let onnx_dir = ensure_onnx(&app, &config, &encoded_name).await?;
    ensure_character_loaded(&client, &state, &config, &encoded_name, &onnx_dir).await?;
    let output_path = {
        let _guard = state.inner.lock().await;
        synthesize_to_file(&app, &client, &config, &encoded_name, &onnx_dir, &content).await?
    };
    let _ = rate;
    Ok(GenieSynthesisResult {
        wav_path: output_path.display().to_string(),
    })
}
