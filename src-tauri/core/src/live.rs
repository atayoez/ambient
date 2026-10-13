//! Live (animated) wallpaper support.
//!
//! Two delivery mechanisms, one spec (the PatternConfig as JSON plus the
//! user's render-quality caps):
//!
//! * **KDE Plasma** — we ship a Plasma wallpaper *plugin* (QML the shell
//!   renders itself) running the same shaders as the in-app preview.
//!   Applying installs/refreshes that plugin, then points the desktop at it
//!   via plasmashell's scripting API. plasmashell persists it across logins.
//! * **Everything else on desktop** — a background webview *window* the shell
//!   places under the desktop: WorkerW on Windows, a desktop-level NSWindow
//!   on macOS, a Wayland layer-shell surface on Linux (COSMIC, Sway,
//!   Hyprland, …), and on GNOME a window Ambient's GNOME Shell extension
//!   moves onto the desktop layer. The shell registers that window's setter/clearer here at
//!   startup (`set_live_setter`), and re-creates it after a restart via
//!   `restore_if_active` since it dies with the process.
//!
//! The active spec is also mirrored into Settings (`live_wallpaper`) so the
//! background rotation / theme-follow tasks stand down while a live
//! wallpaper owns the desktop (they watch the settings channel), and so a
//! static apply knows to tear the live layer down first (desktop.rs).
//!
//! Mobile returns a clear "unsupported" error (Android `WallpaperService`
//! is a later item).

pub const PLUGIN_ID: &str = "me.oezcan.ambient";

// Desktop live-wallpaper delivery hook for the background-window platforms
// (Windows, macOS, non-KDE Linux). Unlike KDE (a Plasma plugin the shell
// renders) and mobile (a WallpaperService), these need a window placed under
// the desktop: WorkerW parenting on Windows, a desktop-level NSWindow on
// macOS, a layer-shell surface on Linux. Only the Tauri shell can create that
// window, so the shell registers a setter/clearer pair here at startup,
// mirroring desktop::OS_SETTER. The setter receives the finished spec JSON,
// the same PatternConfig plus quality the KDE plugin gets.
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
type LiveSetter = Box<dyn Fn(&str) -> Result<(), String> + Send + Sync>;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
type LiveClearer = Box<dyn Fn() + Send + Sync>;
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
static LIVE_SETTER: std::sync::OnceLock<LiveSetter> = std::sync::OnceLock::new();
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
static LIVE_CLEARER: std::sync::OnceLock<LiveClearer> = std::sync::OnceLock::new();

