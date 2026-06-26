//! Live (animated) wallpaper support.
//!
//! Today this targets KDE Plasma: we ship a Plasma wallpaper *plugin*
//! (QML the shell renders itself, on X11 and Wayland) that runs the same
//! Flow/Waves/Aurora shaders as the in-app preview. Applying a live
//! wallpaper installs/refreshes that plugin, then points the desktop at it
//! via plasmashell's scripting API, feeding it the PatternConfig as JSON.
//!
//! The active spec is also mirrored into Settings (`live_wallpaper`) so the
//! background rotation / theme-follow tasks stand down while a live
//! wallpaper owns the desktop (they watch the settings channel).
//!
//! Other platforms return a clear "KDE only" error for now (the desktop
//! background-window and Android `WallpaperService` paths come later).

pub const PLUGIN_ID: &str = "me.oezcan.ambient";

// Desktop live-wallpaper delivery hook for Windows and macOS. Unlike KDE
// (a Plasma plugin the shell renders) and mobile (a WallpaperService), these
// platforms need a background window placed behind the desktop icons. On
// Windows that means parenting under WorkerW, on macOS it means a
// desktop-level NSWindow. Only the Tauri shell can create that window, so the
// shell registers a setter/clearer pair here at startup, mirroring
// desktop::OS_SETTER. The setter receives the finished spec JSON, the same
// PatternConfig plus quality the KDE plugin gets.
#[cfg(any(target_os = "windows", target_os = "macos"))]
type LiveSetter = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;
#[cfg(any(target_os = "windows", target_os = "macos"))]
type LiveClearer = Box<dyn Fn() + Send + Sync>;
#[cfg(any(target_os = "windows", target_os = "macos"))]
static LIVE_SETTER: std::sync::OnceLock<LiveSetter> = std::sync::OnceLock::new();
#[cfg(any(target_os = "windows", target_os = "macos"))]
static LIVE_CLEARER: std::sync::OnceLock<LiveClearer> = std::sync::OnceLock::new();

/// Register the Windows live-wallpaper delivery hooks (shell-only). Later
/// calls are ignored — one shell per process. `set` receives the spec JSON
/// and parents/refreshes the background window; `clear` tears it down.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn set_live_setter<S, C>(set: S, clear: C)
where
    S: Fn(&str) -> Result<(), String> + Send + Sync + 'static,
    C: Fn() + Send + Sync + 'static,
{
    let _ = LIVE_SETTER.set(Box::new(set));
    let _ = LIVE_CLEARER.set(Box::new(clear));
}

/// Build the live-wallpaper spec JSON from a PatternConfig. Cfg-agnostic so
/// both the KDE plugin and the Windows background window get an identical
/// spec. Shader patterns (flow/waves/aurora/dots/bokeh/stripes/geometric/
/// flower/mesh) and emoji are rendered live by the delivery layer from the
/// config; every other pattern animates as a slow drift over a pre-rendered
/// still, so render it now and stamp its path. The user's live render
/// quality (resolution + fps caps) is stamped in for both.
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
async fn build_spec(config: &serde_json::Value) -> Result<String, String> {
    let renders_live = matches!(
        config.get("type").and_then(|t| t.as_str()),
        Some("flow")
            | Some("waves")
            | Some("aurora")
            | Some("dots")
            | Some("bokeh")
            | Some("stripes")
            | Some("geometric")
            | Some("flower")
            | Some("mesh")
            | Some("emoji")
    );
    let mut spec_value = if renders_live {
        config.clone()
    } else {
        let cfg: crate::renderer::PatternConfig = serde_json::from_value(config.clone())
            .map_err(|e| format!("parse pattern config: {e}"))?;
        let wallpaper = crate::renderer::apply_pattern(cfg).await?;
        let mut s = config.clone();
        if let Some(obj) = s.as_object_mut() {
            obj.insert(
                "image".to_string(),
                serde_json::Value::String(wallpaper.path),
            );
        }
        s
    };
    let (max_edge, fps) = crate::state::settings()
        .get()
        .await
        .live_wallpaper_quality
        .resolve();
    if let Some(obj) = spec_value.as_object_mut() {
        obj.insert("maxRenderEdge".to_string(), serde_json::json!(max_edge));
        obj.insert("fps".to_string(), serde_json::json!(fps));
    }
    serde_json::to_string(&spec_value).map_err(|e| format!("serialize live spec: {e}"))
}

/// Mark a live wallpaper active in settings so rotation / theme-follow stand
/// down (they watch this channel).
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
async fn mark_active(config: &serde_json::Value) {
    let _ = crate::state::settings()
        .patch(serde_json::json!({ "liveWallpaper": config }))
        .await;
}

