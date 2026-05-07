use crate::memory::{self, ChatMessage};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_CHARACTER_ID: &str = "jingling";
const DEFAULT_PERSONA_ID: &str = "default-user";
const DEFAULT_PRESET_ID: &str = "healing-short-chat";
const DEFAULT_PROVIDER_ID: &str = "deepseek";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";
const SERVICE_NAME: &str = "jingling-desktop-pet";
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone)]
struct TavernPaths {
    root: PathBuf,
    characters: PathBuf,
    personas: PathBuf,
    chats: PathBuf,
    worldbooks: PathBuf,
    presets: PathBuf,
    avatars: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TavernCharacter {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub avatar: Option<String>,
    pub description: String,
    pub personality: String,
    pub scenario: String,
    pub first_mes: String,
    pub mes_example: String,
    pub tags: Vec<String>,
    pub default_preset_id: Option<String>,
    pub default_provider_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Persona {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
    pub description: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TavernChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub bookmarked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TavernChatSession {
    pub id: String,
    pub title: String,
    pub character_id: String,
    pub persona_id: Option<String>,
    pub preset_id: Option<String>,
    pub provider_id: Option<String>,
    pub summary: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<TavernChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TavernChatListItem {
    pub id: String,
    pub title: String,
    pub character_id: String,
    pub updated_at: String,
    pub message_count: usize,
    pub last_message: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatListChangedPayload {
    chats: Vec<TavernChatListItem>,
    active_chat_id: Option<String>,
    deleted_chat_id: Option<String>,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresetsChangedPayload {
    presets: Vec<PromptPreset>,
    active_preset_id: Option<String>,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharactersChangedPayload {
    characters: Vec<TavernCharacter>,
    active_character_id: Option<String>,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersonasChangedPayload {
    personas: Vec<Persona>,
    active_persona_id: Option<String>,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WorldbookEntry {
    pub id: String,
    pub title: String,
    pub keys: Vec<String>,
    pub content: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub priority: i32,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Worldbook {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub entries: Vec<WorldbookEntry>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub system_prompt: String,
    pub instruct_template: String,
    pub author_note: String,
    pub context_messages: usize,
    pub max_input_chars: usize,
    pub max_output_tokens: u16,
    pub temperature: f32,
    pub reply_limit: usize,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for PromptPreset {
    fn default() -> Self {
        default_preset()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    pub default_model: String,
    pub enabled: bool,
    pub key_saved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorldbookMatch {
    pub worldbook_id: String,
    pub entry_id: String,
    pub title: String,
    pub keys: Vec<String>,
    pub content: String,
    pub priority: i32,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptBuildResult {
    pub chat_id: String,
    pub character_id: String,
    pub preset_id: String,
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub matched_worldbook_entries: Vec<WorldbookMatch>,
    pub estimated_chars: usize,
    pub budget_chars: usize,
    pub max_output_tokens: u16,
    pub temperature: f32,
    pub reply_limit: usize,
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn sanitize_id(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' ) {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        fallback.to_string()
    } else {
        out
    }
}

fn new_id(prefix: &str, label: &str) -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}-{}", prefix, sanitize_id(label, "item"), now_stamp(), counter)
}

fn tavern_paths(app: &AppHandle) -> Result<TavernPaths, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法读取应用数据目录: {err}"))?
        .join("tavern_data");
    let paths = TavernPaths {
        characters: root.join("characters"),
        personas: root.join("personas"),
        chats: root.join("chats"),
        worldbooks: root.join("worldbooks"),
        presets: root.join("presets"),
        avatars: root.join("avatars"),
        root,
    };
    for dir in [
        &paths.root,
        &paths.characters,
        &paths.personas,
        &paths.chats,
        &paths.worldbooks,
        &paths.presets,
        &paths.avatars,
    ] {
        fs::create_dir_all(dir).map_err(|err| format!("无法创建酒馆数据目录: {err}"))?;
    }
    Ok(paths)
}

fn json_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.json", sanitize_id(id, "item")))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let content = fs::read_to_string(path).map_err(|err| format!("无法读取 {}: {err}", path.display()))?;
    serde_json::from_str(&content).map_err(|err| format!("JSON 格式错误 {}: {err}", path.display()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建目录 {}: {err}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| format!("无法写入 {}: {err}", path.display()))
}

fn import_source_path(path: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("请先填写{label}导入路径"));
    }
    let source = PathBuf::from(trimmed);
    if !source.is_file() {
        return Err(format!("{label}文件不存在: {}", source.display()));
    }
    Ok(source)
}

fn export_target_path(path: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("请先填写{label}导出路径"));
    }
    Ok(PathBuf::from(trimmed))
}

fn avatar_is_url(value: &str) -> bool {
    let lowered = value.to_lowercase();
    lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("data:")
        || lowered.starts_with("asset:")
        || lowered.starts_with("blob:")
}

fn copy_avatar_image(app: &AppHandle, source: &Path) -> Result<PathBuf, String> {
    let paths = tavern_paths(app)?;
    if !source.is_file() {
        return Err(format!("头像文件不存在: {}", source.display()));
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "头像文件缺少扩展名".to_string())?;
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        return Err("头像只支持 png、jpg、jpeg、webp、gif".to_string());
    }

    let avatars_dir = paths.avatars.canonicalize().unwrap_or(paths.avatars.clone());
    let source_canonical = source.canonicalize().map_err(|err| format!("无法读取头像路径: {err}"))?;
    if source_canonical.starts_with(&avatars_dir) {
        return Ok(source_canonical);
    }

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_id(value, "avatar"))
        .unwrap_or_else(|| "avatar".to_string());
    let target = paths.avatars.join(format!("{}-{}.{}", now_stamp(), stem, extension));
    fs::copy(source, &target)
        .map_err(|err| format!("无法复制头像到应用数据目录 {}: {err}", target.display()))?;
    Ok(target)
}

fn normalize_avatar_path(app: &AppHandle, avatar: &mut Option<String>) -> Result<(), String> {
    let Some(value) = avatar.clone() else {
        return Ok(());
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        *avatar = None;
        return Ok(());
    }
    if avatar_is_url(trimmed) {
        *avatar = Some(trimmed.to_string());
        return Ok(());
    }

    let source = PathBuf::from(trimmed);
    if source.is_file() {
        *avatar = Some(copy_avatar_image(app, &source)?.display().to_string());
    } else {
        *avatar = Some(trimmed.to_string());
    }
    Ok(())
}

fn dir_has_json(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.path().extension().and_then(|ext| ext.to_str()) == Some("json")
            })
        })
        .unwrap_or(false)
}

fn list_json<T: DeserializeOwned>(dir: &Path) -> Result<Vec<T>, String> {
    let mut items = Vec::new();
    let entries = fs::read_dir(dir).map_err(|err| format!("无法读取目录 {}: {err}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            if let Ok(item) = read_json::<T>(&path) {
                items.push(item);
            }
        }
    }
    Ok(items)
}

