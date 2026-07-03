// Linux-only desktop integration. When the app launches from an
// AppImage (the AppImage runtime sets $APPIMAGE to the .AppImage path
// on disk), copy that AppImage to ~/.local/bin and write a .desktop
// file + icon so the COSMIC / GNOME / KDE launcher discovers Ambient
// on the next boot. Idempotent — runs on every launch and only acts
// when state is out of sync.
//
// Why do this instead of relying on appimaged / AppImageLauncher:
// most distros don't ship those helpers, so the AppImage-on-Downloads
// UX is "download, chmod +x, locate in file manager every time."
// Self-integration brings the install-to-launcher experience to every
// distro without a daemon.

#[cfg(target_os = "linux")]
pub fn integrate_if_needed() {
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    let appimage = match std::env::var("APPIMAGE") {
        Ok(p) => PathBuf::from(p),
        Err(_) => return, // Not launched from an AppImage — dev build or tauri-bundler test
    };
    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => return,
    };

    let bin_dst = home.join(".local/bin/Ambient.AppImage");
    let desktop_dst = home.join(".local/share/applications/me.oezcan.ambient.desktop");
    let icon_dst = home.join(".local/share/icons/hicolor/512x512/apps/me.oezcan.ambient.png");

    // Already integrated AND we're running the integrated copy → no-op.
    // If the user launches a NEW downloaded copy, the bin_dst.canonicalize()
    // won't match appimage.canonicalize(), so we re-copy and bump.
    if bin_dst.exists() && desktop_dst.exists() && icon_dst.exists() {
        if let (Ok(canon_bin), Ok(canon_app)) =
            (bin_dst.canonicalize(), appimage.canonicalize())
        {
            if canon_bin == canon_app {
                return;
            }
        }
    }

    // Create XDG dirs (mkdir -p). Bail silently on any failure — better
    // to launch the app than fail integration; the user can still run
    // by double-clicking the AppImage.
    for d in [
        home.join(".local/bin"),
        home.join(".local/share/applications"),
        home.join(".local/share/icons/hicolor/512x512/apps"),
    ] {
        if std::fs::create_dir_all(&d).is_err() {
            return;
        }
    }

    if std::fs::copy(&appimage, &bin_dst).is_err() {
        return;
    }
    if let Ok(meta) = std::fs::metadata(&bin_dst) {
        let mut perm = meta.permissions();
        perm.set_mode(0o755);
        let _ = std::fs::set_permissions(&bin_dst, perm);
    }

    // Icon shipped as a compile-time blob — we can't extract reliably
    // from inside the AppImage at runtime without squashfs tools.
    let _ = std::fs::write(&icon_dst, ICON_PNG);

    let bin_str = bin_dst.to_string_lossy();
    let ver = env!("CARGO_PKG_VERSION");
    // The "Uninstall" desktop action lets the user right-click the
    // launcher icon → Uninstall, which re-runs the AppImage with
    // `--uninstall` (handled in lib.rs run() before the GUI builds).
    let desktop = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Ambient\n\
         GenericName=Wallpaper Studio\n\
         Comment=Generate, fetch, and apply desktop wallpapers\n\
         Exec={bin_str} %F\n\
         Icon=me.oezcan.ambient\n\
         Categories=Graphics;Utility;\n\
         Keywords=wallpaper;background;desktop;pattern;emoji;generate;\n\
         StartupWMClass=Ambient\n\
         StartupNotify=true\n\
         Terminal=false\n\
         Actions=Uninstall;\n\
         X-AppImage-Version={ver}\n\
         \n\
         [Desktop Action Uninstall]\n\
         Name=Uninstall Ambient\n\
         Exec={bin_str} --uninstall\n",
    );
    let _ = std::fs::write(&desktop_dst, desktop);

    refresh_launcher_caches(&home);
}

/// Refresh the launcher's .desktop + icon caches. Best-effort — neither
/// tool is guaranteed to exist on every distro, and the launcher usually
/// picks up changes within a few seconds anyway.
#[cfg(target_os = "linux")]
fn refresh_launcher_caches(home: &std::path::Path) {
    let _ = std::process::Command::new("update-desktop-database")
        .arg(home.join(".local/share/applications"))
        .status();
    let _ = std::process::Command::new("gtk-update-icon-cache")
        .arg(home.join(".local/share/icons/hicolor"))
        .status();
}

