//! Linux (non-KDE) live-wallpaper delivery: background webview windows
//! turned into Wayland **layer-shell** surfaces on the `background` layer,
//! so the compositor itself keeps them under every window and panel — the
//! same mechanism swaybg / mpvpaper / cosmic-bg use for their wallpapers. They
//! render the fullscreen `#wallpaper` frontend the Windows (WorkerW) and
//! macOS (desktop-level NSWindow) paths already use, so all three
//! background-window platforms share one renderer.
//!
//! One surface per output: a layer surface is pinned to a single `wl_output`
//! (`set_monitor`), so every connected monitor gets its own window, each
//! rendering the spec at that monitor's own size. `ensure_surfaces` is the
//! reconciler — it creates a surface for every monitor that lacks one and is
//! re-run on apply, on monitor hotplug, and after the compositor closes a
//! surface (output removed) — so the set of windows always tracks the set of
//! outputs.
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

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use gtk::prelude::*;
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Window labels are `wallpaper-<n>`, one per output. `n` only ever grows
/// within a session, so a surface re-created after a compositor close never
/// collides with a window Tauri is still tearing down.
/// capabilities/wallpaper.json grants `wallpaper-*`.
const LABEL_PREFIX: &str = "wallpaper-";
static NEXT_LABEL: AtomicUsize = AtomicUsize::new(0);

/// Windows we destroyed ourselves (clear_live) whose Destroyed event hasn't
/// arrived yet — the hook must not resurrect those.
static CLEARING: AtomicUsize = AtomicUsize::new(0);

/// When we last re-created after a compositor close. Guards against a
/// re-create loop while the compositor keeps closing us (no outputs left,
/// e.g. lid closed): one retry, then wait for monitor-added.
static LAST_RECREATE: Mutex<Option<Instant>> = Mutex::new(None);
const RECREATE_COOLDOWN: Duration = Duration::from_secs(30);

thread_local! {
    /// label → the gdk::Monitor its surface is pinned to. GDK objects are
    /// main-thread only, hence thread-local: every access below happens on
    /// the GTK main thread (setup, run_on_main_thread, window events).
    static BOUND: RefCell<HashMap<String, gtk::gdk::Monitor>> = RefCell::new(HashMap::new());
}

/// Layer-shell namespace — what `wayland-info` / compositor debug tools show
/// for the surfaces.
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

    // Output hotplug: a new monitor needs its own surface, and when a
    // monitor goes away the compositor closes that surface (see
    // on_wallpaper_window_destroyed). Runs in setup() on the GTK main thread,
    // where the default display already exists.
    if let Some(display) = gtk::gdk::Display::default() {
        display.connect_monitor_added(|_, monitor| {
            tracing::info!(model = ?monitor.model(), "monitor added; extending the live wallpaper");
            *LAST_RECREATE.lock().unwrap_or_else(|e| e.into_inner()) = None;
            recreate_later(Duration::from_secs(1));
        });
    }
}

/// Tauri `WindowEvent::Destroyed` for a wallpaper window (lib.rs routes it
/// here). If we didn't destroy it ourselves, the compositor closed the layer
/// surface — zwlr_layer_surface_v1.closed on output removal, which
/// gtk-layer-shell turns into a GtkWindow close — so reconcile shortly, once.
/// A second close within the cooldown means the outputs really are gone;
/// then monitor-added is what brings the wallpaper back.
pub fn on_wallpaper_window_destroyed(app: &AppHandle, label: &str) {
    BOUND.with(|b| b.borrow_mut().remove(label));
    if CLEARING.load(Ordering::SeqCst) > 0 {
        CLEARING.fetch_sub(1, Ordering::SeqCst);
        return;
    }
    if crate::QUITTING.load(Ordering::SeqCst) {
        return;
    }
    let now = Instant::now();
    let mut last = LAST_RECREATE.lock().unwrap_or_else(|e| e.into_inner());
    if last.is_some_and(|t| now.duration_since(t) < RECREATE_COOLDOWN) {
        tracing::debug!(
            label,
            "wallpaper surface closed again by the compositor; waiting for an output"
        );
        return;
    }
    *last = Some(now);
    drop(last);
    tracing::info!(
        label,
        "wallpaper surface closed by the compositor; re-creating"
    );
    recreate_later(Duration::from_secs(2));
}

/// Re-apply the active live wallpaper after `delay`. That runs the setter,
/// whose reconciler creates surfaces only for outputs that lack one, so this
/// is safe to call whenever the output set may have changed.
/// `restore_if_active` is a no-op when no live wallpaper is recorded (e.g. a
/// static apply cleared it).
fn recreate_later(delay: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if crate::QUITTING.load(Ordering::SeqCst) {
            return;
        }
        ambient_core::live::restore_if_active().await;
    });
}

