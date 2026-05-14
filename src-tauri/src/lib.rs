use std::path::PathBuf;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[tauri::command]
async fn set_wallpaper(path: String) -> Result<(), String> {
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

#[tauri::command]
async fn fetch_and_save_wallpaper(
    url: String,
    filename: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let res = reqwest::get(&url)
        .await
        .map_err(|e| format!("download request to {}: {}", url, e))?;
    if !res.status().is_success() {
        return Err(format!("download {}: HTTP {}", url, res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("read response bytes from {}: {}", url, e))?;

    let target = wallpaper_target(&app, &filename)?;
    std::fs::write(&target, &bytes)
        .map_err(|e| format!("write wallpaper to {:?}: {}", target, e))?;

    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| "saved wallpaper path is not valid UTF-8".into())
}

#[tauri::command]
async fn save_image_bytes(
    bytes: Vec<u8>,
    filename: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let target = wallpaper_target(&app, &filename)?;
    std::fs::write(&target, &bytes)
        .map_err(|e| format!("write {:?}: {}", target, e))?;
    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| "saved path is not valid UTF-8".into())
}

#[tauri::command]
async fn list_wallpapers(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let wallpapers = data_dir.join("wallpapers");
    if !wallpapers.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&wallpapers).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(s) = entry.path().to_str() {
            out.push(s.to_string());
        }
    }
    Ok(out)
}

#[tauri::command]
async fn delete_wallpaper(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

fn wallpaper_target(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {}", e))?;
    let wallpapers = data_dir.join("wallpapers");
    std::fs::create_dir_all(&wallpapers)
        .map_err(|e| format!("create wallpapers dir {:?}: {}", wallpapers, e))?;
    Ok(wallpapers.join(safe_filename(filename)))
}

fn safe_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

// --- Monitor detection ------------------------------------------------------
//
// Tauri 2's `primaryMonitor()` returns null on COSMIC Wayland (the COSMIC
// compositor doesn't speak the output protocol Tauri queries). Instead, shell
// out to whatever randr tool is available and parse its text output.

#[derive(Serialize, Clone)]
struct MonitorInfo {
    width: u32,
    height: u32,
    scale: f32,
    source: String,
}

#[tauri::command]
fn get_primary_monitor_pixels() -> Result<MonitorInfo, String> {
    if let Some(info) = try_cosmic_randr() {
        return Ok(info);
    }
    if let Some(info) = try_wlr_randr() {
        return Ok(info);
    }
    if let Some(info) = try_xrandr() {
        return Ok(info);
    }
    Err("could not detect monitor via cosmic-randr / wlr-randr / xrandr".into())
}

fn try_cosmic_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("cosmic-randr")
        .arg("list")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let cleaned = strip_ansi(&text);

    let mut scale: f32 = 1.0;
    let mut dims: Option<(u32, u32)> = None;

    for line in cleaned.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Scale:") {
            let s = rest.trim().trim_end_matches('%');
            if let Ok(n) = s.parse::<f32>() {
                scale = if n > 10.0 { n / 100.0 } else { n };
            }
        }
        if line.contains("(current)") {
            if let Some((w, h)) = first_wxh(line) {
                dims = Some((w, h));
                break;
            }
        }
    }

    let (width, height) = dims?;
    Some(MonitorInfo {
        width,
        height,
        scale,
        source: "cosmic-randr".to_string(),
    })
}

fn try_wlr_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("wlr-randr").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();

    let mut scale: f32 = 1.0;
    let mut dims: Option<(u32, u32)> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Scale:") {
            if let Ok(n) = rest.trim().parse::<f32>() {
                scale = n;
            }
        }
        if line.contains("current") {
            if let Some((w, h)) = first_wxh(line) {
                dims = Some((w, h));
                break;
            }
        }
    }

    let (width, height) = dims?;
    Some(MonitorInfo {
        width,
        height,
        scale,
        source: "wlr-randr".to_string(),
    })
}

fn try_xrandr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("xrandr").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    for line in text.lines() {
        if line.contains(" connected") {
            for token in line.split_whitespace() {
                if let Some(plus) = token.find('+') {
                    let dims = &token[..plus];
                    if let Some((w, h)) = dims.split_once('x') {
                        if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                            return Some(MonitorInfo {
                                width: w,
                                height: h,
                                scale: 1.0,
                                source: "xrandr".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

// Find the first WxH token in a line, e.g. extracts (2880, 1800) from
// "    2880x1800 @ 90.001 Hz (current) (preferred)"
fn first_wxh(line: &str) -> Option<(u32, u32)> {
    for token in line.split_whitespace() {
        let token = token.trim_start_matches('[').trim_end_matches(']');
        if let Some((w, h)) = token.split_once('x') {
            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                return Some((w, h));
            }
        }
    }
    None
}

fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            set_wallpaper,
            fetch_and_save_wallpaper,
            save_image_bytes,
            list_wallpapers,
            delete_wallpaper,
            get_primary_monitor_pixels,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let show_i =
                    MenuItem::with_id(app, "show", "Open Ambient", true, None::<&str>)?;
                let rotate_i =
                    MenuItem::with_id(app, "rotate", "Next wallpaper", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &rotate_i, &quit_i])?;

                let mut tray = TrayIconBuilder::with_id("main")
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .tooltip("Ambient")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "rotate" => {
                            let _ = app.emit("rotate-now", ());
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray = tray.icon(icon);
                }

                let _ = tray.build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
