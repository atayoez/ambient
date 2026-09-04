//! Linux (non-KDE) live-wallpaper delivery: a background webview window
//! turned into a Wayland **layer-shell** surface on the `background` layer,
//! so the compositor itself keeps it under every window and panel — the same
//! mechanism swaybg / mpvpaper / cosmic-bg use for their wallpapers. It
//! renders the fullscreen `#wallpaper` frontend the Windows (WorkerW) and
//! macOS (desktop-level NSWindow) paths already use, so all three
//! background-window platforms share one renderer.
//!
//! Works on any compositor that implements `zwlr_layer_shell_v1`: COSMIC
//! (the primary target), Sway, Hyprland, Niri, River, labwc, Wayfire, … KDE
//! Plasma keeps its own Plasma wallpaper *plugin* path (core::live routes
//! there first), and GNOME does not expose layer-shell to third parties, so
//! it stays unsupported — `gtk_layer_shell::is_supported()` is the gate.
//!
//! Ordering matters with GTK3 + gtk-layer-shell: the window must be marked
//! as a layer surface BEFORE it is realized (init swaps the xdg_toplevel role
//! for a layer surface at realize time). Tauri leaves a `.visible(false)`
//! window unrealized, so we create it hidden, convert it, then show it.
//!
//! ambient-core can't reach GTK, so `register()` wires its delivery hook
//! (live::set_live_setter) to this module at startup — the same pattern the
//! Windows/macOS paths and the mobile wallpaper setter use.

#![cfg(target_os = "linux")]

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use gtk::prelude::*;
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label for the background wallpaper webview.
const WALLPAPER_LABEL: &str = "wallpaper";

/// Set right before `clear_live` destroys the window, so the Destroyed hook
/// can tell our own teardown from a compositor-initiated close.
static CLEARING: AtomicBool = AtomicBool::new(false);

/// When we last re-created the surface after a compositor close. Guards
/// against a re-create loop while the compositor keeps closing us (no
/// outputs left, e.g. lid closed): one retry, then wait for monitor-added.
static LAST_RECREATE: Mutex<Option<Instant>> = Mutex::new(None);
const RECREATE_COOLDOWN: Duration = Duration::from_secs(30);

/// Layer-shell namespace — what `wayland-info` / compositor debug tools show
/// for the surface.
const LAYER_NAMESPACE: &str = "ambient-wallpaper";

const UNSUPPORTED: &str = "Live wallpaper on this desktop needs KDE Plasma, or a Wayland \
compositor with layer-shell support (COSMIC, Sway, Hyprland, Niri, …). GNOME \
doesn't let apps draw on the desktop layer.";

/// Wire ambient-core's Linux live-wallpaper hooks to this shell. Call once in
/// setup(). Core only consults these when the session isn't KDE Plasma.
pub fn register(app: &AppHandle) {
    let set_app = app.clone();
    let clear_app = app.clone();
    ambient_core::live::set_live_setter(
        move |spec| set_live(&set_app, spec),
        move || clear_live(&clear_app),
    );

    // Output hotplug: a layer surface lives on ONE output, and when that
    // output goes away the compositor closes it (see
    // on_wallpaper_window_destroyed). When an output (re)appears, bring the
    // wallpaper back if settings still say one is active. Runs in setup()
    // on the GTK main thread, where the default display already exists.
    if let Some(display) = gtk::gdk::Display::default() {
        let app = app.clone();
        display.connect_monitor_added(move |_, _| {
            *LAST_RECREATE.lock().unwrap_or_else(|e| e.into_inner()) = None;
            recreate_later(&app, Duration::from_secs(1));
        });
    }
}

/// Tauri `WindowEvent::Destroyed` for the wallpaper window (lib.rs routes it
/// here). If we didn't destroy it ourselves, the compositor closed the layer
/// surface — zwlr_layer_surface_v1.closed on output removal / idle, which
/// gtk-layer-shell turns into a GtkWindow close — so re-create it shortly,
/// once. A second close within the cooldown means the outputs really are
/// gone; then monitor-added is what brings it back.
pub fn on_wallpaper_window_destroyed(app: &AppHandle) {
    if CLEARING.swap(false, Ordering::SeqCst) || crate::QUITTING.load(Ordering::SeqCst) {
        return;
    }
    let now = Instant::now();
    let mut last = LAST_RECREATE.lock().unwrap_or_else(|e| e.into_inner());
    if last.is_some_and(|t| now.duration_since(t) < RECREATE_COOLDOWN) {
        tracing::debug!("wallpaper surface closed again by the compositor; waiting for an output");
        return;
    }
    *last = Some(now);
    drop(last);
    tracing::info!("wallpaper surface closed by the compositor; re-creating");
    recreate_later(app, Duration::from_secs(2));
}

/// Re-apply the active live wallpaper after `delay` unless the window came
/// back on its own in the meantime. `restore_if_active` is a no-op when no
/// live wallpaper is recorded (e.g. a static apply cleared it).
fn recreate_later(app: &AppHandle, delay: Duration) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if crate::QUITTING.load(Ordering::SeqCst)
            || app.get_webview_window(WALLPAPER_LABEL).is_some()
        {
            return;
        }
        ambient_core::live::restore_if_active().await;
    });
}

