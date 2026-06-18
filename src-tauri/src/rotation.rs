// Background rotation + theme-follow. Two tokio tasks spawned in
// setup(), each subscribed to the SettingsState watch channel:
//
//   * rotation_task fires every `rotation_interval_minutes` when
//     rotation_source is Sources or Library, sleeps indefinitely
//     (until settings change) when Off.
//
//   * theme_check_task fires every 5 minutes when theme_mode is Auto,
//     reapplies the matching slot wallpaper if the system flipped
//     dark/light since the last apply. Sleeps until settings change
//     when mode is locked to Light or Dark.
//
// Both tasks survive webview destroy/rebuild — the whole point of
// Phase 4. Pre-Phase-4 these lived in JS setInterval/matchMedia,
// which died when the user closed the window to tray.

use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use ambient_core::desktop::apply_wallpaper;
use ambient_core::sources::fetch_source_wallpaper;
use ambient_core::state;
use ambient_core::types::{RotationSource, Settings, ThemeMode, Wallpaper};
use ambient_core::util::pseudo_seed;

use crate::tray_icon::is_system_dark;

const THEME_CHECK_INTERVAL_SECS: u64 = 300;

/// Spawn the two background tasks. Called from lib.rs setup() once
/// SettingsState is managed.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move { rotation_task(app).await });
    tauri::async_runtime::spawn(async { theme_check_task().await });
}

async fn rotation_task(app: AppHandle) {
    let mut rx = state::settings().subscribe();
    loop {
        let cfg = rx.borrow().clone();
        // A live (animated) wallpaper owns the desktop — stand down until
        // it's turned off (a settings change wakes us).
        if cfg.live_wallpaper.is_some() {
            if rx.changed().await.is_err() {
                break;
            }
            continue;
        }
        if matches!(cfg.rotation_source, RotationSource::Off) {
            if rx.changed().await.is_err() {
                break;
            }
            continue;
        }
        let interval = Duration::from_secs(
            cfg.rotation_interval_minutes.max(1) as u64 * 60,
        );
        tokio::select! {
            _ = sleep(interval) => {
                if let Err(e) = tick(&app, &cfg).await {
                    tracing::error!(error = %e, "rotation tick failed");
                }
            }
            _ = rx.changed() => {
                // Settings changed mid-sleep — loop and re-read.
            }
        }
    }
}

async fn theme_check_task() {
    let mut rx = state::settings().subscribe();
    loop {
        let cfg = rx.borrow().clone();
        if cfg.live_wallpaper.is_some() {
            if rx.changed().await.is_err() {
                break;
            }
            continue;
        }
        if !matches!(cfg.theme_mode, ThemeMode::Auto) {
            if rx.changed().await.is_err() {
                break;
            }
            continue;
        }
        tokio::select! {
            _ = sleep(Duration::from_secs(THEME_CHECK_INTERVAL_SECS)) => {
                if let Err(e) = theme_check(&cfg).await {
                    tracing::error!(error = %e, "theme check failed");
                }
            }
            _ = rx.changed() => {}
        }
    }
}

/// One tick of the rotation timer. Public so the tray "Next wallpaper"
/// menu item can trigger an out-of-band advance.
pub async fn tick(app: &AppHandle, cfg: &Settings) -> Result<Wallpaper, String> {
    match cfg.rotation_source {
        // Library rotation AND the tray "Next wallpaper" (Off) advance
        // through the saved library, filtered to the current theme's
        // pool. Off only falls back to a source fetch when the library
        // is empty (nothing to advance through).
        RotationSource::Library => shuffle_library(app, cfg).await,
        RotationSource::Off => {
            if state::library().get().await.is_empty() {
                fetch_and_apply_source(app).await
            } else {
                shuffle_library(app, cfg).await
            }
        }
        RotationSource::Sources => fetch_and_apply_source(app).await,
    }
}

/// Tray menu / manual trigger entry point. Reads fresh settings and
/// dispatches the same tick code path the periodic timer uses.
pub async fn trigger_once(app: &AppHandle) -> Result<Wallpaper, String> {
    let cfg = state::settings().get().await;
    if cfg.live_wallpaper.is_some() {
        return Err("A live wallpaper is active — turn it off to shuffle.".to_string());
    }
    tick(app, &cfg).await
}

async fn fetch_and_apply_source(app: &AppHandle) -> Result<Wallpaper, String> {
    let entry = fetch_source_wallpaper().await?;
    apply_wallpaper(&entry.path).await?;
    let _ = app.emit("wallpaper-rotated", &entry);
    Ok(entry)
}

/// The system-theme darkness the rotation pools should target: the
/// locked Light/Dark mode if set, otherwise the live system theme.
fn effective_dark(cfg: &Settings) -> bool {
    match cfg.theme_mode {
        ThemeMode::Light => false,
        ThemeMode::Dark => true,
        ThemeMode::Auto => is_system_dark(),
    }
}

async fn shuffle_library(app: &AppHandle, cfg: &Settings) -> Result<Wallpaper, String> {
    let lib = state::library().get().await;
    if lib.is_empty() {
        return Err("Library is empty — nothing to shuffle from.".to_string());
    }
    let dark = effective_dark(cfg);
    // Pool = entries eligible for the current theme (light-tagged when
    // light, dark-tagged when dark, both-tagged always). If nothing
    // matches — e.g. every entry is tagged the opposite mode — fall back
    // to the whole library so "Next" still produces something.
    let eligible: Vec<Wallpaper> =
        lib.iter().filter(|w| w.mode.matches(dark)).cloned().collect();
    let base = if eligible.is_empty() { lib } else { eligible };
    // Avoid repeating the current wallpaper when there's an alternative.
    let pool: Vec<Wallpaper> = match cfg.last_applied.as_ref() {
        Some(last) => {
            let filtered: Vec<Wallpaper> =
                base.iter().filter(|w| &w.path != last).cloned().collect();
            if filtered.is_empty() {
                base
            } else {
                filtered
            }
        }
        None => base,
    };
    let idx = (pseudo_seed() as usize) % pool.len();
    let pick = pool[idx].clone();
    apply_wallpaper(&pick.path).await?;
    let _ = app.emit("wallpaper-rotated", &pick);
    Ok(pick)
}

/// Auto mode only (gated by the caller). On a system light/dark flip,
/// if the current wallpaper no longer fits the new theme, switch to one
/// from the matching pool. A `Both`-tagged wallpaper always fits, so it's
/// never disturbed; only mode-specific wallpapers trigger a swap.
async fn theme_check(cfg: &Settings) -> Result<(), String> {
    let dark = is_system_dark();
    let lib = state::library().get().await;
    if lib.is_empty() {
        return Ok(());
    }
    // Current wallpaper already eligible for the system theme → leave it.
    if let Some(last) = cfg.last_applied.as_ref() {
        if let Some(cur) = lib.iter().find(|w| &w.path == last) {
            if cur.mode.matches(dark) {
                return Ok(());
            }
        }
    }
    // Otherwise apply the first wallpaper tagged for the new theme. No
    // match (nothing light/both when light, etc.) → nothing to do.
    let Some(pick) = lib.iter().find(|w| w.mode.matches(dark)) else {
        return Ok(());
    };
    apply_wallpaper(&pick.path).await
}

#[tauri::command]
pub async fn rotate_now(app: AppHandle) -> Result<Wallpaper, String> {
    trigger_once(&app).await
}
