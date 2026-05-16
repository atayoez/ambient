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
    let desktop_dst = home.join(".local/share/applications/com.ambient.app.desktop");
    let icon_dst = home.join(".local/share/icons/hicolor/512x512/apps/com.ambient.app.png");

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
    let desktop = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Ambient\n\
         GenericName=Wallpaper Studio\n\
         Comment=Generate, fetch, and apply desktop wallpapers\n\
         Exec={} %F\n\
         Icon=com.ambient.app\n\
         Categories=Utility;Graphics;\n\
         StartupWMClass=Ambient\n\
         Terminal=false\n\
         X-AppImage-Version={}\n",
        bin_str,
        env!("CARGO_PKG_VERSION"),
    );
    let _ = std::fs::write(&desktop_dst, desktop);

    // Refresh launcher caches. Both tools are best-effort — neither is
    // guaranteed to exist on every distro, and the launcher usually
    // picks up new .desktop files within a few seconds anyway.
    let _ = std::process::Command::new("update-desktop-database")
        .arg(home.join(".local/share/applications"))
        .status();
    let _ = std::process::Command::new("gtk-update-icon-cache")
        .arg(home.join(".local/share/icons/hicolor"))
        .status();
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
