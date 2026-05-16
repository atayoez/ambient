// Desktop wallpaper application. Calls the `wallpaper` crate's
// cross-platform setter, or — on Linux under COSMIC — writes the
// CosmicBackground config files directly (the crate doesn't handle
// COSMIC's per-output RON layout).

use std::path::PathBuf;

#[tauri::command]
pub async fn set_wallpaper(path: String) -> Result<(), String> {
    let pb = PathBuf::from(&path);
    if !pb.exists() {
        return Err(format!("wallpaper file not found on disk: {}", path));
    }
    let abs = pb
        .canonicalize()
        .map_err(|e| format!("canonicalize wallpaper path '{}': {}", path, e))?;
    let s = abs
        .to_str()
        .ok_or_else(|| "wallpaper path is not valid UTF-8".to_string())?;

    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        if desktop.eq_ignore_ascii_case("COSMIC") {
            return set_wallpaper_cosmic(s);
        }
    }

    wallpaper::set_from_path(s).map_err(|e| {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        format!(
            "OS wallpaper-set failed: {} (file existed at {}, XDG_CURRENT_DESKTOP={}, XDG_SESSION_TYPE={}).",
            e, s, desktop, session
        )
    })?;
    Ok(())
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
