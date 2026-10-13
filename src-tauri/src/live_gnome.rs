//! GNOME live-wallpaper support: the bundled GNOME Shell extension.
//!
//! GNOME (Mutter) doesn't implement wlr-layer-shell, so unlike COSMIC / Sway
//! the app can't put its wallpaper window on the desktop layer by itself.
//! Only code running inside the compositor can, so Ambient ships a small
//! GNOME Shell extension (`gnome/extensions/ambient-live@oezcan.me`,
//! embedded below) and live_linux.rs creates ordinary borderless windows,
//! one per monitor, titled with [`window_title`]. The extension spots those
//! titles and turns each window into a desktop-layer window covering its
//! monitor (see extension.js for how, per GNOME version).
//!
//! Applying a live wallpaper installs / refreshes the extension, then asks
//! GNOME Shell over D-Bus whether it is running. GNOME Shell on Wayland only
//! discovers new extensions at login, so the very first apply enables it in
//! `org.gnome.shell enabled-extensions` and asks the user to log out and back
//! in once; after that every apply (and the restore at login) just works.
//! Without the extension running no window is created at all — it would be
//! an ordinary window covering the desktop.

#![cfg(target_os = "linux")]

use std::path::PathBuf;
use std::process::Command;

pub const EXTENSION_UUID: &str = "ambient-live@oezcan.me";

/// Window-title prefix the extension matches. Must match TITLE_PREFIX in
/// extension.js.
const TITLE_PREFIX: &str = "ambient-live-wallpaper";

struct Asset {
    rel: &'static str,
    bytes: &'static [u8],
}

const ASSETS: &[Asset] = &[
    Asset {
        rel: "metadata.json",
        bytes: include_bytes!("../../gnome/extensions/ambient-live@oezcan.me/metadata.json"),
    },
    Asset {
        rel: "extension.js",
        bytes: include_bytes!("../../gnome/extensions/ambient-live@oezcan.me/extension.js"),
    },
];

const RELOGIN: &str = "Ambient installed its GNOME Shell extension for live wallpapers. \
Log out and back in once, then apply again.";

/// Whether this is a GNOME (Mutter) session: `GNOME`, `ubuntu:GNOME`,
/// `GNOME-Classic:GNOME`, … Phosh also says GNOME but has layer-shell, which
/// live_linux.rs checks first.
pub fn is_gnome() -> bool {
    is_gnome_desktop(&std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default())
}

fn is_gnome_desktop(desktop: &str) -> bool {
    desktop
        .split(':')
        .any(|tok| tok.trim().eq_ignore_ascii_case("GNOME"))
}

/// Title for the wallpaper window on the monitor at this logical geometry.
/// The extension reads the geometry back to pick the monitor.
pub fn window_title(x: i32, y: i32, width: i32, height: i32) -> String {
    format!("{TITLE_PREFIX}@{x},{y},{width},{height}")
}

/// Make sure the extension is installed and running. `Ok` means windows
/// titled with [`window_title`] will be placed on the desktop layer; `Err`
/// is a message for the user. Runs `gdbus` / `gsettings`, so call it off
/// the GTK main thread.
pub fn ensure_extension() -> Result<(), String> {
    let updated = install_extension()?;
    match query_state()? {
        ExtState::Active => {
            if updated {
                // The running shell keeps the code it loaded at login; the
                // new files take over at the next login. The old extension
                // still places our windows, so carry on.
                tracing::info!(
                    "GNOME Shell extension updated on disk; the new version loads at next login"
                );
            }
            Ok(())
        }
        ExtState::NotLoaded => {
            enable_at_login()?;
            Err(RELOGIN.to_string())
        }
        ExtState::Inactive => {
            if user_extensions_disabled() {
                Err(
                    "GNOME extensions are turned off. Turn them on in the Extensions app, \
                     then apply the live wallpaper again."
                        .to_string(),
                )
            } else {
                Err(
                    "The \u{201c}Ambient Live Wallpaper\u{201d} GNOME extension is turned off. \
                     Turn it on in the Extensions app, then apply again."
                        .to_string(),
                )
            }
        }
        ExtState::OutOfDate => Err(
            "Ambient's GNOME Shell extension doesn't support this GNOME version yet.".to_string(),
        ),
        ExtState::Error(e) => Err(format!(
            "GNOME Shell couldn't load Ambient's live-wallpaper extension: {e}"
        )),
    }
}

fn extension_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .ok_or_else(|| "neither XDG_DATA_HOME nor HOME is set".to_string())?;
    Ok(base.join("gnome-shell/extensions").join(EXTENSION_UUID))
}

