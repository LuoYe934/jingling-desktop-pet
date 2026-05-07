mod deepseek;
mod memory;
mod piper;
mod settings;
mod tavern;
mod tray;

use deepseek::{cancel_message, send_message, AppState};
use piper::{piper_status, synthesize_piper_command};
use settings::{
    clear_memory_command, get_settings, has_api_key, hide_chat_window, save_api_key,
    hide_tavern_window, set_always_on_top, set_pet_scale, show_chat_window, show_tavern_window,
    speak_text_command, toggle_autostart, toggle_chat_window, toggle_tavern_window, update_settings,
    TtsPreviewState,
};
use tavern::{
    bookmark_message, clear_chat_messages, create_chat, delete_chat_command, export_character_card,
    export_chat, export_persona, export_preset, export_worldbook, import_character_card,
    import_avatar_image, import_chat, import_persona, import_preset, import_worldbook,
    list_characters, list_chats, list_personas, list_presets, list_providers, list_worldbooks,
    load_chat_command, preview_prompt, save_character, save_persona, save_preset,
    save_provider_key, save_worldbook, search_chats, test_worldbook_match, update_chat_settings,
};
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

const TOGGLE_PET_SHORTCUT: &str = "Ctrl+Alt+Space";

fn toggle_pet_windows(app: &tauri::AppHandle) {
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };

    let pet_visible = pet.is_visible().unwrap_or(false);
    if pet_visible {
        if let Some(chat) = app.get_webview_window("chat") {
            let _ = chat.hide();
        }
        let _ = pet.hide();
        return;
    }

    let _ = pet.set_always_on_top(true);
    let _ = pet.set_skip_taskbar(true);
    let _ = pet.show();
    let _ = pet.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(TtsPreviewState::default())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts([TOGGLE_PET_SHORTCUT])?
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed
                            && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::Space)
                        {
                            toggle_pet_windows(app);
                        }
                    })
                    .build(),
            )?;
            tray::setup(app)?;
            if let Some(pet) = app.get_webview_window("pet") {
                let _ = pet.set_always_on_top(true);
                let _ = pet.set_skip_taskbar(true);
                let _ = pet.show();
            }
            if let Some(chat) = app.get_webview_window("chat") {
                let _ = chat.set_always_on_top(true);
                let _ = chat.set_skip_taskbar(true);
                let _ = chat.hide();
            }
            if let Some(tavern) = app.get_webview_window("tavern") {
                let _ = tavern.set_always_on_top(true);
                let _ = tavern.hide();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_message,
            cancel_message,
            save_api_key,
            has_api_key,
            get_settings,
            update_settings,
            set_pet_scale,
            set_always_on_top,
            toggle_autostart,
            show_chat_window,
            hide_chat_window,
            toggle_chat_window,
            show_tavern_window,
            hide_tavern_window,
            toggle_tavern_window,
            piper_status,
            synthesize_piper_command,
            speak_text_command,
            clear_memory_command,
            list_characters,
            save_character,
            import_avatar_image,
            import_character_card,
            export_character_card,
            list_personas,
            save_persona,
            import_persona,
            export_persona,
            create_chat,
            list_chats,
            load_chat_command,
            update_chat_settings,
            delete_chat_command,
            search_chats,
            bookmark_message,
            clear_chat_messages,
            list_worldbooks,
            save_worldbook,
            import_worldbook,
            export_worldbook,
            test_worldbook_match,
            list_presets,
            save_preset,
            import_preset,
            export_preset,
            list_providers,
            save_provider_key,
            preview_prompt,
            export_chat,
            import_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
