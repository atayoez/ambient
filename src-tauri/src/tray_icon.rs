// Procedurally-rendered monochrome tray glyph. Drawn at runtime as a
// 32×32 RGBA buffer so there's no external asset to keep in sync with
// the app icon — and because tray hosts disagree about what "template"
// means on disk (macOS wants alpha-only via a specific NSImage flag,
// GTK wants a symbolic SVG named like `app-symbolic`, Windows tray
// just takes the bitmap and re-tints based on theme).
//
// The glyph is a stylized aurora wave with a small "star" — echoes
// app-icon.svg's main motif without requiring SVG rasterization.
//
// Theme handling:
//   - macOS: template mode = the OS inverts the glyph against the
//     menubar's effective theme. We always draw white; the system
//     handles light-menubar inversion.
//   - Windows/Linux: tray hosts don't invert. The frontend detects
//     prefers-color-scheme via matchMedia and calls `update_tray_theme`
//     to swap between a near-black glyph (light system theme) and a
//     near-white glyph (dark system theme).

use tauri::{image::Image, AppHandle};

const SIZE: u32 = 32;

/// Build the symbolic glyph in either the light-on-dark or dark-on-light
/// variant. `dark_glyph = true` paints near-black pixels — used on light
/// system themes so the icon reads against a bright menubar.
///
/// Design: a filled landscape silhouette — two mountain triangles plus a
/// sun disc above. Solid shapes were picked over the prior thin-stroke
/// aurora because filled silhouettes survive the tray host's downscale
/// to 16-22 px without losing definition. Composition mirrors a generic
/// "wallpaper / scenery" glyph the user's OS uses for picture-related
/// affordances (macOS Photos sidebar, GNOME Backgrounds), so the tray
/// affordance is immediately legible as "the app that paints your
/// desktop background."
pub fn symbolic_icon(dark_glyph: bool) -> Image<'static> {
    let (r, g, b) = if dark_glyph {
        // Near-black with a hint of warmth so the icon doesn't read as a
        // flat hole against a colored menubar (e.g. Windows 11 light
        // taskbar, which carries an accent tint of its own).
        (24u8, 24u8, 28u8)
    } else {
        (255u8, 255u8, 255u8)
    };
    let mut bytes = vec![0u8; (SIZE * SIZE * 4) as usize];

    // Big mountain — base sits ~1 px above the bottom edge so the
    // silhouette doesn't get clipped on tray hosts that crop tight.
    let mtn_a = (3.0f32, 26.0f32);
    let mtn_b = (13.0f32, 9.0f32);
    let mtn_c = (22.0f32, 26.0f32);
    // Foothill peeking out from behind / to the right.
    let foot_a = (17.0f32, 26.0f32);
    let foot_b = (24.0f32, 16.0f32);
    let foot_c = (29.0f32, 26.0f32);
    // Sun disc, upper-right, clear of both peaks.
    let sun_cx = 24.0f32;
    let sun_cy = 7.5f32;
    let sun_r2 = 3.0f32 * 3.0f32; // squared for cheaper compare

    // 4×4 super-sampling = 16 sub-samples per pixel. Negligible
    // (~16k float ops total) at startup, gives a smooth alpha edge
    // that holds up under the tray host's downscale to 16-22 px.
    const SS: u32 = 4;
    const SS_F: f32 = SS as f32;
    const SS_TOTAL: f32 = (SS * SS) as f32;
    let step = 1.0 / SS_F;
    let off = step * 0.5;

    for py in 0..SIZE {
        for px in 0..SIZE {
            let mut hits = 0u32;
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = px as f32 + off + sx as f32 * step;
                    let y = py as f32 + off + sy as f32 * step;
                    let p = (x, y);
                    let in_mtn = in_triangle(p, mtn_a, mtn_b, mtn_c);
                    let in_foot = in_triangle(p, foot_a, foot_b, foot_c);
                    let dx = x - sun_cx;
                    let dy = y - sun_cy;
                    let in_sun = dx * dx + dy * dy < sun_r2;
                    if in_mtn || in_foot || in_sun {
                        hits += 1;
                    }
                }
            }
            if hits > 0 {
                let alpha = ((hits as f32 / SS_TOTAL) * 255.0) as u8;
                let idx = ((py * SIZE + px) * 4) as usize;
                bytes[idx] = r;
                bytes[idx + 1] = g;
                bytes[idx + 2] = b;
                bytes[idx + 3] = alpha;
            }
        }
    }

    Image::new_owned(bytes, SIZE, SIZE)
}

