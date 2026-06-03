// Desktop wallpaper application + the side-effects that follow it:
//   1. OS wallpaper-set (cross-platform via `wallpaper` crate, or our
//      own COSMIC-specific RON write on Linux under COSMIC).
//   2. Stamp settings.lastApplied for the "currently applied" indicator
//      that survives webview destroy/rebuild.
//   3. Slot capture for the theme-follow feature — write the path
//      into themeFollowLightPath or themeFollowDarkPath depending on
//      the current theme_mode + (for auto) the live system theme.
//   4. Promote the entry to the head of the library so the grid is
//      sorted by most-recently-applied.
//   5. Emit a `wallpaper-applied` Tauri event.
//   6. If the window is hidden/destroyed (tray-only state), fire a
//      system notification — when the window IS visible the status
//      pill in-tab is enough feedback.
//
// Phase 4 consolidated all of this on the Rust side. Pre-Phase-4 the
// notification + library-promote + slot-capture lived in JS, which
// silently broke whenever the user was in tray-only mode (webview
// destroyed → no JS code running).

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::library_store::{LibraryOp, LibraryState};
use crate::settings::SettingsState;
use crate::tray_icon::is_system_dark;
use crate::types::ThemeMode;

/// Internal: full apply pipeline. Called by both the #[tauri::command]
/// wrapper (frontend invokes) and the rotation task (background tick).
///
/// Always applies the SDR PNG. (HDR AVIF wallpaper output was removed
/// 2026-06-03 — the desktop background layer is SDR-composited on every
/// current OS, so a PQ/BT.2020 file renders dark as a wallpaper.)
pub async fn apply_wallpaper(path: &str, app: &AppHandle) -> Result<(), String> {
    let pb = PathBuf::from(path);
    if !pb.exists() {
        return Err(format!("wallpaper file not found on disk: {}", path));
    }
    let abs = pb
        .canonicalize()
        .map_err(|e| format!("canonicalize wallpaper path '{}': {}", path, e))?;
    let abs_str = abs
        .to_str()
        .ok_or_else(|| "wallpaper path is not valid UTF-8".to_string())?
        .to_string();

    apply_os(&abs_str)?;

    record_post_apply(&abs_str, app).await;
    let _ = app.emit("wallpaper-applied", abs_str.as_str());

    Ok(())
}

fn apply_os(abs_str: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        match linux_strategy(&desktop) {
            LinuxWallpaper::Cosmic => return set_wallpaper_cosmic(abs_str),
            LinuxWallpaper::Kde => {
                // Prefer Plasma's own CLI. The `wallpaper` crate's KDE
                // path shells out to qdbus + a plasma scripting eval,
                // which is frequently absent (qdbus6 not installed) or
                // broken on Plasma 6 / Wayland — the source of the KDE
                // "OS wallpaper-set failed" reports. Fall back to the
                // crate only if the CLI itself can't run.
                if let Err(kde_err) = set_wallpaper_kde(abs_str) {
                    return wallpaper::set_from_path(abs_str).map_err(|e| {
                        linux_err(
                            &format!("{kde_err}; generic fallback also failed: {e}"),
                            abs_str,
                        )
                    });
                }
                return Ok(());
            }
            LinuxWallpaper::Generic => {
                return wallpaper::set_from_path(abs_str)
                    .map_err(|e| linux_err(&e.to_string(), abs_str));
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        wallpaper::set_from_path(abs_str).map_err(|e| format!("OS wallpaper-set failed: {}", e))
    }
}

/// Which Linux wallpaper-set strategy a given `XDG_CURRENT_DESKTOP` maps
/// to. Split out (and unit-tested below) because cross-desktop breakage
/// almost always lives in *routing* — picking the wrong setter for the
/// session — rather than in the setters themselves, and that's the part
/// we can verify without a live compositor.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxWallpaper {
    /// COSMIC: write the cosmic-bg RON config directly.
    Cosmic,
    /// KDE Plasma: drive `plasma-apply-wallpaperimage`.
    Kde,
    /// Everything else (GNOME, Cinnamon, XFCE, MATE, wlroots, …): hand
    /// off to the `wallpaper` crate's per-DE detection.
    Generic,
}

/// `XDG_CURRENT_DESKTOP` is a colon-separated, case-inconsistent list
/// (e.g. `KDE`, `plasma`, `ubuntu:GNOME`, `pop:COSMIC`). Match any token.
#[cfg(target_os = "linux")]
fn linux_strategy(desktop: &str) -> LinuxWallpaper {
    let has = |name: &str| {
        desktop
            .split(':')
            .any(|tok| tok.trim().eq_ignore_ascii_case(name))
    };
    if has("COSMIC") {
        LinuxWallpaper::Cosmic
    } else if has("KDE") || has("plasma") {
        LinuxWallpaper::Kde
    } else {
        LinuxWallpaper::Generic
    }
}

/// Wrap a setter error with the session diagnostics that make remote
/// bug reports actionable (which DE, X11 vs Wayland).
#[cfg(target_os = "linux")]
fn linux_err(msg: &str, abs_str: &str) -> String {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    format!(
        "OS wallpaper-set failed: {} (file existed at {}, XDG_CURRENT_DESKTOP={}, XDG_SESSION_TYPE={}).",
        msg, abs_str, desktop, session
    )
}

