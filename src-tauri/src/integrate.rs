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
/// entry, icon) — for both the current `me.oezcan.ambient` id and the
/// legacy `com.ambient.app` id, best-effort. Does NOT touch settings,
/// library, or saved wallpapers; the caller decides whether to purge
/// those. Invoked via `--uninstall` (CLI / desktop action) and the
/// `uninstall_self` command (About panel).
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
        // Legacy (pre-0.7 bundle id), in case an old install lingers.
        apps.join("com.ambient.app.desktop"),
        icons.join("com.ambient.app.png"),
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

// Compile-time icon for the desktop file's `Icon=` reference. ~73 KB
// at 512x512 — pulled into the binary so a freshly-downloaded
// AppImage can integrate without needing any external assets on disk.
#[cfg(target_os = "linux")]
const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