fn chat_list_item(chat: TavernChatSession) -> TavernChatListItem {
    let last_message = chat
        .messages
        .last()
        .map(|message| compact_reply(&message.content, 72))
        .unwrap_or_default();
    TavernChatListItem {
        id: chat.id,
        title: chat.title,
        character_id: chat.character_id,
        updated_at: chat.updated_at,
        message_count: chat.messages.len(),
        last_message,
        tags: chat.tags,
    }
}

fn list_chat_items_from_dir(dir: &Path) -> Result<Vec<TavernChatListItem>, String> {
    let mut chats = list_json::<TavernChatSession>(dir)?;
    chats.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let mut seen = HashSet::new();
    Ok(chats
        .into_iter()
        .filter(|chat| seen.insert(chat.id.clone()))
        .map(chat_list_item)
        .collect())
}

fn emit_chat_list_changed(
    app: &AppHandle,
    reason: &str,
    active_chat_id: Option<String>,
    deleted_chat_id: Option<String>,
) -> Result<Vec<TavernChatListItem>, String> {
    let paths = tavern_paths(app)?;
    let chats = list_chat_items_from_dir(&paths.chats)?;
    let _ = app.emit(
        "tavern:chats-changed",
        ChatListChangedPayload {
            chats: chats.clone(),
            active_chat_id,
            deleted_chat_id,
            reason: reason.to_string(),
        },
    );
    Ok(chats)
}

fn emit_presets_changed(
    app: &AppHandle,
    reason: &str,
    active_preset_id: Option<String>,
) -> Result<Vec<PromptPreset>, String> {
    let presets = list_presets(app.clone())?;
    let _ = app.emit(
        "tavern:presets-changed",
        PresetsChangedPayload {
            presets: presets.clone(),
            active_preset_id,
            reason: reason.to_string(),
        },
    );
    Ok(presets)
}

fn emit_characters_changed(
    app: &AppHandle,
    reason: &str,
    active_character_id: Option<String>,
) -> Result<Vec<TavernCharacter>, String> {
    let characters = list_characters(app.clone())?;
    let _ = app.emit(
        "tavern:characters-changed",
        CharactersChangedPayload {
            characters: characters.clone(),
            active_character_id,
            reason: reason.to_string(),
        },
    );
    Ok(characters)
}

fn emit_personas_changed(
    app: &AppHandle,
    reason: &str,
    active_persona_id: Option<String>,
) -> Result<Vec<Persona>, String> {
    let personas = list_personas(app.clone())?;
    let _ = app.emit(
        "tavern:personas-changed",
        PersonasChangedPayload {
            personas: personas.clone(),
            active_persona_id,
            reason: reason.to_string(),
        },
    );
    Ok(personas)
}

fn chat_file_paths_by_id(dir: &Path, chat_id: &str) -> Result<Vec<PathBuf>, String> {
    let target_stem = sanitize_id(chat_id, "item");
    let mut exact_matches = Vec::new();
    let mut stem_matches = Vec::new();
    let entries = fs::read_dir(dir).map_err(|err| format!("无法读取目录 {}: {err}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let stem_matches_target = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(|stem| stem == target_stem)
            .unwrap_or(false);

        if let Ok(chat) = read_json::<TavernChatSession>(&path) {
            if chat.id == chat_id {
                exact_matches.push(path);
                continue;
            }
        }

        if stem_matches_target {
            stem_matches.push(path);
        }
    }

    if exact_matches.is_empty() {
        Ok(stem_matches)
    } else {
        Ok(exact_matches)
    }
}

fn default_character() -> TavernCharacter {
    let now = now_stamp();
    TavernCharacter {
        id: DEFAULT_CHARACTER_ID.to_string(),
        name: "鲸灵".to_string(),
        enabled: true,
        avatar: None,
        description: "一只温柔治愈的鲸灵桌宠，喜欢陪用户慢慢整理心情和事情。".to_string(),
        personality: "亲切、短句、轻快、不过度说教，像在桌面边轻轻陪伴。".to_string(),
        scenario: "鲸灵住在用户的桌面上，会在聊天时保持温柔、实用和简短。".to_string(),
        first_mes: "呼噜，我在这里。今天想慢慢聊点什么？".to_string(),
        mes_example: "<START>\n{{user}}: 我有点累。\n{{char}}: 呼噜，先松一口气。我们把事情一件件放好。".to_string(),
        tags: vec!["桌宠".to_string(), "治愈".to_string(), "鲸灵".to_string()],
        default_preset_id: Some(DEFAULT_PRESET_ID.to_string()),
        default_provider_id: Some(DEFAULT_PROVIDER_ID.to_string()),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn default_persona() -> Persona {
    let now = now_stamp();
    Persona {
        id: DEFAULT_PERSONA_ID.to_string(),
        name: "默认我".to_string(),
        avatar: None,
        description: "我是鲸灵的主人，希望得到简短、亲切、实用的陪伴。".to_string(),
        is_default: true,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn default_preset() -> PromptPreset {
    let now = now_stamp();
    PromptPreset {
        id: DEFAULT_PRESET_ID.to_string(),
        name: "治愈短聊".to_string(),
        enabled: true,
        system_prompt: "你是{{char}}，治愈系温柔桌面助手。回复简短活泼，中文为主，单条不超过{{replyLimit}}字。语气亲切，不说教。合适时使用口头禅：呼噜，慢慢来就好。".to_string(),
        instruct_template: "始终保持角色一致；不要主动复述设定；优先给出短而有帮助的回应。".to_string(),
        author_note: "当前是桌宠快捷聊天场景，回答要像贴近屏幕的小助手。".to_string(),
        context_messages: 24,
        max_input_chars: 8000,
        max_output_tokens: 220,
        temperature: 0.8,
        reply_limit: 100,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn default_worldbook() -> Worldbook {
    let now = now_stamp();
    Worldbook {
        id: "jingling-worldbook".to_string(),
        name: "鲸灵世界书".to_string(),
        enabled: true,
        entries: vec![WorldbookEntry {
            id: "catchphrase".to_string(),
            title: "口头禅".to_string(),
            keys: vec!["鲸灵".to_string(), "呼噜".to_string()],
            content: "鲸灵的口头禅是“呼噜，慢慢来就好。”只在自然合适时使用。".to_string(),
            enabled: true,
            priority: 10,
            position: "system".to_string(),
        }],
        created_at: now.clone(),
        updated_at: now,
    }
}

fn provider_credential_user(provider_id: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_ID {
        "deepseek-api-key".to_string()
    } else {
        format!("provider-{provider_id}-api-key")
    }
}

fn provider_env_var(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        "deepseek" => Some("DEEPSEEK_API_KEY"),
        "openai-compatible" => Some("OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        _ => None,
    }
}

pub fn read_provider_api_key(provider_id: &str) -> Result<Option<String>, String> {
    if let Some(env_var) = provider_env_var(provider_id) {
        if let Ok(value) = std::env::var(env_var) {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }

    let entry = keyring::Entry::new(SERVICE_NAME, &provider_credential_user(provider_id))
        .map_err(|err| format!("系统凭据初始化失败: {err}"))?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

fn provider_key_saved(provider_id: &str) -> bool {
    read_provider_api_key(provider_id)
        .map(|value| value.is_some())
        .unwrap_or(false)
}

fn default_providers() -> Vec<ProviderConfig> {
    let mut providers = vec![
        ProviderConfig {
            id: DEFAULT_PROVIDER_ID.to_string(),
            name: "DeepSeek".to_string(),
            provider_type: "deepseek".to_string(),
            base_url: DEEPSEEK_URL.to_string(),
            default_model: DEFAULT_MODEL.to_string(),
            enabled: true,
            key_saved: false,
        },
        ProviderConfig {
            id: "openai-compatible".to_string(),
            name: "OpenAI 兼容接口".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: "https://api.openai.com/v1/chat/completions".to_string(),
            default_model: "gpt-4.1-mini".to_string(),
            enabled: true,
            key_saved: false,
        },
        ProviderConfig {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: "https://openrouter.ai/api/v1/chat/completions".to_string(),
            default_model: "deepseek/deepseek-chat".to_string(),
            enabled: true,
            key_saved: false,
        },
        ProviderConfig {
            id: "ollama".to_string(),
            name: "Ollama 本地模型".to_string(),
            provider_type: "ollama".to_string(),
            base_url: "http://localhost:11434/v1/chat/completions".to_string(),
            default_model: "qwen3".to_string(),
            enabled: true,
            key_saved: false,
        },
    ];

    for provider in &mut providers {
        provider.key_saved = provider_key_saved(&provider.id);
    }
    providers
}

pub fn provider_by_id(provider_id: Option<&str>) -> Result<ProviderConfig, String> {
    let wanted = provider_id.unwrap_or(DEFAULT_PROVIDER_ID);
    default_providers()
        .into_iter()
        .find(|provider| provider.id == wanted)
        .or_else(|| default_providers().into_iter().find(|provider| provider.id == DEFAULT_PROVIDER_ID))
        .ok_or_else(|| "没有可用 Provider".to_string())
}

fn save_character_internal(app: &AppHandle, character: &TavernCharacter) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.characters, &character.id), character)
}

fn save_persona_internal(app: &AppHandle, persona: &Persona) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.personas, &persona.id), persona)
}

fn save_preset_internal(app: &AppHandle, preset: &PromptPreset) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.presets, &preset.id), preset)
}