fn in_triangle(
    p: (f32, f32),
    a: (f32, f32),
    b: (f32, f32),
    c: (f32, f32),
) -> bool {
    let d1 = edge(p, a, b);
    let d2 = edge(p, b, c);
    let d3 = edge(p, c, a);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

fn edge(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    (p.0 - b.0) * (a.1 - b.1) - (a.0 - b.0) * (p.1 - b.1)
}

/// Best-effort detection of the system's APP color scheme — drives the
/// light/dark wallpaper pools (rotation::effective_dark). Returns `true`
/// when the system is in dark mode, `false` for light or when detection
/// fails. NOT used for the tray glyph: the tray sits on the taskbar/panel,
/// whose theme can differ from the app theme (see windows_taskbar_dark /
/// linux_panel_wants_light_glyph).
#[cfg(not(target_os = "macos"))]
pub fn is_system_dark() -> bool {
    #[cfg(target_os = "windows")]
    {
        // AppsUseLightTheme = 0 means dark, 1 means light. Missing key
        // → fall back to dark (matches Windows 11 default). Read via
        // winreg, NOT a `reg query` shell-out: a GUI-subsystem process
        // spawning a console child allocates a fresh console window, and
        // this runs from the 5-minute theme-follow task — users saw a
        // cmd window flash forever.
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let value: Result<u32, _> = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
            .and_then(|k| k.get_value("AppsUseLightTheme"));
        return match value {
            Ok(v) => v == 0,
            Err(_) => true,
        };
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // GNOME 42+: color-scheme is 'prefer-dark' | 'prefer-light' |
        // 'default'. KDE / others fall through to the dark default,
        // matching most desktop environments' shipped panels.
        if let Ok(out) = Command::new("gsettings")
            .args(["get", "org.gnome.desktop.interface", "color-scheme"])
            .output()
        {
            if out.status.success() {
                let raw = String::from_utf8_lossy(&out.stdout);
                if raw.contains("prefer-light") {
                    return false;
                }
                if raw.contains("prefer-dark") {
                    return true;
                }
            }
        }
        return true;
    }
    #[allow(unreachable_code)]
    true
}

/// macOS doesn't need startup detection — template mode handles
/// inversion regardless of the system theme. Returning `false` (the
/// dark-glyph variant) is a no-op since we always pass `true` (light
/// glyph) into `symbolic_icon` on macOS anyway.
#[cfg(target_os = "macos")]
pub fn is_system_dark() -> bool {
    true
}

/// Whether the Windows TASKBAR (where the tray lives) is dark. This is
/// `SystemUsesLightTheme`, NOT `AppsUseLightTheme` — "Windows mode" and
/// "app mode" are separate toggles that users routinely split, and the
/// tray glyph must contrast with the taskbar, not with app chrome.
/// Missing key → dark (Windows 11 default).
#[cfg(target_os = "windows")]
pub fn windows_taskbar_dark() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
    else {
        return true;
    };
    match key.get_value::<u32, _>("SystemUsesLightTheme") {
        Ok(v) => v == 0,
        // Very old builds only have the apps key.
        Err(_) => key
            .get_value::<u32, _>("AppsUseLightTheme")
            .map(|v| v == 0)
            .unwrap_or(true),
    }
}

/// Should the Linux tray use the light (white) glyph? The tray lives in
/// the panel/shell, whose theme is independent of the app theme, so this
/// is a per-desktop heuristic:
///   - KDE Plasma: the panel is painted by the Plasma theme. An explicit
///     breeze-dark/breeze-light pin in plasmarc decides directly; the
///     "default" theme follows the color scheme, whose window-background
///     luminance (kdeglobals) tells us light vs dark. Stock Plasma 6
///     (nothing written yet) is Breeze LIGHT — the old always-white
///     commitment painted an invisible glyph there.
///   - GNOME: the top bar stays dark even in light mode → white glyph.
///   - Everything else (wlroots bars, XFCE, …): overwhelmingly dark
///     panels → white glyph.
#[cfg(target_os = "linux")]
pub fn linux_panel_wants_light_glyph() -> bool {
    let de = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();
    if de.contains("kde") || de.contains("plasma") {
        if let Some(dark) = kde_panel_dark() {
            return dark;
        }
        // Nothing readable → stock Plasma 6 defaults, which are light.
        return false;
    }
    true
}

