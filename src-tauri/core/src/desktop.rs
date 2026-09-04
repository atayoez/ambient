// Desktop wallpaper application + the side-effects that follow it:
//   1. OS wallpaper-set (cross-platform via `wallpaper` crate, or our
//      own COSMIC-specific RON write on Linux under COSMIC).
//   2. Stamp settings.lastApplied for the "currently applied" indicator
//      that survives webview destroy/rebuild.
//   3. Mirror the wallpaper to the lock screen when settings.lockscreen
//      is on (KDE Plasma; no-op on other DEs / OSes).
//   4. Promote the entry to the head of the library so the grid is
//      sorted by most-recently-applied.
//   5. Fire a `wallpaper-applied` app event through the shell's event
//      sink. (The shell derives the tray-mode system notification from
//      this same event — see the sink closure in src-tauri's lib.rs.)
//
// (Per-wallpaper light/dark eligibility now lives as a tag on each
// library entry — see WallpaperMode + rotation.rs — replacing the old
// single themeFollow{Light,Dark}Path slots.)
//
// Phase 4 consolidated all of this on the Rust side. Pre-Phase-4 the
// notification + library-promote + slot-capture lived in JS, which
// silently broke whenever the user was in tray-only mode (webview
// destroyed → no JS code running).

use std::path::PathBuf;

use crate::library_store::LibraryOp;

// ---------------------------------------------------------------------
// Mobile OS-setter hook. Android/iOS can only reach their wallpaper
// service from platform code, so the mobile shell registers a setter at
// startup (the Tauri shell wires its wallpaper plugin in here) and
// apply_os routes through it on those targets. Mirrors events::set_sink.
// ---------------------------------------------------------------------
#[cfg(any(target_os = "android", target_os = "ios"))]
static OS_SETTER: std::sync::OnceLock<Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>> =
    std::sync::OnceLock::new();

/// Register the platform wallpaper setter (mobile shells only). Later
/// calls are ignored — one shell per process.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn set_os_setter<F>(f: F)
where
    F: Fn(&str) -> Result<(), String> + Send + Sync + 'static,
{
    let _ = OS_SETTER.set(Box::new(f));
}

/// Full apply pipeline. Called by both the shell's set_wallpaper
/// command wrapper (frontend invokes) and the rotation task
/// (background tick).
///
/// Always applies the SDR PNG. (HDR AVIF wallpaper output was removed
/// 2026-06-03 — the desktop background layer is SDR-composited on every
/// current OS, so a PQ/BT.2020 file renders dark as a wallpaper.)
pub async fn apply_wallpaper(path: &str) -> Result<(), String> {
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

    // A live (animated) wallpaper owns the desktop: tear it down first, or
    // the still would land UNDER the live layer on the background-window
    // platforms (Windows / macOS / Linux layer-shell) — and settings would
    // keep saying "live", which parks the rotation + theme-follow tasks. On
    // KDE the static apply already swaps the plugin back; here it just keeps
    // the recorded state honest.
    if crate::state::settings().get().await.live_wallpaper.is_some() {
        let _ = crate::live::clear_live_wallpaper().await;
    }

    apply_os(&abs_str)?;

    // Mirror to the lock screen when enabled (KDE; no-op elsewhere).
    // Best-effort — a lock-screen failure shouldn't fail the apply.
    if crate::state::settings().get().await.lockscreen {
        let _ = set_lockscreen(&abs_str);
    }

    record_post_apply(&abs_str).await;
    crate::events::emit("wallpaper-applied", &abs_str);

    Ok(())
}

/// Mirror the wallpaper onto the OS lock screen. Only KDE Plasma exposes
/// a scriptable lock-screen wallpaper (kscreenlocker + the org.kde.image
/// plugin); other Linux DEs and non-Linux OSes have no stable mechanism,
/// so this is a no-op there.
#[cfg(target_os = "linux")]
fn set_lockscreen(abs_path: &str) -> Result<(), String> {
    use std::process::Command;
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !matches!(linux_strategy(&desktop), LinuxWallpaper::Kde) {
        return Ok(());
    }
    // kwriteconfig6 (Plasma 6) preferred; fall back to kwriteconfig5.
    for tool in ["kwriteconfig6", "kwriteconfig5"] {
        if let Ok(out) = Command::new(tool)
            .args([
                "--file",
                "kscreenlockerrc",
                "--group",
                "Greeter",
                "--group",
                "Wallpaper",
                "--group",
                "org.kde.image",
                "--group",
                "General",
                "--key",
                "Image",
                abs_path,
            ])
            .output()
        {
            if out.status.success() {
                return Ok(());
            }
        }
    }
    Err("no kwriteconfig6/5 available to set the lock screen".to_string())
}

#[cfg(not(target_os = "linux"))]
fn set_lockscreen(_abs_path: &str) -> Result<(), String> {
    Ok(())
}

fn apply_os(abs_str: &str) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return match OS_SETTER.get() {
            Some(set) => set(abs_str),
            None => Err("no platform wallpaper setter registered".to_string()),
        };
    }

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

    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "ios")))]
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

async fn record_post_apply(abs_str: &str) {
    // Stamp lastApplied so the "currently applied" indicator + the
    // theme-check's "does the current wallpaper still fit?" logic survive
    // a webview destroy/rebuild.
    let mut patch = serde_json::Map::new();
    patch.insert(
        "lastApplied".to_string(),
        serde_json::Value::String(abs_str.to_string()),
    );
    let _ = crate::state::settings()
        .patch(serde_json::Value::Object(patch))
        .await;

    // Promote to head of library — no-op when not in library (the
    // typical mid-fetch case where the prepend hasn't committed yet).
    let _ = crate::state::library()
        .patch(LibraryOp::PromoteToHead {
            path: abs_str.to_string(),
        })
        .await;
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