fn save_worldbook_internal(app: &AppHandle, worldbook: &Worldbook) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.worldbooks, &worldbook.id), worldbook)
}

fn save_chat_internal(app: &AppHandle, chat: &TavernChatSession) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.chats, &chat.id), chat)
}

fn seed_default_chat(app: &AppHandle) -> Result<(), String> {
    let character = default_character();
    let mut chat = TavernChatSession {
        id: "jingling-first-chat".to_string(),
        title: "和鲸灵的聊天".to_string(),
        character_id: character.id.clone(),
        persona_id: Some(DEFAULT_PERSONA_ID.to_string()),
        preset_id: Some(DEFAULT_PRESET_ID.to_string()),
        provider_id: Some(DEFAULT_PROVIDER_ID.to_string()),
        summary: String::new(),
        tags: vec!["默认".to_string()],
        created_at: now_stamp(),
        updated_at: now_stamp(),
        messages: Vec::new(),
    };

    if let Ok(memory) = memory::load_memory(app) {
        if !memory.messages.is_empty() {
            chat.title = "迁移的鲸灵聊天".to_string();
            chat.messages = memory
                .messages
                .into_iter()
                .map(|message| TavernChatMessage {
                    id: new_id("msg", &message.role),
                    role: message.role,
                    content: message.content,
                    created_at: now_stamp(),
                    bookmarked: false,
                })
                .collect();
            chat.summary = memory.summary;
            save_chat_internal(app, &chat)?;
            return Ok(());
        }
    }

    if !character.first_mes.trim().is_empty() {
        chat.messages.push(TavernChatMessage {
            id: new_id("msg", "first"),
            role: "assistant".to_string(),
            content: character.first_mes,
            created_at: now_stamp(),
            bookmarked: false,
        });
    }
    save_chat_internal(app, &chat)
}

fn ensure_seed_data(app: &AppHandle) -> Result<(), String> {
    let paths = tavern_paths(app)?;
    let seed_marker = paths.root.join(".seeded");
    let first_seed = !seed_marker.exists();
    if !dir_has_json(&paths.characters) {
        save_character_internal(app, &default_character())?;
    }
    if !dir_has_json(&paths.personas) {
        save_persona_internal(app, &default_persona())?;
    }
    if !dir_has_json(&paths.presets) {
        save_preset_internal(app, &default_preset())?;
    }
    if !dir_has_json(&paths.worldbooks) {
        save_worldbook_internal(app, &default_worldbook())?;
    }
    if first_seed && !dir_has_json(&paths.chats) {
        seed_default_chat(app)?;
    }
    if first_seed {
        fs::write(seed_marker, now_stamp()).map_err(|err| format!("无法写入初始化标记: {err}"))?;
    }
    Ok(())
}

fn load_character(app: &AppHandle, id: Option<&str>) -> Result<TavernCharacter, String> {
    ensure_seed_data(app)?;
    let characters = list_characters(app.clone())?;
    if let Some(wanted) = id {
        if let Some(character) = characters.iter().find(|item| item.id == wanted) {
            return Ok(character.clone());
        }
    }
    characters
        .iter()
        .find(|item| item.id == DEFAULT_CHARACTER_ID && item.enabled)
        .cloned()
        .or_else(|| characters.iter().find(|item| item.enabled).cloned())
        .or_else(|| characters.first().cloned())
        .ok_or_else(|| "没有可用角色".to_string())
}

fn load_persona(app: &AppHandle, id: Option<&str>) -> Result<Persona, String> {
    ensure_seed_data(app)?;
    let personas = list_personas(app.clone())?;
    if let Some(wanted) = id {
        if let Some(persona) = personas.iter().find(|item| item.id == wanted) {
            return Ok(persona.clone());
        }
    }
    personas
        .iter()
        .find(|item| item.is_default)
        .cloned()
        .or_else(|| personas.first().cloned())
        .ok_or_else(|| "没有可用 Persona".to_string())
}

