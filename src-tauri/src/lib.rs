mod commands;
mod integrate;
#[cfg(target_os = "linux")]
mod live_linux;
#[cfg(target_os = "macos")]
mod live_mac;
#[cfg(target_os = "windows")]
mod live_win;
mod rotation;
mod solo_instance;
mod tray_icon;

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Set once the user has explicitly chosen to exit (tray Quit, in-app
/// uninstall). The ExitRequested guard below only vetoes code-less exit
/// requests while this is false — so the tray survives a window close,
/// but nothing can re-veto an exit the user asked for (e.g. a late
/// last-window-destroyed request racing quit, or a session logoff after
/// quit started on Windows).
pub(crate) static QUITTING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Android: the JVM pointer, captured in JNI_OnLoad — the one callback
/// Android guarantees us when System.loadLibrary brings this cdylib in,
/// and the only public route to the VM: JNI_GetCreatedJavaVMs is
/// linker-namespace-restricted for apps, and tauri 2.11's tao/wry no
/// longer feed the ndk-context bridge. Consumed by the TLS-verifier
/// init in setup().
#[cfg(target_os = "android")]
static ANDROID_JVM: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn JNI_OnLoad(
    vm: *mut jni::sys::JavaVM,
    _reserved: *mut std::ffi::c_void,
) -> jni::sys::jint {
    let _ = ANDROID_JVM.set(vm as usize);
    jni::sys::JNI_VERSION_1_6
}

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
        QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
        solo_instance::cleanup();
        handle.exit(0);
    });
    Ok(())
}

/// Whether "start on login" is currently enabled (XDG autostart entry on
/// Linux, HKCU Run value on Windows). See integrate::autostart_*.
#[tauri::command]
fn get_autostart() -> bool {
    integrate::autostart_enabled()
}

/// Enable/disable start-on-login.
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    integrate::set_autostart(enabled)
}