/// Register the background-window live-wallpaper delivery hooks (shell-only).
/// Later calls are ignored — one shell per process. `set` receives the spec
/// JSON and creates/refreshes the background window; `clear` tears it down.
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
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
/// spec. Every pattern type is rendered live by the delivery layer straight
/// from the config — shader patterns (flow/waves/aurora/dots/bokeh/stripes/
/// geometric/flower/mesh) via their fragment shaders, emoji via glyph tiles
/// — so the spec is just the config plus the user's live render quality
/// (resolution + fps caps).
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
async fn build_spec(config: &serde_json::Value) -> Result<String, String> {
    if is_video_spec(config) {
        return build_video_spec(config).await;
    }
    let mut spec_value = config.clone();
    // Emoji renders in the delivery layer (QML Text/Image tiles). Ship the
    // Fluent 3D PNG for every glyph alongside the spec so the plugin shows
    // the same 3D art as the in-app renderer — a bare Text glyph depends on
    // whatever color-emoji font the system has and looks flat on Linux.
    if config.get("type").and_then(|t| t.as_str()) == Some("emoji") {
        let glyphs: Vec<String> = config
            .get("emojis")
            .and_then(|e| e.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        if !glyphs.is_empty() {
            let paths = crate::emojis::export_pngs(&glyphs).await;
            if let Some(obj) = spec_value.as_object_mut() {
                obj.insert("emojiImages".to_string(), serde_json::json!(paths));
            }
        }
    }

    let settings = crate::state::settings().get().await;
    let (max_edge, fps) = settings.live_wallpaper_quality.resolve();
    if let Some(obj) = spec_value.as_object_mut() {
        obj.insert("maxRenderEdge".to_string(), serde_json::json!(max_edge));
        obj.insert("fps".to_string(), serde_json::json!(fps));
        // Global animation-speed multiplier — the delivery layers (QML
        // Timer, WebGL runner, emoji drift) scale their clocks by it.
        obj.insert("speed".to_string(), serde_json::json!(settings.animation_speed));
        // Live-clock overlay — every delivery draws it (Widgets.qml in the
        // Plasma plugin, widgets/WidgetLayer in the desktop-layer webview).
        obj.insert(
            "clock".to_string(),
            serde_json::to_value(settings.live_clock).unwrap_or(serde_json::Value::Null),
        );
        // Weather / calendar / countdown / note + the shared widget style,
        // drawn by the same deliveries as the clock.
        obj.insert("widgets".to_string(), widgets_value(&settings));
    }

    // Resolve the per-type knobs into the shader's p1/p2/p3 uniforms (and
    // the matrix text glyph slots) HERE, so the KDE plugin's QML reads
    // plain numbers instead of carrying its own copy of the knob→uniform
    // mapping and defaults. One resolver (renderer::knobs, driven by
    // patternManifest.json) serves the GPU still path and every live spec.
    if let Ok(cfg) = serde_json::from_value::<crate::renderer::PatternConfig>(config.clone()) {
        let (p1, p2, p3) = crate::renderer::knobs(&cfg);
        let slots: Vec<f32> = crate::renderer::matrix_text_slots(cfg.matrix_text.as_deref())
            .into_iter()
            .flatten()
            .collect();
        if let Some(obj) = spec_value.as_object_mut() {
            obj.insert("p1".to_string(), serde_json::json!(p1));
            obj.insert("p2".to_string(), serde_json::json!(p2));
            obj.insert("p3".to_string(), serde_json::json!(p3));
            obj.insert("textSlots".to_string(), serde_json::json!(slots));
        }
    }
    serde_json::to_string(&spec_value).map_err(|e| format!("serialize live spec: {e}"))
}

/// Video / GIF spec: `{ "kind": "video", "video": "/abs/path" }`, stamped
/// with what the delivery layers need — `format` ("gif" plays as an animated
/// image, everything else through the media stack), the speed multiplier
/// (playback rate) and the clock overlay. The render-quality caps don't apply:
/// a clip plays at its own resolution and frame rate.
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
async fn build_video_spec(config: &serde_json::Value) -> Result<String, String> {
    let path = config
        .get("video")
        .and_then(|v| v.as_str())
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "video live wallpaper has no file".to_string())?;
    if !std::path::Path::new(path).is_file() {
        return Err(format!("The video file is gone: {path}"));
    }
    let settings = crate::state::settings().get().await;
    let spec = serde_json::json!({
        "kind": "video",
        "video": path,
        "format": video_format(std::path::Path::new(path)),
        "speed": settings.animation_speed,
        "clock": serde_json::to_value(settings.live_clock).unwrap_or(serde_json::Value::Null),
        "widgets": widgets_value(&settings),
    });
    serde_json::to_string(&spec).map_err(|e| format!("serialize live spec: {e}"))
}

#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
fn widgets_value(settings: &crate::types::Settings) -> serde_json::Value {
    serde_json::to_value(&settings.live_widgets).unwrap_or(serde_json::Value::Null)
}

/// Whether a live spec is a video / GIF (`kind: "video"`) rather than a
/// PatternConfig.
pub fn is_video_spec(config: &serde_json::Value) -> bool {
    config.get("kind").and_then(|k| k.as_str()) == Some("video")
}

/// File extensions the video importer accepts (lower-case). GIF plays as an
/// animated image; the rest go through the platform media stack (WebView2 /
/// WKWebView / WebKitGTK+GStreamer in the desktop-layer webview, QtMultimedia
/// in the KDE plugin), so what actually decodes depends on the codecs there.
pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "webm", "mov", "mkv", "gif"];

fn video_format(path: &std::path::Path) -> &'static str {
    let gif = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("gif"));
    if gif { "gif" } else { "video" }
}

/// Where imported clips live: `<app data>/live`. Inside the asset-protocol
/// scope (tauri.conf.json), so the webview can stream them, and owned by us,
/// so pruning old imports never touches the user's own files.
fn video_dir() -> std::path::PathBuf {
    crate::state::data_dir().join("live")
}

