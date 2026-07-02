// Thin #[tauri::command] wrappers around ambient-core. Command names,
// argument names, and return shapes are the pre-extraction wire
// contract, verbatim — the React layer's invoke() calls must not see a
// difference. No logic lives here: parameter passthrough only. (The
// events the old command bodies emitted now fire inside core, through
// the sink registered in lib.rs's setup.)

use ambient_core::library_store::LibraryOp;
use ambient_core::license::{LicenseInfo, StartupLicense};
use ambient_core::monitor::MonitorInfo;
use ambient_core::renderer::PatternConfig;
use ambient_core::types::{Settings, Wallpaper};

// --- desktop ---------------------------------------------------------

#[tauri::command]
pub async fn set_wallpaper(path: String) -> Result<(), String> {
    ambient_core::desktop::apply_wallpaper(&path).await
}

// --- library files ---------------------------------------------------

#[tauri::command]
pub async fn list_wallpapers() -> Result<Vec<String>, String> {
    ambient_core::library::list_wallpapers().await
}

#[tauri::command]
pub async fn delete_wallpaper(path: String) -> Result<(), String> {
    ambient_core::library::delete_wallpaper(path).await
}

#[tauri::command]
pub async fn get_or_create_thumbnail(path: String) -> Result<String, String> {
    ambient_core::library::get_or_create_thumbnail(path).await
}

#[tauri::command]
pub async fn clear_thumbnail_cache() -> Result<(), String> {
    ambient_core::library::clear_thumbnail_cache().await
}

#[tauri::command]
pub async fn delete_local_wallpapers() -> Result<u32, String> {
    ambient_core::library::delete_local_wallpapers().await
}

// --- library index ---------------------------------------------------

#[tauri::command]
pub async fn get_library() -> Result<Vec<Wallpaper>, String> {
    Ok(ambient_core::state::library().get().await)
}

#[tauri::command]
pub async fn patch_library(op: LibraryOp) -> Result<Vec<Wallpaper>, String> {
    ambient_core::state::library().patch(op).await
}

// --- license ---------------------------------------------------------

#[tauri::command]
pub async fn get_startup_license() -> Result<StartupLicense, String> {
    Ok(ambient_core::license::get_startup_license().await)
}

#[tauri::command]
pub async fn request_login_code(email: String) -> Result<(), String> {
    ambient_core::license::request_login_code(email).await
}

#[tauri::command]
pub async fn login_with_code(code: String) -> Result<LicenseInfo, String> {
    ambient_core::license::login_with_code(code).await
}

#[tauri::command]
pub async fn clear_license() -> Result<(), String> {
    ambient_core::license::clear_license().await;
    Ok(())
}

// --- platform queries ------------------------------------------------

#[tauri::command]
pub fn get_primary_monitor_pixels() -> Result<MonitorInfo, String> {
    ambient_core::monitor::get_primary_monitor_pixels()
}

#[tauri::command]
pub fn get_system_accent() -> Option<String> {
    ambient_core::accent::get_system_accent()
}

// --- secrets ---------------------------------------------------------

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    ambient_core::secrets::get_secret(name)
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    ambient_core::secrets::set_secret(name, value)
}

#[tauri::command]
pub fn clear_secret(name: String) -> Result<(), String> {
    ambient_core::secrets::clear_secret(name)
}

// --- settings --------------------------------------------------------

#[tauri::command]
pub async fn get_settings() -> Result<Settings, String> {
    Ok(ambient_core::state::settings().get().await)
}

#[tauri::command]
pub async fn patch_settings(patch: serde_json::Value) -> Result<Settings, String> {
    ambient_core::state::settings().patch(patch).await
}

// --- sources + AI generation -----------------------------------------

#[tauri::command]
pub async fn fetch_source_wallpaper() -> Result<Wallpaper, String> {
    ambient_core::sources::fetch_source_wallpaper().await
}

#[tauri::command]
pub async fn generate_wallpaper(prompt: String) -> Result<Wallpaper, String> {
    ambient_core::aigen::generate_wallpaper(prompt).await
}

#[tauri::command]
pub async fn pollinations_models() -> Result<Vec<String>, String> {
    ambient_core::aigen::pollinations_models().await
}

// --- pattern renderer ------------------------------------------------

#[tauri::command]
pub async fn apply_pattern(config: PatternConfig) -> Result<Wallpaper, String> {
    ambient_core::renderer::apply_pattern(config).await
}

#[tauri::command]
pub async fn render_preview(
    config: PatternConfig,
    width: u32,
    height: u32,
) -> Result<String, String> {
    ambient_core::renderer::render_preview(config, width, height).await
}

/// Materialize Fluent 3D PNGs for `emojis` on disk and return their paths
/// (empty string per glyph that isn't available), so the webview can show
/// the same 3D art via the asset protocol instead of flat font glyphs.
#[tauri::command]
pub async fn export_emoji_pngs(emojis: Vec<String>) -> Vec<String> {
    ambient_core::emojis::export_pngs(&emojis).await
}

// --- live (animated) wallpaper ---------------------------------------

#[tauri::command]
pub async fn apply_live_pattern(config: serde_json::Value) -> Result<(), String> {
    ambient_core::live::apply_live_pattern(config).await
}

#[tauri::command]
pub async fn clear_live_wallpaper() -> Result<(), String> {
    ambient_core::live::clear_live_wallpaper().await
}

#[tauri::command]
pub async fn get_live_wallpaper() -> Result<Option<serde_json::Value>, String> {
    Ok(ambient_core::state::settings().get().await.live_wallpaper)
}