fn load_preset(app: &AppHandle, id: Option<&str>) -> Result<PromptPreset, String> {
    ensure_seed_data(app)?;
    let presets = list_presets(app.clone())?;
    if let Some(wanted) = id {
        if let Some(preset) = presets.iter().find(|item| item.id == wanted) {
            return Ok(preset.clone());
        }
    }
    presets
        .iter()
        .find(|item| item.id == DEFAULT_PRESET_ID && item.enabled)
        .cloned()
        .or_else(|| presets.iter().find(|item| item.enabled).cloned())
        .or_else(|| presets.first().cloned())
        .ok_or_else(|| "没有可用预设".to_string())
}

fn load_worldbook(app: &AppHandle, id: &str) -> Result<Worldbook, String> {
    ensure_seed_data(app)?;
    let worldbooks = list_worldbooks(app.clone())?;
    worldbooks
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "没有找到世界书".to_string())
}

fn load_chat(app: &AppHandle, id: &str) -> Result<TavernChatSession, String> {
    ensure_seed_data(app)?;
    let paths = tavern_paths(app)?;
    let path = chat_file_paths_by_id(&paths.chats, id)?
        .into_iter()
        .next()
        .ok_or_else(|| "没有找到聊天".to_string())?;
    let mut chat = read_json::<TavernChatSession>(&path)?;
    if ensure_unique_message_ids(&mut chat) {
        write_json(&path, &chat)?;
    }
    Ok(chat)
}

fn create_chat_internal(app: &AppHandle, character_id: Option<String>) -> Result<TavernChatSession, String> {
    let character = load_character(app, character_id.as_deref())?;
    let now = now_stamp();
    let mut chat = TavernChatSession {
        id: new_id("chat", &character.name),
        title: format!("和{}的聊天", character.name),
        character_id: character.id.clone(),
        persona_id: Some(DEFAULT_PERSONA_ID.to_string()),
        preset_id: character.default_preset_id.clone().or_else(|| Some(DEFAULT_PRESET_ID.to_string())),
        provider_id: character.default_provider_id.clone().or_else(|| Some(DEFAULT_PROVIDER_ID.to_string())),
        summary: String::new(),
        tags: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
    };
    if !character.first_mes.trim().is_empty() {
        chat.messages.push(TavernChatMessage {
            id: new_id("msg", "first"),
            role: "assistant".to_string(),
            content: character.first_mes,
            created_at: now_stamp(),
            bookmarked: false,
        });
    }
    save_chat_internal(app, &chat)?;
    Ok(chat)
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0;

    for byte in value.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let val = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'-' => 62,
            b'_' => 63,
            _ => return Err("角色卡 Base64 数据包含非法字符".to_string()),
        } as u32;
        buffer = (buffer << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
            if bits > 0 {
                buffer &= (1 << bits) - 1;
            } else {
                buffer = 0;
            }
        }
    }
    Ok(output)
}

fn parse_png_text_chunks(bytes: &[u8]) -> Option<String> {
    const PNG_SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 8 || &bytes[..8] != PNG_SIG {
        return None;
    }

    let mut cursor = 8usize;
    while cursor + 8 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[cursor],
            bytes[cursor + 1],
            bytes[cursor + 2],
            bytes[cursor + 3],
        ]) as usize;
        let chunk_type = &bytes[cursor + 4..cursor + 8];
        let data_start = cursor + 8;
        let data_end = data_start.saturating_add(length);
        if data_end > bytes.len() {
            return None;
        }
        let data = &bytes[data_start..data_end];

        if chunk_type == b"tEXt" {
            if let Some(split) = data.iter().position(|byte| *byte == 0) {
                let key = String::from_utf8_lossy(&data[..split]).to_string();
                let text = String::from_utf8_lossy(&data[split + 1..]).to_string();
                if key == "chara" || key == "ccv3" {
                    return Some(text);
                }
            }
        }

        if chunk_type == b"iTXt" {
            if let Some(split) = data.iter().position(|byte| *byte == 0) {
                let key = String::from_utf8_lossy(&data[..split]).to_string();
                if key == "chara" || key == "ccv3" {
                    let rest = &data[split + 1..];
                    if rest.len() > 4 && rest[0] == 0 {
                        let mut sections = rest[2..].split(|byte| *byte == 0);
                        let _language = sections.next();
                        let _translated = sections.next();
                        if let Some(text) = sections.next() {
                            return Some(String::from_utf8_lossy(text).to_string());
                        }
                    }
                }
            }
        }

        cursor = data_end.saturating_add(4);
    }
    None
}