/// KDE Plasma 5.18+: `plasma-apply-wallpaperimage` ships with
/// plasma-workspace and sets the image wallpaper on every screen through
/// the running shell — works on both X11 and Wayland.
#[cfg(target_os = "linux")]
fn set_wallpaper_kde(abs_path: &str) -> Result<(), String> {
    use std::process::Command;
    let out = Command::new("plasma-apply-wallpaperimage")
        .arg(abs_path)
        .output()
        .map_err(|e| format!("plasma-apply-wallpaperimage not runnable: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "plasma-apply-wallpaperimage exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

async fn record_post_apply(abs_str: &str, app: &AppHandle) {
    // Build the patch — lastApplied plus the matching theme-follow slot.
    // is_system_dark() is only called when theme_mode is Auto (it's a
    // shell-out — fine per apply, but avoid when the mode is locked).
    let state = app.state::<SettingsState>();
    let current = state.get().await;
    let slot_key = match current.theme_mode {
        ThemeMode::Light => Some("themeFollowLightPath"),
        ThemeMode::Dark => Some("themeFollowDarkPath"),
        ThemeMode::Auto => Some(if is_system_dark() {
            "themeFollowDarkPath"
        } else {
            "themeFollowLightPath"
        }),
    };
    let mut patch = serde_json::Map::new();
    patch.insert(
        "lastApplied".to_string(),
        serde_json::Value::String(abs_str.to_string()),
    );
    if let Some(key) = slot_key {
        patch.insert(
            key.to_string(),
            serde_json::Value::String(abs_str.to_string()),
        );
    }
    let _ = state.patch(serde_json::Value::Object(patch), app).await;

    // Promote to head of library — no-op when not in library (the
    // typical mid-fetch case where the prepend hasn't committed yet).
    let lib_state = app.state::<LibraryState>();
    let _ = lib_state
        .patch(
            LibraryOp::PromoteToHead {
                path: abs_str.to_string(),
            },
            app,
        )
        .await;

    notify_if_hidden(abs_str, app);
}

fn notify_if_hidden(abs_path: &str, app: &AppHandle) {
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

#[tauri::command]
pub async fn set_wallpaper(path: String, app: AppHandle) -> Result<(), String> {
    apply_wallpaper(&path, &app).await
}

#[cfg(target_os = "linux")]
fn set_wallpaper_cosmic(abs_path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| format!("$HOME: {}", e))?;
    let dir = PathBuf::from(home).join(".config/cosmic/com.system76.CosmicBackground/v1");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create cosmic config dir {:?}: {}", dir, e))?;

    std::fs::write(dir.join("same-on-all"), "true")
        .map_err(|e| format!("write cosmic same-on-all: {}", e))?;

    let escaped = abs_path.replace('\\', "\\\\").replace('"', "\\\"");
    let ron = format!(
        "(\n    output: \"all\",\n    source: Path(\"{}\"),\n    filter_by_theme: false,\n    rotation_frequency: 0,\n    filter_method: Lanczos,\n    scaling_mode: Stretch,\n    sampling_method: Alphanumeric,\n)\n",
        escaped
    );
    std::fs::write(dir.join("all"), ron)
        .map_err(|e| format!("write cosmic background config: {}", e))?;

    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{linux_strategy, LinuxWallpaper};

    // Cross-desktop routing matrix. We can't drive a real compositor in
    // CI, but mis-routing the session is where every "works on my DE,
    // fails on theirs" report has originated — so pin the mapping for
    // every desktop string we expect to see in the wild.
    #[test]
    fn routes_each_desktop_to_its_setter() {
        let cases = [
            ("COSMIC", LinuxWallpaper::Cosmic),
            ("pop:COSMIC", LinuxWallpaper::Cosmic),
            ("KDE", LinuxWallpaper::Kde),
            ("plasma", LinuxWallpaper::Kde),
            ("KDE:plasma", LinuxWallpaper::Kde),
            ("GNOME", LinuxWallpaper::Generic),
            ("ubuntu:GNOME", LinuxWallpaper::Generic),
            ("X-Cinnamon", LinuxWallpaper::Generic),
            ("XFCE", LinuxWallpaper::Generic),
            ("MATE", LinuxWallpaper::Generic),
            ("sway", LinuxWallpaper::Generic),
            ("Hyprland", LinuxWallpaper::Generic),
            ("", LinuxWallpaper::Generic),
        ];
        for (xdg, want) in cases {
            assert_eq!(
                linux_strategy(xdg),
                want,
                "XDG_CURRENT_DESKTOP={xdg:?} routed to the wrong setter"
            );
        }
    }

    // Detection is case- and position-insensitive across the colon list.
    #[test]
    fn desktop_match_is_case_and_order_insensitive() {
        assert_eq!(linux_strategy("kde"), LinuxWallpaper::Kde);
        assert_eq!(linux_strategy("Plasma"), LinuxWallpaper::Kde);
        assert_eq!(linux_strategy("cosmic"), LinuxWallpaper::Cosmic);
        assert_eq!(linux_strategy("foo:bar:KDE"), LinuxWallpaper::Kde);
    }
}
