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

/// Uninstall from inside the app (About panel "Uninstall" button).
/// Removes the desktop integration (binary copy, launcher entry, icon),
/// optionally purges settings + saved wallpapers, then quits. On Linux
/// only — `remove_integration` returns a friendly error elsewhere.
#[tauri::command]
async fn uninstall_self(purge: bool, app: AppHandle) -> Result<(), String> {
    integrate::remove_integration()?;
    if purge {
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::remove_dir_all(dir);
        }
        if let Ok(dir) = app.path().app_config_dir() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    // Quit shortly after so the IPC reply reaches the UI first.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        solo_instance::cleanup();
        handle.exit(0);
    });
    Ok(())
}

/// Whether "start on login" is currently enabled (XDG autostart entry
/// present). See integrate::autostart_*.
#[tauri::command]
fn get_autostart() -> bool {
    integrate::autostart_enabled()
}

/// Enable/disable start-on-login.
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    integrate::set_autostart(enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Headless uninstall path: `Ambient.AppImage --uninstall` (also what
    // the launcher's "Uninstall" desktop action runs). Remove the desktop
    // integration and exit before spinning up GTK / the webview. Settings
    // and saved wallpapers are intentionally left in place.
    if std::env::args().any(|a| a == "--uninstall") {
        match integrate::remove_integration() {
            Ok(()) => println!(
                "Ambient: removed the launcher entry, icon, and integrated binary. \
                 Your settings and saved wallpapers were left in place."
            ),
            Err(e) => eprintln!("Ambient: uninstall failed: {e}"),
        }
        return;
    }

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

        // Disable WebKitGTK's DMABUF renderer — but ONLY inside the bundled
        // AppImage. There, the bundled WebKit + the host Mesa frequently
        // disagree on EGL ("Could not create surfaceless EGL display:
        // EGL_BAD_ALLOC. Aborting...") and WebKit's GPU process abort()s,
        // SIGABRTing the whole app on launch; forcing the non-DMABUF
        // fallback fixes that. BUT the fallback also disables GPU
        // compositing, which kills every backdrop-filter blur in the UI —
        // so applying it unconditionally (the previous behaviour) made the
        // glass go flat in `tauri dev` and in native packages that run
        // against the host's own WebKit, where the EGL crash never happens.
        // Gate on $APPIMAGE (set by the AppImage runtime) so the crash
        // workaround stays where it's needed and the blur comes back
        // everywhere else. Still honour an explicit user override.
        let in_appimage = std::env::var_os("APPIMAGE").is_some();
        if in_appimage && std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: same as above — set before any GTK/WebKit thread spawns.
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }

        // Steer EGL away from a stuck NVIDIA vendor. libglvnd's EGL loader
        // scans /usr/share/glvnd/egl_vendor.d in filename order, and
        // `10_nvidia.json` (installed by nvidia-utils) sorts ahead of
        // `50_mesa.json`. On a machine with no NVIDIA GPU — e.g. an
        // AMD/Intel laptop where `nvidia-utils` was pulled in transitively
        // (Steam depends on it) — WebKit's web process still dlopens
        // libEGL_nvidia first. With no device to bind to it never really
        // initializes, but it registers teardown handlers that segfault on
        // process exit (SIGSEGV in posix_memalign during the webview's
        // destroy), spamming 90 MB coredumps. Detect that exact case —
        // an NVIDIA EGL vendor present while the kernel module is NOT
        // loaded — and point our own processes at the remaining (Mesa /
        // other) vendors only. A real NVIDIA system (module loaded) or an
        // explicit user override is left untouched.
        let egl_dir = std::path::Path::new("/usr/share/glvnd/egl_vendor.d");
        let nvidia_loaded = std::path::Path::new("/sys/module/nvidia").exists();
        if !nvidia_loaded && std::env::var_os("__EGL_VENDOR_LIBRARY_FILENAMES").is_none() {
            if let Ok(entries) = std::fs::read_dir(egl_dir) {
                let mut jsons: Vec<std::path::PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "json"))
                    .collect();
                let is_nvidia = |p: &std::path::Path| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().to_ascii_lowercase().contains("nvidia"))
                };
                // Only intervene if there's actually an NVIDIA vendor to skip
                // and at least one non-NVIDIA vendor left to fall back to.
                if jsons.iter().any(|p| is_nvidia(p)) {
                    jsons.retain(|p| !is_nvidia(p));
                    if !jsons.is_empty() {
                        jsons.sort();
                        let joined = jsons
                            .iter()
                            .map(|p| p.to_string_lossy().into_owned())
                            .collect::<Vec<_>>()
                            .join(":");
                        // SAFETY: same as above — set before any GTK/WebKit
                        // thread spawns and before glvnd reads the variable.
                        unsafe {
                            std::env::set_var("__EGL_VENDOR_LIBRARY_FILENAMES", joined);
                        }
                        tracing::info!(
                            vendors = %std::env::var("__EGL_VENDOR_LIBRARY_FILENAMES").unwrap_or_default(),
                            "steered EGL away from an inactive NVIDIA vendor"
                        );
                    }
                }
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            desktop::set_wallpaper,
            library::list_wallpapers,
            library::delete_wallpaper,
            library::get_or_create_thumbnail,
            library::clear_thumbnail_cache,
            library::delete_local_wallpapers,
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
            aigen::pollinations_models,
            renderer::apply_pattern,
            renderer::render_preview,
            rotation::rotate_now,
            tray_icon::update_tray_theme,
            uninstall_self,
            get_autostart,
            set_autostart,
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