/// Every live wallpaper window currently alive (any thread — Tauri's window
/// map is thread-safe).
fn wallpaper_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(LABEL_PREFIX))
        .map(|(_, win)| win)
        .collect()
}

/// Setter: push the spec to every existing surface, then make sure every
/// output has one. The first apply creates them all (spec baked into an init
/// script so it's present before the app mounts); later applies pick up an
/// output that appeared without a hotplug signal.
fn set_live(app: &AppHandle, spec: &str) -> Result<(), String> {
    // emit() is thread-safe, so this is fine on the async-command worker.
    for win in wallpaper_windows(app) {
        win.emit("live-spec", spec).map_err(|e| e.to_string())?;
    }
    // WebviewWindowBuilder::build() and every GTK call must run on the main
    // (GTK) thread; apply_live_pattern is an async Tauri command, so we're on
    // a worker thread. Marshal it over and block briefly for the real result.
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_create = app.clone();
    let spec = spec.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(ensure_surfaces(&app_for_create, &spec));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "wallpaper window creation did not complete".to_string())?
}

/// Clearer: destroy every surface on the main thread. The compositor drops
/// back to its own wallpaper (cosmic-bg etc.) underneath.
fn clear_live(app: &AppHandle) {
    let app_for_destroy = app.clone();
    let _ = app.run_on_main_thread(move || {
        let wins = wallpaper_windows(&app_for_destroy);
        // Flag first: the Destroyed hook must not treat these as compositor
        // closes and resurrect the windows we're removing.
        CLEARING.fetch_add(wins.len(), Ordering::SeqCst);
        for win in wins {
            if win.destroy().is_err() {
                CLEARING.fetch_sub(1, Ordering::SeqCst);
            }
        }
        BOUND.with(|b| b.borrow_mut().clear());
    });
}

/// Main thread. Create a surface for every monitor that doesn't have one.
fn ensure_surfaces(app: &AppHandle, spec: &str) -> Result<(), String> {
    // Needs a Wayland GDK display AND a compositor advertising
    // zwlr_layer_shell_v1. (X11 sessions never get here — lib.rs exits on
    // non-Wayland — but GNOME Wayland does, and it lacks the protocol.)
    if !gtk_layer_shell::is_supported() {
        return Err(UNSUPPORTED.to_string());
    }
    let display = gtk::gdk::Display::default().ok_or("no GDK display")?;

    // Drop bindings whose window is gone (Destroyed removes them too; this
    // is belt and braces for a window that died without the event).
    BOUND.with(|b| {
        b.borrow_mut()
            .retain(|label, _| app.get_webview_window(label).is_some())
    });

    let outputs = display.n_monitors();
    let mut created = 0;
    for i in 0..outputs {
        let Some(monitor) = display.monitor(i) else {
            continue;
        };
        let covered = BOUND.with(|b| b.borrow().values().any(|m| m == &monitor));
        if covered {
            continue;
        }
        let label = format!(
            "{LABEL_PREFIX}{}",
            NEXT_LABEL.fetch_add(1, Ordering::SeqCst)
        );
        create_surface(app, &label, spec, &monitor)?;
        BOUND.with(|b| b.borrow_mut().insert(label, monitor));
        created += 1;
    }
    tracing::debug!(created, outputs, "live wallpaper surfaces reconciled");
    Ok(())
}

/// Main thread. One hidden webview window → layer surface on `monitor`.
fn create_surface(
    app: &AppHandle,
    label: &str,
    spec: &str,
    monitor: &gtk::gdk::Monitor,
) -> Result<(), String> {
    // Bake the spec in as a global so the fullscreen `#wallpaper` frontend can
    // read it synchronously on first mount (no IPC race). `spec` is JSON,
    // which is a valid JS literal; our config never contains `</script>`.
    let init = format!("window.__AMBIENT_SPEC__ = {spec};");

    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html#wallpaper".into()))
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

    place_on_background_layer(&gtk_win, monitor);

    // Mapping (show → realize) is what creates the layer surface.
    win.show()
        .map_err(|e| format!("show wallpaper window: {e}"))?;
    tracing::info!(
        label,
        monitor = ?monitor.model(),
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

/// Convert `window` into a background-layer surface on `monitor`: anchored
/// to all four edges (= output-sized), ignoring other surfaces' exclusive
/// zones so it runs under panels too, never taking keyboard focus, and
/// click-through so a stray desktop click reaches whatever the compositor
/// has underneath.
fn place_on_background_layer(window: &gtk::ApplicationWindow, monitor: &gtk::gdk::Monitor) {
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
    window.set_monitor(monitor);
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
