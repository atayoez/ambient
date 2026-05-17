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

use tauri::{AppHandle, Emitter, Manager};
use tokio::time::sleep;

use crate::desktop::apply_wallpaper;
use crate::library_store::LibraryState;
use crate::settings::SettingsState;
use crate::sources::fetch_source_wallpaper;
use crate::tray_icon::is_system_dark;
use crate::types::{RotationSource, Settings, ThemeMode, Wallpaper};
use crate::util::pseudo_seed;

const THEME_CHECK_INTERVAL_SECS: u64 = 300;

/// Spawn the two background tasks. Called from lib.rs setup() once
/// SettingsState is managed.
pub fn spawn(app: AppHandle) {
    let app_rot = app.clone();
    tauri::async_runtime::spawn(async move { rotation_task(app_rot).await });
    let app_theme = app.clone();
    tauri::async_runtime::spawn(async move { theme_check_task(app_theme).await });
}

async fn rotation_task(app: AppHandle) {
    let mut rx = app.state::<SettingsState>().subscribe();
    loop {
        let cfg = rx.borrow().clone();
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
                    eprintln!("[ambient] rotation tick: {}", e);
                }
            }
            _ = rx.changed() => {
                // Settings changed mid-sleep — loop and re-read.
            }
        }
    }
}

async fn theme_check_task(app: AppHandle) {
    let mut rx = app.state::<SettingsState>().subscribe();
    loop {
        let cfg = rx.borrow().clone();
        if !matches!(cfg.theme_mode, ThemeMode::Auto) {
            if rx.changed().await.is_err() {
                break;
            }
            continue;
        }
        tokio::select! {
            _ = sleep(Duration::from_secs(THEME_CHECK_INTERVAL_SECS)) => {
                if let Err(e) = theme_check(&app, &cfg).await {
                    eprintln!("[ambient] theme check: {}", e);
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
        RotationSource::Library => shuffle_library(app, cfg).await,
        // Off + Sources both go to the source fetcher. The Off case is
        // for the tray "Next wallpaper" menu item — user explicitly
        // asked for a new image, treat as "fetch from source".
        RotationSource::Off | RotationSource::Sources => {
            fetch_and_apply_source(app).await
        }
    }
}

/// Tray menu / manual trigger entry point. Reads fresh settings and
/// dispatches the same tick code path the periodic timer uses.
pub async fn trigger_once(app: &AppHandle) -> Result<Wallpaper, String> {
    let cfg = app.state::<SettingsState>().get().await;
    tick(app, &cfg).await
}

async fn fetch_and_apply_source(app: &AppHandle) -> Result<Wallpaper, String> {
    let entry = fetch_source_wallpaper(app.clone()).await?;
    apply_wallpaper(&entry.path, app).await?;
    let _ = app.emit("wallpaper-rotated", &entry);
    Ok(entry)
}

async fn shuffle_library(app: &AppHandle, cfg: &Settings) -> Result<Wallpaper, String> {
    let lib = app.state::<LibraryState>().get().await;
    if lib.is_empty() {
        return Err("Library is empty — nothing to shuffle from.".to_string());
    }
    // Filter out the most-recently-applied entry so we don't pick the
    // same image two ticks in a row. With a one-item library, filtering
    // empties the pool — fall back to the unfiltered list so the user
    // still sees the tick produce something.
    let pool: Vec<Wallpaper> = match cfg.last_applied.as_ref() {
        Some(last) => {
            let filtered: Vec<Wallpaper> =
                lib.iter().filter(|w| &w.path != last).cloned().collect();
            if filtered.is_empty() {
                lib
            } else {
                filtered
            }
        }
        None => lib,
    };
    let idx = (pseudo_seed() as usize) % pool.len();
    let pick = pool[idx].clone();
    apply_wallpaper(&pick.path, app).await?;
    let _ = app.emit("wallpaper-rotated", &pick);
    Ok(pick)
}

async fn theme_check(app: &AppHandle, cfg: &Settings) -> Result<(), String> {
    let want = if is_system_dark() {
        &cfg.theme_follow_dark_path
    } else {
        &cfg.theme_follow_light_path
    };
    let Some(want) = want.as_ref() else {
        // No slot wallpaper yet for the current system theme — nothing
        // to apply. User needs to apply a wallpaper while in the target
        // mode to populate the slot.
        return Ok(());
    };
    if cfg.last_applied.as_deref() == Some(want.as_str()) {
        return Ok(());
    }
    apply_wallpaper(want, app).await
}

#[tauri::command]
pub async fn rotate_now(app: AppHandle) -> Result<Wallpaper, String> {
    trigger_once(&app).await
}
