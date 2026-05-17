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

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatResponseChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseChoice {
    message: Option<ChatResponseMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: Option<String>,
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
    event_scope: String,
    request_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatDonePayload {
    content: String,
    chat_id: String,
    assistant_created_at: String,
    cancelled: bool,
    event_scope: String,
    request_id: Option<String>,
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
    event_scope: String,
    request_id: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FreeModeWatchEventParams {
    pub character_id: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub visual_context: String,
    pub previous_summary: String,
    pub event_summary: String,
    pub recent_reaction_summary: String,
    pub reason: String,
    pub client_now: Option<String>,
}

impl Default for FreeModeWatchEventParams {
    fn default() -> Self {
        Self {
            character_id: None,
            provider_id: None,
            model: None,
            visual_context: String::new(),
            previous_summary: String::new(),
            event_summary: String::new(),
            recent_reaction_summary: String::new(),
            reason: String::new(),
            client_now: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeModeWatchDecision {
    pub should_respond: bool,
    pub reason: String,
    pub prompt: String,
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

fn normalized_event_scope(scope: Option<String>) -> String {
    match scope.as_deref() {
        Some("free-mode") => "free-mode".to_string(),
        Some("story-mode") => "story-mode".to_string(),
        _ => "chat".to_string(),
    }
}

fn emit_error(
    app: &AppHandle,
    message: impl Into<String>,
    event_scope: &str,
    request_id: Option<&String>,
) {
    let _ = app.emit(
        "chat:error",
        ChatErrorPayload {
            message: message.into(),
            event_scope: event_scope.to_string(),
            request_id: request_id.cloned(),
        },
    );
}

fn emit_done(
    app: &AppHandle,
    prompt: tavern::PromptBuildResult,
    final_reply: String,
    assistant_created_at: String,
    cancelled: bool,
    token_usage: Option<TokenUsage>,
    event_scope: &str,
    request_id: Option<&String>,
) {
    let _ = app.emit(
        "chat:done",
        ChatDonePayload {
            content: final_reply,
            chat_id: prompt.chat_id,
            assistant_created_at,
            cancelled,
            event_scope: event_scope.to_string(),
            request_id: request_id.cloned(),
            prompt_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_tokens),
            completion_tokens: token_usage.as_ref().and_then(|usage| usage.completion_tokens),
            total_tokens: token_usage.as_ref().and_then(|usage| usage.total_tokens),
            prompt_cache_hit_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_cache_hit_tokens),
            prompt_cache_miss_tokens: token_usage.as_ref().and_then(|usage| usage.prompt_cache_miss_tokens),
            prompt_cache_hit_rate: prompt_cache_hit_rate(token_usage.as_ref()),
        },
    );
}

fn finalize_reply(
    app: &AppHandle,
    state: &AppState,
    prompt: tavern::PromptBuildResult,
    user_message: String,
    final_reply: String,
    user_created_at: Option<String>,
    assistant_created_at: String,
    cancelled: bool,
    token_usage: Option<TokenUsage>,
    event_scope: &str,
    request_id: Option<&String>,
) -> Result<(), String> {
    if !final_reply.is_empty() {
        let scope = if event_scope == "free-mode" {
            tavern::ChatSessionScope::FreeMode
        } else {
            tavern::ChatSessionScope::Normal
        };
        let (user_message_id, assistant_message_id) = tavern::append_exchange_in_scope(
            app,
            &prompt,
            &user_message,
            &final_reply,
            user_created_at.as_deref(),
            &assistant_created_at,
            scope,
        )?;
        if event_scope == "chat" {
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
        }
        if event_scope == "chat" {
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
        }
        let compact_app = app.clone();
        let compact_emit_app = app.clone();
        let compact_client = state.client.clone();
        let compact_prompt = prompt.clone();
        let compact_event_scope = event_scope.to_string();
        tauri::async_runtime::spawn(async move {
            let chat_id = compact_prompt.chat_id.clone();
            let result = if compact_event_scope == "free-mode" {
                tavern::compact_free_mode_memory_for_prompt(compact_app, compact_client, compact_prompt, false).await
            } else {
                tavern::compact_chat_memory_for_prompt(compact_app, compact_client, compact_prompt, false).await
            };
            match result
            {
                Ok(result) => {
                    if compact_event_scope != "free-mode" && (result.compacted_count > 0 || result.summary_updated) {
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

    emit_done(
        app,
        prompt,
        final_reply,
        assistant_created_at,
        cancelled,
        token_usage,
        event_scope,
        request_id,
    );
    Ok(())
}

fn web_bridge_prompt_text(prompt: &tavern::PromptBuildResult) -> String {
    prompt
        .messages
        .iter()
        .map(|message| {
            let label = match message.role.as_str() {
                "system" => "系统",
                "assistant" => "角色",
                "user" => "用户",
                other => other,
            };
            format!("{label}:\n{}", message.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
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

fn provider_max_tokens(provider: &tavern::ProviderConfig, value: u16) -> (Option<u16>, Option<u16>) {
    if provider.max_tokens_field == "max_completion_tokens" {
        (None, Some(value))
    } else {
        (Some(value), None)
    }
}

fn extract_json_object(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in text[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..start + offset + ch.len_utf8()].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_watch_decision(text: &str) -> FreeModeWatchDecision {
    let candidate = extract_json_object(text).unwrap_or_else(|| text.trim().to_string());
    let parsed = serde_json::from_str::<serde_json::Value>(&candidate).unwrap_or_default();
    let should_respond = parsed
        .get("shouldRespond")
        .and_then(|value| value.as_bool())
        .or_else(|| parsed.get("should_respond").and_then(|value| value.as_bool()))
        .unwrap_or(false);
    let reason = parsed
        .get("reason")
        .and_then(|value| value.as_str())
        .unwrap_or(if should_respond { "screen change may be worth a reaction" } else { "not worth interrupting" })
        .trim()
        .to_string();
    let prompt = parsed
        .get("prompt")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    FreeModeWatchDecision {
        should_respond: should_respond && !prompt.is_empty(),
        reason,
        prompt,
    }
}

fn with_provider_auth(
    request: reqwest::RequestBuilder,
    provider: &tavern::ProviderConfig,
    api_key: Option<String>,
) -> reqwest::RequestBuilder {
    let Some(api_key) = api_key.filter(|value| !value.trim().is_empty()) else {
        return request;
    };
    if provider.auth_type == "api-key" {
        request.header("api-key", api_key)
    } else if provider.auth_type == "none" || provider.provider_type == "ollama" {
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
    bridge_state: State<'_, crate::web_bridge::WebBridgeState>,
    message: String,
    model: Option<String>,
    chat_id: Option<String>,
    character_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
    client_now: Option<String>,
    user_created_at: Option<String>,
    event_scope: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let event_scope = normalized_event_scope(event_scope);
    let request_message = message.trim().to_string();
    if request_message.is_empty() {
        return Err("请输入想和鲸灵说的话。".to_string());
    }

    let (prompt, user_message) = if event_scope == "story-mode" {
        let prompt = tavern::build_prompt_for_story_mode(
            &app,
            &request_message,
            chat_id,
            character_id,
            provider_id,
            model.clone(),
            client_now,
        )?;
        (prompt, request_message)
    } else if event_scope == "free-mode" {
        tavern::build_prompt_for_free_mode(
            &app,
            &request_message,
            chat_id,
            character_id,
            provider_id,
            model.clone(),
            client_now,
        )?
    } else {
        let prompt = tavern::build_prompt_for_chat(
            &app,
            &request_message,
            chat_id,
            character_id,
            preset_id,
            provider_id,
            model.clone(),
            client_now,
        )?;
        (prompt, request_message)
    };
    let provider = tavern::provider_by_id(Some(&app), Some(&prompt.provider_id))?;
    if provider.provider_type == crate::web_bridge::WEB_BRIDGE_PROVIDER_TYPE {
        if !crate::web_bridge::qa_features_enabled() {
            return Err("DeepSeek 网页桥只在 QA 构建中可用。".to_string());
        }
        let token = CancellationToken::new();
        {
            let mut guard = state.cancel_token.lock().await;
            if let Some(previous) = guard.take() {
                previous.cancel();
            }
            *guard = Some(token.clone());
        }
        let bridge_text = web_bridge_prompt_text(&prompt);
        let job_result = tokio::select! {
            _ = token.cancelled() => {
                Err("已停止 DeepSeek 网页桥任务等待。".to_string())
            }
            result = crate::web_bridge::enqueue_and_wait(&bridge_state, bridge_text) => {
                result
            }
        };
        {
            let mut guard = state.cancel_token.lock().await;
            *guard = None;
        }
        let job = match job_result {
            Ok(job) => job,
            Err(message) => {
                emit_error(&app, &message, &event_scope, request_id.as_ref());
                return Err(message);
            }
        };
        let final_reply = tavern::compact_reply(&job.answer_text, prompt.reply_limit);
        if final_reply.is_empty() {
            let message = "DeepSeek 网页桥没有回传可用回复。".to_string();
            emit_error(&app, &message, &event_scope, request_id.as_ref());
            return Err(message);
        }
        let _ = app.emit(
            "chat:chunk",
            ChatChunkPayload {
                content: final_reply.clone(),
                event_scope: event_scope.clone(),
                request_id: request_id.clone(),
            },
        );
        let assistant_created_at = tavern::now_stamp_public();
        return finalize_reply(
            &app,
            &state,
            prompt,
            user_message,
            final_reply,
            user_created_at,
            assistant_created_at,
            false,
            None,
            &event_scope,
            request_id.as_ref(),
        );
    }
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

    let request = with_provider_auth(
        state
            .client
            .post(tavern::provider_chat_completions_url(&provider))
            .json(&body),
        &provider,
        api_key,
    );
    let response = request
        .send()
        .await
        .map_err(|err| format!("连接 {} 失败: {err}", provider.name))?;

    if response.status() != StatusCode::OK {
        let status = response.status();
        let text = response.text().await.unwrap_or_else(|_| "无法读取错误详情".to_string());
        let message = format!("{} 返回 {status}: {text}", provider.name);
        emit_error(&app, &message, &event_scope, request_id.as_ref());
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
                                let _ = app.emit(
                                    "chat:chunk",
                                    ChatChunkPayload {
                                        content,
                                        event_scope: event_scope.clone(),
                                        request_id: request_id.clone(),
                                    },
                                );
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
    finalize_reply(
        &app,
        &state,
        prompt,
        user_message,
        final_reply,
        user_created_at,
        assistant_created_at,
        cancelled,
        token_usage,
        &event_scope,
        request_id.as_ref(),
    )
}

#[tauri::command]
pub async fn evaluate_free_mode_watch_event_command(
    app: AppHandle,
    state: State<'_, AppState>,
    params: FreeModeWatchEventParams,
) -> Result<FreeModeWatchDecision, String> {
    if !crate::web_bridge::qa_features_enabled() {
        return Err("QA-only feature is not available in this build.".to_string());
    }
    let visual_context = params.visual_context.trim();
    if visual_context.is_empty() {
        return Ok(FreeModeWatchDecision {
            should_respond: false,
            reason: "没有可用的观察上下文。".to_string(),
            prompt: String::new(),
        });
    }
    let character = tavern::load_character(&app, params.character_id.as_deref())?;
    let provider_id = params
        .provider_id
        .clone()
        .or_else(|| character.default_provider_id.clone())
        .unwrap_or_else(|| "deepseek".to_string());
    let provider = tavern::provider_by_id(Some(&app), Some(&provider_id))?;
    let api_key = tavern::read_provider_api_key(&provider.id)?;
    if provider.provider_type != "ollama" && api_key.is_none() {
        return Err(format!("还没有设置 {} API Key。", provider.name));
    }
    let model = params
        .model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| provider.default_model.clone());
    let system = ChatMessage {
        role: "system".to_string(),
        content: format!(
            "你是 QA 自由模式的观察判定器，只输出 JSON，不要 Markdown。\
             判断屏幕变化是否值得让角色“{}”主动说一句。\
             默认保守，只有出现明显新信息、用户可能关心的错误/页面变化/有趣内容时才 shouldRespond=true。\
             输出格式：{{\"shouldRespond\":true/false,\"reason\":\"简短原因\",\"prompt\":\"给角色的自然中文触发语\"}}。\
             如果不值得回应，prompt 为空字符串。",
            character.name
        ),
    };
    let user = ChatMessage {
        role: "user".to_string(),
        content: format!(
            "当前时间：{}\n触发原因：{}\n最近观察摘要：{}\n当前事件摘要：{}\n最近已经回应过：{}\n本次屏幕上下文：\n{}",
            params.client_now.unwrap_or_default(),
            params.reason,
            params.previous_summary,
            params.event_summary,
            params.recent_reaction_summary,
            visual_context
        ),
    };
    let (max_tokens, max_completion_tokens) = provider_max_tokens(&provider, 180);
    let body = ChatRequest {
        model,
        messages: vec![system, user],
        stream: false,
        stream_options: None,
        thinking: if provider.provider_type == "deepseek" {
            Some(Thinking { kind: "disabled" })
        } else {
            None
        },
        temperature: 0.2,
        max_tokens,
        max_completion_tokens,
    };
    let request = with_provider_auth(
        state
            .client
            .post(tavern::provider_chat_completions_url(&provider))
            .json(&body),
        &provider,
        api_key,
    );
    let response = request
        .send()
        .await
        .map_err(|err| format!("连接 {} 失败: {err}", provider.name))?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let text = response.text().await.unwrap_or_else(|_| "无法读取错误详情".to_string());
        return Err(format!("{} 返回 {status}: {text}", provider.name));
    }
    let parsed: ChatResponse = response
        .json()
        .await
        .map_err(|err| format!("解析 {} 判定结果失败: {err}", provider.name))?;
    let text = parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.and_then(|message| message.content))
        .unwrap_or_default();
    Ok(parse_watch_decision(&text))
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
