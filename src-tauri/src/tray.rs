use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager,
};

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let show_chat = MenuItemBuilder::with_id("show_chat", "打开快捷聊天").build(app)?;
    let show_tavern = MenuItemBuilder::with_id("show_tavern", "打开酒馆管理器").build(app)?;
    let show_free_mode = MenuItemBuilder::with_id("show_free_mode", "打开自由模式 QA").build(app)?;
    let show_story_mode = MenuItemBuilder::with_id("show_story_mode", "打开剧情模式 QA").build(app)?;
    let hide_windows = MenuItemBuilder::with_id("hide_windows", "隐藏聊天和模式窗口").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let mut menu_builder = MenuBuilder::new(app).items(&[&show_chat, &show_tavern]);
    if crate::web_bridge::qa_features_enabled() {
        menu_builder = menu_builder.items(&[&show_free_mode, &show_story_mode]);
    }
    let menu = menu_builder.items(&[&hide_windows, &quit]).build()?;

    let mut tray_builder = TrayIconBuilder::new()
        .tooltip("鲤灵桌宠")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_chat" => {
                show_window(app, "pet");
                show_window(app, "chat");
            }
            "show_tavern" => {
                show_window(app, "pet");
                show_window(app, "tavern");
            }
            "show_free_mode" => {
                hide_window(app, "pet");
                show_window(app, "free-mode");
            }
            "show_story_mode" => {
                show_window(app, "pet");
                show_window(app, "story-mode");
            }
            "hide_windows" => {
                hide_window(app, "chat");
                hide_window(app, "tavern");
                hide_window(app, "free-mode");
                hide_window(app, "story-mode");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                show_window(app, "pet");
                show_window(app, "chat");
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;

    Ok(())
}
