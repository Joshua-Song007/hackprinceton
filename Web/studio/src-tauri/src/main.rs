#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod plugins;

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Opens a panel in its own OS window. The Studio normally pops panels out through window.open (see
/// on_new_window below) so they share the main window's state; this command is the standalone fallback.
#[tauri::command]
fn open_panel_window(app: AppHandle, panel_id: String) -> Result<(), String> {
    let label: String = panel_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    WebviewWindowBuilder::new(&app, format!("panel-{label}"), WebviewUrl::App(format!("popout.html#{label}").into()))
        .title(format!("Pear Studio - {label}"))
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(plugins::Runtimes::default())
        .invoke_handler(tauri::generate_handler![
            open_panel_window,
            plugins::install_plugin,
            plugins::uninstall_plugin,
            plugins::start_runtime,
            plugins::stop_runtime
        ])
        .setup(|app| {
            // Built here (window config has create:false) because window.open is blocked unless a new-window handler
            // returns a window; dockview pops panels out with window.open so they stay in the main JS context.
            let handle = app.handle().clone();
            let next = AtomicU32::new(0);
            WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .on_new_window(move |url, features| {
                    let label = format!("popout-{}", next.fetch_add(1, Ordering::Relaxed));
                    // about:blank first: the opener's window.open navigates the new webview to `url` itself.
                    match WebviewWindowBuilder::new(&handle, label, WebviewUrl::External("about:blank".parse().unwrap()))
                        .window_features(features)
                        .title(url.as_str())
                        .build()
                    {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(_) => NewWindowResponse::Deny,
                    }
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Pear Studio")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                plugins::stop_all(&app.state::<plugins::Runtimes>());
            }
        });
}