/// Copy a user-picked video / GIF into the app's live dir and return the
/// copy's absolute path — the value a `{ kind: "video", video }` spec
/// carries. Copying (rather than pointing at the original) keeps the live
/// wallpaper working when the user moves or deletes their file, and keeps
/// every played path inside the webview's asset scope.
///
/// The copy is named by a hash of the source path + size + mtime, so
/// re-importing the same file reuses it. Older imports are pruned, except
/// the clip the active live wallpaper plays: only one spare copy of a
/// potentially large file is ever kept around.
pub async fn import_video(src: std::path::PathBuf) -> Result<String, String> {
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .filter(|e| VIDEO_EXTENSIONS.contains(&e.as_str()))
        .ok_or_else(|| format!("Pick a video or GIF ({}).", VIDEO_EXTENSIONS.join(", ")))?;
    let meta = std::fs::metadata(&src).map_err(|e| format!("read {src:?}: {e}"))?;
    if !meta.is_file() || meta.len() == 0 {
        return Err(format!("{src:?} is not a video file"));
    }

    let dir = video_dir();
    let dest = dir.join(import_name(&src, &meta, &ext));
    let active = crate::state::settings()
        .get()
        .await
        .live_wallpaper
        .filter(is_video_spec)
        .and_then(|v| {
            v.get("video")
                .and_then(|p| p.as_str())
                .map(std::path::PathBuf::from)
        });

    let copy_src = src.clone();
    let copy_dest = dest.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
        if !copy_dest.is_file() {
            // Copy to a temp name first so a cancelled / failed copy never
            // leaves a truncated clip under the final name.
            let tmp = copy_dest.with_extension("part");
            std::fs::copy(&copy_src, &tmp).map_err(|e| format!("copy {copy_src:?}: {e}"))?;
            std::fs::rename(&tmp, &copy_dest).map_err(|e| format!("save {copy_dest:?}: {e}"))?;
        }
        prune_imports(&dir, &copy_dest, active.as_deref());
        Ok(())
    })
    .await
    .map_err(|e| format!("import task: {e}"))??;

    Ok(dest.to_string_lossy().into_owned())
}

fn import_name(src: &std::path::Path, meta: &std::fs::Metadata, ext: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    src.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    format!("video-{:016x}.{ext}", h.finish())
}

/// Delete every file in the live dir except `keep` and the active clip.
fn prune_imports(dir: &std::path::Path, keep: &std::path::Path, active: Option<&std::path::Path>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep || Some(path.as_path()) == active || !path.is_file() {
            continue;
        }
        let _ = std::fs::remove_file(&path);
    }
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
///
/// KDE Plasma gets the bundled wallpaper plugin; every other desktop OS gets
/// the background window the shell registered via `set_live_setter`. The
/// setter reports its own "not possible here" (e.g. a Wayland compositor with
/// no layer-shell that isn't GNOME, or GNOME before its extension is running)
/// as the error the UI shows.
pub async fn apply_live_pattern(config: serde_json::Value) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        let spec = build_spec(&config).await?;
        #[cfg(target_os = "linux")]
        {
            if is_kde(&current_desktop()) {
                set_kde_live(&spec)?;
                // Mirror onto the lock screen when the user opted in.
                // Best-effort — a greeter-config failure shouldn't fail the
                // desktop apply.
                if crate::state::settings().get().await.lockscreen {
                    let _ = set_kde_live_lockscreen(&spec);
                }
                mark_active(&config).await;
                return Ok(());
            }
        }
        let setter = LIVE_SETTER
            .get()
            .ok_or_else(|| "live wallpaper delivery not initialized".to_string())?;
        setter(&spec)?;
        mark_active(&config).await;
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = config;
        Err("Live wallpaper is supported on desktop only (Windows, macOS, Linux).".to_string())
    }
}

/// Turn off the live wallpaper and revert to a static wallpaper.
pub async fn clear_live_wallpaper() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if is_kde(&current_desktop()) {
            let _ = clear_kde_live();
            // Revert the lock screen too if we were mirroring there.
            if crate::state::settings().get().await.lockscreen {
                clear_kde_live_lockscreen();
            }
        } else if let Some(clear) = LIVE_CLEARER.get() {
            clear();
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

/// Re-apply the recorded live wallpaper if there is one — after a process
/// restart, or after the compositor closed the Linux layer surface (output
/// removed). The background-window deliveries (Windows / macOS / Linux
/// layer-shell) die with the process, so without this an autostarted Ambient
/// would leave the desktop on the OS's plain wallpaper while settings still
/// say a live one is active (and rotation stays stood down). KDE is skipped
/// on purpose: plasmashell owns that plugin and restores it itself, and
/// re-applying would reinstall the plugin + restart the shell on every login.
///
/// A failure is logged, not fatal, and leaves the recorded state alone: the
/// user's live config survives e.g. one login into a desktop that can't host
/// it, and the next static apply clears it explicitly.
pub async fn restore_if_active() {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        #[cfg(target_os = "linux")]
        {
            if is_kde(&current_desktop()) {
                return;
            }
        }
        let Some(spec) = crate::state::settings().get().await.live_wallpaper else {
            return;
        };
        if let Err(e) = apply_live_pattern(spec).await {
            tracing::warn!(error = %e, "could not restore the live wallpaper after restart");
        }
    }
}

