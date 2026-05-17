// Reads the system accent color and returns it as a CSS color string
// (e.g. "#0a84ff"). Returns None when:
//   - the platform has no concept of a global accent (most Linux DEs)
//   - the user hasn't picked one
//   - the read fails (registry permission, gsettings missing, etc.)
//
// Shell-outs are used in preference to native crates so the binary stays
// dependency-free. The lookups run on every app launch (<10 ms total)
// and the result is cached in the frontend for the session.

#[tauri::command]
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
    use std::process::Command;

    // Windows stores the DWM accent as a DWORD in ABGR order (little
    // endian). `reg query` prints it as a hex value like `0xff0078d4`,
    // which is alpha-prefixed ABGR — we strip alpha and swap to RGB.
    pub fn accent() -> Option<String> {
        let out = Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\DWM",
                "/v",
                "AccentColor",
            ])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        // Output format: "    AccentColor    REG_DWORD    0xff0078d4"
        let hex = stdout
            .lines()
            .find_map(|line| {
                let lower = line.to_ascii_lowercase();
                lower
                    .split_whitespace()
                    .find(|tok| tok.starts_with("0x"))
                    .map(|tok| tok.trim_start_matches("0x").to_string())
            })?;
        let value = u32::from_str_radix(&hex, 16).ok()?;
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

    // GNOME 47+ exposes `org.gnome.desktop.interface accent-color` with
    // values like "blue", "teal", "green", "yellow", "orange", "red",
    // "pink", "purple", "slate". Map each to the canonical libadwaita
    // hex. Other DEs (KDE, XFCE) don't have a unified accent concept;
    // we leave them on the achromatic default.
    pub fn accent() -> Option<String> {
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
