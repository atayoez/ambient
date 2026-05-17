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
/// On macOS + Windows, prefers an AVIF HDR sibling next to the supplied
/// path — Pattern apply writes both `pattern-X.png` (SDR fallback, what
/// the Library indexes) and `pattern-X.avif` (10-bit BT.2020 PQ).
///
/// On Linux, the AVIF is always written for inspection / external use
/// but never handed to the OS wallpaper API: cosmic-bg, gnome-shell,
/// sway-bg, etc. mostly don't decode AVIF as a wallpaper source as of
/// 2026 — silently rendering blank/grey. PNG goes to the compositor;
/// the AVIF sits next to it for users who want to inspect or share
/// the HDR file.
///
/// The recorded settings.lastApplied always stays on the PNG path so
/// the Library indicator + slot capture stay consistent.
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

    let try_avif = cfg!(any(target_os = "macos", target_os = "windows"));
    let avif_sibling = abs.with_extension("avif");
    let applied_avif = try_avif
        && avif_sibling.exists()
        && avif_sibling
            .to_str()
            .and_then(|s| apply_os(s).ok())
            .is_some();

    if !applied_avif {
        // Critical step — failure here is fatal, the rest is
        // best-effort.
        apply_os(&abs_str)?;
    }

    record_post_apply(&abs_str, app).await;
    let _ = app.emit("wallpaper-applied", abs_str.as_str());

    Ok(())
}

fn apply_os(abs_str: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        if desktop.eq_ignore_ascii_case("COSMIC") {
            return set_wallpaper_cosmic(abs_str);
        }
    }

    wallpaper::set_from_path(abs_str).map_err(|e| {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        format!(
            "OS wallpaper-set failed: {} (file existed at {}, XDG_CURRENT_DESKTOP={}, XDG_SESSION_TYPE={}).",
            e, abs_str, desktop, session
        )
    })
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