// --- KDE Plasma ------------------------------------------------------------

#[cfg(target_os = "linux")]
fn current_desktop() -> String {
    std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default()
}

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
        rel: "contents/ui/Widgets.qml",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/ui/Widgets.qml"
        )),
    },
    Asset {
        rel: "contents/ui/VideoLayer.qml",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/ui/VideoLayer.qml"
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
    Asset {
        rel: "contents/shaders/matrix.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/matrix.frag.qsb"
        )),
    },
    Asset {
        rel: "contents/shaders/crt.frag.qsb",
        bytes: include_bytes!(concat!(
            "../../../plasma/wallpapers/me.oezcan.ambient/contents/shaders/crt.frag.qsb"
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

/// Sync the bundled plugin into the user's Plasma wallpapers dir. Every
/// embedded asset is compared byte-for-byte with what's on disk and written
/// only when it differs (or is missing), so a rebaked shader or edited QML
/// can never be left stale while an unchanged plugin costs nothing.
///
/// Returns whether anything was written. Only then does the caller reload
/// plasmashell — it caches the plugin's QML + compiled shaders per session,
/// so a changed file won't show until the shell restarts, but a mere spec
/// re-apply (speed slider, quality, clock) must NOT restart the shell: the
/// plugin re-reads its `Spec` config live.
#[cfg(target_os = "linux")]
pub fn install_plugin() -> Result<bool, String> {
    let _ = PLUGIN_ROOT; // documents the embedded source root
    let dir = plugin_dir()?;
    let mut changed = false;
    for asset in ASSETS {
        let dest = dir.join(asset.rel);
        if std::fs::read(&dest).is_ok_and(|on_disk| on_disk == asset.bytes) {
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {parent:?}: {e}"))?;
        }
        std::fs::write(&dest, asset.bytes)
            .map_err(|e| format!("write {dest:?}: {e}"))?;
        changed = true;
    }
    Ok(changed)
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
    // The config is persisted now and the running plugin re-reads it live.
    // Only when the plugin FILES changed does the shell need a reload (it
    // drops the old cached QML / shaders and renders the new build).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_spec_is_told_apart_from_patterns() {
        assert!(is_video_spec(
            &serde_json::json!({ "kind": "video", "video": "/a.mp4" })
        ));
        assert!(!is_video_spec(
            &serde_json::json!({ "type": "aurora", "colors": [] })
        ));
        assert!(!is_video_spec(&serde_json::Value::Null));
    }

    #[test]
    fn gif_plays_as_an_image_everything_else_as_video() {
        use std::path::Path;
        assert_eq!(video_format(Path::new("/x/clip.GIF")), "gif");
        assert_eq!(video_format(Path::new("/x/clip.mp4")), "video");
        assert_eq!(video_format(Path::new("/x/clip.webm")), "video");
    }

    #[test]
    fn prune_keeps_the_new_import_and_the_active_clip() {
        let dir = std::env::temp_dir().join(format!("ambient-live-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let keep = dir.join("video-new.mp4");
        let active = dir.join("video-active.webm");
        let stale = dir.join("video-old.gif");
        let partial = dir.join("video-cancelled.part");
        for f in [&keep, &active, &stale, &partial] {
            std::fs::write(f, b"x").unwrap();
        }
        prune_imports(&dir, &keep, Some(&active));
        assert!(keep.exists());
        assert!(active.exists());
        assert!(!stale.exists());
        assert!(!partial.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reimporting_the_same_file_reuses_its_name() {
        let src = std::env::temp_dir().join(format!("ambient-live-src-{}.mp4", std::process::id()));
        std::fs::write(&src, b"not really a video").unwrap();
        let meta = std::fs::metadata(&src).unwrap();
        let a = import_name(&src, &meta, "mp4");
        let b = import_name(&src, &meta, "mp4");
        assert_eq!(a, b);
        assert!(a.starts_with("video-") && a.ends_with(".mp4"));
        let _ = std::fs::remove_file(&src);
    }
}