/// Set a generative live wallpaper from `config` (a PatternConfig as JSON).
pub async fn apply_live_pattern(config: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        if !is_kde(&desktop) {
            return Err(
                "Live wallpaper is currently supported on KDE Plasma, Windows, and macOS only."
                    .to_string(),
            );
        }
        let spec = build_spec(&config).await?;
        set_kde_live(&spec)?;
        // Mirror onto the lock screen when the user opted in. Best-effort —
        // a greeter-config failure shouldn't fail the desktop apply.
        if crate::state::settings().get().await.lockscreen {
            let _ = set_kde_live_lockscreen(&spec);
        }
        mark_active(&config).await;
        Ok(())
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let setter = LIVE_SETTER
            .get()
            .ok_or_else(|| "live wallpaper delivery not initialized".to_string())?;
        let spec = build_spec(&config).await?;
        setter(&spec)?;
        mark_active(&config).await;
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = config;
        Err("Live wallpaper is currently supported on KDE Plasma, Windows, and macOS only.".to_string())
    }
}

/// Turn off the live wallpaper and revert to a static wallpaper.
pub async fn clear_live_wallpaper() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = clear_kde_live();
        // Revert the lock screen too if we were mirroring there.
        if crate::state::settings().get().await.lockscreen {
            clear_kde_live_lockscreen();
        }
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if let Some(clear) = LIVE_CLEARER.get() {
            clear();
        }
    }
    let _ = crate::state::settings()
        .patch(serde_json::json!({ "liveWallpaper": serde_json::Value::Null }))
        .await;
    Ok(())
}

// --- KDE Plasma ------------------------------------------------------------

#[cfg(target_os = "linux")]
fn is_kde(desktop: &str) -> bool {
    desktop.split(':').any(|tok| {
        let t = tok.trim();
        t.eq_ignore_ascii_case("KDE") || t.eq_ignore_ascii_case("plasma")
    })
}

// Bundled Plasma wallpaper plugin, embedded so a release build is
// self-contained (the package lives outside src-tauri/). install_plugin
// always rewrites these on apply, so there's no version marker to maintain.
#[cfg(target_os = "linux")]
struct Asset {
    rel: &'static str,
    bytes: &'static [u8],
}

#[cfg(target_os = "linux")]
const PLUGIN_ROOT: &str = "../../../plasma/wallpapers/me.oezcan.ambient";

#[cfg(target_os = "linux")]
const ASSETS: &[Asset] = &[
    Asset {
        rel: "metadata.json",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/metadata.json"
        )),
    },
    Asset {
        rel: "contents/config/main.xml",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/config/main.xml"
        )),
    },
    Asset {
        rel: "contents/ui/main.qml",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/ui/main.qml"
        )),
    },
    Asset {
        rel: "contents/shaders/wallpaper.vert.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/wallpaper.vert.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/flow.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/flow.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/waves.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/waves.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/aurora.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/aurora.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/bokeh.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/bokeh.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/stripes.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/stripes.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/geometric.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/geometric.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/flower.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/flower.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/mesh.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/mesh.frag.qsb"
        )),
    },
];

#[cfg(target_os = "linux")]
fn plugin_dir() -> Result<std::path::PathBuf, String> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| {
            std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))
        })
        .ok_or_else(|| "neither XDG_DATA_HOME nor HOME is set".to_string())?;
    Ok(base.join("plasma/wallpapers").join(PLUGIN_ID))
}

/// Write the bundled plugin into the user's Plasma wallpapers dir. No skip,
/// no marker: it ALWAYS overwrites every embedded asset, so a rebaked shader
/// or edited QML can never be left stale — the live wallpaper always gets the
/// current build's files.
///
/// Always returns `Ok(true)` so the caller reloads plasmashell, which caches
/// the plugin's QML + compiled shaders per session; an in-place file rewrite
/// alone won't show until the shell restarts.
#[cfg(target_os = "linux")]
pub fn install_plugin() -> Result<bool, String> {
    let _ = PLUGIN_ROOT; // documents the embedded source root
    let dir = plugin_dir()?;
    for asset in ASSETS {
        let dest = dir.join(asset.rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {parent:?}: {e}"))?;
        }
        std::fs::write(&dest, asset.bytes)
            .map_err(|e| format!("write {dest:?}: {e}"))?;
    }
    Ok(true)
}