fn value_string(data: &Value, key: &str) -> String {
    data.get(key)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

fn value_tags(data: &Value) -> Vec<String> {
    data.get("tags")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn character_from_value(value: Value) -> TavernCharacter {
    let data = value.get("data").unwrap_or(&value);
    let name = value_string(data, "name");
    let now = now_stamp();
    TavernCharacter {
        id: new_id("character", if name.is_empty() { "imported" } else { &name }),
        name: if name.is_empty() { "导入角色".to_string() } else { name },
        enabled: true,
        avatar: value_string(data, "avatar").trim().to_string().into(),
        description: value_string(data, "description"),
        personality: value_string(data, "personality"),
        scenario: value_string(data, "scenario"),
        first_mes: value_string(data, "first_mes"),
        mes_example: value_string(data, "mes_example"),
        tags: value_tags(data),
        default_preset_id: Some(DEFAULT_PRESET_ID.to_string()),
        default_provider_id: Some(DEFAULT_PROVIDER_ID.to_string()),
        created_at: now.clone(),
        updated_at: now,
    }
}

fn normalize_character(mut character: TavernCharacter) -> TavernCharacter {
    let now = now_stamp();
    if character.id.trim().is_empty() {
        character.id = new_id("character", &character.name);
    }
    if character.name.trim().is_empty() {
        character.name = "未命名角色".to_string();
    }
    if character.created_at.trim().is_empty() {
        character.created_at = now.clone();
    }
    character.updated_at = now;
    character
}

fn normalize_persona(mut persona: Persona) -> Persona {
    let now = now_stamp();
    if persona.id.trim().is_empty() {
        persona.id = new_id("persona", &persona.name);
    }
    if persona.name.trim().is_empty() {
        persona.name = "未命名 Persona".to_string();
    }
    if persona.created_at.trim().is_empty() {
        persona.created_at = now.clone();
    }
    persona.updated_at = now;
    persona
}

fn normalize_worldbook(mut worldbook: Worldbook) -> Worldbook {
    let now = now_stamp();
    if worldbook.id.trim().is_empty() {
        worldbook.id = new_id("worldbook", &worldbook.name);
    }
    if worldbook.name.trim().is_empty() {
        worldbook.name = "未命名世界书".to_string();
    }
    for entry in &mut worldbook.entries {
        if entry.id.trim().is_empty() {
            entry.id = new_id("entry", &entry.title);
        }
        if entry.position.trim().is_empty() {
            entry.position = "system".to_string();
        }
    }
    if worldbook.created_at.trim().is_empty() {
        worldbook.created_at = now.clone();
    }
    worldbook.updated_at = now;
    worldbook
}

fn normalize_preset(mut preset: PromptPreset) -> PromptPreset {
    let now = now_stamp();
    if preset.id.trim().is_empty() {
        preset.id = new_id("preset", &preset.name);
    }
    if preset.name.trim().is_empty() {
        preset.name = "未命名预设".to_string();
    }
    preset.context_messages = preset.context_messages.clamp(2, 80);
    preset.max_input_chars = preset.max_input_chars.clamp(1200, 100_000);
    preset.max_output_tokens = preset.max_output_tokens.clamp(32, 8192);
    preset.temperature = preset.temperature.clamp(0.0, 2.0);
    preset.reply_limit = preset.reply_limit.clamp(20, 2000);
    if preset.created_at.trim().is_empty() {
        preset.created_at = now.clone();
    }
    preset.updated_at = now;
    preset
}

fn ensure_unique_message_ids(chat: &mut TavernChatSession) -> bool {
    let mut changed = false;
    let mut ids = HashSet::new();

    for message in &mut chat.messages {
        if message.id.trim().is_empty() || ids.contains(&message.id) {
            loop {
                message.id = new_id("msg", &message.role);
                if !ids.contains(&message.id) {
                    break;
                }
            }
            changed = true;
        }
        ids.insert(message.id.clone());
    }

    changed
}

fn replace_vars(template: &str, character: &TavernCharacter, persona: &Persona, preset: &PromptPreset) -> String {
    template
        .replace("{{char}}", &character.name)
        .replace("{{user}}", &persona.name)
        .replace("{{replyLimit}}", &preset.reply_limit.to_string())
}

fn match_worldbook_entries(app: &AppHandle, text: &str) -> Result<Vec<WorldbookMatch>, String> {
    let lower = text.to_lowercase();
    let mut matches = Vec::new();
    for worldbook in list_worldbooks(app.clone())? {
        if !worldbook.enabled {
            continue;
        }
        for entry in worldbook.entries {
            if !entry.enabled || entry.keys.is_empty() || entry.content.trim().is_empty() {
                continue;
            }
            let hit = entry
                .keys
                .iter()
                .filter(|key| !key.trim().is_empty())
                .any(|key| lower.contains(&key.to_lowercase()));
            if hit {
                matches.push(WorldbookMatch {
                    worldbook_id: worldbook.id.clone(),
                    entry_id: entry.id,
                    title: entry.title,
                    keys: entry.keys,
                    content: entry.content,
                    priority: entry.priority,
                    position: entry.position,
                });
            }
        }
    }
    matches.sort_by(|a, b| b.priority.cmp(&a.priority));
    matches.truncate(12);
    Ok(matches)
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x9fff | 0xf900..=0xfaff | 0x3040..=0x30ff | 0xac00..=0xd7af
    )
}

fn estimate_text_tokens(text: &str) -> usize {
    let mut tenths = 0usize;
    for ch in text.trim().chars() {
        if ch.is_whitespace() {
            continue;
        }
        if is_cjk(ch) {
            tenths += 6;
        } else if ch.is_ascii_alphanumeric() || ch == '_' {
            tenths += 3;
        } else if ch.is_ascii_punctuation() {
            tenths += 10;
        } else {
            tenths += 6;
        }
    }
    tenths.div_ceil(10).max(1)
}

fn estimate_message_tokens(message: &ChatMessage) -> usize {
    estimate_text_tokens(&message.content) + 4
}

fn estimate_prompt_tokens(messages: &[ChatMessage]) -> usize {
    if messages.is_empty() {
        return 0;
    }
    messages.iter().map(estimate_message_tokens).sum::<usize>() + 2
}

fn current_or_new_chat(
    app: &AppHandle,
    chat_id: Option<String>,
    character_id: Option<String>,
) -> Result<TavernChatSession, String> {
    if let Some(id) = chat_id.filter(|id| !id.trim().is_empty()) {
        if let Ok(chat) = load_chat(app, &id) {
            return Ok(chat);
        }
    }
    if let Some(chat) = list_chats(app.clone())?
        .first()
        .and_then(|item| load_chat(app, &item.id).ok())
    {
        return Ok(chat);
    }
    create_chat_internal(app, character_id)
}

pub fn compact_reply(reply: &str, limit: usize) -> String {
    let trimmed = reply.trim();
    let normalized = limit.clamp(20, 2000);
    if trimmed.chars().count() <= normalized {
        return trimmed.to_string();
    }
    let take = normalized.saturating_sub(3);
    trimmed.chars().take(take).collect::<String>() + "..."
}

pub fn build_prompt_for_chat(
    app: &AppHandle,
    user_input: &str,
    chat_id: Option<String>,
    character_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
) -> Result<PromptBuildResult, String> {
    ensure_seed_data(app)?;
    let chat = current_or_new_chat(app, chat_id, character_id.clone())?;
    let character = load_character(app, Some(character_id.as_deref().unwrap_or(&chat.character_id)))?;
    let persona = load_persona(app, chat.persona_id.as_deref())?;
    let preset = load_preset(
        app,
        preset_id
            .as_deref()
            .or(chat.preset_id.as_deref())
            .or(character.default_preset_id.as_deref()),
    )?;
    let selected_provider_id = provider_id
        .filter(|value| !value.trim().is_empty())
        .or_else(|| chat.provider_id.clone())
        .or_else(|| character.default_provider_id.clone())
        .unwrap_or_else(|| DEFAULT_PROVIDER_ID.to_string());
    let provider = provider_by_id(Some(&selected_provider_id))?;
    let selected_model = model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| provider.default_model.clone());

    let mut trigger_text = user_input.to_string();
    for message in chat.messages.iter().rev().take(preset.context_messages) {
        trigger_text.push('\n');
        trigger_text.push_str(&message.content);
    }
    let matched = match_worldbook_entries(app, &trigger_text)?;

    let mut system_parts = Vec::new();
    system_parts.push(replace_vars(&preset.system_prompt, &character, &persona, &preset));
    system_parts.push(format!(
        "角色卡:\n名字: {}\n描述: {}\n性格: {}\n场景: {}",
        character.name, character.description, character.personality, character.scenario
    ));
    if !character.mes_example.trim().is_empty() {
        system_parts.push(format!("示例对话:\n{}", character.mes_example));
    }
    if !persona.description.trim().is_empty() {
        system_parts.push(format!("用户 Persona:\n{}", persona.description));
    }
    if !chat.summary.trim().is_empty() {
        system_parts.push(format!("长期摘要:\n{}", compact_reply(&chat.summary, 1800)));
    }
    if !matched.is_empty() {
        let lore = matched
            .iter()
            .map(|entry| format!("[{}]\n{}", entry.title, entry.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        system_parts.push(format!("世界书触发内容:\n{lore}"));
    }
    if !preset.author_note.trim().is_empty() {
        system_parts.push(format!("作者注释:\n{}", replace_vars(&preset.author_note, &character, &persona, &preset)));
    }
    if !preset.instruct_template.trim().is_empty() {
        system_parts.push(format!("输出规则:\n{}", replace_vars(&preset.instruct_template, &character, &persona, &preset)));
    }

    let system_message = ChatMessage {
        role: "system".to_string(),
        content: system_parts.join("\n\n"),
    };
    let mut messages = vec![system_message];
    let mut recent = chat
        .messages
        .iter()
        .rev()
        .take(preset.context_messages)
        .cloned()
        .collect::<Vec<_>>();
    recent.reverse();

    let mut budget_used = estimate_prompt_tokens(&messages) + estimate_text_tokens(user_input) + 4;
    for message in recent {
        let cost = estimate_message_tokens(&ChatMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        });
        if budget_used + cost > preset.max_input_chars {
            continue;
        }
        budget_used += cost;
        messages.push(ChatMessage {
            role: message.role,
            content: message.content,
        });
    }
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_input.to_string(),
    });

    Ok(PromptBuildResult {
        chat_id: chat.id,
        character_id: character.id,
        preset_id: preset.id,
        provider_id: provider.id,
        model: selected_model,
        estimated_chars: estimate_prompt_tokens(&messages),
        budget_chars: preset.max_input_chars,
        max_output_tokens: preset.max_output_tokens,
        temperature: preset.temperature,
        reply_limit: preset.reply_limit,
        messages,
        matched_worldbook_entries: matched,
    })
}

