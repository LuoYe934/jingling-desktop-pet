use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConversationStore {
    pub summary: String,
    pub messages: Vec<ChatMessage>,
}

fn memory_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法读取应用数据目录: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用数据目录: {err}"))?;
    Ok(dir.join("memory.json"))
}

pub fn load_memory(app: &AppHandle) -> Result<ConversationStore, String> {
    let path = memory_path(app)?;
    if !path.exists() {
        return Ok(ConversationStore::default());
    }

    let content = fs::read_to_string(path).map_err(|err| format!("无法读取记忆文件: {err}"))?;
    serde_json::from_str(&content).map_err(|err| format!("记忆文件格式错误: {err}"))
}

fn save_memory(app: &AppHandle, memory: &ConversationStore) -> Result<(), String> {
    let path = memory_path(app)?;
    let content = serde_json::to_string_pretty(memory).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| format!("无法保存记忆文件: {err}"))
}

pub fn clear_memory(app: &AppHandle) -> Result<(), String> {
    save_memory(app, &ConversationStore::default())
}