/// Whether this process can update itself in place. True only for the
/// Linux AppImage ($APPIMAGE set) — that's the one desktop format
/// tauri-plugin-updater replaces on disk without an OS installer prompt.
/// On macOS/Windows the bundles aren't OS-code-signed, so an in-app
/// install would trip Gatekeeper/SmartScreen mid-update; those keep the
/// "open the download page" path instead. Always false off Linux.
#[tauri::command]
fn running_as_appimage() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_some()
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

    // Linux session/GPU environment steering — Wayland-only gate,
    // GDK_BACKEND, WebKit DMABUF (AppImage), NVIDIA explicit-sync, and
    // EGL vendor selection. Must run before the tauri builder initializes
    // GTK (webkit2gtk reads these variables at GTK init).
    #[cfg(target_os = "linux")]
    configure_linux_session_env();

    // "New launch wins" solo-instance handoff. Reads the previous
    // instance's PID file, SIGKILLs it if it's still alive and is
    // really an `ambient` process, waits up to ~0.8s for it to vanish,
    // then writes our own PID. Runs BEFORE the tauri::Builder so we
    // never have two webviews / two trays competing for the shared
    // settings/library/license files. Desktop-only — Android's activity
    // model already guarantees a single instance.
    #[cfg(desktop)]
    solo_instance::ensure_solo();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    // Updater is desktop-only: mobile updates ship through the store /
    // APK installs, and tauri-plugin-updater has no mobile support (the
    // crate is a desktop-gated target dep in Cargo.toml).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        .invoke_handler(tauri::generate_handler![
            commands::set_wallpaper,
            commands::list_wallpapers,
            commands::delete_wallpaper,
            commands::get_or_create_thumbnail,
            commands::clear_thumbnail_cache,
            commands::delete_local_wallpapers,
            commands::get_library,
            commands::patch_library,
            commands::get_startup_license,
            commands::request_login_code,
            commands::login_with_code,
            commands::clear_license,
            commands::get_primary_monitor_pixels,
            commands::get_system_accent,
            commands::get_secret,
            commands::set_secret,
            commands::clear_secret,
            commands::get_settings,
            commands::patch_settings,
            commands::fetch_source_wallpaper,
            commands::generate_wallpaper,
            commands::pollinations_models,
            commands::apply_pattern,
            commands::render_preview,
            commands::export_emoji_pngs,
            commands::apply_live_pattern,
            commands::clear_live_wallpaper,
            commands::get_live_wallpaper,
            commands::import_live_video,
            rotation::rotate_now,
            tray_icon::update_tray_theme,
            uninstall_self,
            get_autostart,
            set_autostart,
            running_as_appimage,
        ])
        .setup(|app| {
            // Self-integrate when launched from an AppImage on Linux —
            // copies the running .AppImage into ~/.local/bin and writes
            // a .desktop entry so the launcher picks it up. No-op on
            // macOS / Windows / mobile.
            integrate::integrate_if_needed();

            // Android: hand the JVM + app Context to reqwest's TLS
            // certificate verifier (rustls-platform-verifier) before any
            // HTTPS request fires — Polar validation, source fetches and
            // AI downloads all panic without it. The VM comes from our
            // JNI_OnLoad capture (see ANDROID_JVM above); the Context via
            // ActivityThread.currentApplication(), the long-standing NDK
            // convention.
            #[cfg(target_os = "android")]
            {
                let vm_ptr = *ANDROID_JVM
                    .get()
                    .expect("JNI_OnLoad ran before setup")
                    as *mut jni::sys::JavaVM;
                // SAFETY: pointer was handed to JNI_OnLoad by the runtime
                // and the VM lives as long as the process.
                let vm = unsafe { jni::JavaVM::from_raw(vm_ptr) }
                    .expect("JavaVM::from_raw");
                let mut env = vm
                    .attach_current_thread()
                    .expect("attach JNI env for TLS verifier init");
                let app_context = env
                    .call_static_method(
                        "android/app/ActivityThread",
                        "currentApplication",
                        "()Landroid/app/Application;",
                        &[],
                    )
                    .and_then(|v| v.l())
                    .expect("ActivityThread.currentApplication");
                rustls_platform_verifier::android::init_with_env(&mut env, app_context)
                    .expect("initialize rustls-platform-verifier");
            }

            // Mobile: wallpaper-setting goes through the Kotlin plugin
            // (WallpaperManager) — register it and route ambient-core's
            // apply pipeline through it. Desktop keeps core's own
            // wallpaper paths and never touches this plugin.
            #[cfg(mobile)]
            {
                use tauri_plugin_wallpaper::{WallpaperExt, WallpaperTarget};
                app.handle().plugin(tauri_plugin_wallpaper::init())?;
                let wallpaper_handle = app.handle().clone();
                ambient_core::desktop::set_os_setter(move |path| {
                    wallpaper_handle
                        .wallpaper()
                        .set_wallpaper(path.to_string(), WallpaperTarget::Both)
                        .map_err(|e| e.to_string())
                });
            }

            // Windows: live wallpapers render in a background webview window
            // parented behind the desktop icons (WorkerW). Register the
            // delivery hook ambient-core's apply_live_pattern routes through.
            #[cfg(target_os = "windows")]
            live_win::register(app.handle());

            // macOS: same idea, but the background window sits at the desktop
            // window level (behind the icons) instead of under WorkerW.
            #[cfg(target_os = "macos")]
            live_mac::register(app.handle());

            // Linux: same window, placed by the compositor as a Wayland
            // layer-shell surface on the background layer (COSMIC, Sway,
            // Hyprland, …). Only consulted when the session isn't KDE Plasma
            // — core routes Plasma to its wallpaper plugin first.
            #[cfg(target_os = "linux")]
            live_linux::register(app.handle());

            // Monitor lookup for the renderer / AI-resolution pickers. On
            // Windows/macOS this is the only route (the randr fallbacks in
            // core are Linux tools — without this, Windows rendered every
            // pattern at the 1920×1080 fallback regardless of the actual
            // screen). Monitor::size() is physical pixels.
            let monitor_handle = app.handle().clone();
            ambient_core::monitor::set_provider(move || {
                let m = monitor_handle.primary_monitor().ok().flatten()?;
                let size = m.size();
                Some(ambient_core::monitor::MonitorInfo {
                    width: size.width,
                    height: size.height,
                    scale: m.scale_factor() as f32,
                    source: "tauri".to_string(),
                })
            });

            // Bridge ambient-core's app events onto the Tauri event bus.
            // Registered BEFORE core init so nothing fires into the void.
            // The tray-mode system notification derives from the same
            // `wallpaper-applied` event the frontend listens for, so the
            // notification keeps firing even when rotation runs with the
            // webview destroyed.
            let sink = app.handle().clone();
            ambient_core::events::set_sink(move |name, payload| {
                if name == "wallpaper-applied" {
                    if let Some(path) = payload.as_str() {
                        notify_if_hidden(path, &sink);
                    }
                }
                let _ = sink.emit(name, payload);
            });

            // One-time core bootstrap: secrets backend + key migration,
            // emoji cache, then the settings / library / license
            // singletons (same ordering the pre-extraction setup used).
            // The shell injects the data dir so Tauri's app.path()
            // remains the single source of truth for where user data
            // lives.
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir for state load");
            let needs_reval = ambient_core::state::init(app_data_dir);

            // License gate runs before the webview's first paint. Disk
            // load is synchronous (~ms); Polar revalidation runs in a
            // background task so cold launches don't pay the network
            // round-trip — the frontend mounts on cached state and
            // listens for `license-revoked` (via the sink) if Polar
            // rejects later.
            if needs_reval {
                tauri::async_runtime::spawn(async {
                    ambient_core::license::revalidate_background().await;
                });
            }

            // Startup cache-limit pass: catches a limit lowered while the
            // app wasn't running and pre-limit libraries that already
            // exceed the cap.
            tauri::async_runtime::spawn(ambient_core::library::enforce_cache_limit());

            // Trial keys expire mid-session (the app lives in the tray for
            // days); this watcher revalidates at the key's expiry instant
            // so a lapsed trial gates immediately, not at the next launch.
            tauri::async_runtime::spawn(async {
                ambient_core::license::watch_expiry().await;
            });

            // Background rotation + theme-follow tasks. Both survive
            // webview destroy/rebuild (the whole reason these moved
            // out of JS in Phase 4 — pre-Phase-4 the rotation timer
            // silently died the moment the user closed to tray).
            rotation::spawn(app.handle().clone());

            // Bring an active live wallpaper back after a restart: the
            // background-window deliveries (Windows / macOS / Linux
            // layer-shell) die with the process; KDE's plugin doesn't and is
            // skipped inside. Deferred a little so the main window paints
            // first and the event loop is running for the main-thread hop.
            tauri::async_runtime::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                ambient_core::live::restore_if_active().await;
            });

            #[cfg(desktop)]
            {
                // "Next wallpaper" only makes sense while rotation is on;
                // with rotation off the slot becomes "Random wallpaper",
                // which re-rolls the current pattern's arrangement. The
                // watcher below swaps the menu live when the setting flips.
                let rotation_on = !matches!(
                    ambient_core::state::settings().subscribe().borrow().rotation_source,
                    ambient_core::types::RotationSource::Off
                );
                let menu = tray_menu(app.handle(), rotation_on)?;

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
                        "random" => {
                            // Full re-roll of the current pattern (live or
                            // static): seed + knobs + palette. When the
                            // desktop isn't showing a pattern, fall back to
                            // the library-shuffle path "next" uses with
                            // rotation off.
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let cfg = ambient_core::state::settings().get().await;
                                let dark = rotation::effective_dark(&cfg);
                                if ambient_core::renderer::randomize_current(dark)
                                    .await
                                    .is_err()
                                {
                                    let _ = rotation::trigger_once(&app).await;
                                }
                            });
                        }
                        "show" => show_main_window(app),
                        "quit" => {
                            QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
                            // Windows: the live-wallpaper webview is parented
                            // into explorer's WorkerW tree. Un-parent + destroy
                            // it BEFORE exit — tao's shutdown destroying a
                            // still-parented HWND can deadlock the message
                            // pump, leaving a headless process that never
                            // dies ("Quit didn't quit").
                            #[cfg(target_os = "windows")]
                            live_win::teardown(app);
                            app.exit(0);
                        }
                        _ => {}
                    });

                // Symbolic monochrome glyph. macOS gets the white glyph
                // + template flag and the system handles inversion
                // against the menubar's effective theme. Windows/Linux
                // tray hosts don't invert, so we detect the TASKBAR /
                // PANEL darkness at launch (not the app theme — the two
                // are separate toggles on both platforms) and ship the
                // matching variant: dark glyph on light bars, white on
                // dark. The frontend's useTrayThemeSync() hook re-runs
                // the same detection on theme flips while the window is
                // open via the `update_tray_theme` command.
                #[cfg(target_os = "macos")]
                let glyph_light = true;
                #[cfg(target_os = "linux")]
                let glyph_light = tray_icon::linux_panel_wants_light_glyph();
                #[cfg(target_os = "windows")]
                let glyph_light = tray_icon::windows_taskbar_dark();
                tray = tray
                    .icon(tray_icon::symbolic_icon(!glyph_light))
                    .icon_as_template(true);

                let _ = tray.build(app)?;

                // Keep the action item in step with the rotation setting:
                // rotation toggled on → "Next wallpaper", off → "Random
                // wallpaper". Rebuild only on an actual flip. The baseline
                // is the same value the initial menu was built from — the
                // task must not re-read it, or a flip landing between menu
                // build and subscribe would be folded into the baseline
                // and never reflected.
                let menu_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut rx = ambient_core::state::settings().subscribe();
                    let mut rotation_on = rotation_on;
                    loop {
                        // First iteration catches a flip that landed between
                        // the initial menu build and this subscribe (a new
                        // watch receiver treats the current value as seen,
                        // so changed() alone would miss it).
                        let on = !matches!(
                            rx.borrow().rotation_source,
                            ambient_core::types::RotationSource::Off
                        );
                        if on != rotation_on {
                            rotation_on = on;
                            if let Some(tray) = menu_handle.tray_by_id("main") {
                                if let Ok(menu) = tray_menu(&menu_handle, on) {
                                    let _ = tray.set_menu(Some(menu));
                                }
                            }
                        }
                        if rx.changed().await.is_err() {
                            break;
                        }
                    }
                });
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
            // Main window only: the desktop-layer "wallpaper[-N]" windows
            // (Windows / macOS / Linux layer-shell live mode) must never be
            // destroyed by a stray close request — they're owned by the
            // live-wallpaper lifecycle.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let _ = window.destroy();
                }
            }
            // Linux: the compositor can close the layer surface itself (the
            // output went away); bring it back when it's not our own clear.
            #[cfg(target_os = "linux")]
            if window.label().starts_with("wallpaper-") {
                if let tauri::WindowEvent::Destroyed = event {
                    live_linux::on_wallpaper_window_destroyed(window.label());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| match event {
            // Last-window-close would normally exit the process. Keep it
            // alive so the tray icon survives; the user explicitly quits
            // via the tray menu (which calls app.exit(0), bypassing this
            // because ExitRequested.code is Some in that path). QUITTING
            // additionally disarms the veto once an explicit quit has
            // started, so no code-less request racing shutdown can pin
            // the process alive.
            RunEvent::ExitRequested { code, api, .. } => {
                if code.is_none() && !QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
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

// Wayland-only: force the native Wayland backend, never X11/XWayland.
//
// linuxdeploy-plugin-gtk's AppRun hook unconditionally exports
// GDK_BACKEND=x11 (a blanket guard against old WebKitGTK crashing on
// Wayland, tauri-apps/tauri#8541), which otherwise pins the AppImage to
// XWayland and clobbers anything the user set. We build against modern
// webkit2gtk (26.04), where Wayland is healthy, so override that hook and
// set the Wayland backend outright. Must run before the tauri builder
// initializes GTK (webkit2gtk reads GDK_BACKEND at GTK init).
#[cfg(target_os = "linux")]
fn configure_linux_session_env() {
    // Wayland-only on Linux: no X11/XWayland support. A Wayland
    // compositor is required — bail out with a clear message instead of
    // letting GTK limp along on X11 where the wallpaper plugin, blur and
    // GPU paths are untested.
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if !session.eq_ignore_ascii_case("wayland")
        && std::env::var_os("WAYLAND_DISPLAY").is_none()
    {
        eprintln!(
            "Ambient requires a Wayland session (X11 is not supported). \
             Detected session type: {}.",
            if session.is_empty() { "unknown" } else { &session }
        );
        std::process::exit(1);
    }
    // SAFETY: Rust 2024 made set_var unsafe because env mutation can
    // race with concurrent readers in other threads. This runs in
    // `run()` before any tauri/tokio thread is spawned and before the
    // GTK backend reads the variable, so there is no concurrent reader.
    unsafe {
        std::env::set_var("GDK_BACKEND", "wayland");
    }

    // The proprietary NVIDIA driver is detected once here and reused for
    // the EGL-vendor steering further down. `/sys/module/nvidia` exists
    // iff the kernel module is loaded — i.e. NVIDIA's EGL/GBM stack is the
    // one actually in play.
    let nvidia_loaded = std::path::Path::new("/sys/module/nvidia").exists();

    // Disable WebKitGTK's DMABUF renderer where it is known to break —
    // inside the bundled AppImage: the bundled WebKit + the host Mesa
    // disagree on EGL ("Could not create surfaceless EGL display:
    // EGL_BAD_ALLOC. Aborting...") and WebKit's GPU process abort()s,
    // SIGABRTing the whole app on launch.
    let in_appimage = std::env::var_os("APPIMAGE").is_some();
    if in_appimage && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: same as above — set before any GTK/WebKit thread spawns.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // NVIDIA + Wayland: don't kill the DMABUF renderer, kill explicit
    // sync. The old crash — "Error 71 (Protocol error) dispatching to
    // Wayland display" ~1s after the webview loads — is NVIDIA's EGL
    // registering wp_linux_drm_syncobj on the surface while GTK3 then
    // commits buffers without an acquire point, so the compositor
    // terminates the connection ("explicit sync is used, but no acquire
    // point is set"). We previously set WEBKIT_DISABLE_DMABUF_RENDERER=1
    // here, which avoided the crash but also disabled GPU compositing —
    // and with it every backdrop-filter blur in the UI (the glass look).
    // Opting the NVIDIA driver out of explicit sync instead keeps the
    // full DMABUF/GPU path AND the blur, at worst costing NVIDIA's
    // explicit-sync frame pacing (pre-555 implicit-sync behaviour).
    // Verified on the box that reproduces the crash (aarch64, RTX 5060
    // Ti, driver 595.80, Plasma 6 Wayland, webkit2gtk 2.52): with
    // explicit sync disabled the app is stable and the glass renders;
    // with DMABUF disabled the panels lose all blur. An explicit user
    // override of either variable always wins.
    if nvidia_loaded
        && !in_appimage
        && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        // SAFETY: same as above — set before any GTK/WebKit thread spawns.
        unsafe {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
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

/// The tray menu. The first slot depends on the rotation setting: rotation
/// on → "Next wallpaper" (advance the rotation out of band); rotation off →
/// "Random wallpaper" (re-roll the current pattern's seed). A settings
/// watcher in setup() rebuilds the menu when the setting flips.
#[cfg(desktop)]
fn tray_menu(app: &AppHandle, rotation_on: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let action = if rotation_on {
        MenuItem::with_id(app, "next", "Next wallpaper", true, None::<&str>)?
    } else {
        MenuItem::with_id(app, "random", "Random wallpaper", true, None::<&str>)?
    };
    let sep = PredefinedMenuItem::separator(app)?;
    let show_i = MenuItem::with_id(app, "show", "Open Ambient", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&action, &sep, &show_i, &quit_i])
}

/// Show the main window, creating it on demand if a prior close destroyed it.
/// Called from the tray "Open Ambient" menu item — desktop-only, like the
/// tray itself (and `unminimize` doesn't exist on mobile).
#[cfg(desktop)]
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

/// System notification for wallpaper changes that happen while the
/// window is hidden/destroyed (tray-only state) — when the window IS
/// visible the in-tab status pill is enough feedback. Driven by the
/// `wallpaper-applied` events core fires through the sink, which covers
/// every apply path (frontend command, rotation tick, tray "Next").
fn notify_if_hidden(abs_path: &str, app: &AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        return;
    }
    let filename = std::path::Path::new(abs_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("wallpaper");
    let _ = app
        .notification()
        .builder()
        .title("Ambient")
        .body(format!("Wallpaper changed — {}", filename))
        .show();
}
