#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude_config_writer;
mod commands;
mod models;
mod presets;
mod provider_quota;
mod provider_service;
mod state;
mod storage;
mod usage_service;

use state::AppState;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, Wry};

fn build_provider_menu_items(app: &tauri::AppHandle) -> Vec<MenuItem<Wry>> {
    let Ok(state) = AppState::new() else {
        return vec![];
    };
    let providers = state.providers().list();
    let active = state.providers().get_active();
    let mut items = Vec::new();
    for p in &providers {
        let label = if active.as_ref().map(|a| &a.id == &p.id).unwrap_or(false) {
            format!("● {}  (当前)", p.name)
        } else {
            format!("  {}", p.name)
        };
        if let Ok(it) = MenuItem::with_id(
            app,
            &format!("prov:{}", p.id),
            label,
            true,
            None::<&str>,
        ) {
            items.push(it);
        }
    }
    items
}

fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let prov_items = build_provider_menu_items(app);
    let mut builder = MenuBuilder::new(app);
    for it in &prov_items {
        builder = builder.item(it);
    }
    if !prov_items.is_empty() {
        builder = builder.separator();
    }
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 CCBox", true, None::<&str>)?;
    let menu = builder.item(&show).item(&quit).build()?;
    Ok(menu)
}

fn refresh_tray_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let menu = build_tray_menu(app)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("CCBox")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "show" => show_main(app),
                "quit" => app.exit(0),
                s if s.starts_with("prov:") => {
                    let pid = s["prov:".len()..].to_string();
                    if let Some(st) = app.try_state::<AppState>() {
                        if commands::apply_switch(st.inner(), &pid).is_ok() {
                            let _ = refresh_tray_menu(app);
                        }
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(ic) = icon {
        builder = builder.icon(ic);
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = AppState::new()?;
            app.manage(state);
            // Tray is best-effort: never let it prevent the app from starting.
            let _ = setup_tray(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::add_provider,
            commands::update_provider,
            commands::delete_provider,
            commands::switch_provider,
            commands::reorder_providers,
            commands::clear_active,
            commands::get_active_id,
            commands::list_presets,
            commands::get_usage,
            commands::refresh_usage,
            commands::test_provider,
            commands::fetch_models,
            commands::get_settings,
            commands::set_settings,
            commands::apply_statusbar,
            commands::get_active_provider_info,
            commands::get_provider_quota,
            commands::default_pricing,
            commands::get_claude_settings_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CCBox");
}
