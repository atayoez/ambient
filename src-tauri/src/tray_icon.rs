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

/// Best-effort startup detection of the system's color scheme. Used to
/// pick the right initial tray-icon variant before the frontend has
/// matchMedia available (i.e. cold launch, window still painting).
/// Returns `true` when the system is in dark mode, `false` for light or
/// when detection fails. macOS callers can ignore this and rely on
/// template inversion.
#[cfg(not(target_os = "macos"))]
pub fn is_system_dark() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // AppsUseLightTheme = 0 means dark, 1 means light. Missing key
        // → fall back to dark (matches Windows 11 default + the prior
        // icon color).
        let out = Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                "/v",
                "AppsUseLightTheme",
            ])
            .output();
        if let Ok(out) = out {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(tok) = stdout
                    .lines()
                    .find_map(|line| line.split_whitespace().find(|t| t.starts_with("0x")))
                {
                    let v = u32::from_str_radix(tok.trim_start_matches("0x"), 16).unwrap_or(0);
                    return v == 0;
                }
            }
        }
        return true;
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

/// Should the Linux tray use the light (white) glyph? On Linux the tray
/// lives in the panel/shell, whose theme is independent of everything we
/// can reliably read:
///   - `prefers-color-scheme` reflects the webview/GTK app theme, not the
///     panel (a light app theme over a dark panel is a common KDE setup).
///   - kdeglobals' color scheme describes window chrome, not the Plasma
///     panel style — they routinely disagree (light windows, dark panel).
/// There's no portable, dependable signal for the actual panel color, and
/// guessing wrong paints a black glyph into a row of white panel icons.
/// Since Linux panels are overwhelmingly dark (GNOME top bar, default +
/// dark Breeze, most wlroots bars), we commit to the white glyph rather
/// than detect. macOS uses template inversion and Windows reads the
/// registry, so this only governs Linux.
#[cfg(target_os = "linux")]
pub fn linux_panel_wants_light_glyph() -> bool {
    true
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
    #[cfg(all(desktop, not(target_os = "macos")))]
    {
        // On Linux the passed `is_dark` reflects the webview's
        // prefers-color-scheme, which is the wrong signal for the panel
        // (see linux_panel_dark). Re-detect the panel theme and ignore
        // it; the call still usefully serves as a "theme may have
        // changed, refresh" trigger. Windows' tray host tracks the same
        // theme the registry reports, so the web signal is fine there.
        #[cfg(target_os = "linux")]
        let want_light_glyph = {
            let _ = is_dark;
            linux_panel_wants_light_glyph()
        };
        #[cfg(not(target_os = "linux"))]
        let want_light_glyph = is_dark;

        let tray = app
            .tray_by_id("main")
            .ok_or_else(|| "tray 'main' not registered".to_string())?;
        let icon = symbolic_icon(!want_light_glyph);
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        Ok(())
    }
}
