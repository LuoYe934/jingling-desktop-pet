use crate::{memory::ChatMessage, tavern};
use futures_util::StreamExt;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const SERVICE_NAME: &str = "jingling-desktop-pet";
const API_KEY_USER: &str = "deepseek-api-key";

#[derive(Debug)]
pub struct AppState {
    pub client: reqwest::Client,
    pub cancel_token: Mutex<Option<CancellationToken>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to create reqwest client"),
            cancel_token: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u16>,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    usage: Option<TokenUsage>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TokenUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
    prompt_cache_hit_tokens: Option<u32>,
    prompt_cache_miss_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatChunkPayload {
    content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatDonePayload {
    content: String,
    chat_id: String,
    assistant_created_at: String,
    cancelled: bool,
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
    total_tokens: Option<u32>,
    prompt_cache_hit_tokens: Option<u32>,
    prompt_cache_miss_tokens: Option<u32>,
    prompt_cache_hit_rate: Option<f32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatErrorPayload {
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatCompactedPayload {
    chat_id: String,
    compacted_count: usize,
    skipped_bookmarked_count: usize,
    summary_updated: bool,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatCompactErrorPayload {
    chat_id: String,
    message: String,
}

fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE_NAME, API_KEY_USER).map_err(|err| format!("系统凭据初始化失败: {err}"))
}

pub fn read_api_key() -> Result<Option<String>, String> {
    if let Ok(value) = std::env::var("DEEPSEEK_API_KEY") {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed));
        }
    }

    match credential_entry()?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

pub fn write_api_key(api_key: &str) -> Result<(), String> {
    let entry = credential_entry()?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }

    entry
        .set_password(trimmed)
        .map_err(|err| format!("保存 DeepSeek API Key 失败: {err}"))
}

fn emit_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "chat:error",
        ChatErrorPayload {
            message: message.into(),
        },
    );
}

fn prompt_cache_hit_rate(usage: Option<&TokenUsage>) -> Option<f32> {
    let usage = usage?;
    let hit = usage.prompt_cache_hit_tokens?;
    let miss = usage.prompt_cache_miss_tokens?;
    let total = hit + miss;
    if total == 0 {
        return None;
    }
    Some(hit as f32 / total as f32)
}

fn provider_max_tokens(_provider: &tavern::ProviderConfig, value: u16) -> (Option<u16>, Option<u16>) {
    (Some(value), None)
}

fn with_provider_auth(
    request: reqwest::RequestBuilder,
    provider: &tavern::ProviderConfig,
    api_key: Option<String>,
) -> reqwest::RequestBuilder {
    let Some(api_key) = api_key.filter(|value| !value.trim().is_empty()) else {
        return request;
    };
    if provider.provider_type == "ollama" {
        request
    } else {
        request.bearer_auth(api_key)
    }
}