/// Remove the desktop integration this app wrote (binary copy, .desktop
/// entry, icon), best-effort. Does NOT touch settings, library, or saved
/// wallpapers; the caller decides whether to purge those. Invoked via
/// `--uninstall` (CLI / desktop action) and the `uninstall_self` command
/// (About panel).
#[cfg(target_os = "linux")]
pub fn remove_integration() -> Result<(), String> {
    use std::path::PathBuf;
    let home = PathBuf::from(std::env::var("HOME").map_err(|_| "no $HOME".to_string())?);
    let apps = home.join(".local/share/applications");
    let icons = home.join(".local/share/icons/hicolor/512x512/apps");
    let targets = [
        home.join(".local/bin/Ambient.AppImage"),
        apps.join("me.oezcan.ambient.desktop"),
        icons.join("me.oezcan.ambient.png"),
    ];
    let mut first_err = None;
    for t in &targets {
        if t.exists() {
            if let Err(e) = std::fs::remove_file(t) {
                first_err.get_or_insert(format!("remove {}: {e}", t.display()));
            }
        }
    }
    refresh_launcher_caches(&home);
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

#[cfg(not(target_os = "linux"))]
pub fn remove_integration() -> Result<(), String> {
    Err("Self-uninstall is only available for the Linux AppImage. On macOS \
         drag Ambient to the Trash; on Windows use Settings → Apps."
        .to_string())
}

#[cfg(not(target_os = "linux"))]
pub fn integrate_if_needed() {
    // No-op on macOS (DMG drag-to-Applications handles placement) and
    // Windows (the MSI installer registers Start Menu entries).
}

// --- Start-on-login (autostart) ------------------------------------
// Implemented via an XDG autostart .desktop in ~/.config/autostart,
// which every Linux DE (KDE, GNOME, XFCE, …) honours — no extra plugin.

#[cfg(target_os = "linux")]
fn autostart_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::PathBuf::from(home).join(".config/autostart/me.oezcan.ambient.desktop"))
}

#[cfg(target_os = "linux")]
pub fn autostart_enabled() -> bool {
    autostart_path().map(|p| p.exists()).unwrap_or(false)
}

#[cfg(target_os = "linux")]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let path = autostart_path().ok_or("no $HOME")?;
    if !enabled {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let home = std::path::PathBuf::from(std::env::var("HOME").map_err(|_| "no $HOME")?);
    // Prefer the integrated copy; fall back to the running AppImage.
    let bin = home.join(".local/bin/Ambient.AppImage");
    let exec = if bin.exists() {
        bin.to_string_lossy().into_owned()
    } else {
        std::env::var("APPIMAGE").unwrap_or_else(|_| bin.to_string_lossy().into_owned())
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let desktop = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Ambient\n\
         Exec={exec}\n\
         Icon=me.oezcan.ambient\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n"
    );
    std::fs::write(&path, desktop).map_err(|e| e.to_string())
}

// Windows: a value under HKCU\...\CurrentVersion\Run — the per-user
// autostart mechanism, no admin rights, works for the NSIS install and
// dev builds alike (the value points at the running exe).

#[cfg(target_os = "windows")]
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(target_os = "windows")]
const RUN_VALUE: &str = "Ambient";

#[cfg(target_os = "windows")]
pub fn autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|k| k.get_value::<String, _>(RUN_VALUE))
        .is_ok()
}

#[cfg(target_os = "windows")]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN_KEY)
        .map_err(|e| format!("open Run key: {e}"))?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("resolve exe path: {e}"))?;
        // Quoted: the install path contains spaces (C:\Program Files\…).
        let cmd = format!("\"{}\"", exe.display());
        key.set_value(RUN_VALUE, &cmd)
            .map_err(|e| format!("write Run entry: {e}"))
    } else if key.get_value::<String, _>(RUN_VALUE).is_ok() {
        key.delete_value(RUN_VALUE)
            .map_err(|e| format!("remove Run entry: {e}"))
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn autostart_enabled() -> bool {
    false
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn set_autostart(_enabled: bool) -> Result<(), String> {
    Err("Start-on-login is wired up for Linux and Windows. On macOS add \
         Ambient to System Settings → General → Login Items."
        .to_string())
}

// Compile-time icon for the desktop file's `Icon=` reference. ~73 KB
// at 512x512 — pulled into the binary so a freshly-downloaded
// AppImage can integrate without needing any external assets on disk.
#[cfg(target_os = "linux")]
const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