pub fn append_exchange(
    app: &AppHandle,
    prompt: &PromptBuildResult,
    user_input: &str,
    assistant_reply: &str,
) -> Result<(), String> {
    let mut chat = load_chat(app, &prompt.chat_id)?;
    let now = now_stamp();
    chat.character_id = prompt.character_id.clone();
    chat.preset_id = Some(prompt.preset_id.clone());
    chat.provider_id = Some(prompt.provider_id.clone());
    chat.messages.push(TavernChatMessage {
        id: new_id("msg", "user"),
        role: "user".to_string(),
        content: user_input.to_string(),
        created_at: now.clone(),
        bookmarked: false,
    });
    chat.messages.push(TavernChatMessage {
        id: new_id("msg", "assistant"),
        role: "assistant".to_string(),
        content: assistant_reply.to_string(),
        created_at: now.clone(),
        bookmarked: false,
    });

    let max_messages = 160usize;
    if chat.messages.len() > max_messages {
        let overflow = chat.messages.len() - max_messages;
        let older = chat.messages.drain(0..overflow).collect::<Vec<_>>();
        let mut digest = chat.summary;
        for message in older {
            let speaker = if message.role == "user" { "用户" } else { "角色" };
            digest.push_str(&format!("{speaker}: {}; ", message.content));
        }
        chat.summary = digest
            .chars()
            .rev()
            .take(1800)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }

    chat.updated_at = now;
    save_chat_internal(app, &chat)?;
    let _ = emit_chat_list_changed(app, "message", Some(chat.id), None);
    Ok(())
}

