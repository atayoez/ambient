//! macOS live-wallpaper delivery: borderless webview windows placed at the
//! desktop window level, behind the icons, on every Space — one per attached
//! screen. They render the same WebGL shaders as the in-app LivePreview (the
//! frontend's `#wallpaper` mode), so macOS reuses the exact algorithm the KDE
//! plugin runs in Qt and the Windows path runs behind WorkerW.
//!
//! macOS is cleaner than Windows here: there is a real window level for
//! desktop content, between the system wallpaper and the icons, so there is
//! no WorkerW-style reparenting. We just set each NSWindow's level, make it
//! join all Spaces, ignore mouse events, drop its chrome, and size it to its
//! screen's frame. Screens are enumerated at apply time; a display plugged in
//! later gets covered on the next apply / restart (no hotplug listener yet).
//!
//! ambient-core can't reach AppKit, so `register()` wires its delivery hook
//! (live::set_live_setter) to this shell module at startup, the same pattern
//! the Windows/Linux paths and the mobile wallpaper setter use.

#![cfg(target_os = "macos")]

use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use objc2_foundation::NSRect;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Window labels are `wallpaper-<screen index>`; capabilities/wallpaper.json
/// grants `wallpaper-*`.
const LABEL_PREFIX: &str = "wallpaper-";

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

/// Every live wallpaper window currently alive.
fn wallpaper_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, win)| win)
        .collect()
}

/// Setter: ensure the background windows exist, then hand them the spec. The
/// first call creates one per screen (spec baked into an init script so it's
/// present before the app mounts); later calls push the new spec over an
/// event to each.
fn set_live(app: &AppHandle, spec: &str) -> Result<(), String> {
    let existing = wallpaper_windows(app);
    if !existing.is_empty() {
        for win in existing {
            win.emit("live-spec", spec).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    // WebviewWindowBuilder::build() and the AppKit calls must run on the main
    // thread; apply_live_pattern is an async Tauri command, so we're on a
    // worker thread. Marshal it over and block briefly for the real result.
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_create = app.clone();
    let spec = spec.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(create_wallpaper_windows(&app_for_create, &spec));
    })
    .map_err(|e| e.to_string())?;
    // Bounded wait: if the main thread is winding down (quit racing an
    // apply), an unbounded recv() would park this worker thread forever.
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "wallpaper window creation did not complete".to_string())?
}

/// Clearer: destroy every background window on the main thread.
fn clear_live(app: &AppHandle) {
    let app_for_destroy = app.clone();
    let _ = app.run_on_main_thread(move || {
        for win in wallpaper_windows(&app_for_destroy) {
            let _ = win.destroy();
        }
    });
}

/// Main thread. One window per attached screen, each sized to that screen's
/// frame (index 0 is the screen with the menu bar).
fn create_wallpaper_windows(app: &AppHandle, spec: &str) -> Result<(), String> {
    let mtm = MainThreadMarker::new()
        .ok_or_else(|| "wallpaper windows must be created on the main thread".to_string())?;
    let frames: Vec<NSRect> = NSScreen::screens(mtm).iter().map(|s| s.frame()).collect();
    if frames.is_empty() {
        return Err("no screens attached".to_string());
    }
    for (i, frame) in frames.into_iter().enumerate() {
        create_wallpaper_window(app, &format!("{LABEL_PREFIX}{i}"), spec, frame)?;
    }
    Ok(())
}

fn create_wallpaper_window(
    app: &AppHandle,
    label: &str,
    spec: &str,
    frame: NSRect,
) -> Result<(), String> {
    // Bake the spec in as a global so the fullscreen `#wallpaper` frontend can
    // read it synchronously on first mount (no IPC race). `spec` is JSON,
    // which is a valid JS literal; our config never contains `</script>`.
    let init = format!("window.__AMBIENT_SPEC__ = {spec};");

    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html#wallpaper".into()))
        .title("Ambient Wallpaper")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .resizable(false)
        // Created hidden: it'd otherwise flash as a normal floating window for
        // a frame before place_behind_icons drops it to the desktop level —
        // same ordering the Windows path uses.
        .visible(false)
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
    place_behind_icons(window, frame);
    // Reveal only after the level/collection flags are set — showing a
    // desktop-level window keeps it behind the icons.
    let _ = win.show();
    Ok(())
}

/// Put `window` at the desktop window level (behind the icons), on every
/// Space, click-through, chromeless, and sized to `frame` (its screen).
fn place_behind_icons(window: &NSWindow, frame: NSRect) {
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
        window.setFrame_display(frame, true);
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
