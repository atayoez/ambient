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

/// Set a generative live wallpaper from `config` (a PatternConfig as JSON).
pub async fn apply_live_pattern(config: serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
        if !is_kde(&desktop) {
            return Err(
                "Live wallpaper is currently supported on KDE Plasma only.".to_string(),
            );
        }
        // Shader patterns (flow/waves/aurora/dots) and emoji are rendered
        // live by the plugin from the config; every other pattern animates as
        // a slow drift over a rendered still, so render it now and pass the
        // plugin its path.
        let renders_in_plugin = matches!(
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
        let mut spec_value = if renders_in_plugin {
            config.clone()
        } else {
            let cfg: crate::renderer::PatternConfig =
                serde_json::from_value(config.clone())
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
        // Stamp the user's live render quality (resolution + fps caps) into
        // the spec so the plugin's shader renders at the chosen quality.
        let (max_edge, fps) = crate::state::settings()
            .get()
            .await
            .live_wallpaper_quality
            .resolve();
        if let Some(obj) = spec_value.as_object_mut() {
            obj.insert("maxRenderEdge".to_string(), serde_json::json!(max_edge));
            obj.insert("fps".to_string(), serde_json::json!(fps));
        }
        let spec = serde_json::to_string(&spec_value)
            .map_err(|e| format!("serialize live spec: {e}"))?;
        set_kde_live(&spec)?;
        // Mark active so rotation/theme-follow stand down (they watch this).
        let _ = crate::state::settings()
            .patch(serde_json::json!({ "liveWallpaper": config }))
            .await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = config;
        Err("Live wallpaper is currently supported on KDE Plasma only.".to_string())
    }
}

/// Turn off the live wallpaper and revert to a static wallpaper.
pub async fn clear_live_wallpaper() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = clear_kde_live();
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
// self-contained (the package lives outside src-tauri/). Bump
// PLUGIN_VERSION whenever any embedded file changes so installed copies
// get refreshed on the next apply.
#[cfg(target_os = "linux")]
const PLUGIN_VERSION: &str = "8";

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

/// Write the bundled plugin into the user's Plasma wallpapers dir, unless an
/// up-to-date copy is already there. Idempotent (version-marker gated).
///
/// Returns `Ok(true)` when it *replaced* an older install: the running
/// plasmashell still holds that version's QML in its per-session component
/// cache, so the caller must reload it or new pattern types render blank. A
/// first install (no prior marker) returns `Ok(false)` — plasmashell loads
/// our plugin cleanly on the apply that follows.
#[cfg(target_os = "linux")]
pub fn install_plugin() -> Result<bool, String> {
    let _ = PLUGIN_ROOT; // documents the embedded source root
    let dir = plugin_dir()?;
    let marker = dir.join(".ambient-plugin-version");
    let existing = std::fs::read_to_string(&marker)
        .ok()
        .map(|v| v.trim().to_string());
    if existing.as_deref() == Some(PLUGIN_VERSION) {
        return Ok(false);
    }
    for asset in ASSETS {
        let dest = dir.join(asset.rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {parent:?}: {e}"))?;
        }
        std::fs::write(&dest, asset.bytes)
            .map_err(|e| format!("write {dest:?}: {e}"))?;
    }
    let _ = std::fs::write(&marker, PLUGIN_VERSION);
    Ok(existing.is_some())
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
