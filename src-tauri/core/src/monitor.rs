// Monitor detection. Tauri 2's `primaryMonitor()` returns null on
// COSMIC Wayland (the compositor doesn't speak the output protocol
// Tauri queries), so we shell out to the available randr tool and
// parse its text output. cosmic-randr → wlr-randr → xrandr, first
// hit wins.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub source: String,
}

pub fn get_primary_monitor_pixels() -> Result<MonitorInfo, String> {
    if let Some(info) = try_cosmic_randr() {
        return Ok(info);
    }
    if let Some(info) = try_wlr_randr() {
        return Ok(info);
    }
    if let Some(info) = try_xrandr() {
        return Ok(info);
    }
    Err("could not detect monitor via cosmic-randr / wlr-randr / xrandr".into())
}

fn try_cosmic_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("cosmic-randr")
        .arg("list")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let cleaned = strip_ansi(&text);

    let mut scale: f32 = 1.0;
    let mut dims: Option<(u32, u32)> = None;

    for line in cleaned.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Scale:") {
            let s = rest.trim().trim_end_matches('%');
            if let Ok(n) = s.parse::<f32>() {
                scale = if n > 10.0 { n / 100.0 } else { n };
            }
        }
        if line.contains("(current)") {
            if let Some((w, h)) = first_wxh(line) {
                dims = Some((w, h));
                break;
            }
        }
    }

    let (width, height) = dims?;
    Some(MonitorInfo {
        width,
        height,
        scale,
        source: "cosmic-randr".to_string(),
    })
}

fn try_wlr_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("wlr-randr").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();

    let mut scale: f32 = 1.0;
    let mut dims: Option<(u32, u32)> = None;
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Scale:") {
            if let Ok(n) = rest.trim().parse::<f32>() {
                scale = n;
            }
        }
        if line.contains("current") {
            if let Some((w, h)) = first_wxh(line) {
                dims = Some((w, h));
                break;
            }
        }
    }

    let (width, height) = dims?;
    Some(MonitorInfo {
        width,
        height,
        scale,
        source: "wlr-randr".to_string(),
    })
}

fn try_xrandr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("xrandr").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    for line in text.lines() {
        if line.contains(" connected") {
            for token in line.split_whitespace() {
                if let Some(plus) = token.find('+') {
                    let dims = &token[..plus];
                    if let Some((w, h)) = dims.split_once('x') {
                        if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                            return Some(MonitorInfo {
                                width: w,
                                height: h,
                                scale: 1.0,
                                source: "xrandr".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

// Find the first WxH token in a line, e.g. extracts (2880, 1800) from
// "    2880x1800 @ 90.001 Hz (current) (preferred)"
pub(crate) fn first_wxh(line: &str) -> Option<(u32, u32)> {
    for token in line.split_whitespace() {
        let token = token.trim_start_matches('[').trim_end_matches(']');
        if let Some((w, h)) = token.split_once('x') {
            if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                return Some((w, h));
            }
        }
    }
    None
}

pub(crate) fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_wxh_picks_first_dimensions_token() {
        assert_eq!(first_wxh("2880x1800 @ 90.001 Hz (current)"), Some((2880, 1800)));
        assert_eq!(
            first_wxh("    1920x1080 @ 60 Hz [preferred]"),
            Some((1920, 1080))
        );
        assert_eq!(first_wxh("nothing here"), None);
    }

    #[test]
    fn first_wxh_skips_brackets() {
        assert_eq!(first_wxh("[1920x1080]"), Some((1920, 1080)));
    }

    #[test]
    fn strip_ansi_removes_csi_sequences() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi("plain"), "plain");
        assert_eq!(strip_ansi("\x1b[1;33mwarn\x1b[m\x1b[K"), "warn");
    }

    #[test]
    fn strip_ansi_handles_unterminated() {
        // Mid-CSI without final letter — the loop drains chars but never
        // breaks. Acceptable: the input is malformed.
        let out = strip_ansi("normal\x1b[31");
        assert_eq!(out, "normal");
    }
}
