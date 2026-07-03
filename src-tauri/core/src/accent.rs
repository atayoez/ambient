// Reads the system accent color and returns it as a CSS color string
// (e.g. "#0a84ff"). Returns None when:
//   - the platform has no concept of a global accent (most Linux DEs)
//   - the user hasn't picked one
//   - the read fails (registry permission, gsettings missing, etc.)
//
// macOS/Linux shell out (`defaults`/`gsettings`) so the binary stays
// dependency-free; Windows reads the registry directly via winreg — a
// shell-out there would flash a console window from the GUI-subsystem
// process. The lookups run on every app launch (<10 ms total) and the
// result is cached in the frontend for the session.

pub fn get_system_accent() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        return macos::accent();
    }
    #[cfg(target_os = "windows")]
    {
        return windows::accent();
    }
    #[cfg(target_os = "linux")]
    {
        return linux::accent();
    }
    #[allow(unreachable_code)]
    None
}

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;

    // macOS doesn't expose the actual rendered accent RGB via any defaults
    // key. AppleAccentColor stores the user's pick (0–7 or -1 for
    // multicolor / graphite); we map that to the canonical SF System hex
    // values Apple ships in HIG. AppleHighlightColor is per-user too but
    // optional; we read AppleAccentColor only.
    pub fn accent() -> Option<String> {
        let out = Command::new("defaults")
            .args(["read", "-g", "AppleAccentColor"])
            .output()
            .ok()?;
        if !out.status.success() {
            // Key missing → user is on the default ("Multicolor"), which
            // resolves to blue.
            return Some("#0a84ff".to_string());
        }
        let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Some(
            match raw.as_str() {
                "-1" => "#8e8e93",   // Graphite
                "0" => "#ff5257",    // Red
                "1" => "#ff9f0a",    // Orange
                "2" => "#ffd60a",    // Yellow
                "3" => "#30d158",    // Green
                "4" => "#0a84ff",    // Blue (default)
                "5" => "#bf5af2",    // Purple
                "6" => "#ff375f",    // Pink
                _ => "#0a84ff",
            }
            .to_string(),
        )
    }
}

#[cfg(target_os = "windows")]
mod windows {
    // Windows stores the DWM accent as a DWORD in alpha-prefixed ABGR
    // order — strip alpha and swap to RGB. Read via winreg, NOT a
    // `reg query` shell-out: spawning a console child from a
    // GUI-subsystem process flashes a cmd window on every app launch.
    pub fn accent() -> Option<String> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let value: u32 = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\DWM")
            .and_then(|k| k.get_value("AccentColor"))
            .ok()?;
        let b = ((value >> 16) & 0xFF) as u8;
        let g = ((value >> 8) & 0xFF) as u8;
        let r = (value & 0xFF) as u8;
        Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Diagnostic — prints whatever the resolver returns on the current
    // machine. Run with `cargo test -p ambient accent_diag -- --nocapture`.
    // Not asserted because the answer is system-dependent; the goal is
    // to verify the function actually returns the expected value when
    // debugging "why isn't the accent showing up in the UI?".
    #[test]
    fn accent_diag() {
        let r = get_system_accent();
        eprintln!("\n>>> get_system_accent() = {:?}\n", r);
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::process::Command;

    // Try KDE first (kdeglobals), then GNOME (gsettings). On a Plasma
    // session the KDE value is authoritative even when gsettings also
    // reports something. Other DEs (XFCE, …) have no unified accent
    // concept → None, leaving the achromatic default in place.
    pub fn accent() -> Option<String> {
        kde().or_else(gnome)
    }

    // KDE Plasma stores the accent under `[General] AccentColor=R,G,B`
    // (decimal 0–255) in kdeglobals. The key is present even when
    // `accentColorFromWallpaper=true` — Plasma writes the resolved RGB
    // there. Absent on default Breeze (no custom accent), in which case
    // we fall through to GNOME / None.
    fn kde() -> Option<String> {
        let dir = std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
            })?;
        let text = std::fs::read_to_string(dir.join("kdeglobals")).ok()?;
        let mut in_general = false;
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                in_general = line == "[General]";
                continue;
            }
            if in_general {
                if let Some(rgb) = line.strip_prefix("AccentColor=") {
                    let mut ch = rgb.split(',').map(|s| s.trim().parse::<u8>().ok());
                    let r = ch.next()??;
                    let g = ch.next()??;
                    let b = ch.next()??;
                    return Some(format!("#{:02x}{:02x}{:02x}", r, g, b));
                }
            }
        }
        None
    }

    // GNOME 47+ exposes `org.gnome.desktop.interface accent-color` with
    // values like "blue", "teal", "green", "yellow", "orange", "red",
    // "pink", "purple", "slate". Map each to the canonical libadwaita hex.
    fn gnome() -> Option<String> {
        let out = Command::new("gsettings")
            .args(["get", "org.gnome.desktop.interface", "accent-color"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let raw = String::from_utf8_lossy(&out.stdout)
            .trim()
            .trim_matches('\'')
            .to_string();
        Some(
            match raw.as_str() {
                "blue" => "#3584e4",
                "teal" => "#2190a4",
                "green" => "#3a944a",
                "yellow" => "#c88800",
                "orange" => "#ed5b00",
                "red" => "#e62d42",
                "pink" => "#d56199",
                "purple" => "#9141ac",
                "slate" => "#6f8396",
                _ => return None,
            }
            .to_string(),
        )
    }
}