/// Best-effort KDE panel darkness. None when neither plasmarc nor
/// kdeglobals yields a signal.
#[cfg(target_os = "linux")]
fn kde_panel_dark() -> Option<bool> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
        })?;
    // Explicit Plasma-theme pin wins (System Settings → Plasma Style).
    if let Ok(text) = std::fs::read_to_string(config.join("plasmarc")) {
        if let Some(name) = ini_value(&text, "[Theme]", "name=") {
            let n = name.to_lowercase();
            if n.contains("dark") {
                return Some(true);
            }
            if n.contains("light") {
                return Some(false);
            }
            // "default" follows the color scheme — fall through.
        }
    }
    // Default theme paints the panel with the color scheme's window
    // background — its luminance is the ground truth.
    let text = std::fs::read_to_string(config.join("kdeglobals")).ok()?;
    if let Some(rgb) = ini_value(&text, "[Colors:Window]", "BackgroundNormal=") {
        if let Some(dark) = rgb_is_dark(&rgb) {
            return Some(dark);
        }
    }
    // Palette missing but a scheme name is present (older writes).
    ini_value(&text, "[General]", "ColorScheme=").map(|s| s.to_lowercase().contains("dark"))
}

/// Scan a KDE-style ini for `key` inside `section`. Sections end at the
/// next `[...]` header; keys are matched as line prefixes.
#[cfg(target_os = "linux")]
fn ini_value(text: &str, section: &str, key: &str) -> Option<String> {
    let mut in_section = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line == section;
            continue;
        }
        if in_section {
            if let Some(v) = line.strip_prefix(key) {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// "r,g,b" (0-255 decimals, KDE color format) → is it a dark color?
#[cfg(target_os = "linux")]
fn rgb_is_dark(rgb: &str) -> Option<bool> {
    let mut ch = rgb.split(',').map(|s| s.trim().parse::<u32>().ok());
    let r = ch.next()??;
    let g = ch.next()??;
    let b = ch.next()??;
    // Rec. 709 luma, integer-scaled; threshold at mid-gray.
    let luma = (2126 * r + 7152 * g + 722 * b) / 10000;
    Some(luma < 128)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn ini_value_scopes_to_section() {
        let text = "[Theme]\nname=breeze-dark\n\n[Other]\nname=nope\n";
        assert_eq!(ini_value(text, "[Theme]", "name=").as_deref(), Some("breeze-dark"));
        assert_eq!(ini_value(text, "[Other]", "name=").as_deref(), Some("nope"));
        assert_eq!(ini_value(text, "[Missing]", "name="), None);
    }

    #[test]
    fn ini_value_stops_at_next_section() {
        let text = "[Colors:Window]\nForegroundNormal=1,2,3\n[General]\nBackgroundNormal=9,9,9\n";
        assert_eq!(ini_value(text, "[Colors:Window]", "BackgroundNormal="), None);
    }

    #[test]
    fn rgb_is_dark_classifies_breeze_backgrounds() {
        assert_eq!(rgb_is_dark("239,240,241"), Some(false)); // Breeze light window bg
        assert_eq!(rgb_is_dark("42,46,50"), Some(true)); // Breeze dark window bg
        assert_eq!(rgb_is_dark("garbage"), None);
    }
}

/// Update the tray icon in response to a system theme change. Called
/// from the frontend's `useTrayThemeSync` hook on prefers-color-scheme
/// transitions. macOS short-circuits because template-mode inversion
/// is already handled by the OS — re-setting the icon there would just
/// trigger an unnecessary tray redraw.
#[tauri::command]
pub fn update_tray_theme(app: AppHandle, is_dark: bool) -> Result<(), String> {
    // No tray on mobile — accept and ignore so a shared frontend hook
    // can keep calling unconditionally.
    #[cfg(mobile)]
    {
        let _ = (app, is_dark);
        return Ok(());
    }
    #[cfg(all(desktop, target_os = "macos"))]
    {
        let _ = (app, is_dark);
        return Ok(());
    }
    // Linux: the webview's prefers-color-scheme flip usually accompanies a
    // global theme switch, so treat it as a wake-up and re-detect the
    // PANEL darkness (the app theme itself is the wrong signal — a light
    // app over a dark panel is a common KDE setup).
    #[cfg(all(desktop, target_os = "linux"))]
    {
        let _ = is_dark;
        let tray = app
            .tray_by_id("main")
            .ok_or_else(|| "tray 'main' not registered".to_string())?;
        let icon = symbolic_icon(!linux_panel_wants_light_glyph());
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(desktop, target_os = "windows"))]
    {
        // The webview reports the APP theme; the taskbar follows the
        // separate "Windows mode" toggle — re-read the registry instead.
        let _ = is_dark;
        let tray = app
            .tray_by_id("main")
            .ok_or_else(|| "tray 'main' not registered".to_string())?;
        let icon = symbolic_icon(!windows_taskbar_dark());
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        Ok(())
    }
}