/// Sync the bundled extension into the user's extensions dir, writing only
/// files that differ. Returns whether anything was written.
fn install_extension() -> Result<bool, String> {
    let dir = extension_dir()?;
    let mut changed = false;
    for asset in ASSETS {
        let dest = dir.join(asset.rel);
        if std::fs::read(&dest).is_ok_and(|on_disk| on_disk == asset.bytes) {
            continue;
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
        std::fs::write(&dest, asset.bytes).map_err(|e| format!("write {dest:?}: {e}"))?;
        changed = true;
    }
    Ok(changed)
}

#[derive(Debug, PartialEq)]
enum ExtState {
    /// Running (ACTIVE / ENABLED, or ACTIVATING).
    Active,
    /// Known to the shell but not running: turned off by the user, or all
    /// user extensions are disabled.
    Inactive,
    /// The shell doesn't know it: installed after login.
    NotLoaded,
    OutOfDate,
    Error(String),
}

/// Ask GNOME Shell about the extension (org.gnome.Shell.Extensions).
fn query_state() -> Result<ExtState, String> {
    let out = Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell.Extensions",
            "--object-path",
            "/org/gnome/Shell/Extensions",
            "--method",
            "org.gnome.Shell.Extensions.GetExtensionInfo",
            EXTENSION_UUID,
        ])
        .output()
        .map_err(|e| format!("gdbus not runnable: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "couldn't reach GNOME Shell: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(parse_info(&String::from_utf8_lossy(&out.stdout)))
}

/// Parse `gdbus call … GetExtensionInfo` output, a GVariant `(a{sv},)` such
/// as `({'uuid': <'…'>, 'state': <1.0>, 'error': <''>, …},)`, or
/// `(@a{sv} {},)` when the shell doesn't know the extension. States are
/// GNOME Shell's ExtensionState: 1 active, 2 inactive, 3 error,
/// 4 out of date, 6 initialized, 7 deactivating, 8 activating.
fn parse_info(out: &str) -> ExtState {
    let Some(state) = field(out, "state").and_then(|v| v.parse::<f64>().ok()) else {
        return ExtState::NotLoaded;
    };
    match state as i64 {
        1 | 8 => ExtState::Active,
        3 => ExtState::Error(
            field(out, "error")
                .map(|e| e.trim_matches('\'').to_string())
                .filter(|e| !e.is_empty())
                .unwrap_or_else(|| "unknown error".to_string()),
        ),
        4 => ExtState::OutOfDate,
        99 => ExtState::NotLoaded,
        _ => ExtState::Inactive,
    }
}

/// The raw value of `'key': <value>` in GVariant text output.
fn field<'a>(out: &'a str, key: &str) -> Option<&'a str> {
    let start = out.find(&format!("'{key}': <"))? + key.len() + 5;
    let rest = &out[start..];
    let end = if let Some(quoted) = rest.strip_prefix('\'') {
        quoted.find("'>").map(|i| i + 2)?
    } else {
        rest.find('>')?
    };
    Some(&rest[..end])
}

/// Add the extension to `org.gnome.shell enabled-extensions` so the shell
/// starts it at the next login.
fn enable_at_login() -> Result<(), String> {
    let out = Command::new("gsettings")
        .args(["get", "org.gnome.shell", "enabled-extensions"])
        .output()
        .map_err(|e| format!("gsettings not runnable: {e}"))?;
    if !out.status.success() {
        return Err("couldn't read the enabled GNOME extensions".to_string());
    }
    let Some(list) = with_uuid(String::from_utf8_lossy(&out.stdout).trim(), EXTENSION_UUID) else {
        return Ok(());
    };
    let ok = Command::new("gsettings")
        .args(["set", "org.gnome.shell", "enabled-extensions", &list])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err("couldn't enable the GNOME extension".to_string())
    }
}

/// `list` (a GVariant `as` in gsettings text form) with `uuid` appended, or
/// `None` when it's already there.
fn with_uuid(list: &str, uuid: &str) -> Option<String> {
    if list.contains(&format!("'{uuid}'")) {
        return None;
    }
    let inner = list
        .trim_start_matches("@as")
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    Some(if inner.is_empty() {
        format!("['{uuid}']")
    } else {
        format!("[{inner}, '{uuid}']")
    })
}

fn user_extensions_disabled() -> bool {
    Command::new("gsettings")
        .args(["get", "org.gnome.shell", "disable-user-extensions"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gnome_sessions_are_recognised() {
        assert!(is_gnome_desktop("GNOME"));
        assert!(is_gnome_desktop("ubuntu:GNOME"));
        assert!(is_gnome_desktop("GNOME-Classic:GNOME"));
        assert!(!is_gnome_desktop("KDE"));
        assert!(!is_gnome_desktop("COSMIC"));
        assert!(!is_gnome_desktop(""));
    }

    #[test]
    fn extension_state_is_read_from_gdbus_output() {
        let active = "({'uuid': <'ambient-live@oezcan.me'>, 'type': <2.0>, 'state': <1.0>, \
                      'path': <'/home/a/.local/share/gnome-shell/extensions/ambient-live@oezcan.me'>, \
                      'error': <''>, 'hasPrefs': <false>, 'enabled': <true>},)";
        assert_eq!(parse_info(active), ExtState::Active);
        assert_eq!(
            parse_info("({'state': <2.0>, 'enabled': <false>},)"),
            ExtState::Inactive
        );
        assert_eq!(parse_info("({'state': <4.0>},)"), ExtState::OutOfDate);
        assert_eq!(parse_info("(@a{sv} {},)"), ExtState::NotLoaded);
        assert_eq!(
            parse_info("({'state': <3.0>, 'error': <'SyntaxError: oops'>},)"),
            ExtState::Error("SyntaxError: oops".to_string())
        );
        assert_eq!(
            parse_info("({'error': <''>, 'state': <3.0>},)"),
            ExtState::Error("unknown error".to_string())
        );
    }

    #[test]
    fn uuid_is_appended_once() {
        let id = EXTENSION_UUID;
        assert_eq!(
            with_uuid("@as []", id).as_deref(),
            Some("['ambient-live@oezcan.me']")
        );
        assert_eq!(
            with_uuid("['a@b.c']", id).as_deref(),
            Some("['a@b.c', 'ambient-live@oezcan.me']")
        );
        assert_eq!(with_uuid("['a@b.c', 'ambient-live@oezcan.me']", id), None);
    }

    #[test]
    fn title_carries_the_monitor_geometry() {
        assert_eq!(
            window_title(-1920, 0, 1920, 1080),
            "ambient-live-wallpaper@-1920,0,1920,1080"
        );
    }
}
