use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

pub const WEB_BRIDGE_PROVIDER_ID: &str = "deepseek-web-bridge";
pub const WEB_BRIDGE_PROVIDER_TYPE: &str = "web-bridge";
pub const WEB_BRIDGE_URL: &str = "http://127.0.0.1:8787";
pub const DEEPSEEK_CHAT_URL: &str = "https://chat.deepseek.com";
const HOST: &str = "127.0.0.1:8787";
const HEARTBEAT_TTL_MS: u128 = 10_000;
const JOB_WAIT_TIMEOUT_MS: u128 = 180_000;

pub fn qa_features_enabled() -> bool {
    option_env!("JINGLING_QA_FEATURES") == Some("1")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeJob {
    pub id: String,
    pub text: String,
    pub status: String,
    pub answer_text: String,
    pub raw_text: String,
    pub error: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeEvent {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub at: String,
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeSummary {
    pub connected: bool,
    pub last_seen: Option<String>,
    pub page_url: Option<String>,
    pub page_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeStateSnapshot {
    pub jobs: Vec<WebBridgeJob>,
    pub events: Vec<WebBridgeEvent>,
    pub bridge: WebBridgeSummary,
    pub qa_enabled: bool,
    pub service_running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartWebBridgeResult {
    pub ok: bool,
    pub message: String,
    pub state: WebBridgeStateSnapshot,
}

#[derive(Debug, Default)]
struct WebBridgeInner {
    jobs: VecDeque<WebBridgeJob>,
    events: VecDeque<WebBridgeEvent>,
    last_seen_ms: Option<u128>,
    last_seen: Option<String>,
    page_url: Option<String>,
    page_title: Option<String>,
    server_started: bool,
}

#[derive(Debug, Default)]
pub struct WebBridgeState {
    inner: Arc<Mutex<WebBridgeInner>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateJobRequest {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobStatusRequest {
    status: Option<String>,
    answer_text: Option<String>,
    raw_text: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatRequest {
    page_url: Option<String>,
    page_title: Option<String>,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_stamp() -> String {
    now_ms().to_string()
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", now_ms())
}

fn json_response(status: u16, payload: serde_json::Value) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = if status == 204 {
        String::new()
    } else {
        payload.to_string()
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json; charset=utf-8\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET,POST,OPTIONS\r\naccess-control-allow-headers: content-type\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    )
    .into_bytes()
}

fn parse_request(buffer: &[u8]) -> Result<HttpRequest, String> {
    let text = String::from_utf8_lossy(buffer).to_string();
    let (head, body) = text
        .split_once("\r\n\r\n")
        .or_else(|| text.split_once("\n\n"))
        .ok_or_else(|| "Invalid HTTP request.".to_string())?;
    let mut lines = head.lines();
    let first = lines.next().ok_or_else(|| "Invalid HTTP request.".to_string())?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let raw_path = parts.next().unwrap_or("/").to_string();
    let path = raw_path
        .split('?')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("/")
        .to_string();
    Ok(HttpRequest {
        method,
        path,
        body: body.to_string(),
    })
}

fn content_length(buffer: &[u8]) -> usize {
    let text = String::from_utf8_lossy(buffer);
    let head = text
        .split_once("\r\n\r\n")
        .or_else(|| text.split_once("\n\n"))
        .map(|(head, _)| head)
        .unwrap_or(&text);
    head.lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn header_body_split_len(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|chunk| chunk == b"\r\n\r\n")
        .map(|index| index + 4)
        .or_else(|| {
            buffer
                .windows(2)
                .position(|chunk| chunk == b"\n\n")
                .map(|index| index + 2)
        })
}

fn summary_from_inner(inner: &WebBridgeInner) -> WebBridgeSummary {
    let connected = inner
        .last_seen_ms
        .map(|last_seen| now_ms().saturating_sub(last_seen) < HEARTBEAT_TTL_MS)
        .unwrap_or(false);
    WebBridgeSummary {
        connected,
        last_seen: inner.last_seen.clone(),
        page_url: inner.page_url.clone(),
        page_title: inner.page_title.clone(),
    }
}

fn snapshot_from_inner(inner: &WebBridgeInner) -> WebBridgeStateSnapshot {
    WebBridgeStateSnapshot {
        jobs: inner.jobs.iter().cloned().collect(),
        events: inner.events.iter().cloned().collect(),
        bridge: summary_from_inner(inner),
        qa_enabled: qa_features_enabled(),
        service_running: inner.server_started,
    }
}

fn add_event(inner: &mut WebBridgeInner, kind: &str, message: impl Into<String>, job_id: Option<String>) {
    inner.events.push_front(WebBridgeEvent {
        id: new_id("event"),
        kind: kind.to_string(),
        message: message.into(),
        at: now_stamp(),
        job_id,
    });
    while inner.events.len() > 80 {
        inner.events.pop_back();
    }
}

impl WebBridgeState {
    async fn snapshot(&self) -> WebBridgeStateSnapshot {
        let inner = self.inner.lock().await;
        snapshot_from_inner(&inner)
    }

    pub async fn enqueue_job(&self, text: String) -> Result<WebBridgeJob, String> {
        if !qa_features_enabled() {
            return Err("DeepSeek 网页桥只在 QA 构建中可用。".to_string());
        }
        let mut inner = self.inner.lock().await;
        if inner
            .jobs
            .iter()
            .any(|job| matches!(job.status.as_str(), "queued" | "claimed" | "sent"))
        {
            return Err("网页桥已有任务正在执行，请等待当前回复完成。".to_string());
        }
        let job = WebBridgeJob {
            id: new_id("job"),
            text,
            status: "queued".to_string(),
            answer_text: String::new(),
            raw_text: String::new(),
            error: String::new(),
            created_at: now_stamp(),
            updated_at: now_stamp(),
        };
        inner.jobs.push_front(job.clone());
        add_event(&mut inner, "queued", "已排队发送到 DeepSeek 网页端。", Some(job.id.clone()));
        Ok(job)
    }

    pub async fn wait_for_job(&self, job_id: &str) -> Result<WebBridgeJob, String> {
        let started = now_ms();
        loop {
            {
                let inner = self.inner.lock().await;
                if let Some(job) = inner.jobs.iter().find(|job| job.id == job_id) {
                    if job.status == "done" {
                        return Ok(job.clone());
                    }
                    if job.status == "error" {
                        return Err(if job.error.trim().is_empty() {
                            "DeepSeek 网页端任务失败。".to_string()
                        } else {
                            job.error.clone()
                        });
                    }
                } else {
                    return Err("网页桥任务不存在或已被清理。".to_string());
                }
            }
            if now_ms().saturating_sub(started) > JOB_WAIT_TIMEOUT_MS {
                let mut inner = self.inner.lock().await;
                if let Some(job) = inner.jobs.iter_mut().find(|job| job.id == job_id) {
                    job.status = "error".to_string();
                    job.error = "等待 DeepSeek 网页端回复超时。".to_string();
                    job.updated_at = now_stamp();
                }
                add_event(&mut inner, "timeout", "等待 DeepSeek 网页端回复超时。", Some(job_id.to_string()));
                return Err("等待 DeepSeek 网页端回复超时。".to_string());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}

async fn handle_api(state: &Arc<Mutex<WebBridgeInner>>, request: HttpRequest) -> Vec<u8> {
    if request.method == "OPTIONS" {
        return json_response(204, serde_json::json!({}));
    }
    if !qa_features_enabled() {
        return json_response(
            403,
            serde_json::json!({ "ok": false, "error": "DeepSeek web bridge is available in QA builds only." }),
        );
    }

    if request.method == "GET" && request.path == "/api/state" {
        let inner = state.lock().await;
        return json_response(200, serde_json::json!(snapshot_from_inner(&inner)));
    }

    if request.method == "POST" && request.path == "/api/jobs" {
        let body = serde_json::from_str::<CreateJobRequest>(&request.body).unwrap_or(CreateJobRequest { text: None });
        let text = body.text.unwrap_or_default().trim().to_string();
        if text.is_empty() {
            return json_response(400, serde_json::json!({ "ok": false, "error": "Message text is required." }));
        }
        let mut inner = state.lock().await;
        if inner
            .jobs
            .iter()
            .any(|job| matches!(job.status.as_str(), "queued" | "claimed" | "sent"))
        {
            return json_response(409, serde_json::json!({ "ok": false, "error": "A bridge job is already running." }));
        }
        let job = WebBridgeJob {
            id: new_id("job"),
            text,
            status: "queued".to_string(),
            answer_text: String::new(),
            raw_text: String::new(),
            error: String::new(),
            created_at: now_stamp(),
            updated_at: now_stamp(),
        };
        inner.jobs.push_front(job.clone());
        add_event(&mut inner, "queued", "Queued a prompt for the DeepSeek page.", Some(job.id.clone()));
        return json_response(200, serde_json::json!({ "ok": true, "job": job }));
    }

    if request.method == "GET" && request.path == "/api/jobs/next" {
        let mut inner = state.lock().await;
        if let Some(index) = inner.jobs.iter().rposition(|job| job.status == "queued") {
            let mut job = inner.jobs[index].clone();
            job.status = "claimed".to_string();
            job.updated_at = now_stamp();
            inner.jobs[index] = job.clone();
            add_event(&mut inner, "claimed", "DeepSeek page picked up a prompt.", Some(job.id.clone()));
            return json_response(200, serde_json::json!({ "ok": true, "job": job }));
        }
        return json_response(200, serde_json::json!({ "ok": true, "job": null }));
    }

    if request.method == "POST" && request.path == "/api/jobs/clear-done" {
        let mut inner = state.lock().await;
        let before = inner.jobs.len();
        inner.jobs.retain(|job| job.status != "done");
        let removed = before.saturating_sub(inner.jobs.len());
        add_event(&mut inner, "clear", format!("Cleared {removed} completed jobs."), None);
        return json_response(200, serde_json::json!({ "ok": true, "removed": removed }));
    }

    if request.method == "POST" && request.path == "/api/bridge/heartbeat" {
        let body = serde_json::from_str::<HeartbeatRequest>(&request.body).unwrap_or(HeartbeatRequest {
            page_url: None,
            page_title: None,
        });
        let mut inner = state.lock().await;
        inner.last_seen_ms = Some(now_ms());
        inner.last_seen = Some(now_stamp());
        inner.page_url = body.page_url;
        inner.page_title = body.page_title;
        let bridge = summary_from_inner(&inner);
        return json_response(200, serde_json::json!({ "ok": true, "bridge": bridge }));
    }

    if request.method == "POST" && request.path.starts_with("/api/jobs/") && request.path.ends_with("/status") {
        let job_id = request
            .path
            .trim_start_matches("/api/jobs/")
            .trim_end_matches("/status")
            .trim_end_matches('/')
            .to_string();
        let body = serde_json::from_str::<JobStatusRequest>(&request.body).unwrap_or(JobStatusRequest {
            status: None,
            answer_text: None,
            raw_text: None,
            error: None,
        });
        let next_status = body.status.unwrap_or_default();
        if !matches!(next_status.as_str(), "claimed" | "sent" | "done" | "error") {
            return json_response(400, serde_json::json!({ "ok": false, "error": "Invalid status." }));
        }
        let mut inner = state.lock().await;
        let Some(index) = inner.jobs.iter().position(|job| job.id == job_id) else {
            return json_response(404, serde_json::json!({ "ok": false, "error": "Job not found." }));
        };
        let mut job = inner.jobs[index].clone();
        job.status = next_status.clone();
        job.updated_at = now_stamp();
        if let Some(answer_text) = body.answer_text {
            job.answer_text = answer_text;
        }
        if let Some(raw_text) = body.raw_text {
            job.raw_text = raw_text;
        }
        if let Some(error) = body.error {
            job.error = error;
        }
        inner.jobs[index] = job.clone();
        add_event(&mut inner, &next_status, format!("Job {next_status}."), Some(job.id.clone()));
        return json_response(200, serde_json::json!({ "ok": true, "job": job }));
    }

    json_response(404, serde_json::json!({ "ok": false, "error": "Not found." }))
}

async fn handle_connection(mut stream: TcpStream, state: Arc<Mutex<WebBridgeInner>>) {
    let mut buffer = Vec::with_capacity(64 * 1024);
    let mut chunk = vec![0; 8192];
    let Ok(size) = stream.read(&mut chunk).await else {
        return;
    };
    if size == 0 {
        return;
    }
    buffer.extend_from_slice(&chunk[..size]);
    while let Some(body_start) = header_body_split_len(&buffer) {
        let expected = content_length(&buffer);
        let current = buffer.len().saturating_sub(body_start);
        if current >= expected || buffer.len() >= 1024 * 1024 {
            break;
        }
        let Ok(size) = stream.read(&mut chunk).await else {
            break;
        };
        if size == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..size]);
    }
    let response = match parse_request(&buffer) {
        Ok(request) => handle_api(&state, request).await,
        Err(error) => json_response(400, serde_json::json!({ "ok": false, "error": error })),
    };
    let _ = stream.write_all(&response).await;
    let _ = stream.shutdown().await;
}

async fn run_server(listener: TcpListener, state: Arc<Mutex<WebBridgeInner>>) -> Result<(), String> {
    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|err| format!("网页桥连接失败: {err}"))?;
        let next_state = Arc::clone(&state);
        tauri::async_runtime::spawn(async move {
            handle_connection(stream, next_state).await;
        });
    }
}

async fn ensure_server(state: &WebBridgeState) -> Result<(), String> {
    {
        let inner = state.inner.lock().await;
        if inner.server_started {
            return Ok(());
        }
    }

    let listener = match TcpListener::bind(HOST).await {
        Ok(listener) => listener,
        Err(err) => {
            let message = format!("无法监听 {HOST}: {err}。请先关闭占用 8787 的旧 bridge/demo。");
            let mut inner = state.inner.lock().await;
            inner.server_started = false;
            add_event(&mut inner, "error", message.clone(), None);
            return Err(message);
        }
    };

    {
        let mut inner = state.inner.lock().await;
        inner.server_started = true;
        add_event(&mut inner, "service", format!("DeepSeek 网页桥已启动：{WEB_BRIDGE_URL}"), None);
    }

    let server_state = Arc::clone(&state.inner);
    tauri::async_runtime::spawn(async move {
        if let Err(message) = run_server(listener, server_state.clone()).await {
            let mut inner = server_state.lock().await;
            inner.server_started = false;
            add_event(&mut inner, "error", message, None);
        }
    });
    Ok(())
}

fn open_edge_to_deepseek() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            "msedge".to_string(),
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe".to_string(),
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe".to_string(),
        ];
        for candidate in candidates {
            if Command::new(&candidate).arg(DEEPSEEK_CHAT_URL).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("没有成功启动 Edge，请手动打开 https://chat.deepseek.com。".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂未自动启动 Edge，请手动打开 https://chat.deepseek.com。".to_string())
    }
}

pub async fn enqueue_and_wait(state: &WebBridgeState, text: String) -> Result<WebBridgeJob, String> {
    ensure_server(state).await?;
    let job = state.enqueue_job(text).await?;
    state.wait_for_job(&job.id).await
}

#[tauri::command]
pub async fn start_deepseek_web_bridge(
    state: State<'_, WebBridgeState>,
) -> Result<StartWebBridgeResult, String> {
    if !qa_features_enabled() {
        return Ok(StartWebBridgeResult {
            ok: false,
            message: "DeepSeek 网页桥只在 QA 构建中可用。".to_string(),
            state: state.snapshot().await,
        });
    }
    if let Err(message) = ensure_server(&state).await {
        return Ok(StartWebBridgeResult {
            ok: false,
            message,
            state: state.snapshot().await,
        });
    }
    let message = match open_edge_to_deepseek() {
        Ok(()) => "本地 bridge 已启动，并已尝试打开 Edge 到 DeepSeek 网页端。".to_string(),
        Err(error) => format!("本地 bridge 已启动。{error}"),
    };
    Ok(StartWebBridgeResult {
        ok: true,
        message,
        state: state.snapshot().await,
    })
}

#[tauri::command]
pub async fn get_deepseek_web_bridge_state(
    state: State<'_, WebBridgeState>,
) -> Result<WebBridgeStateSnapshot, String> {
    Ok(state.snapshot().await)
}

#[cfg(test)]
mod tests {
    use super::{
        content_length, header_body_split_len, now_ms, summary_from_inner, WebBridgeInner, HEARTBEAT_TTL_MS,
    };

    #[test]
    fn heartbeat_summary_marks_recent_page_connected() {
        let inner = WebBridgeInner {
            last_seen_ms: Some(now_ms()),
            last_seen: Some("now".to_string()),
            page_url: Some("https://chat.deepseek.com".to_string()),
            page_title: Some("DeepSeek".to_string()),
            server_started: true,
            ..WebBridgeInner::default()
        };

        let summary = summary_from_inner(&inner);

        assert!(summary.connected);
        assert_eq!(summary.page_url.as_deref(), Some("https://chat.deepseek.com"));
    }

    #[test]
    fn heartbeat_summary_expires_after_ttl() {
        let inner = WebBridgeInner {
            last_seen_ms: Some(now_ms().saturating_sub(HEARTBEAT_TTL_MS + 1)),
            last_seen: Some("old".to_string()),
            server_started: true,
            ..WebBridgeInner::default()
        };

        let summary = summary_from_inner(&inner);

        assert!(!summary.connected);
    }

    #[test]
    fn parses_content_length_from_http_header() {
        let request = b"POST /api/jobs HTTP/1.1\r\ncontent-length: 17\r\n\r\n{\"text\":\"hello\"}";

        assert_eq!(header_body_split_len(request), Some(47));
        assert_eq!(content_length(request), 17);
    }
}
