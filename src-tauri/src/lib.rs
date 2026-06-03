mod accent;
mod aigen;
mod desktop;
mod emojis;
mod integrate;
mod library;
mod library_store;
mod license;
mod monitor;
mod renderer;
mod rotation;
mod secrets;
mod settings;
mod solo_instance;
mod sources;
mod tray_icon;
mod types;
mod util;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Structured logging via the `tracing` crate. The env-filter reads
    // RUST_LOG so dev can crank up verbosity for specific modules
    // (`RUST_LOG=ambient_lib::rotation=debug tauri dev`) without
    // recompiling. `try_init` rather than `init` because the test
    // harness may have already installed a subscriber.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("ambient_lib=info")),
        )
        .try_init();

    // Prefer native Wayland over XWayland on Linux. webkit2gtk picks up
    // GDK_BACKEND from the env, so this must be set before the tauri builder
    // initializes GTK. The ",x11" fallback keeps things working if the user
    // later logs into an X session.
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        if session.eq_ignore_ascii_case("wayland") && std::env::var("GDK_BACKEND").is_err() {
            // SAFETY: Rust 2024 made set_var unsafe because env mutation
            // can race with concurrent readers in other threads. This
            // call runs in `run()` before any tauri/tokio thread is
            // spawned and before the GTK backend reads the variable,
            // so there is no concurrent reader.
            unsafe {
                std::env::set_var("GDK_BACKEND", "wayland,x11");
            }
        }
    }

    // "New launch wins" solo-instance handoff. Reads the previous
    // instance's PID file, SIGTERMs it if it's still alive and is
    // really an `ambient` process, waits up to 1.5s for it to exit,
    // then writes our own PID. Runs BEFORE the tauri::Builder so we
    // never have two webviews / two trays competing for the shared
    // settings/library/license files.
    solo_instance::ensure_solo();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            desktop::set_wallpaper,
            library::list_wallpapers,
            library::delete_wallpaper,
            library::get_or_create_thumbnail,
            library_store::get_library,
            library_store::patch_library,
            license::get_startup_license,
            license::activate_license,
            license::clear_license,
            monitor::get_primary_monitor_pixels,
            accent::get_system_accent,
            secrets::get_secret,
            secrets::set_secret,
            secrets::clear_secret,
            settings::get_settings,
            settings::patch_settings,
            sources::fetch_source_wallpaper,
            aigen::generate_wallpaper,
            renderer::apply_pattern,
            renderer::render_preview,
            rotation::rotate_now,
            tray_icon::update_tray_theme,
        ])
        .setup(|app| {
            // Self-integrate when launched from an AppImage on Linux —
            // copies the running .AppImage into ~/.local/bin and writes
            // a .desktop entry so the launcher picks it up. No-op on
            // macOS / Windows.
            integrate::integrate_if_needed();

            // Rust-owned Settings + Library state. Phase 1 — every later
            // phase reads from here via the watch channel (rotation task)
            // or via the get_settings / patch_settings commands (TS UI).
            // load_or_default migrates from the legacy tauri-plugin-store
            // `ambient.json` on first run, leaving per-tab draft keys
            // (patterns.config, generate.prompt, app.tab) intact so the
            // JS plugin path keeps working for those.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir for state load");
            let _ = std::fs::create_dir_all(&app_data_dir);

            // Secrets backend MUST init before settings::load_or_default
            // — the key-migration step looks for BYO keys in the
            // settings JSON (whether legacy ambient.json or fresh
            // ambient-settings.json) and pushes them into the chosen
            // backend (OS keyring, or JSON fallback on headless Linux).
            // Running before settings::load means the migrated file is
            // already clean by the time Settings deserializes — no
            // dropped-on-the-floor secrets.
            secrets::init(&app_data_dir);
            secrets::migrate_from_settings(&app_data_dir);

            // Emoji cache dir for on-demand Fluent glyph fetches (the
            // picker offers the full Unicode set; non-bundled glyphs are
            // fetched + cached here on first use).
            emojis::init(&app_data_dir);

            let loaded_settings = settings::load_or_default(&app_data_dir);
            let loaded_library = library_store::load_or_default(&app_data_dir);
            app.manage(settings::SettingsState::new(
                loaded_settings,
                app_data_dir.join("ambient-settings.json"),
            ));
            app.manage(library_store::LibraryState::new(
                loaded_library,
                app_data_dir.join("ambient-library.json"),
            ));

            // License gate runs before the webview's first paint. Disk
            // load is synchronous (~ms), Polar revalidation runs in a
            // background task so cold launches don't pay the network
            // round-trip — the frontend mounts on cached state and
            // listens for `license-revoked` if Polar rejects later.
            let (license_info, startup_state, needs_reval) =
                license::load_at_startup(&app_data_dir);
            app.manage(license::LicenseState::new(
                license_info,
                startup_state,
                app_data_dir.join("ambient-license.json"),
            ));
            if needs_reval {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    license::revalidate_background(handle).await;
                });
            }

            // Background rotation + theme-follow tasks. Both survive
            // webview destroy/rebuild (the whole reason these moved
            // out of JS in Phase 4 — pre-Phase-4 the rotation timer
            // silently died the moment the user closed to tray).
            rotation::spawn(app.handle().clone());

            #[cfg(desktop)]
            {
                let next_i = MenuItem::with_id(
                    app,
                    "next",
                    "Next wallpaper",
                    true,
                    None::<&str>,
                )?;
                let sep = PredefinedMenuItem::separator(app)?;
                let show_i =
                    MenuItem::with_id(app, "show", "Open Ambient", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&next_i, &sep, &show_i, &quit_i])?;

                let mut tray = TrayIconBuilder::with_id("main")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Ambient")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "next" => {
                            // Tray-triggered rotation works in tray-only
                            // mode because rotation::trigger_once is
                            // Rust — the pre-Phase-4 JS timer couldn't.
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = rotation::trigger_once(&app).await;
                            });
                        }
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
                // Linux can't reliably read the panel theme, so it
                // commits to the white glyph — see
                // linux_panel_wants_light_glyph.
                #[cfg(target_os = "linux")]
                let glyph_light = tray_icon::linux_panel_wants_light_glyph();
                #[cfg(target_os = "windows")]
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
        .run(|_app, event| match event {
            // Last-window-close would normally exit the process. Keep it
            // alive so the tray icon survives; the user explicitly quits
            // via the tray menu (which calls app.exit(0), bypassing this
            // because ExitRequested.code is Some in that path).
            RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            // Clear the solo-instance PID file on a graceful exit so the
            // next launch doesn't waste time trying to take over a dead
            // process. SIGKILL'd or crashed exits leave it stale —
            // harmless; the next launch's process-name check skips it.
            RunEvent::Exit => solo_instance::cleanup(),
            _ => {}
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