#[tauri::command]
pub fn list_characters(app: AppHandle) -> Result<Vec<TavernCharacter>, String> {
    ensure_seed_data(&app)?;
    let paths = tavern_paths(&app)?;
    let mut items = list_json::<TavernCharacter>(&paths.characters)?;
    for item in &mut items {
        let before = item.avatar.clone();
        normalize_avatar_path(&app, &mut item.avatar)?;
        if item.avatar != before {
            save_character_internal(&app, item)?;
        }
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn save_character(app: AppHandle, character: TavernCharacter) -> Result<TavernCharacter, String> {
    let mut character = normalize_character(character);
    normalize_avatar_path(&app, &mut character.avatar)?;
    save_character_internal(&app, &character)?;
    let _ = emit_characters_changed(&app, "save", Some(character.id.clone()));
    Ok(character)
}

#[tauri::command]
pub fn import_character_card(app: AppHandle, path: String) -> Result<TavernCharacter, String> {
    let source = import_source_path(&path, "角色卡")?;

    let value = match source.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_lowercase()) {
        Some(ext) if ext == "png" => {
            let bytes = fs::read(&source).map_err(|err| format!("无法读取 PNG 角色卡: {err}"))?;
            let encoded = parse_png_text_chunks(&bytes).ok_or_else(|| "没有在 PNG 中找到 SillyTavern 角色卡元数据".to_string())?;
            let decoded = if encoded.trim_start().starts_with('{') {
                encoded.into_bytes()
            } else {
                decode_base64(&encoded)?
            };
            serde_json::from_slice::<Value>(&decoded).map_err(|err| format!("角色卡元数据不是有效 JSON: {err}"))?
        }
        _ => {
            let content = fs::read_to_string(&source).map_err(|err| format!("无法读取角色卡 JSON: {err}"))?;
            serde_json::from_str::<Value>(&content).map_err(|err| format!("角色卡 JSON 格式错误: {err}"))?
        }
    };

    let mut character = normalize_character(character_from_value(value));
    normalize_avatar_path(&app, &mut character.avatar)?;
    save_character_internal(&app, &character)?;
    let _ = emit_characters_changed(&app, "import", Some(character.id.clone()));
    Ok(character)
}

#[tauri::command]
pub fn export_character_card(app: AppHandle, character_id: String, path: String) -> Result<String, String> {
    let character = load_character(&app, Some(&character_id))?;
    let value = json!({
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name": character.name,
            "description": character.description,
            "personality": character.personality,
            "scenario": character.scenario,
            "first_mes": character.first_mes,
            "mes_example": character.mes_example,
            "tags": character.tags,
            "extensions": {
                "jingling_character_id": character.id
            }
        }
    });
    let target = export_target_path(&path, "角色卡")?;
    write_json(&target, &value)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn list_personas(app: AppHandle) -> Result<Vec<Persona>, String> {
    ensure_seed_data(&app)?;
    let paths = tavern_paths(&app)?;
    let mut items = list_json::<Persona>(&paths.personas)?;
    for item in &mut items {
        let before = item.avatar.clone();
        normalize_avatar_path(&app, &mut item.avatar)?;
        if item.avatar != before {
            save_persona_internal(&app, item)?;
        }
    }
    items.sort_by(|a, b| b.is_default.cmp(&a.is_default).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
pub fn save_persona(app: AppHandle, persona: Persona) -> Result<Persona, String> {
    let mut next = normalize_persona(persona);
    normalize_avatar_path(&app, &mut next.avatar)?;
    if next.is_default {
        for mut item in list_personas(app.clone())? {
            if item.id != next.id && item.is_default {
                item.is_default = false;
                save_persona_internal(&app, &item)?;
            }
        }
    }
    if !list_personas(app.clone())?.iter().any(|item| item.is_default) {
        next.is_default = true;
    }
    save_persona_internal(&app, &next)?;
    let _ = emit_personas_changed(&app, "save", Some(next.id.clone()));
    Ok(next)
}

#[tauri::command]
pub fn import_avatar_image(app: AppHandle, path: String) -> Result<String, String> {
    let source = import_source_path(&path, "头像")?;
    Ok(copy_avatar_image(&app, &source)?.display().to_string())
}

#[tauri::command]
pub fn import_persona(app: AppHandle, path: String) -> Result<Persona, String> {
    let source = import_source_path(&path, "Persona")?;
    let persona = normalize_persona(read_json::<Persona>(&source)?);
    save_persona(app, persona)
}

#[tauri::command]
pub fn export_persona(app: AppHandle, persona_id: String, path: String) -> Result<String, String> {
    let persona = load_persona(&app, Some(&persona_id))?;
    let target = export_target_path(&path, "Persona")?;
    write_json(&target, &persona)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn create_chat(app: AppHandle, character_id: Option<String>) -> Result<TavernChatSession, String> {
    ensure_seed_data(&app)?;
    let chat = create_chat_internal(&app, character_id)?;
    let _ = emit_chat_list_changed(&app, "create", Some(chat.id.clone()), None);
    Ok(chat)
}

#[tauri::command]
pub fn list_chats(app: AppHandle) -> Result<Vec<TavernChatListItem>, String> {
    ensure_seed_data(&app)?;
    let paths = tavern_paths(&app)?;
    list_chat_items_from_dir(&paths.chats)
}

#[tauri::command]
pub fn load_chat_command(app: AppHandle, chat_id: String) -> Result<TavernChatSession, String> {
    load_chat(&app, &chat_id)
}

#[tauri::command]
pub fn update_chat_settings(
    app: AppHandle,
    chat_id: String,
    character_id: Option<String>,
    persona_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
) -> Result<TavernChatSession, String> {
    let mut chat = load_chat(&app, &chat_id)?;

    if let Some(value) = character_id.filter(|value| !value.trim().is_empty()) {
        let character = load_character(&app, Some(&value))?;
        chat.character_id = character.id;
    }
    if let Some(value) = persona_id {
        chat.persona_id = if value.trim().is_empty() {
            None
        } else {
            Some(load_persona(&app, Some(&value))?.id)
        };
    }
    if let Some(value) = preset_id {
        chat.preset_id = if value.trim().is_empty() {
            None
        } else {
            Some(load_preset(&app, Some(&value))?.id)
        };
    }
    if let Some(value) = provider_id {
        chat.provider_id = if value.trim().is_empty() {
            None
        } else {
            Some(provider_by_id(Some(&value))?.id)
        };
    }

    chat.updated_at = now_stamp();
    save_chat_internal(&app, &chat)?;
    let _ = emit_chat_list_changed(&app, "settings", Some(chat.id.clone()), None);
    Ok(chat)
}

#[tauri::command]
#[allow(dead_code)]
pub fn delete_chat(app: AppHandle, chat_id: String) -> Result<(), String> {
    let paths = tavern_paths(&app)?;
    for path in chat_file_paths_by_id(&paths.chats, &chat_id)? {
        fs::remove_file(&path).map_err(|err| format!("无法删除聊天 {}: {err}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_chat_command(app: AppHandle, chat_id: String) -> Result<Vec<TavernChatListItem>, String> {
    let paths = tavern_paths(&app)?;
    let paths_to_delete = chat_file_paths_by_id(&paths.chats, &chat_id)?;
    if paths_to_delete.is_empty() {
        return Err("没有找到要删除的聊天文件。".to_string());
    }
    for path in paths_to_delete {
        fs::remove_file(&path).map_err(|err| format!("无法删除聊天 {}: {err}", path.display()))?;
    }
    emit_chat_list_changed(&app, "delete", None, Some(chat_id))
}

#[tauri::command]
pub fn search_chats(app: AppHandle, query: String) -> Result<Vec<TavernChatListItem>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return list_chats(app);
    }
    let paths = tavern_paths(&app)?;
    let chats = list_json::<TavernChatSession>(&paths.chats)?;
    let mut results = Vec::new();
    for chat in chats {
        let mut haystack = format!("{} {}", chat.title, chat.tags.join(" ")).to_lowercase();
        for message in &chat.messages {
            haystack.push(' ');
            haystack.push_str(&message.content.to_lowercase());
        }
        if haystack.contains(&needle) {
            results.push(TavernChatListItem {
                id: chat.id,
                title: chat.title,
                character_id: chat.character_id,
                updated_at: chat.updated_at,
                message_count: chat.messages.len(),
                last_message: chat
                    .messages
                    .last()
                    .map(|message| compact_reply(&message.content, 72))
                    .unwrap_or_default(),
                tags: chat.tags,
            });
        }
    }
    results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(results)
}

#[tauri::command]
pub fn bookmark_message(app: AppHandle, chat_id: String, message_id: String, bookmarked: bool) -> Result<TavernChatSession, String> {
    let mut chat = load_chat(&app, &chat_id)?;
    for message in &mut chat.messages {
        if message.id == message_id {
            message.bookmarked = bookmarked;
        }
    }
    chat.updated_at = now_stamp();
    save_chat_internal(&app, &chat)?;
    let _ = emit_chat_list_changed(&app, "bookmark", Some(chat.id.clone()), None);
    Ok(chat)
}

#[tauri::command]
pub fn clear_chat_messages(app: AppHandle, chat_id: String) -> Result<TavernChatSession, String> {
    let mut chat = load_chat(&app, &chat_id)?;
    chat.messages.clear();
    chat.summary.clear();
    chat.updated_at = now_stamp();
    save_chat_internal(&app, &chat)?;
    let _ = emit_chat_list_changed(&app, "clear", Some(chat.id.clone()), None);
    Ok(chat)
}

#[tauri::command]
pub fn list_worldbooks(app: AppHandle) -> Result<Vec<Worldbook>, String> {
    ensure_seed_data(&app)?;
    let paths = tavern_paths(&app)?;
    let mut items = list_json::<Worldbook>(&paths.worldbooks)?;
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn save_worldbook(app: AppHandle, worldbook: Worldbook) -> Result<Worldbook, String> {
    let worldbook = normalize_worldbook(worldbook);
    save_worldbook_internal(&app, &worldbook)?;
    Ok(worldbook)
}

#[tauri::command]
pub fn import_worldbook(app: AppHandle, path: String) -> Result<Worldbook, String> {
    let source = import_source_path(&path, "世界书")?;
    let worldbook = normalize_worldbook(read_json::<Worldbook>(&source)?);
    save_worldbook_internal(&app, &worldbook)?;
    Ok(worldbook)
}

#[tauri::command]
pub fn export_worldbook(app: AppHandle, worldbook_id: String, path: String) -> Result<String, String> {
    let worldbook = load_worldbook(&app, &worldbook_id)?;
    let target = export_target_path(&path, "世界书")?;
    write_json(&target, &worldbook)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn test_worldbook_match(app: AppHandle, text: String) -> Result<Vec<WorldbookMatch>, String> {
    match_worldbook_entries(&app, &text)
}

#[tauri::command]
pub fn list_presets(app: AppHandle) -> Result<Vec<PromptPreset>, String> {
    ensure_seed_data(&app)?;
    let paths = tavern_paths(&app)?;
    let mut items = list_json::<PromptPreset>(&paths.presets)?;
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
pub fn save_preset(app: AppHandle, preset: PromptPreset) -> Result<PromptPreset, String> {
    let preset = normalize_preset(preset);
    save_preset_internal(&app, &preset)?;
    let _ = emit_presets_changed(&app, "save", Some(preset.id.clone()));
    Ok(preset)
}

#[tauri::command]
pub fn import_preset(app: AppHandle, path: String) -> Result<PromptPreset, String> {
    let source = import_source_path(&path, "预设")?;
    let preset = normalize_preset(read_json::<PromptPreset>(&source)?);
    save_preset(app, preset)
}

#[tauri::command]
pub fn export_preset(app: AppHandle, preset_id: String, path: String) -> Result<String, String> {
    let preset = load_preset(&app, Some(&preset_id))?;
    let target = export_target_path(&path, "预设")?;
    write_json(&target, &preset)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn list_providers() -> Result<Vec<ProviderConfig>, String> {
    Ok(default_providers())
}

#[tauri::command]
pub fn save_provider_key(provider_id: String, api_key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &provider_credential_user(&provider_id))
        .map_err(|err| format!("系统凭据初始化失败: {err}"))?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry
        .set_password(trimmed)
        .map_err(|err| format!("保存 Provider API Key 失败: {err}"))
}

#[tauri::command]
pub fn preview_prompt(
    app: AppHandle,
    chat_id: Option<String>,
    character_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
    message: Option<String>,
) -> Result<PromptBuildResult, String> {
    build_prompt_for_chat(
        &app,
        message.as_deref().unwrap_or("你好"),
        chat_id,
        character_id,
        preset_id,
        provider_id,
        None,
    )
}

#[tauri::command]
pub fn export_chat(app: AppHandle, chat_id: String, path: String) -> Result<String, String> {
    let chat = load_chat(&app, &chat_id)?;
    let target = PathBuf::from(path.trim());
    write_json(&target, &chat)?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn import_chat(app: AppHandle, path: String) -> Result<TavernChatSession, String> {
    let source = PathBuf::from(path.trim());
    let mut chat = read_json::<TavernChatSession>(&source)?;
    if chat.id.trim().is_empty() {
        chat.id = new_id("chat", &chat.title);
    }
    if chat.title.trim().is_empty() {
        chat.title = "导入聊天".to_string();
    }
    if chat.created_at.trim().is_empty() {
        chat.created_at = now_stamp();
    }
    chat.updated_at = now_stamp();
    ensure_unique_message_ids(&mut chat);
    for message in &mut chat.messages {
        if message.created_at.trim().is_empty() {
            message.created_at = now_stamp();
        }
    }
    save_chat_internal(&app, &chat)?;
    let _ = emit_chat_list_changed(&app, "import", Some(chat.id.clone()), None);
    Ok(chat)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_chat_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jingling-tavern-test-{}-{}",
            name,
            new_id("run", "test")
        ));
        fs::create_dir_all(&dir).expect("create temp chat dir");
        dir
    }

    fn chat_fixture(id: &str, title: &str, updated_at: &str) -> TavernChatSession {
        TavernChatSession {
            id: id.to_string(),
            title: title.to_string(),
            character_id: DEFAULT_CHARACTER_ID.to_string(),
            persona_id: Some(DEFAULT_PERSONA_ID.to_string()),
            preset_id: Some(DEFAULT_PRESET_ID.to_string()),
            provider_id: Some(DEFAULT_PROVIDER_ID.to_string()),
            summary: String::new(),
            tags: Vec::new(),
            created_at: "0".to_string(),
            updated_at: updated_at.to_string(),
            messages: vec![TavernChatMessage {
                id: format!("msg-{updated_at}"),
                role: "assistant".to_string(),
                content: title.to_string(),
                created_at: updated_at.to_string(),
                bookmarked: false,
            }],
        }
    }

    #[test]
    fn finds_legacy_chat_file_by_json_id() {
        let dir = temp_chat_dir("legacy-id");
        let legacy_path = dir.join("legacy-file-name.json");
        write_json(&legacy_path, &chat_fixture("chat:legacy/imported", "legacy", "2")).unwrap();

        let matches = chat_file_paths_by_id(&dir, "chat:legacy/imported").unwrap();

        assert_eq!(matches, vec![legacy_path]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delete_lookup_returns_all_duplicate_chat_id_files() {
        let dir = temp_chat_dir("duplicates");
        let first = dir.join("first-copy.json");
        let second = dir.join("second-copy.json");
        write_json(&first, &chat_fixture("same-chat-id", "first", "1")).unwrap();
        write_json(&second, &chat_fixture("same-chat-id", "second", "2")).unwrap();

        let mut matches = chat_file_paths_by_id(&dir, "same-chat-id").unwrap();
        matches.sort();

        assert_eq!(matches, vec![first, second]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_chat_items_dedupes_by_id_and_keeps_newest() {
        let dir = temp_chat_dir("dedupe");
        write_json(&dir.join("older.json"), &chat_fixture("same-chat-id", "older", "1")).unwrap();
        write_json(&dir.join("newer.json"), &chat_fixture("same-chat-id", "newer", "2")).unwrap();

        let chats = list_chat_items_from_dir(&dir).unwrap();

        assert_eq!(chats.len(), 1);
        assert_eq!(chats[0].id, "same-chat-id");
        assert_eq!(chats[0].title, "newer");
        fs::remove_dir_all(dir).unwrap();
    }
}
