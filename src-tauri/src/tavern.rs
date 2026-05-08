use crate::memory::{self, ChatMessage};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_CHARACTER_ID: &str = "jingling";
const DEFAULT_PERSONA_ID: &str = "default-user";
const DEFAULT_PRESET_ID: &str = "healing-short-chat";
const DEFAULT_PROVIDER_ID: &str = "deepseek";
const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";
const SERVICE_NAME: &str = "jingling-desktop-pet";
const SUMMARY_PROMPT_LIMIT: usize = 2400;
const SUMMARY_STORE_LIMIT: usize = 6000;
const BOOKMARK_PROMPT_LIMIT: usize = 1200;
const SUMMARY_OUTPUT_TOKENS: u16 = 1200;
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

const SUMMARY_SECTION_TITLES: [&str; 6] = [
    "用户身份/偏好",
    "和角色的重要关系",
    "已发生的重要事件",
    "未完成的话题/承诺",
    "用户情绪倾向",
    "角色需要记住的称呼、禁忌、习惯",
];

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
    relationships: PathBuf,
    avatars: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelationshipStage {
    Guarded,
    Distant,
    Neutral,
    Close,
    Trusted,
}

impl Default for RelationshipStage {
    fn default() -> Self {
        Self::Neutral
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipStagePrompts {
    pub guarded: String,
    pub distant: String,
    pub neutral: String,
    pub close: String,
    pub trusted: String,
}

impl Default for RelationshipStagePrompts {
    fn default() -> Self {
        default_relationship_stage_prompts()
    }
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
    pub use_custom_relationship_prompts: bool,
    pub relationship_stage_prompts: RelationshipStagePrompts,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RelationshipUnlocks {
    pub special_greeting: bool,
    pub nickname: bool,
    pub idle_lines: bool,
    pub holiday_reaction: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RelationshipNicknameSettings {
    pub enabled: bool,
    pub user_nickname: String,
    pub character_nickname: String,
    pub minimum_stage: RelationshipStage,
}

impl Default for RelationshipNicknameSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            user_nickname: String::new(),
            character_nickname: String::new(),
            minimum_stage: RelationshipStage::Close,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RelationshipIdleLine {
    pub id: String,
    pub text: String,
    pub minimum_stage: RelationshipStage,
    pub enabled: bool,
    pub weight: u16,
    pub note: String,
}

impl Default for RelationshipIdleLine {
    fn default() -> Self {
        Self {
            id: String::new(),
            text: String::new(),
            minimum_stage: RelationshipStage::Neutral,
            enabled: true,
            weight: 1,
            note: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HolidayRule {
    pub id: String,
    pub name: String,
    pub month: u8,
    pub day: u8,
    pub enabled: bool,
    pub scope: String,
    pub minimum_stage: RelationshipStage,
    pub prompt: String,
    pub built_in: bool,
}

impl Default for HolidayRule {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            month: 1,
            day: 1,
            enabled: true,
            scope: "all".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            prompt: String::new(),
            built_in: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RelationshipPreferences {
    pub character_id: String,
    pub nickname_settings: RelationshipNicknameSettings,
    pub idle_lines: Vec<RelationshipIdleLine>,
    pub holidays: Vec<HolidayRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RelationshipEvent {
    pub id: String,
    pub created_at: String,
    pub delta: i32,
    pub mood_delta: i32,
    pub reason: String,
    pub source: String,
    pub confidence: f32,
    pub user_excerpt: String,
    pub assistant_excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CharacterRelationship {
    pub character_id: String,
    pub affection: i32,
    pub mood: i32,
    pub stage: RelationshipStage,
    pub stage_label: String,
    pub mood_label: String,
    pub events: Vec<RelationshipEvent>,
    pub unlocks: RelationshipUnlocks,
    pub last_passive_decay_at: String,
    pub warm_streak: u32,
    pub last_warm_interaction_at: String,
    pub nickname_settings: RelationshipNicknameSettings,
    pub idle_lines: Vec<RelationshipIdleLine>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipChangedPayload {
    pub relationship: CharacterRelationship,
    pub delta: i32,
    pub mood_delta: i32,
    pub reason: String,
    pub source: String,
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
    #[serde(default)]
    pub compacted: bool,
    #[serde(default)]
    pub compacted_at: Option<String>,
    #[serde(default)]
    pub summary_batch_id: Option<String>,
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
    pub memory_summary_used: bool,
    pub recent_message_count: usize,
    pub bookmarked_message_count: usize,
    pub compacted_message_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMemoryCompactResult {
    pub chat: TavernChatSession,
    pub compacted_count: usize,
    pub skipped_bookmarked_count: usize,
    pub summary_updated: bool,
    pub message: String,
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub fn now_stamp_public() -> String {
    now_stamp()
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

fn default_relationship_stage_prompts() -> RelationshipStagePrompts {
    RelationshipStagePrompts {
        guarded: "关系阶段: 戒备。{{char}}对{{user}}保持明显距离，语气谨慎、冷淡，不轻易亲近；如果用户真诚道歉或温和交流，可以出现一点缓和。".to_string(),
        distant: "关系阶段: 疏离。{{char}}愿意正常回应{{user}}，但仍保留边界，少用亲昵称呼，先观察用户是否可靠。".to_string(),
        neutral: "关系阶段: 普通。{{char}}自然、礼貌、轻松地陪伴{{user}}，不刻意暧昧，也不过分冷淡。".to_string(),
        close: "关系阶段: 亲近。{{char}}对{{user}}更放松、更主动，语气可以更柔软亲昵，会记得对方的善意和相处感。".to_string(),
        trusted: "关系阶段: 信赖。{{char}}很信任{{user}}，语气亲近、有安全感，可以出现专属问候、昵称倾向和更坦率的情绪表达。".to_string(),
    }
}

fn default_idle_lines() -> Vec<RelationshipIdleLine> {
    vec![
        RelationshipIdleLine {
            id: "idle-neutral".to_string(),
            text: "我在这里，慢慢来就好。".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            enabled: true,
            weight: 1,
            note: "普通阶段默认待机台词".to_string(),
        },
        RelationshipIdleLine {
            id: "idle-close".to_string(),
            text: "要不要歇一小会儿？我陪你。".to_string(),
            minimum_stage: RelationshipStage::Close,
            enabled: true,
            weight: 1,
            note: "亲近阶段默认待机台词".to_string(),
        },
        RelationshipIdleLine {
            id: "idle-trusted".to_string(),
            text: "今天也在你身边，放心。".to_string(),
            minimum_stage: RelationshipStage::Trusted,
            enabled: true,
            weight: 1,
            note: "信赖阶段默认待机台词".to_string(),
        },
    ]
}

fn default_holidays() -> Vec<HolidayRule> {
    vec![
        HolidayRule {
            id: "new-year".to_string(),
            name: "元旦".to_string(),
            month: 1,
            day: 1,
            enabled: true,
            scope: "all".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            prompt: "今天是元旦，可以自然地给出新年问候。".to_string(),
            built_in: true,
        },
        HolidayRule {
            id: "valentine".to_string(),
            name: "情人节".to_string(),
            month: 2,
            day: 14,
            enabled: true,
            scope: "all".to_string(),
            minimum_stage: RelationshipStage::Close,
            prompt: "今天是情人节；如果关系足够亲近，可以温柔回应节日氛围，但不要突然过分亲密。".to_string(),
            built_in: true,
        },
        HolidayRule {
            id: "children-day".to_string(),
            name: "儿童节".to_string(),
            month: 6,
            day: 1,
            enabled: true,
            scope: "all".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            prompt: "今天是儿童节，可以用轻快可爱的语气祝福一下。".to_string(),
            built_in: true,
        },
        HolidayRule {
            id: "qixi-placeholder".to_string(),
            name: "七夕占位".to_string(),
            month: 0,
            day: 0,
            enabled: false,
            scope: "manual".to_string(),
            minimum_stage: RelationshipStage::Close,
            prompt: "七夕相关反应入口；v1 不做农历自动换算，可手动填入当年阳历日期。".to_string(),
            built_in: true,
        },
        HolidayRule {
            id: "christmas".to_string(),
            name: "圣诞".to_string(),
            month: 12,
            day: 25,
            enabled: true,
            scope: "all".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            prompt: "今天是圣诞，可以自然地给出节日问候。".to_string(),
            built_in: true,
        },
        HolidayRule {
            id: "character-birthday".to_string(),
            name: "角色生日入口".to_string(),
            month: 0,
            day: 0,
            enabled: false,
            scope: "manual".to_string(),
            minimum_stage: RelationshipStage::Neutral,
            prompt: "角色生日反应入口；填入月日后启用。".to_string(),
            built_in: true,
        },
    ]
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
        relationships: root.join("relationships"),
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
        &paths.relationships,
        &paths.avatars,
    ] {
        fs::create_dir_all(dir).map_err(|err| format!("无法创建酒馆数据目录: {err}"))?;
    }
    Ok(paths)
}

fn json_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.json", sanitize_id(id, "item")))
}

fn holidays_path(paths: &TavernPaths) -> PathBuf {
    paths.root.join("holidays.json")
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

fn stage_for_affection(affection: i32) -> RelationshipStage {
    match affection {
        value if value <= -50 => RelationshipStage::Guarded,
        value if value <= -15 => RelationshipStage::Distant,
        value if value < 35 => RelationshipStage::Neutral,
        value if value < 75 => RelationshipStage::Close,
        _ => RelationshipStage::Trusted,
    }
}

fn stage_label(stage: RelationshipStage) -> &'static str {
    match stage {
        RelationshipStage::Guarded => "戒备",
        RelationshipStage::Distant => "疏离",
        RelationshipStage::Neutral => "普通",
        RelationshipStage::Close => "亲近",
        RelationshipStage::Trusted => "信赖",
    }
}

fn mood_label(mood: i32) -> &'static str {
    match mood {
        value if value <= -45 => "心情很差",
        value if value <= -15 => "有点低落",
        value if value < 15 => "心情平稳",
        value if value < 45 => "心情不错",
        _ => "很开心",
    }
}

fn relationship_unlocks(affection: i32) -> RelationshipUnlocks {
    RelationshipUnlocks {
        special_greeting: affection >= 35,
        nickname: affection >= 55,
        idle_lines: affection >= 75,
        holiday_reaction: affection >= 75,
    }
}

fn stage_rank(stage: RelationshipStage) -> i32 {
    match stage {
        RelationshipStage::Guarded => 0,
        RelationshipStage::Distant => 1,
        RelationshipStage::Neutral => 2,
        RelationshipStage::Close => 3,
        RelationshipStage::Trusted => 4,
    }
}

fn stage_allows(current: RelationshipStage, minimum: RelationshipStage) -> bool {
    stage_rank(current) >= stage_rank(minimum)
}

fn normalize_idle_lines(lines: &mut Vec<RelationshipIdleLine>) {
    if lines.is_empty() {
        *lines = default_idle_lines();
    }
    for line in lines {
        if line.id.trim().is_empty() {
            line.id = new_id("idle", &line.text);
        }
        if line.weight == 0 {
            line.weight = 1;
        }
    }
}

fn normalize_holidays(holidays: &mut Vec<HolidayRule>) {
    for holiday in holidays.iter_mut() {
        if holiday.id.trim().is_empty() {
            holiday.id = new_id("holiday", &holiday.name);
        }
        holiday.month = holiday.month.min(12);
        holiday.day = holiday.day.min(31);
        if holiday.scope.trim().is_empty() {
            holiday.scope = "all".to_string();
        }
    }

    for default_holiday in default_holidays() {
        if !holidays.iter().any(|holiday| holiday.id == default_holiday.id) {
            holidays.push(default_holiday);
        }
    }
}

fn load_holidays(app: &AppHandle) -> Result<Vec<HolidayRule>, String> {
    let paths = tavern_paths(app)?;
    let path = holidays_path(&paths);
    let mut holidays = if path.exists() {
        read_json::<Vec<HolidayRule>>(&path)?
    } else {
        default_holidays()
    };
    normalize_holidays(&mut holidays);
    write_json(&path, &holidays)?;
    Ok(holidays)
}

fn save_holidays(app: &AppHandle, mut holidays: Vec<HolidayRule>) -> Result<Vec<HolidayRule>, String> {
    normalize_holidays(&mut holidays);
    let paths = tavern_paths(app)?;
    write_json(&holidays_path(&paths), &holidays)?;
    Ok(holidays)
}

fn default_relationship(character_id: &str) -> CharacterRelationship {
    let mut relationship = CharacterRelationship {
        character_id: character_id.to_string(),
        affection: 0,
        mood: 0,
        stage: RelationshipStage::Neutral,
        stage_label: String::new(),
        mood_label: String::new(),
        events: Vec::new(),
        unlocks: RelationshipUnlocks::default(),
        last_passive_decay_at: String::new(),
        warm_streak: 0,
        last_warm_interaction_at: String::new(),
        nickname_settings: RelationshipNicknameSettings::default(),
        idle_lines: default_idle_lines(),
        updated_at: now_stamp(),
    };
    normalize_relationship(&mut relationship);
    relationship
}

fn normalize_relationship(relationship: &mut CharacterRelationship) {
    relationship.affection = relationship.affection.clamp(-100, 100);
    relationship.mood = relationship.mood.clamp(-100, 100);
    relationship.stage = stage_for_affection(relationship.affection);
    relationship.stage_label = stage_label(relationship.stage).to_string();
    relationship.mood_label = mood_label(relationship.mood).to_string();
    relationship.unlocks = relationship_unlocks(relationship.affection);
    normalize_idle_lines(&mut relationship.idle_lines);
    if relationship.updated_at.trim().is_empty() {
        relationship.updated_at = now_stamp();
    }
    if relationship.events.len() > 20 {
        let overflow = relationship.events.len() - 20;
        relationship.events.drain(0..overflow);
    }
}

fn load_relationship_internal(app: &AppHandle, character_id: &str) -> Result<CharacterRelationship, String> {
    let paths = tavern_paths(app)?;
    let path = json_path(&paths.relationships, character_id);
    let mut relationship = if path.exists() {
        read_json::<CharacterRelationship>(&path)?
    } else {
        default_relationship(character_id)
    };
    if relationship.character_id.trim().is_empty() {
        relationship.character_id = character_id.to_string();
    }
    normalize_relationship(&mut relationship);
    write_json(&path, &relationship)?;
    Ok(relationship)
}

fn save_relationship_internal(app: &AppHandle, relationship: &mut CharacterRelationship) -> Result<(), String> {
    relationship.updated_at = now_stamp();
    normalize_relationship(relationship);
    let paths = tavern_paths(app)?;
    write_json(&json_path(&paths.relationships, &relationship.character_id), relationship)
}

fn emit_relationship_changed(
    app: &AppHandle,
    relationship: CharacterRelationship,
    delta: i32,
    mood_delta: i32,
    reason: String,
    source: String,
) {
    let _ = app.emit(
        "relationship:changed",
        RelationshipChangedPayload {
            relationship,
            delta,
            mood_delta,
            reason,
            source,
        },
    );
}

fn relationship_stage_prompt(
    character: &TavernCharacter,
    persona: &Persona,
    relationship: &CharacterRelationship,
) -> String {
    let defaults = default_relationship_stage_prompts();
    let configured = if character.use_custom_relationship_prompts {
        &character.relationship_stage_prompts
    } else {
        &defaults
    };
    let fallback = match relationship.stage {
        RelationshipStage::Guarded => &defaults.guarded,
        RelationshipStage::Distant => &defaults.distant,
        RelationshipStage::Neutral => &defaults.neutral,
        RelationshipStage::Close => &defaults.close,
        RelationshipStage::Trusted => &defaults.trusted,
    };
    let prompt = match relationship.stage {
        RelationshipStage::Guarded => &configured.guarded,
        RelationshipStage::Distant => &configured.distant,
        RelationshipStage::Neutral => &configured.neutral,
        RelationshipStage::Close => &configured.close,
        RelationshipStage::Trusted => &configured.trusted,
    };
    let selected = if prompt.trim().is_empty() { fallback } else { prompt };
    selected
        .replace("{{char}}", &character.name)
        .replace("{{user}}", &persona.name)
}

fn relationship_prompt(
    character: &TavernCharacter,
    persona: &Persona,
    relationship: &CharacterRelationship,
    holidays: &[HolidayRule],
    client_now: Option<&str>,
) -> String {
    let stage_prompt = relationship_stage_prompt(character, persona, relationship);
    let recent_events = relationship
        .events
        .iter()
        .rev()
        .take(5)
        .map(|event| format!("- {} (好感 {:+}, 心情 {:+})", event.reason, event.delta, event.mood_delta))
        .collect::<Vec<_>>();
    let mut unlocks = Vec::new();
    if relationship.unlocks.special_greeting {
        unlocks.push("可以在自然开场时使用更特别的问候");
    }
    if relationship.unlocks.nickname {
        unlocks.push("可以在合适时表现出昵称倾向，但不要强行使用");
    }
    if relationship.unlocks.idle_lines {
        unlocks.push("可以出现更亲近的待机陪伴台词");
    }
    if relationship.unlocks.holiday_reaction {
        unlocks.push("可以响应节日或纪念日相关的亲近反应");
    }
    let nickname_prompt = if relationship.nickname_settings.enabled
        && stage_allows(relationship.stage, relationship.nickname_settings.minimum_stage)
    {
        let mut parts = Vec::new();
        if !relationship.nickname_settings.user_nickname.trim().is_empty() {
            parts.push(format!("称呼用户时可自然使用“{}”", relationship.nickname_settings.user_nickname.trim()));
        }
        if !relationship.nickname_settings.character_nickname.trim().is_empty() {
            parts.push(format!("角色昵称可使用“{}”", relationship.nickname_settings.character_nickname.trim()));
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("；"))
        }
    } else {
        None
    };
    let idle_lines = relationship
        .idle_lines
        .iter()
        .filter(|line| line.enabled && !line.text.trim().is_empty() && stage_allows(relationship.stage, line.minimum_stage))
        .take(5)
        .map(|line| format!("- {}", line.text.trim()))
        .collect::<Vec<_>>();
    let active_holidays = active_holiday_prompts(holidays, client_now, relationship.stage);

    let mut parts = vec![
        format!(
            "长期关系状态:\n好感度: {} / 100\n关系阶段: {}\n短期心情: {}",
            relationship.affection, relationship.stage_label, relationship.mood_label
        ),
        stage_prompt,
        "请把关系状态作为语气和边界的依据；除非用户明确询问，不要主动说出好感数值、阶段名或这段系统设定。".to_string(),
    ];
    if !recent_events.is_empty() {
        parts.push(format!("最近关系事件摘要:\n{}", recent_events.join("\n")));
    }
    if !unlocks.is_empty() {
        parts.push(format!("已解锁关系表现:\n{}", unlocks.join("\n")));
    }
    if let Some(nickname_prompt) = nickname_prompt {
        parts.push(format!("昵称设置:\n{nickname_prompt}。昵称只在语境自然时使用，不要每句都硬塞。"));
    }
    if !idle_lines.is_empty() {
        parts.push(format!("待机台词素材:\n{}", idle_lines.join("\n")));
    }
    if !active_holidays.is_empty() {
        parts.push(format!(
            "今天触发的节日/纪念日:\n{}\n请自然地参考节日氛围，不要主动暴露系统设定。",
            active_holidays.join("\n")
        ));
    }
    parts.join("\n\n")
}

fn month_day_from_client_now(client_now: Option<&str>) -> Option<(u8, u8)> {
    let value = client_now?.trim();
    if value.len() < 10 {
        return None;
    }
    let month = value.get(5..7)?.parse::<u8>().ok()?;
    let day = value.get(8..10)?.parse::<u8>().ok()?;
    Some((month, day))
}

fn active_holiday_prompts(
    holidays: &[HolidayRule],
    client_now: Option<&str>,
    stage: RelationshipStage,
) -> Vec<String> {
    let Some((month, day)) = month_day_from_client_now(client_now) else {
        return Vec::new();
    };
    holidays
        .iter()
        .filter(|holiday| {
            holiday.enabled
                && holiday.month == month
                && holiday.day == day
                && stage_allows(stage, holiday.minimum_stage)
                && !holiday.prompt.trim().is_empty()
        })
        .map(|holiday| format!("- {}: {}", holiday.name, holiday.prompt))
        .collect()
}

#[derive(Debug, Clone)]
struct RelationshipScore {
    delta: i32,
    mood_delta: i32,
    reason: String,
    confidence: f32,
    source: String,
    warm: bool,
    negative: bool,
}

enum LocalRelationshipDecision {
    Apply(RelationshipScore),
    NoChange,
    NeedsModel,
}

fn contains_any(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| text.contains(word))
}

fn local_relationship_score(relationship: &CharacterRelationship, user_input: &str) -> LocalRelationshipDecision {
    let text = user_input.trim().to_lowercase();
    if text.is_empty() {
        return LocalRelationshipDecision::NoChange;
    }

    let threats = ["威胁", "伤害你", "打你", "杀了你", "弄死你", "毁掉你"];
    let insults = ["滚", "闭嘴", "讨厌你", "烦死了", "废物", "垃圾", "笨蛋", "蠢", "没用"];
    let apologies = ["对不起", "抱歉", "不好意思", "我错了", "原谅我"];
    let praise = ["谢谢", "感谢", "喜欢你", "爱你", "你真好", "可爱", "温柔", "厉害", "辛苦了", "抱抱"];
    let care = ["你还好吗", "累不累", "休息一下", "别难过", "陪陪你"];
    let uncertain = ["开心", "难过", "生气", "失望", "关系", "好感", "心情"];

    if contains_any(&text, &threats) {
        return LocalRelationshipDecision::Apply(RelationshipScore {
            delta: -6,
            mood_delta: -12,
            reason: "感受到威胁或恶意命令".to_string(),
            confidence: 1.0,
            source: "local".to_string(),
            warm: false,
            negative: true,
        });
    }
    if contains_any(&text, &insults) {
        return LocalRelationshipDecision::Apply(RelationshipScore {
            delta: -4,
            mood_delta: -8,
            reason: "被冒犯，心情明显变差".to_string(),
            confidence: 0.95,
            source: "local".to_string(),
            warm: false,
            negative: true,
        });
    }
    if contains_any(&text, &apologies) {
        let delta = if relationship.affection < 0 { 3 } else { 1 };
        return LocalRelationshipDecision::Apply(RelationshipScore {
            delta,
            mood_delta: 5,
            reason: "真诚道歉让关系缓和".to_string(),
            confidence: 0.9,
            source: "local".to_string(),
            warm: true,
            negative: false,
        });
    }
    if contains_any(&text, &praise) {
        return LocalRelationshipDecision::Apply(RelationshipScore {
            delta: 2,
            mood_delta: 6,
            reason: "收到了感谢或夸奖".to_string(),
            confidence: 0.9,
            source: "local".to_string(),
            warm: true,
            negative: false,
        });
    }
    if contains_any(&text, &care) {
        return LocalRelationshipDecision::Apply(RelationshipScore {
            delta: 2,
            mood_delta: 5,
            reason: "感受到关心".to_string(),
            confidence: 0.85,
            source: "local".to_string(),
            warm: true,
            negative: false,
        });
    }
    if contains_any(&text, &uncertain) {
        return LocalRelationshipDecision::NeedsModel;
    }
    LocalRelationshipDecision::NoChange
}

fn limit_relationship_delta(current_affection: i32, delta: i32) -> i32 {
    let capped = delta.clamp(-6, 6);
    if current_affection < 0 && capped > 3 {
        3
    } else {
        capped
    }
}

fn excerpt(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    trimmed.chars().take(limit).collect::<String>() + "..."
}

fn apply_relationship_score(
    app: &AppHandle,
    character_id: &str,
    score: RelationshipScore,
    user_input: &str,
    assistant_reply: &str,
) -> Result<CharacterRelationship, String> {
    let mut relationship = load_relationship_internal(app, character_id)?;
    let mut raw_delta = score.delta;
    let mut raw_mood_delta = score.mood_delta;
    let mut reason = score.reason.clone();
    let mut source = score.source.clone();
    if score.negative {
        relationship.warm_streak = 0;
    } else if relationship.affection < 0 && score.warm && (score.delta > 0 || score.mood_delta > 0) {
        relationship.warm_streak = relationship.warm_streak.saturating_add(1);
        relationship.last_warm_interaction_at = now_stamp();
        if relationship.warm_streak % 3 == 0 {
            raw_delta += 1;
            raw_mood_delta += 2;
            reason = format!("{}；连续温和互动让关系继续恢复", reason);
            source = "recovery".to_string();
        }
    }

    let delta = limit_relationship_delta(relationship.affection, raw_delta);
    let mood_delta = raw_mood_delta.clamp(-12, 12);
    if delta == 0 && mood_delta == 0 {
        save_relationship_internal(app, &mut relationship)?;
        return Ok(relationship);
    }

    relationship.affection = (relationship.affection + delta).clamp(-100, 100);
    relationship.mood = (relationship.mood + mood_delta).clamp(-100, 100);
    relationship.events.push(RelationshipEvent {
        id: new_id("rel", character_id),
        created_at: now_stamp(),
        delta,
        mood_delta,
        reason: excerpt(&reason, 72),
        source: source.clone(),
        confidence: score.confidence.clamp(0.0, 1.0),
        user_excerpt: excerpt(user_input, 120),
        assistant_excerpt: excerpt(assistant_reply, 120),
    });
    save_relationship_internal(app, &mut relationship)?;
    emit_relationship_changed(app, relationship.clone(), delta, mood_delta, reason, source);
    Ok(relationship)
}

#[derive(Debug, Serialize)]
struct RelationshipThinking {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct RelationshipScoreRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    temperature: f32,
    max_tokens: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<RelationshipThinking>,
}

#[derive(Debug, Deserialize)]
struct RelationshipScoreResponse {
    choices: Vec<RelationshipScoreChoice>,
}

#[derive(Debug, Deserialize)]
struct RelationshipScoreChoice {
    message: RelationshipScoreMessage,
}

#[derive(Debug, Deserialize)]
struct RelationshipScoreMessage {
    content: String,
}

#[derive(Debug, Serialize)]
struct SummaryRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    temperature: f32,
    max_tokens: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<RelationshipThinking>,
}

#[derive(Debug, Deserialize)]
struct SummaryResponse {
    #[serde(default)]
    choices: Vec<SummaryChoice>,
}

#[derive(Debug, Deserialize)]
struct SummaryChoice {
    message: SummaryMessage,
}

#[derive(Debug, Deserialize)]
struct SummaryMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRelationshipScore {
    delta: i32,
    mood_delta: i32,
    reason: String,
    confidence: f32,
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&text[start..=end])
}

async fn model_relationship_score(
    client: &reqwest::Client,
    provider: &ProviderConfig,
    model: &str,
    api_key: Option<String>,
    relationship: &CharacterRelationship,
    user_input: &str,
    assistant_reply: &str,
) -> Result<Option<RelationshipScore>, String> {
    let prompt = format!(
        "当前好感: {}, 阶段: {}, 心情: {}\n用户本轮消息:\n{}\n角色回复:\n{}\n\n判断用户这轮话对角色关系的影响。只返回 JSON，字段为 delta、moodDelta、reason、confidence。delta 范围 -6 到 6，moodDelta 范围 -12 到 12。普通中性聊天应返回 0。reason 用中文短句。",
        relationship.affection,
        relationship.stage_label,
        relationship.mood_label,
        excerpt(user_input, 600),
        excerpt(assistant_reply, 600),
    );
    let body = RelationshipScoreRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: "你是关系变化评分器。只输出一个 JSON 对象，不要输出解释、Markdown 或代码块。".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: prompt,
            },
        ],
        stream: false,
        temperature: 0.0,
        max_tokens: 120,
        thinking: if provider.provider_type == "deepseek" {
            Some(RelationshipThinking { kind: "disabled" })
        } else {
            None
        },
    };

    let mut request = client.post(&provider.base_url).json(&body);
    if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("关系评分请求失败: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("关系评分返回 {}", response.status()));
    }
    let parsed = response
        .json::<RelationshipScoreResponse>()
        .await
        .map_err(|err| format!("关系评分 JSON 解析失败: {err}"))?;
    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .unwrap_or_default();
    let Some(json_text) = extract_json_object(content) else {
        return Ok(None);
    };
    let raw = serde_json::from_str::<ModelRelationshipScore>(json_text)
        .map_err(|err| format!("关系评分内容不是有效 JSON: {err}"))?;
    if raw.confidence < 0.55 || (raw.delta == 0 && raw.mood_delta == 0) {
        return Ok(None);
    }
    Ok(Some(RelationshipScore {
        delta: raw.delta,
        mood_delta: raw.mood_delta,
        reason: raw.reason,
        confidence: raw.confidence,
        source: "model".to_string(),
        warm: raw.delta > 0 || raw.mood_delta > 0,
        negative: raw.delta < 0 || raw.mood_delta < 0,
    }))
}

pub async fn judge_relationship_after_exchange(
    app: AppHandle,
    client: reqwest::Client,
    prompt: PromptBuildResult,
    user_input: String,
    assistant_reply: String,
) -> Result<(), String> {
    let relationship = load_relationship_internal(&app, &prompt.character_id)?;
    let score = match local_relationship_score(&relationship, &user_input) {
        LocalRelationshipDecision::Apply(score) => Some(score),
        LocalRelationshipDecision::NoChange => None,
        LocalRelationshipDecision::NeedsModel => {
            let provider = match provider_by_id(Some(&prompt.provider_id)) {
                Ok(provider) => provider,
                Err(_) => return Ok(()),
            };
            let api_key = match read_provider_api_key(&provider.id) {
                Ok(value) => value,
                Err(_) => return Ok(()),
            };
            if provider.provider_type != "ollama" && api_key.is_none() {
                return Ok(());
            }
            model_relationship_score(
                &client,
                &provider,
                &prompt.model,
                api_key,
                &relationship,
                &user_input,
                &assistant_reply,
            )
            .await
            .unwrap_or(None)
        }
    };
    if let Some(score) = score {
        let _ = apply_relationship_score(&app, &prompt.character_id, score, &user_input, &assistant_reply);
    }
    Ok(())
}

fn apply_passive_decay_to_relationship(relationship: &mut CharacterRelationship, now: &str) -> Option<(i32, i32)> {
    if relationship.affection <= -100 {
        relationship.last_passive_decay_at = now.to_string();
        normalize_relationship(relationship);
        return None;
    }
    relationship.affection = (relationship.affection - 1).clamp(-100, 100);
    relationship.last_passive_decay_at = now.to_string();
    normalize_relationship(relationship);
    Some((-1, 0))
}

pub fn apply_passive_relationship_decay(app: &AppHandle) -> Result<(), String> {
    let characters = list_characters(app.clone())?;
    let now = now_stamp();
    for character in characters.into_iter().filter(|character| character.enabled) {
        let mut relationship = load_relationship_internal(app, &character.id)?;
        if let Some((delta, mood_delta)) = apply_passive_decay_to_relationship(&mut relationship, &now) {
            save_relationship_internal(app, &mut relationship)?;
            emit_relationship_changed(
                app,
                relationship,
                delta,
                mood_delta,
                "时间流逝".to_string(),
                "timeDecay".to_string(),
            );
        } else {
            save_relationship_internal(app, &mut relationship)?;
        }
    }
    Ok(())
}

pub fn start_relationship_decay_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
            let _ = apply_passive_relationship_decay(&app);
        }
    });
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
        use_custom_relationship_prompts: false,
        relationship_stage_prompts: default_relationship_stage_prompts(),
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
                    compacted: false,
                    compacted_at: None,
                    summary_batch_id: None,
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
            compacted: false,
            compacted_at: None,
            summary_batch_id: None,
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
            compacted: false,
            compacted_at: None,
            summary_batch_id: None,
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
        use_custom_relationship_prompts: false,
        relationship_stage_prompts: default_relationship_stage_prompts(),
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
    if character.relationship_stage_prompts.guarded.trim().is_empty() {
        character.relationship_stage_prompts.guarded = default_relationship_stage_prompts().guarded;
    }
    if character.relationship_stage_prompts.distant.trim().is_empty() {
        character.relationship_stage_prompts.distant = default_relationship_stage_prompts().distant;
    }
    if character.relationship_stage_prompts.neutral.trim().is_empty() {
        character.relationship_stage_prompts.neutral = default_relationship_stage_prompts().neutral;
    }
    if character.relationship_stage_prompts.close.trim().is_empty() {
        character.relationship_stage_prompts.close = default_relationship_stage_prompts().close;
    }
    if character.relationship_stage_prompts.trusted.trim().is_empty() {
        character.relationship_stage_prompts.trusted = default_relationship_stage_prompts().trusted;
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

fn limit_text(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let take = limit.saturating_sub(3);
    trimmed.chars().take(take).collect::<String>() + "..."
}

fn speaker_label(role: &str) -> &'static str {
    if role == "user" {
        "用户"
    } else if role == "assistant" {
        "角色"
    } else {
        "系统"
    }
}

fn ensure_summary_sections(summary: &str) -> String {
    let mut normalized = limit_text(summary, SUMMARY_STORE_LIMIT);
    if normalized.trim().is_empty() {
        normalized = SUMMARY_SECTION_TITLES
            .iter()
            .map(|title| format!("{title}:\n- 未记录"))
            .collect::<Vec<_>>()
            .join("\n\n");
    }
    for title in SUMMARY_SECTION_TITLES {
        if !normalized.contains(title) {
            normalized.push_str(&format!("\n\n{title}:\n- 未记录"));
        }
    }
    normalized
}

fn bookmarked_context_for_prompt(
    messages: &[TavernChatMessage],
    recent_ids: &HashSet<String>,
    limit: usize,
) -> (String, usize) {
    let mut bookmarked = messages
        .iter()
        .filter(|message| message.bookmarked && !message.compacted && !recent_ids.contains(&message.id))
        .rev()
        .take(8)
        .collect::<Vec<_>>();
    bookmarked.reverse();

    let count = bookmarked.len();
    let text = bookmarked
        .into_iter()
        .map(|message| {
            format!(
                "{}: {}",
                speaker_label(&message.role),
                limit_text(&message.content, 180)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    (limit_text(&text, limit), count)
}

pub fn build_prompt_for_chat(
    app: &AppHandle,
    user_input: &str,
    chat_id: Option<String>,
    character_id: Option<String>,
    preset_id: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
    client_now: Option<String>,
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

    let mut recent = chat
        .messages
        .iter()
        .filter(|message| !message.compacted)
        .rev()
        .take(preset.context_messages)
        .cloned()
        .collect::<Vec<_>>();
    recent.reverse();
    let recent_ids = recent
        .iter()
        .map(|message| message.id.clone())
        .collect::<HashSet<_>>();
    let (bookmarked_context, bookmarked_message_count) =
        bookmarked_context_for_prompt(&chat.messages, &recent_ids, BOOKMARK_PROMPT_LIMIT);
    let compacted_message_count = chat.messages.iter().filter(|message| message.compacted).count();

    let mut trigger_text = user_input.to_string();
    if !chat.summary.trim().is_empty() {
        trigger_text.push('\n');
        trigger_text.push_str(&limit_text(&chat.summary, SUMMARY_PROMPT_LIMIT));
    }
    for message in &recent {
        trigger_text.push('\n');
        trigger_text.push_str(&message.content);
    }
    if !bookmarked_context.trim().is_empty() {
        trigger_text.push('\n');
        trigger_text.push_str(&bookmarked_context);
    }
    let matched = match_worldbook_entries(app, &trigger_text)?;

    let mut system_parts = Vec::new();
    system_parts.push(replace_vars(&preset.system_prompt, &character, &persona, &preset));
    let time_context = client_now
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| format!("Unix 毫秒 {}", now_stamp()));
    system_parts.push(format!(
        "当前本地时间:\n{time_context}\n请把这个时间作为判断今天、节日、问候和上下文时效的依据。"
    ));
    system_parts.push(format!(
        "角色卡:\n名字: {}\n描述: {}\n性格: {}\n场景: {}",
        character.name, character.description, character.personality, character.scenario
    ));
    let relationship = load_relationship_internal(app, &character.id)?;
    let holidays = load_holidays(app)?;
    system_parts.push(relationship_prompt(
        &character,
        &persona,
        &relationship,
        &holidays,
        client_now.as_deref(),
    ));
    if !character.mes_example.trim().is_empty() {
        system_parts.push(format!("示例对话:\n{}", character.mes_example));
    }
    if !persona.description.trim().is_empty() {
        system_parts.push(format!("用户 Persona:\n{}", persona.description));
    }
    if !chat.summary.trim().is_empty() {
        system_parts.push(format!("长期摘要:\n{}", limit_text(&chat.summary, SUMMARY_PROMPT_LIMIT)));
    }
    if !bookmarked_context.trim().is_empty() {
        system_parts.push(format!("重要收藏摘录:\n{}", bookmarked_context));
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

    let mut budget_used = estimate_prompt_tokens(&messages) + estimate_text_tokens(user_input) + 4;
    let mut recent_message_count = 0usize;
    for message in recent {
        let cost = estimate_message_tokens(&ChatMessage {
            role: message.role.clone(),
            content: message.content.clone(),
        });
        if budget_used + cost > preset.max_input_chars {
            continue;
        }
        budget_used += cost;
        recent_message_count += 1;
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
        memory_summary_used: !chat.summary.trim().is_empty(),
        recent_message_count,
        bookmarked_message_count,
        compacted_message_count,
        messages,
        matched_worldbook_entries: matched,
    })
}

pub fn append_exchange(
    app: &AppHandle,
    prompt: &PromptBuildResult,
    user_input: &str,
    assistant_reply: &str,
    user_created_at: Option<&str>,
    assistant_created_at: &str,
) -> Result<(), String> {
    let mut chat = load_chat(app, &prompt.chat_id)?;
    let user_created_at = user_created_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(assistant_created_at)
        .to_string();
    chat.character_id = prompt.character_id.clone();
    chat.preset_id = Some(prompt.preset_id.clone());
    chat.provider_id = Some(prompt.provider_id.clone());
    chat.messages.push(TavernChatMessage {
        id: new_id("msg", "user"),
        role: "user".to_string(),
        content: user_input.to_string(),
        created_at: user_created_at,
        bookmarked: false,
        compacted: false,
        compacted_at: None,
        summary_batch_id: None,
    });
    chat.messages.push(TavernChatMessage {
        id: new_id("msg", "assistant"),
        role: "assistant".to_string(),
        content: assistant_reply.to_string(),
        created_at: assistant_created_at.to_string(),
        bookmarked: false,
        compacted: false,
        compacted_at: None,
        summary_batch_id: None,
    });

    chat.updated_at = assistant_created_at.to_string();
    save_chat_internal(app, &chat)?;
    let _ = emit_chat_list_changed(app, "message", Some(chat.id), None);
    Ok(())
}

#[derive(Debug, Clone)]
struct CompactionSelection {
    message_ids: Vec<String>,
    skipped_bookmarked_count: usize,
}

fn select_compaction_messages(
    chat: &TavernChatSession,
    context_messages: usize,
    force: bool,
) -> Option<CompactionSelection> {
    let keep_raw_count = context_messages.max(2);
    let batch_size = (keep_raw_count / 2).max(1);
    let active_indices = chat
        .messages
        .iter()
        .enumerate()
        .filter_map(|(index, message)| (!message.compacted).then_some(index))
        .collect::<Vec<_>>();

    if active_indices.len() <= keep_raw_count {
        return None;
    }

    let protected_start = active_indices.len().saturating_sub(keep_raw_count);
    let older_indices = &active_indices[..protected_start];
    let skipped_bookmarked_count = older_indices
        .iter()
        .filter(|index| chat.messages[**index].bookmarked)
        .count();
    let eligible_ids = older_indices
        .iter()
        .filter_map(|index| {
            let message = &chat.messages[*index];
            (!message.bookmarked).then(|| message.id.clone())
        })
        .collect::<Vec<_>>();
    let target_count = if force {
        eligible_ids.len().min(batch_size)
    } else {
        batch_size
    };

    if target_count == 0 || eligible_ids.len() < target_count {
        return None;
    }

    Some(CompactionSelection {
        message_ids: eligible_ids.into_iter().take(target_count).collect(),
        skipped_bookmarked_count,
    })
}

fn resolve_chat_runtime(
    app: &AppHandle,
    chat: &TavernChatSession,
    preset_id: Option<&str>,
    provider_id: Option<&str>,
    model: Option<&str>,
) -> Result<(PromptPreset, ProviderConfig, String), String> {
    let character = load_character(app, Some(&chat.character_id))?;
    let preset = load_preset(
        app,
        preset_id
            .filter(|value| !value.trim().is_empty())
            .or(chat.preset_id.as_deref())
            .or(character.default_preset_id.as_deref()),
    )?;
    let selected_provider_id = provider_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| chat.provider_id.clone())
        .or_else(|| character.default_provider_id.clone())
        .unwrap_or_else(|| DEFAULT_PROVIDER_ID.to_string());
    let provider = provider_by_id(Some(&selected_provider_id))?;
    let selected_model = model
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| provider.default_model.clone());
    Ok((preset, provider, selected_model))
}

fn summary_transcript(messages: &[TavernChatMessage]) -> String {
    messages
        .iter()
        .map(|message| {
            format!(
                "[{}] {}: {}",
                message.created_at,
                speaker_label(&message.role),
                message.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

async fn summarize_chat_messages(
    client: &reqwest::Client,
    provider: &ProviderConfig,
    model: &str,
    api_key: Option<String>,
    existing_summary: &str,
    batch_messages: &[TavernChatMessage],
) -> Result<String, String> {
    let old_summary = if existing_summary.trim().is_empty() {
        "（暂无）".to_string()
    } else {
        limit_text(existing_summary, SUMMARY_STORE_LIMIT)
    };
    let transcript = summary_transcript(batch_messages);
    let user_prompt = format!(
        "已有长期摘要:\n{old_summary}\n\n本次需要整理进长期摘要的旧消息:\n{transcript}\n\n请合并成新的完整长期摘要。固定使用这些栏目并保留栏目名:\n- 用户身份/偏好\n- 和角色的重要关系\n- 已发生的重要事件\n- 未完成的话题/承诺\n- 用户情绪倾向\n- 角色需要记住的称呼、禁忌、习惯\n\n要求: 只根据消息和旧摘要整理，不要编造；不确定就写“未记录”；保留称呼、禁忌、承诺、关系变化和重要事件；语言简洁；不要输出 Markdown 代码块。"
    );
    let body = SummaryRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: "你是角色聊天的长期记忆整理器。你只负责把旧对话合并成结构化摘要，不能添加没有根据的新事实。".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_prompt,
            },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: SUMMARY_OUTPUT_TOKENS,
        thinking: if provider.provider_type == "deepseek" {
            Some(RelationshipThinking { kind: "disabled" })
        } else {
            None
        },
    };

    let mut request = client.post(&provider.base_url).json(&body);
    if let Some(api_key) = api_key {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("长期摘要整理请求失败: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("长期摘要整理返回 {status}: {}", limit_text(&text, 400)));
    }
    let parsed = response
        .json::<SummaryResponse>()
        .await
        .map_err(|err| format!("长期摘要整理 JSON 解析失败: {err}"))?;
    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .unwrap_or_default();
    if content.is_empty() {
        return Err("长期摘要整理没有返回内容".to_string());
    }
    Ok(ensure_summary_sections(content))
}

async fn compact_chat_memory_internal(
    app: AppHandle,
    client: reqwest::Client,
    chat_id: String,
    preset_id: Option<String>,
    provider_id: Option<String>,
    model: Option<String>,
    force: bool,
) -> Result<ChatMemoryCompactResult, String> {
    let chat = load_chat(&app, &chat_id)?;
    let (preset, provider, selected_model) = resolve_chat_runtime(
        &app,
        &chat,
        preset_id.as_deref(),
        provider_id.as_deref(),
        model.as_deref(),
    )?;
    let Some(selection) = select_compaction_messages(&chat, preset.context_messages, force) else {
        return Ok(ChatMemoryCompactResult {
            chat,
            compacted_count: 0,
            skipped_bookmarked_count: 0,
            summary_updated: false,
            message: "还没有达到需要整理的上下文上限".to_string(),
        });
    };

    let selected_ids = selection
        .message_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let batch_messages = chat
        .messages
        .iter()
        .filter(|message| selected_ids.contains(&message.id))
        .cloned()
        .collect::<Vec<_>>();
    if batch_messages.is_empty() {
        return Ok(ChatMemoryCompactResult {
            chat,
            compacted_count: 0,
            skipped_bookmarked_count: selection.skipped_bookmarked_count,
            summary_updated: false,
            message: "没有可整理的旧消息".to_string(),
        });
    }

    let api_key = read_provider_api_key(&provider.id)?;
    if provider.provider_type != "ollama" && api_key.is_none() {
        return Err(format!("还没有设置 {} API Key，无法整理长期摘要。", provider.name));
    }

    let next_summary = summarize_chat_messages(
        &client,
        &provider,
        &selected_model,
        api_key,
        &chat.summary,
        &batch_messages,
    )
    .await?;

    let mut latest = load_chat(&app, &chat_id)?;
    if latest.summary != chat.summary {
        return Ok(ChatMemoryCompactResult {
            chat: latest,
            compacted_count: 0,
            skipped_bookmarked_count: selection.skipped_bookmarked_count,
            summary_updated: false,
            message: "长期摘要刚刚被更新过，本次整理已跳过，稍后可重试。".to_string(),
        });
    }

    let now = now_stamp();
    let summary_batch_id = new_id("summary", &chat_id);
    let mut compacted_count = 0usize;
    let mut skipped_bookmarked_count = selection.skipped_bookmarked_count;
    for message in &mut latest.messages {
        if !selected_ids.contains(&message.id) {
            continue;
        }
        if message.bookmarked {
            skipped_bookmarked_count += 1;
            continue;
        }
        if message.compacted {
            continue;
        }
        message.compacted = true;
        message.compacted_at = Some(now.clone());
        message.summary_batch_id = Some(summary_batch_id.clone());
        compacted_count += 1;
    }

    if compacted_count == 0 {
        return Ok(ChatMemoryCompactResult {
            chat: latest,
            compacted_count: 0,
            skipped_bookmarked_count,
            summary_updated: false,
            message: "选中的旧消息已被收藏或已整理，本次没有改动。".to_string(),
        });
    }

    latest.summary = next_summary;
    latest.updated_at = now;
    save_chat_internal(&app, &latest)?;
    let _ = emit_chat_list_changed(&app, "compact", Some(latest.id.clone()), None);
    Ok(ChatMemoryCompactResult {
        chat: latest,
        compacted_count,
        skipped_bookmarked_count,
        summary_updated: true,
        message: format!("已整理 {compacted_count} 条旧消息进长期摘要"),
    })
}

pub async fn compact_chat_memory_for_prompt(
    app: AppHandle,
    client: reqwest::Client,
    prompt: PromptBuildResult,
    force: bool,
) -> Result<ChatMemoryCompactResult, String> {
    compact_chat_memory_internal(
        app,
        client,
        prompt.chat_id,
        Some(prompt.preset_id),
        Some(prompt.provider_id),
        Some(prompt.model),
        force,
    )
    .await
}

pub async fn compact_chat_memory(
    app: AppHandle,
    client: reqwest::Client,
    chat_id: String,
    force: bool,
) -> Result<ChatMemoryCompactResult, String> {
    compact_chat_memory_internal(app, client, chat_id, None, None, None, force).await
}

#[tauri::command]
pub fn get_relationship(app: AppHandle, character_id: String) -> Result<CharacterRelationship, String> {
    load_relationship_internal(&app, &character_id)
}

#[tauri::command]
pub fn list_relationships(app: AppHandle) -> Result<Vec<CharacterRelationship>, String> {
    let characters = list_characters(app.clone())?;
    let mut relationships = Vec::new();
    for character in characters {
        relationships.push(load_relationship_internal(&app, &character.id)?);
    }
    relationships.sort_by(|a, b| a.character_id.cmp(&b.character_id));
    Ok(relationships)
}

#[tauri::command]
pub fn reset_relationship(app: AppHandle, character_id: String) -> Result<CharacterRelationship, String> {
    let mut relationship = default_relationship(&character_id);
    save_relationship_internal(&app, &mut relationship)?;
    emit_relationship_changed(
        &app,
        relationship.clone(),
        0,
        0,
        "关系已重置".to_string(),
        "system".to_string(),
    );
    Ok(relationship)
}

#[tauri::command]
pub fn get_relationship_preferences(app: AppHandle, character_id: String) -> Result<RelationshipPreferences, String> {
    let relationship = load_relationship_internal(&app, &character_id)?;
    Ok(RelationshipPreferences {
        character_id,
        nickname_settings: relationship.nickname_settings,
        idle_lines: relationship.idle_lines,
        holidays: load_holidays(&app)?,
    })
}

#[tauri::command]
pub fn save_relationship_preferences(
    app: AppHandle,
    character_id: String,
    preferences: RelationshipPreferences,
) -> Result<RelationshipPreferences, String> {
    let mut relationship = load_relationship_internal(&app, &character_id)?;
    relationship.nickname_settings = preferences.nickname_settings;
    relationship.idle_lines = preferences.idle_lines;
    normalize_idle_lines(&mut relationship.idle_lines);
    save_relationship_internal(&app, &mut relationship)?;
    let holidays = save_holidays(&app, preferences.holidays)?;
    emit_relationship_changed(
        &app,
        relationship.clone(),
        0,
        0,
        "关系设置已保存".to_string(),
        "system".to_string(),
    );
    Ok(RelationshipPreferences {
        character_id,
        nickname_settings: relationship.nickname_settings,
        idle_lines: relationship.idle_lines,
        holidays,
    })
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
            if bookmarked {
                message.compacted = false;
                message.compacted_at = None;
                message.summary_batch_id = None;
            }
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
pub fn save_chat_summary(app: AppHandle, chat_id: String, summary: String) -> Result<TavernChatSession, String> {
    let mut chat = load_chat(&app, &chat_id)?;
    chat.summary = limit_text(&summary, SUMMARY_STORE_LIMIT);
    chat.updated_at = now_stamp();
    save_chat_internal(&app, &chat)?;
    let _ = emit_chat_list_changed(&app, "summary", Some(chat.id.clone()), None);
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
    client_now: Option<String>,
) -> Result<PromptBuildResult, String> {
    build_prompt_for_chat(
        &app,
        message.as_deref().unwrap_or("你好"),
        chat_id,
        character_id,
        preset_id,
        provider_id,
        None,
        client_now,
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
                compacted: false,
                compacted_at: None,
                summary_batch_id: None,
            }],
        }
    }

    fn message_fixture(index: usize) -> TavernChatMessage {
        TavernChatMessage {
            id: format!("msg-{index}"),
            role: if index % 2 == 0 { "user" } else { "assistant" }.to_string(),
            content: format!("message {index}"),
            created_at: index.to_string(),
            bookmarked: false,
            compacted: false,
            compacted_at: None,
            summary_batch_id: None,
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
    fn compaction_selection_keeps_recent_and_skips_bookmarks() {
        let mut chat = chat_fixture("chat", "title", "1");
        chat.messages = (0..10).map(message_fixture).collect();
        chat.messages[1].bookmarked = true;

        let selection = select_compaction_messages(&chat, 4, false).expect("selection");

        assert_eq!(selection.message_ids, vec!["msg-0".to_string(), "msg-2".to_string()]);
        assert_eq!(selection.skipped_bookmarked_count, 1);
    }

    #[test]
    fn auto_compaction_waits_for_full_batch_but_manual_can_force() {
        let mut chat = chat_fixture("chat", "title", "1");
        chat.messages = (0..5).map(message_fixture).collect();

        assert!(select_compaction_messages(&chat, 4, false).is_none());
        let forced = select_compaction_messages(&chat, 4, true).expect("forced selection");
        assert_eq!(forced.message_ids, vec!["msg-0".to_string()]);
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

    #[test]
    fn maps_affection_to_relationship_stage() {
        assert_eq!(stage_for_affection(-80), RelationshipStage::Guarded);
        assert_eq!(stage_for_affection(-20), RelationshipStage::Distant);
        assert_eq!(stage_for_affection(0), RelationshipStage::Neutral);
        assert_eq!(stage_for_affection(40), RelationshipStage::Close);
        assert_eq!(stage_for_affection(90), RelationshipStage::Trusted);
    }

    #[test]
    fn local_relationship_rules_score_obvious_messages() {
        let relationship = default_relationship("jingling");

        let positive = match local_relationship_score(&relationship, "谢谢你，你真好") {
            LocalRelationshipDecision::Apply(score) => score,
            _ => panic!("expected positive local score"),
        };
        assert!(positive.delta > 0);
        assert!(positive.mood_delta > 0);
        assert_eq!(positive.source, "local");
        assert!(positive.warm);
        assert!(!positive.negative);

        let negative = match local_relationship_score(&relationship, "闭嘴，真没用") {
            LocalRelationshipDecision::Apply(score) => score,
            _ => panic!("expected negative local score"),
        };
        assert!(negative.delta < 0);
        assert!(negative.mood_delta < 0);
        assert_eq!(negative.source, "local");
        assert!(!negative.warm);
        assert!(negative.negative);

        let mut negative_relationship = default_relationship("jingling");
        negative_relationship.affection = -20;
        let apology = match local_relationship_score(&negative_relationship, "对不起，我错了") {
            LocalRelationshipDecision::Apply(score) => score,
            _ => panic!("expected apology local score"),
        };
        assert_eq!(apology.delta, 3);
        assert!(apology.warm);

        assert!(matches!(
            local_relationship_score(&relationship, "今天吃了面"),
            LocalRelationshipDecision::NoChange
        ));
        assert!(matches!(
            local_relationship_score(&relationship, "我有点失望，但也不知道怎么说"),
            LocalRelationshipDecision::NeedsModel
        ));
    }

    #[test]
    fn passive_decay_updates_timestamp_without_adding_events() {
        let mut relationship = default_relationship("jingling");
        relationship.affection = 1;
        let event_count = relationship.events.len();

        let result = apply_passive_decay_to_relationship(&mut relationship, "123456");

        assert_eq!(result, Some((-1, 0)));
        assert_eq!(relationship.affection, 0);
        assert_eq!(relationship.last_passive_decay_at, "123456");
        assert_eq!(relationship.events.len(), event_count);

        relationship.affection = -100;
        let result = apply_passive_decay_to_relationship(&mut relationship, "456789");
        assert_eq!(result, None);
        assert_eq!(relationship.affection, -100);
        assert_eq!(relationship.last_passive_decay_at, "456789");
    }

    #[test]
    fn active_holidays_respect_date_enabled_and_stage() {
        let holidays = default_holidays();

        let neutral_prompts =
            active_holiday_prompts(&holidays, Some("2026-02-14 12:00:00 Asia/Shanghai"), RelationshipStage::Neutral);
        assert!(neutral_prompts.is_empty());

        let close_prompts =
            active_holiday_prompts(&holidays, Some("2026-02-14 12:00:00 Asia/Shanghai"), RelationshipStage::Close);
        assert_eq!(close_prompts.len(), 1);
        assert!(close_prompts[0].contains("情人节"));

        let qixi_prompts =
            active_holiday_prompts(&holidays, Some("2026-00-00 12:00:00 Asia/Shanghai"), RelationshipStage::Trusted);
        assert!(qixi_prompts.is_empty());
    }

    #[test]
    fn relationship_normalize_clamps_and_limits_event_log() {
        let mut relationship = default_relationship("jingling");
        relationship.affection = 250;
        relationship.mood = -250;
        for index in 0..25 {
            relationship.events.push(RelationshipEvent {
                id: format!("event-{index}"),
                created_at: index.to_string(),
                delta: 1,
                mood_delta: 1,
                reason: "test".to_string(),
                source: "local".to_string(),
                confidence: 1.0,
                user_excerpt: String::new(),
                assistant_excerpt: String::new(),
            });
        }

        normalize_relationship(&mut relationship);

        assert_eq!(relationship.affection, 100);
        assert_eq!(relationship.mood, -100);
        assert_eq!(relationship.events.len(), 20);
        assert_eq!(relationship.events[0].id, "event-5");
        assert!(relationship.unlocks.special_greeting);
    }
}
