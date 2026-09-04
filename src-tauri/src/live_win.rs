//! Windows live-wallpaper delivery: background webview windows parented
//! behind the desktop icons (the classic `WorkerW` technique used by
//! Wallpaper Engine / Lively) — ONE PER MONITOR, so each screen renders the
//! pattern at its own size and aspect instead of one canvas stretched across
//! the whole virtual desktop. They render the same WebGL shaders as the
//! in-app `LivePreview` — the frontend serves a stripped fullscreen
//! `#wallpaper` mode — so Windows reuses the exact algorithm the KDE plugin
//! runs in Qt.
//!
//! How the parenting works (well-trodden Win32 dance):
//!   1. `Progman` (the desktop's Program Manager) owns the wallpaper. Send
//!      it the undocumented `0x052C` message, which makes it spawn a
//!      `WorkerW` window *behind* the `SHELLDLL_DefView` that hosts the
//!      icons.
//!   2. EnumWindows to find that `WorkerW` (the top-level whose next sibling
//!      after a `SHELLDLL_DefView` child is a `WorkerW`).
//!   3. `SetParent(our_window, WorkerW)` → our window now draws between the
//!      desktop background and the icons.
//!   4. Place each child over its monitor. Monitor rects come from
//!      EnumDisplayMonitors in SCREEN coordinates; MapWindowPoints converts
//!      them into WorkerW's client space. (WorkerW spans the virtual screen,
//!      whose origin is not (0,0) when a monitor sits left of / above the
//!      primary — the earlier single window positioned itself with raw
//!      virtual-screen coordinates and was off by exactly that origin.)
//!
//! Monitors are enumerated at apply time; a display plugged in later is
//! covered on the next apply / restart (no WM_DISPLAYCHANGE listener yet).
//!
//! ambient-core can't reach the windowing layer, so it exposes a setter hook
//! (`live::set_live_setter`) that `register()` wires up at startup — mirrors
//! the mobile `desktop::set_os_setter` pattern.

#![cfg(target_os = "windows")]

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR, MapWindowPoints};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetSystemMetrics, HWND_BOTTOM, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SMTO_NORMAL, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, SendMessageTimeoutW, SetParent, SetWindowPos,
};
use windows::core::{BOOL, w};

/// Window labels are `wallpaper-<monitor index>`; capabilities/wallpaper.json
/// grants `wallpaper-*`.
const LABEL_PREFIX: &str = "wallpaper-";

/// Wire ambient-core's Windows live-wallpaper hooks to this shell. Call once
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

/// Setter: ensure the background windows exist + are parented behind the
/// icons, then hand them the spec. The first call creates one per monitor
/// (spec baked into an init script so it's present before the app mounts);
/// subsequent calls just push the new spec over an event to each.
fn set_live(app: &AppHandle, spec: &str) -> Result<(), String> {
    // Re-apply: push the new spec. emit() is thread-safe, so this is fine on
    // the async-command worker thread.
    let existing = wallpaper_windows(app);
    if !existing.is_empty() {
        for win in existing {
            win.emit("live-spec", spec).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    // First apply: create the windows. WebviewWindowBuilder::build() (and
    // the WorkerW parenting) must run on the main / event-loop thread, but
    // apply_live_pattern is an async Tauri command so we're on a worker
    // thread. Marshal it over and block briefly for the real result.
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

/// Clearer: un-parent + destroy the background windows. Plasma's equivalent
/// is reverting the plugin.
fn clear_live(app: &AppHandle) {
    // Window teardown on the main thread, same reasoning as creation.
    let app_for_destroy = app.clone();
    let _ = app.run_on_main_thread(move || teardown(&app_for_destroy));
}

/// Un-parent every wallpaper window from explorer's WorkerW tree, then
/// destroy it. Must run on the main thread, and MUST run before process exit:
/// `SetParent` across processes ties our thread's input queue to explorer's,
/// and letting tao's shutdown call DestroyWindow on a still-parented HWND
/// while the message pump is winding down can deadlock — the process then
/// lingers headless after "Quit" (the well-known WorkerW hang that
/// Lively / Wallpaper Engine also re-parent to avoid).
pub fn teardown(app: &AppHandle) {
    for win in wallpaper_windows(app) {
        if let Ok(raw) = win.hwnd() {
            let hwnd = HWND(raw.0 as _);
            // SAFETY: hwnd is our own live window; re-parenting to the
            // desktop (None) is standard Win32 and detaches us from
            // explorer's tree.
            unsafe {
                let _ = SetParent(hwnd, None);
            }
        }
        let _ = win.destroy();
    }
}

/// Main thread. Find the WorkerW once, then one child window per monitor.
/// Falls back to a single virtual-screen window if monitor enumeration
/// comes back empty (it shouldn't, but a blank desktop is worse than a
/// stretched one).
fn create_wallpaper_windows(app: &AppHandle, spec: &str) -> Result<(), String> {
    let worker = find_desktop_worker()?;
    let mut rects = monitor_rects();
    if rects.is_empty() {
        rects.push(virtual_screen_rect());
    }
    for (i, rect) in rects.into_iter().enumerate() {
        create_wallpaper_window(app, &format!("{LABEL_PREFIX}{i}"), spec, worker, rect)?;
    }
    Ok(())
}

fn create_wallpaper_window(
    app: &AppHandle,
    label: &str,
    spec: &str,
    worker: HWND,
    rect: RECT,
) -> Result<(), String> {
    // Bake the spec in as a global so the fullscreen `#wallpaper` frontend
    // can read it synchronously on first mount (no IPC round-trip / no race
    // with event-listener setup). `spec` is JSON, which is a valid JS
    // literal; our config never contains `</script>` so this is injection-safe.
    let init = format!("window.__AMBIENT_SPEC__ = {spec};");

    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html#wallpaper".into()))
        .title("Ambient Wallpaper")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .focused(false)
        .resizable(false)
        // Created hidden: it'd otherwise flash as a normal floating window
        // for a frame before we re-parent it. parent_behind_icons reveals it
        // via SetWindowPos(SWP_SHOWWINDOW) once it's behind the icons.
        .visible(false)
        .initialization_script(&init)
        .build()
        .map_err(|e| format!("create wallpaper window: {e}"))?;

    let raw = win.hwnd().map_err(|e| format!("wallpaper hwnd: {e}"))?;
    // Bridge Tauri's HWND to our `windows` crate version via the raw handle
    // pointer (handle value is version-independent).
    let hwnd = HWND(raw.0 as _);
    parent_behind_icons(hwnd, worker, rect)
}

/// Locate (spawning if needed) the WorkerW that sits behind the desktop
/// icons. See the module doc.
fn find_desktop_worker() -> Result<HWND, String> {
    // SAFETY: standard Win32 window lookups; every result is checked.
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).map_err(|e| format!("find Progman: {e}"))?;

        // Ask Progman to spawn the WorkerW behind the icons. Best-effort: on
        // some builds the WorkerW already exists. Result ignored (the send
        // reports whether the window processed it, not our intent's success).
        let mut res: usize = 0;
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            1000,
            Some(&mut res as *mut usize),
        );

        // Find the WorkerW to draw into. The desktop's structure differs by
        // Windows version, so try in order:
        //   1. Win11 (22H2+): WorkerW is a *child* of Progman, alongside
        //      SHELLDLL_DefView — FindWindowExW under Progman finds it.
        //   2. Win10: the 0x052C message spawns a separate top-level WorkerW
        //      that is the sibling after the SHELLDLL_DefView host — found by
        //      the EnumWindows scan.
        //   3. Last resort: Progman itself (renders, but may sit above icons
        //      or behind the wallpaper bitmap depending on the build).
        Ok(FindWindowExW(Some(progman), None, w!("WorkerW"), None)
            .ok()
            .filter(|w| !w.0.is_null())
            .or_else(find_worker_w)
            .unwrap_or(progman))
    }
}

