//! macOS live-wallpaper delivery: a borderless webview window placed at the
//! desktop window level, behind the icons, on every Space. It renders the
//! same WebGL shaders as the in-app LivePreview (the frontend's `#wallpaper`
//! mode), so macOS reuses the exact algorithm the KDE plugin runs in Qt and
//! the Windows path runs behind WorkerW.
//!
//! macOS is cleaner than Windows here: there is a real window level for
//! desktop content, between the system wallpaper and the icons, so there is
//! no WorkerW-style reparenting. We just set the NSWindow level, make it join
//! all Spaces, ignore mouse events, drop its chrome, and size it to the
//! screen.
//!
//! ambient-core can't reach AppKit, so `register()` wires its delivery hook
//! (live::set_live_setter) to this shell module at startup, the same pattern
//! the Windows path and the mobile wallpaper setter use.

#![cfg(target_os = "macos")]

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const WALLPAPER_LABEL: &str = "wallpaper";

/// Wire ambient-core's desktop live-wallpaper hooks to this shell. Call once
/// in setup().
pub fn register(app: &AppHandle) {
    let set_app = app.clone();
    let clear_app = app.clone();
    ambient_core::live::set_live_setter(
        move |spec| set_live(&set_app, spec),
        move || clear_live(&clear_app),
    );
}

/// Setter: ensure the background window exists, then hand it the spec. The
/// first call creates it (spec baked into an init script so it's present
/// before the app mounts); later calls push the new spec over an event.
fn set_live(app: &AppHandle, spec: &str) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(WALLPAPER_LABEL) {
        return win.emit("live-spec", spec).map_err(|e| e.to_string());
    }
    // WebviewWindowBuilder::build() and the AppKit calls must run on the main
    // thread; apply_live_pattern is an async Tauri command, so we're on a
    // worker thread. Marshal it over and block briefly for the real result.
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_create = app.clone();
    let spec = spec.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(create_wallpaper_window(&app_for_create, &spec));
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|_| "wallpaper window creation did not complete".to_string())?
}

/// Clearer: destroy the background window on the main thread.
fn clear_live(app: &AppHandle) {
    let app_for_destroy = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_for_destroy.get_webview_window(WALLPAPER_LABEL) {
            let _ = win.destroy();
        }
    });
}

fn create_wallpaper_window(app: &AppHandle, spec: &str) -> Result<(), String> {
    // Bake the spec in as a global so the fullscreen `#wallpaper` frontend can
    // read it synchronously on first mount (no IPC race). `spec` is JSON,
    // which is a valid JS literal; our config never contains `</script>`.
    let init = format!("window.__AMBIENT_SPEC__ = {spec};");

    let win = WebviewWindowBuilder::new(
        app,
        WALLPAPER_LABEL,
        WebviewUrl::App("index.html#wallpaper".into()),
    )
    .title("Ambient Wallpaper")
    .decorations(false)
    .shadow(false)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(true)
    .initialization_script(&init)
    .build()
    .map_err(|e| format!("create wallpaper window: {e}"))?;

    let ptr = win.ns_window().map_err(|e| format!("ns_window: {e}"))? as *mut NSWindow;
    if ptr.is_null() {
        return Err("ns_window returned null".to_string());
    }
    // SAFETY: ptr is the live NSWindow Tauri just created; we hold it only for
    // the duration of these synchronous AppKit setters, on the main thread.
    let window: &NSWindow = unsafe { &*ptr };
    place_behind_icons(window);
    Ok(())
}

/// Put `window` at the desktop window level (behind the icons), on every
/// Space, click-through, chromeless, and sized to its screen.
fn place_behind_icons(window: &NSWindow) {
    let level = desktop_window_level();
    // SAFETY: standard AppKit setters on a valid window, on the main thread.
    unsafe {
        window.setLevel(level);
        window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        window.setIgnoresMouseEvents(true);
        window.setStyleMask(NSWindowStyleMask::Borderless);
        if let Some(screen) = window.screen() {
            window.setFrame_display(screen.frame(), true);
        }
    }
}

/// kCGDesktopWindowLevel: just below the desktop icons, above the system
/// wallpaper. NSWindow.level is a plain isize; CGWindowLevelForKey returns the
/// matching i32. We declare it directly rather than pull objc2-core-graphics
/// for one constant. kCGDesktopWindowLevelKey == 2.
fn desktop_window_level() -> isize {
    const K_CG_DESKTOP_WINDOW_LEVEL_KEY: i32 = 2;
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    // SAFETY: a pure CoreGraphics lookup with a constant key.
    (unsafe { CGWindowLevelForKey(K_CG_DESKTOP_WINDOW_LEVEL_KEY) }) as isize
}