/// Best-effort restart of plasmashell so a freshly-upgraded wallpaper plugin
/// is reloaded — Plasma caches a plugin's QML per shell process for the whole
/// session, so an in-place file upgrade alone won't take effect. Plasma 6
/// runs plasmashell as a systemd user service; fall back to kquitapp6 +
/// kstart for non-systemd sessions. Never fatal: the apply already
/// succeeded, so at worst the new look waits for the next login.
#[cfg(target_os = "linux")]
fn reload_plasmashell() {
    let via_systemd = std::process::Command::new("systemctl")
        .args(["--user", "restart", "plasma-plasmashell.service"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if via_systemd {
        return;
    }
    let _ = std::process::Command::new("kquitapp6")
        .arg("plasmashell")
        .status();
    let _ = std::process::Command::new("kstart")
        .arg("plasmashell")
        .spawn();
}

#[cfg(target_os = "linux")]
fn qdbus_bin() -> Option<&'static str> {
    for bin in ["qdbus6", "qdbus-qt6", "qdbus"] {
        let ok = std::process::Command::new(bin)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Some(bin);
        }
    }
    None
}

/// Run a Plasma scripting snippet through plasmashell's D-Bus interface —
/// the same mechanism `plasma-apply-wallpaperimage` uses internally.
#[cfg(target_os = "linux")]
fn evaluate_script(script: &str) -> Result<(), String> {
    let bin = qdbus_bin()
        .ok_or_else(|| "qdbus (qdbus6/qdbus-qt6/qdbus) not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args([
            "org.kde.plasmashell",
            "/PlasmaShell",
            "org.kde.PlasmaShell.evaluateScript",
            script,
        ])
        .output()
        .map_err(|e| format!("{bin} not runnable: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{bin} evaluateScript failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

#[cfg(target_os = "linux")]
fn set_kde_live(spec_json: &str) -> Result<(), String> {
    let upgraded = install_plugin()?;
    // spec_json is JSON (double quotes only) → safe inside a single-quoted
    // JS string; escape backslashes/quotes defensively anyway.
    let safe = spec_json.replace('\\', "\\\\").replace('\'', "\\'");
    let script = format!(
        "var ds = desktops();\n\
         for (var i = 0; i < ds.length; i++) {{\n\
        \x20   var d = ds[i];\n\
        \x20   d.currentConfigGroup = [\"Wallpaper\", \"{PLUGIN_ID}\", \"General\"];\n\
        \x20   d.writeConfig(\"Spec\", '{safe}');\n\
        \x20   d.wallpaperPlugin = \"{PLUGIN_ID}\";\n\
         }}"
    );
    evaluate_script(&script)?;
    // The config is persisted now; if we just upgraded the plugin, reload the
    // shell so it drops the old cached QML and renders the new build.
    if upgraded {
        reload_plasmashell();
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn clear_kde_live() -> Result<(), String> {
    evaluate_script(
        "var ds = desktops(); \
         for (var i = 0; i < ds.length; i++) { ds[i].wallpaperPlugin = \"org.kde.image\"; }",
    )
}

/// Mirror the live wallpaper onto the KDE lock screen. The greeter
/// (kscreenlocker) drives its background through the same Plasma wallpaper
/// plugin system as the desktop, so pointing it at our plugin + writing the
/// same Spec makes the lock screen animate too. kscreenlocker reads
/// kscreenlockerrc when it locks, so no reload is needed. Plain static
/// wallpapers keep going through desktop::set_lockscreen (org.kde.image).
#[cfg(target_os = "linux")]
fn set_kde_live_lockscreen(spec_json: &str) -> Result<(), String> {
    use std::process::Command;
    for tool in ["kwriteconfig6", "kwriteconfig5"] {
        let plugin_ok = Command::new(tool)
            .args([
                "--file",
                "kscreenlockerrc",
                "--group",
                "Greeter",
                "--key",
                "WallpaperPlugin",
                PLUGIN_ID,
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !plugin_ok {
            continue;
        }
        let spec_ok = Command::new(tool)
            .args([
                "--file",
                "kscreenlockerrc",
                "--group",
                "Greeter",
                "--group",
                "Wallpaper",
                "--group",
                PLUGIN_ID,
                "--group",
                "General",
                "--key",
                "Spec",
                spec_json,
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if spec_ok {
            return Ok(());
        }
    }
    Err("no kwriteconfig6/5 available to set the live lock screen".to_string())
}

/// Revert the lock screen to the static image plugin when live is turned off
/// (the next static apply re-points org.kde.image at a fresh PNG).
#[cfg(target_os = "linux")]
fn clear_kde_live_lockscreen() {
    use std::process::Command;
    for tool in ["kwriteconfig6", "kwriteconfig5"] {
        let ok = Command::new(tool)
            .args([
                "--file",
                "kscreenlockerrc",
                "--group",
                "Greeter",
                "--key",
                "WallpaperPlugin",
                "org.kde.image",
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            break;
        }
    }
}
