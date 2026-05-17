mod accent;
mod desktop;
mod integrate;
mod library;
mod monitor;
mod tray_icon;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent,
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
            accent::get_system_accent,
            tray_icon::update_tray_theme,
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
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    });

                // Symbolic monochrome glyph. macOS gets the white glyph
                // + template flag and the system handles inversion
                // against the menubar's effective theme. Windows/Linux
                // tray hosts don't invert, so we detect the system's
                // color scheme at launch and ship the right variant
                // (dark glyph for light themes, white for dark). The
                // frontend's useTrayThemeSync() hook keeps the icon in
                // step with subsequent theme flips while the window is
                // open via the `update_tray_theme` command.
                #[cfg(target_os = "macos")]
                let glyph_light = true;
                #[cfg(not(target_os = "macos"))]
                let glyph_light = tray_icon::is_system_dark();
                tray = tray
                    .icon(tray_icon::symbolic_icon(!glyph_light))
                    .icon_as_template(true);

                let _ = tray.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Window close (chrome X, OS close, frontend .close()) destroys
            // the webview entirely — on WebKitGTK a hidden webview keeps
            // its GPU layers, backdrop-filter surfaces, and decoded image
            // cache resident (~150-200 MB), which is what users see when
            // the tray-only process still shows up large in `nvidia-smi`
            // or Task Manager. Destroying drops all of that; the tray
            // icon stays alive via the prevent_exit handler below, and
            // the next "Open Ambient" rebuilds a fresh webview from
            // tauri.conf.json's window definition.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = window.destroy();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Last-window-close would normally exit the process. Keep it
            // alive so the tray icon survives; the user explicitly quits
            // via the tray menu (which calls app.exit(0), bypassing this
            // because ExitRequested.code is Some in that path).
            if let RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

/// Show the main window, creating it on demand if a prior close destroyed it.
/// Called from the tray "Open Ambient" menu item.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }

    // Rebuild from the same window definition as tauri.conf.json — keeps
    // dimensions, decorations, transparency, and label in sync without
    // duplicating the config here.
    let config = app.config();
    if let Some(window_config) = config.app.windows.first() {
        if let Ok(builder) =
            tauri::WebviewWindowBuilder::from_config(app, window_config)
        {
            let _ = builder.build();
        }
    }
}