/// Setter: ensure the layer surface exists, then hand it the spec. The first
/// call creates the window (spec baked into an init script so it's present
/// before the app mounts); later calls push the new spec over an event.
fn set_live(app: &AppHandle, spec: &str) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(WALLPAPER_LABEL) {
        return win.emit("live-spec", spec).map_err(|e| e.to_string());
    }
    // WebviewWindowBuilder::build() and every GTK call must run on the main
    // (GTK) thread; apply_live_pattern is an async Tauri command, so we're on
    // a worker thread. Marshal it over and block briefly for the real result.
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

/// Clearer: destroy the layer surface on the main thread. The compositor
/// drops back to its own wallpaper (cosmic-bg etc.) underneath.
fn clear_live(app: &AppHandle) {
    let app_for_destroy = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_for_destroy.get_webview_window(WALLPAPER_LABEL) {
            // Flag first: the Destroyed hook must not treat this as a
            // compositor close and resurrect the window we're removing.
            CLEARING.store(true, Ordering::SeqCst);
            if win.destroy().is_err() {
                CLEARING.store(false, Ordering::SeqCst);
            }
        }
    });
}

fn create_wallpaper_window(app: &AppHandle, spec: &str) -> Result<(), String> {
    // Needs a Wayland GDK display AND a compositor advertising
    // zwlr_layer_shell_v1. (X11 sessions never get here — lib.rs exits on
    // non-Wayland — but GNOME Wayland does, and it lacks the protocol.)
    if !gtk_layer_shell::is_supported() {
        return Err(UNSUPPORTED.to_string());
    }

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
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    // Hidden on purpose: gtk-layer-shell can only take over an UNREALIZED
    // window, and showing it now would map it as an ordinary toplevel.
    .visible(false)
    .initialization_script(&init)
    .build()
    .map_err(|e| format!("create wallpaper window: {e}"))?;

    let gtk_win = win
        .gtk_window()
        .map_err(|e| format!("wallpaper gtk window: {e}"))?;
    if gtk_win.is_realized() {
        // Guard against a future Tauri/tao change realizing hidden windows —
        // a realized window silently stays a normal toplevel, which would
        // pop a fullscreen webview OVER the desktop instead of under it.
        let _ = win.destroy();
        return Err("wallpaper window was realized before layer-shell init".to_string());
    }

    place_on_background_layer(&gtk_win);

    // Mapping (show → realize) is what creates the layer surface.
    win.show()
        .map_err(|e| format!("show wallpaper window: {e}"))?;
    tracing::info!(
        layer_window = gtk_win.is_layer_window(),
        gtk_layer_shell = %format!(
            "{}.{}.{}",
            gtk_layer_shell::major_version(),
            gtk_layer_shell::minor_version(),
            gtk_layer_shell::micro_version()
        ),
        "live wallpaper layer surface shown"
    );
    Ok(())
}

/// Convert `window` into a background-layer surface: anchored to all four
/// edges (= output-sized), ignoring other surfaces' exclusive zones so it
/// runs under panels too, never taking keyboard focus, and click-through so
/// a stray desktop click reaches whatever the compositor has underneath.
///
/// No explicit monitor: the compositor picks the output. Multi-monitor is one
/// window per `gdk::Monitor` with `set_monitor` — the labels/lifecycle here
/// are the only thing that needs to grow for that.
fn place_on_background_layer(window: &gtk::ApplicationWindow) {
    window.init_layer_shell();
    window.set_namespace(LAYER_NAMESPACE);
    // `background` is the wallpaper layer: same as cosmic-bg / swaybg, and
    // within a layer compositors stack later-mapped surfaces on top, so ours
    // (mapped after the session's wallpaper daemon) wins. Deliberately NOT
    // `bottom`: panels/bars are commonly configured on that layer (waybar
    // "layer": "bottom", cosmic-panel's layer option) and a later-mapped
    // bottom surface would cover them. AMBIENT_LAYER=bottom is a dev knob to
    // compare stacking when a compositor misbehaves.
    let layer = match std::env::var("AMBIENT_LAYER").as_deref() {
        Ok("bottom") => Layer::Bottom,
        _ => Layer::Background,
    };
    window.set_layer(layer);
    for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
        window.set_anchor(edge, true);
    }
    // -1: extend under panels/docks instead of being pushed by their zones.
    window.set_exclusive_zone(-1);
    window.set_keyboard_mode(KeyboardMode::None);
    window.connect_size_allocate(|w, alloc| {
        tracing::debug!(
            width = alloc.width(),
            height = alloc.height(),
            mapped = w.is_mapped(),
            "wallpaper surface allocated"
        );
    });

    // Empty input region → pointer events fall through. The GdkWindow only
    // exists once mapped, so set it from the map signal (fires on every
    // re-map, which keeps the region if the compositor ever re-configures).
    window.connect_map(|w| {
        if let Some(gdk_win) = w.window() {
            gdk_win.input_shape_combine_region(&gtk::cairo::Region::create(), 0, 0);
        }
    });
}
