mod desktop;
mod integrate;
mod library;
mod monitor;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Prefer native Wayland over XWayland on Linux. webkit2gtk picks up
    // GDK_BACKEND from the env, so this must be set before the tauri builder
    // initializes GTK. The ",x11" fallback keeps things working if the user
    // later logs into an X session.
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        if session.eq_ignore_ascii_case("wayland") && std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            desktop::set_wallpaper,
            library::fetch_and_save_wallpaper,
            library::save_image_bytes,
            library::list_wallpapers,
            library::delete_wallpaper,
            library::get_or_create_thumbnail,
            monitor::get_primary_monitor_pixels,
        ])
        .setup(|app| {
            // Self-integrate when launched from an AppImage on Linux —
            // copies the running .AppImage into ~/.local/bin and writes
            // a .desktop entry so the launcher picks it up. No-op on
            // macOS / Windows.
            integrate::integrate_if_needed();

            #[cfg(desktop)]
            {
                let show_i =
                    MenuItem::with_id(app, "show", "Open Ambient", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let mut tray = TrayIconBuilder::with_id("main")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Ambient")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray = tray.icon(icon);
                }

                let _ = tray.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