fn take_sse_event(buffer: &str) -> Option<(String, String)> {
    if let Some(index) = buffer.find("\n\n") {
        let event = buffer[..index].to_string();
        let rest = buffer[index + 2..].to_string();
        return Some((event, rest));
    }
    if let Some(index) = buffer.find("\r\n\r\n") {
        let event = buffer[..index].to_string();
        let rest = buffer[index + 4..].to_string();
        return Some((event, rest));
    }
    None
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    message: String,
    model: Option<String>,
    chat_id: Option<String>,
    character_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
    client_now: Option<String>,
    user_created_at: Option<String>,
) -> Result<(), String> {
    let user_message = message.trim().to_string();
    if user_message.is_empty() {
        return Err("请输入想和鲸灵说的话。".to_string());
    }

    let prompt = tavern::build_prompt_for_chat(
        &app,
        &user_message,
        chat_id,
        character_id,
        preset_id,
        provider_id,
        model.clone(),
        client_now,
    )?;
    let provider = tavern::provider_by_id(Some(&prompt.provider_id))?;
    let api_key = tavern::read_provider_api_key(&provider.id)?;
    let needs_key = provider.provider_type != "ollama";
    if needs_key && api_key.is_none() {
        return Err(format!(
            "还没有设置 {} API Key。可以在酒馆的“扩展 > Provider”里保存。",
            provider.name
        ));
    }

    let token = CancellationToken::new();
    {
        let mut guard = state.cancel_token.lock().await;
        if let Some(previous) = guard.take() {
            previous.cancel();
        }
        *guard = Some(token.clone());
    }

    let (max_tokens, max_completion_tokens) = provider_max_tokens(&provider, prompt.max_output_tokens);
    let body = ChatRequest {
        model: prompt.model.clone(),
        messages: prompt.messages.clone(),
        stream: true,
        stream_options: if provider.provider_type == "ollama" {
            None
        } else {
            Some(StreamOptions {
                include_usage: true,
            })
        },
        thinking: if provider.provider_type == "deepseek" {
            Some(Thinking { kind: "disabled" })
        } else {
            None
        },
        temperature: prompt.temperature,
        max_tokens,
        max_completion_tokens,
    };

    let request = with_provider_auth(state.client.post(&provider.base_url).json(&body), &provider, api_key);
    let response = request
        .send()
        .await
        .map_err(|err| format!("连接 {} 失败: {err}", provider.name))?;

    if response.status() != StatusCode::OK {
        let status = response.status();
        let text = response.text().await.unwrap_or_else(|_| "无法读取错误详情".to_string());
        let message = format!("{} 返回 {status}: {text}", provider.name);
        emit_error(&app, &message);
        return Err(message);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut assistant_reply = String::new();
    let mut token_usage: Option<TokenUsage> = None;
    let mut cancelled = false;

    loop {
        tokio::select! {
            _ = token.cancelled() => {
                cancelled = true;
                break;
            }
            maybe_chunk = stream.next() => {
                let Some(chunk_result) = maybe_chunk else { break };
                let bytes = chunk_result.map_err(|err| format!("读取 {} 流失败: {err}", provider.name))?;
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some((event, rest)) = take_sse_event(&buffer) {
                    buffer = rest;
                    for line in event.lines() {
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line.trim_start_matches("data:").trim();
                        if data == "[DONE]" {
                            break;
                        }
                        let parsed: StreamChunk = match serde_json::from_str(data) {
                            Ok(value) => value,
                            Err(_) => continue,
                        };
                        if parsed.usage.is_some() {
                            token_usage = parsed.usage.clone();
                        }
                        for choice in parsed.choices {
                            if let Some(content) = choice.delta.and_then(|delta| delta.content) {
                                assistant_reply.push_str(&content);
                                let _ = app.emit("chat:chunk", ChatChunkPayload { content });
                            }
                        }
                    }
                }
            }
        }
    }

    {
        let mut guard = state.cancel_token.lock().await;
        *guard = None;
    }

    let final_reply = tavern::compact_reply(&assistant_reply, prompt.reply_limit);
    let assistant_created_at = tavern::now_stamp_public();
    if !final_reply.is_empty() {
        let (user_message_id, assistant_message_id) = tavern::append_exchange(
            &app,
            &prompt,
            &user_message,
            &final_reply,
            user_created_at.as_deref(),
            &assistant_created_at,
        )?;
        let memory_app = app.clone();
        let memory_client = state.client.clone();
        let memory_prompt = prompt.clone();
        let memory_user_message = user_message.clone();
        let memory_reply = final_reply.clone();
        tauri::async_runtime::spawn(async move {
            let _ = tavern::extract_memory_cards_after_exchange(
                memory_app,
                memory_client,
                memory_prompt,
                memory_user_message,
                memory_reply,
                vec![user_message_id, assistant_message_id],
            )
            .await;
        });
        let score_app = app.clone();
        let score_client = state.client.clone();
        let score_prompt = prompt.clone();
        let score_user_message = user_message.clone();
        let score_reply = final_reply.clone();
        tauri::async_runtime::spawn(async move {
            let _ = tavern::judge_relationship_after_exchange(
                score_app,
                score_client,
                score_prompt,
                score_user_message,
                score_reply,
            )
            .await;
        });
        let compact_app = app.clone();
        let compact_emit_app = app.clone();
        let compact_client = state.client.clone();
        let compact_prompt = prompt.clone();
        tauri::async_runtime::spawn(async move {
            let chat_id = compact_prompt.chat_id.clone();
            match tavern::compact_chat_memory_for_prompt(
                compact_app,
                compact_client,
                compact_prompt,
                false,
            )
            .await
            {
                Ok(result) => {
                    if result.compacted_count > 0 || result.summary_updated {
                        let _ = compact_emit_app.emit(
                            "chat:compacted",
                            ChatCompactedPayload {
                                chat_id: result.chat.id,
                                compacted_count: result.compacted_count,
                                skipped_bookmarked_count: result.skipped_bookmarked_count,
                                summary_updated: result.summary_updated,
                                message: result.message,
                            },
                        );
                    }
                }
                Err(message) => {
                    let _ = compact_emit_app.emit(
                        "chat:compact-error",
                        ChatCompactErrorPayload { chat_id, message },
                    );
                }
            }
        });
    }

    let _ = app.emit(
        "chat:done",
        ChatDonePayload {
            content: final_reply,
            chat_id: prompt.chat_id,
            assistant_created_at,
            cancelled,
            prompt_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_tokens),
            completion_tokens: token_usage.as_ref().and_then(|usage| usage.completion_tokens),
            total_tokens: token_usage.as_ref().and_then(|usage| usage.total_tokens),
            prompt_cache_hit_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_cache_hit_tokens),
            prompt_cache_miss_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_cache_miss_tokens),
            prompt_cache_hit_rate: prompt_cache_hit_rate(token_usage.as_ref()),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn compact_chat_memory_command(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<tavern::ChatMemoryCompactResult, String> {
    tavern::compact_chat_memory(app, state.client.clone(), chat_id, true).await
}

#[tauri::command]
pub async fn extract_memory_cards_for_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
) -> Result<tavern::MemoryExtractionSummary, String> {
    tavern::extract_memory_cards_for_latest_chat(app, state.client.clone(), chat_id).await
}

#[tauri::command]
pub async fn cancel_message(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.cancel_token.lock().await.take() {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{prompt_cache_hit_rate, take_sse_event, StreamChunk};

    #[test]
    fn take_sse_event_splits_lf_delimited_events() {
        let (event, rest) = take_sse_event("data: one\n\ndata: two\n\n").expect("event");

        assert_eq!(event, "data: one");
        assert_eq!(rest, "data: two\n\n");
    }

    #[test]
    fn take_sse_event_waits_for_complete_event() {
        assert!(take_sse_event("data: partial").is_none());
    }

    #[test]
    fn stream_chunk_deserializes_deepseek_cache_usage() {
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":8,"total_tokens":108,"prompt_cache_hit_tokens":72,"prompt_cache_miss_tokens":28}}"#,
        )
        .expect("valid usage chunk");
        let usage = chunk.usage.as_ref().expect("usage");

        assert_eq!(usage.prompt_cache_hit_tokens, Some(72));
        assert_eq!(usage.prompt_cache_miss_tokens, Some(28));
        assert_eq!(prompt_cache_hit_rate(chunk.usage.as_ref()), Some(0.72));
    }

    #[test]
    fn stream_chunk_accepts_usage_without_cache_fields() {
        let chunk: StreamChunk = serde_json::from_str(
            r#"{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":8,"total_tokens":108}}"#,
        )
        .expect("valid usage chunk");
        let usage = chunk.usage.as_ref().expect("usage");

        assert_eq!(usage.prompt_cache_hit_tokens, None);
        assert_eq!(usage.prompt_cache_miss_tokens, None);
        assert_eq!(prompt_cache_hit_rate(chunk.usage.as_ref()), None);
    }
}