/// Parent `hwnd` under `worker` (behind the desktop icons) and place it over
/// `rect`, a monitor rectangle in screen coordinates.
fn parent_behind_icons(hwnd: HWND, worker: HWND, rect: RECT) -> Result<(), String> {
    // SAFETY: hwnd is a live top-level window we just created; every call is
    // standard Win32 window management with its result checked.
    unsafe {
        SetParent(hwnd, Some(worker)).map_err(|e| format!("SetParent to WorkerW: {e}"))?;

        // Screen → WorkerW client coordinates (hwndFrom = NULL means screen).
        let mut pts = [
            POINT {
                x: rect.left,
                y: rect.top,
            },
            POINT {
                x: rect.right,
                y: rect.bottom,
            },
        ];
        let _ = MapWindowPoints(None, Some(worker), &mut pts);

        SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            pts[0].x,
            pts[0].y,
            pts[1].x - pts[0].x,
            pts[1].y - pts[0].y,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .map_err(|e| format!("size wallpaper window: {e}"))?;
    }
    Ok(())
}

/// Every attached monitor's rectangle, in screen coordinates.
fn monitor_rects() -> Vec<RECT> {
    let mut rects: Vec<RECT> = Vec::new();
    unsafe extern "system" fn enum_monitor(
        _monitor: HMONITOR,
        _dc: HDC,
        rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        // SAFETY: MONITORENUMPROC contract — `rect` points at the monitor's
        // RECT and `lparam` is the &mut Vec we handed EnumDisplayMonitors.
        unsafe {
            let out = lparam.0 as *mut Vec<RECT>;
            (*out).push(*rect);
        }
        BOOL(1) // continue enumeration
    }
    // SAFETY: enum_monitor only appends to the Vec we pass through lparam.
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(enum_monitor),
            LPARAM(&mut rects as *mut Vec<RECT> as isize),
        );
    }
    rects
}

/// The whole virtual screen, in screen coordinates (fallback when monitor
/// enumeration yields nothing).
fn virtual_screen_rect() -> RECT {
    // SAFETY: GetSystemMetrics is a pure query.
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        RECT {
            left: x,
            top: y,
            right: x + GetSystemMetrics(SM_CXVIRTUALSCREEN),
            bottom: y + GetSystemMetrics(SM_CYVIRTUALSCREEN),
        }
    }
}

/// EnumWindows scan for the WorkerW that sits behind the desktop icons: the
/// top-level window that has a `SHELLDLL_DefView` child also has, as its next
/// sibling, the `WorkerW` we want to draw into.
fn find_worker_w() -> Option<HWND> {
    let mut found = HWND::default();
    // SAFETY: enum_proc only writes the found HWND through the &mut we pass.
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut found as *mut HWND as isize));
    }
    if found.0.is_null() { None } else { Some(found) }
}

unsafe extern "system" fn enum_proc(top: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: WNDENUMPROC contract — `top` is a valid HWND, `lparam` is the
    // &mut HWND we handed EnumWindows.
    unsafe {
        // Does this top-level host the desktop icon view?
        if FindWindowExW(Some(top), None, w!("SHELLDLL_DefView"), None).is_ok() {
            // The wallpaper WorkerW is the sibling immediately after `top`.
            if let Ok(worker) = FindWindowExW(None, Some(top), w!("WorkerW"), None) {
                let out = lparam.0 as *mut HWND;
                *out = worker;
                return BOOL(0); // stop — found it
            }
        }
        BOOL(1) // continue enumeration
    }
}
