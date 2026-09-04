// Monitor detection. Two routes, in platform-appropriate order:
//
//   * Linux: shell out to the available randr tool and parse its text
//     output (cosmic-randr → wlr-randr → xrandr, first hit wins) —
//     Tauri 2's `primaryMonitor()` returns null on COSMIC Wayland (the
//     compositor doesn't speak the output protocol Tauri queries).
//   * Everywhere: a shell-registered provider (the Tauri shell wires
//     `primary_monitor()` in via set_provider, mirroring
//     desktop::set_os_setter). This is the ONLY route on Windows/macOS —
//     the randr binaries are Linux tools, and before this gate existed
//     Windows always fell through to the 1920×1080 render fallback, so
//     4K monitors got low-res wallpapers.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub source: String,
}

type MonitorProvider = Box<dyn Fn() -> Option<MonitorInfo> + Send + Sync>;
static SHELL_PROVIDER: std::sync::OnceLock<MonitorProvider> = std::sync::OnceLock::new();

/// Register the shell's monitor lookup (Tauri's `primary_monitor()`).
/// Later calls are ignored — one shell per process.
pub fn set_provider<F>(provider: F)
where
    F: Fn() -> Option<MonitorInfo> + Send + Sync + 'static,
{
    let _ = SHELL_PROVIDER.set(Box::new(provider));
}

/// The resolution to render wallpapers at. On Linux this is the LARGEST
/// enabled output (see `pick_render_target`) — one image covers every screen
/// of a multi-monitor desktop without upscaling — falling back to the shell's
/// primary-monitor lookup. The name is the frontend's wire contract.
pub fn get_primary_monitor_pixels() -> Result<MonitorInfo, String> {
    // Linux first tries the randr tools: they report physical pixels even
    // on the Wayland compositors where Tauri's monitor query comes back
    // empty or logical-sized.
    #[cfg(target_os = "linux")]
    {
        if let Some(info) = try_cosmic_randr() {
            return Ok(info);
        }
        if let Some(info) = try_wlr_randr() {
            return Ok(info);
        }
        if let Some(info) = try_xrandr() {
            return Ok(info);
        }
    }
    if let Some(provider) = SHELL_PROVIDER.get() {
        if let Some(info) = provider() {
            return Ok(info);
        }
    }
    Err("could not detect the primary monitor".into())
}

/// One output as reported by cosmic-randr / wlr-randr.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RandrOutput {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub scale: f32,
    pub enabled: bool,
}

/// Parse the block-per-output text both cosmic-randr and wlr-randr print: a
/// header at column 0 (`DP-1 (enabled)` / `DP-1 "Samsung …"`), then indented
/// `Scale:` / `Enabled:` lines and a mode list in which the active mode
/// carries `current`. Outputs without a current mode (disabled, no mode set)
/// are still returned so the caller can see them, with 0×0 dimensions.
/// Feed it ANSI-stripped text (cosmic-randr colours its output).
#[cfg(target_os = "linux")]
pub(crate) fn parse_randr_outputs(text: &str) -> Vec<RandrOutput> {
    let mut outs: Vec<RandrOutput> = Vec::new();
    for raw in text.lines() {
        if raw.trim().is_empty() {
            continue;
        }
        let line = raw.trim();
        let header = !(raw.starts_with(' ') || raw.starts_with('\t'));
        if header {
            outs.push(RandrOutput {
                name: line.split_whitespace().next().unwrap_or("").to_string(),
                width: 0,
                height: 0,
                scale: 1.0,
                enabled: !line.contains("(disabled)"),
            });
            continue;
        }
        let Some(out) = outs.last_mut() else {
            continue;
        };
        if let Some(rest) = line.strip_prefix("Scale:") {
            // cosmic-randr prints "125%", wlr-randr "1.250000".
            let v = rest.trim().trim_end_matches('%');
            if let Ok(n) = v.parse::<f32>() {
                out.scale = if n > 10.0 { n / 100.0 } else { n };
            }
        } else if let Some(rest) = line.strip_prefix("Enabled:") {
            out.enabled = rest.trim().eq_ignore_ascii_case("yes");
        } else if line.contains("current") && out.width == 0 {
            if let Some((w, h)) = first_wxh(line) {
                out.width = w;
                out.height = h;
            }
        }
    }
    outs
}

/// The output one render should target: the largest ENABLED one with a
/// current mode. A single image at that size covers every screen without
/// upscaling; smaller outputs crop it (cosmic-bg `Zoom`, Plasma's
/// scaled-and-cropped). Ties keep the first listed.
#[cfg(target_os = "linux")]
pub(crate) fn pick_render_target(outs: &[RandrOutput]) -> Option<&RandrOutput> {
    outs.iter()
        .filter(|o| o.enabled && o.width > 0 && o.height > 0)
        .fold(None, |best: Option<&RandrOutput>, o| match best {
            Some(b)
                if (b.width as u64) * (b.height as u64) >= (o.width as u64) * (o.height as u64) =>
            {
                Some(b)
            }
            _ => Some(o),
        })
}

#[cfg(target_os = "linux")]
fn try_cosmic_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("cosmic-randr")
        .arg("list")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = strip_ansi(&String::from_utf8_lossy(&output.stdout));
    let outs = parse_randr_outputs(&text);
    let pick = pick_render_target(&outs)?;
    Some(MonitorInfo {
        width: pick.width,
        height: pick.height,
        scale: pick.scale,
        source: "cosmic-randr".to_string(),
    })
}

#[cfg(target_os = "linux")]
fn try_wlr_randr() -> Option<MonitorInfo> {
    let output = std::process::Command::new("wlr-randr").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = strip_ansi(&String::from_utf8_lossy(&output.stdout));
    let outs = parse_randr_outputs(&text);
    let pick = pick_render_target(&outs)?;
    Some(MonitorInfo {
        width: pick.width,
        height: pick.height,
        scale: pick.scale,
        source: "wlr-randr".to_string(),
    })
}

#[cfg(target_os = "linux")]
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
#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn first_wxh_picks_first_dimensions_token() {
        assert_eq!(
            first_wxh("2880x1800 @ 90.001 Hz (current)"),
            Some((2880, 1800))
        );
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

    const COSMIC_TWO_OUTPUTS: &str = "\
DP-1 (enabled)
  Make: Samsung Electric Company
  Model: Odyssey G85SB
  Position: 0,0
  Scale: 125%
  Transform: normal
  Xwayland primary: true

  Modes:
    3840x2160 @  59.997 Hz
    3440x1440 @ 174.962 Hz (current)
    3440x1440 @  59.959 Hz (preferred)
HDMI-A-1 (enabled)
  Make: Dell
  Model: U2412M
  Position: 3440,0
  Scale: 100%

  Modes:
    1920x1200 @  59.950 Hz (current) (preferred)
    1280x1024 @  60.020 Hz
eDP-1 (disabled)
  Make: BOE
  Scale: 200%

  Modes:
    2880x1800 @  90.001 Hz (current) (preferred)
";

    const WLR_TWO_OUTPUTS: &str = "\
HDMI-A-1 \"Dell Inc. DELL U2412M (HDMI-A-1)\"
  Make: Dell Inc.
  Physical size: 520x320 mm
  Enabled: yes
  Modes:
    1920x1200 px, 59.950 Hz (preferred, current)
    1280x1024 px, 60.020 Hz
  Position: 3440,0
  Transform: normal
  Scale: 1.000000
  Adaptive Sync: disabled
DP-1 \"Samsung Electric Company Odyssey G85SB (DP-1)\"
  Enabled: yes
  Modes:
    3840x2160 px, 59.997 Hz
    3440x1440 px, 174.962 Hz (current)
    3440x1440 px, 59.959 Hz (preferred)
  Position: 0,0
  Scale: 1.250000
";

    #[test]
    fn parses_every_cosmic_randr_output_block() {
        let outs = parse_randr_outputs(COSMIC_TWO_OUTPUTS);
        assert_eq!(outs.len(), 3);
        assert_eq!(
            outs[0],
            RandrOutput {
                name: "DP-1".into(),
                width: 3440,
                height: 1440,
                scale: 1.25,
                enabled: true
            }
        );
        assert_eq!(
            (
                outs[1].name.as_str(),
                outs[1].width,
                outs[1].height,
                outs[1].scale
            ),
            ("HDMI-A-1", 1920, 1200, 1.0)
        );
        assert!(!outs[2].enabled, "eDP-1 is marked (disabled) in the header");
        assert_eq!(outs[2].scale, 2.0);
    }

    #[test]
    fn parses_wlr_randr_with_scale_after_modes() {
        let outs = parse_randr_outputs(WLR_TWO_OUTPUTS);
        assert_eq!(outs.len(), 2);
        assert_eq!(
            (
                outs[0].name.as_str(),
                outs[0].width,
                outs[0].height,
                outs[0].scale,
                outs[0].enabled
            ),
            ("HDMI-A-1", 1920, 1200, 1.0, true)
        );
        assert_eq!(
            (
                outs[1].name.as_str(),
                outs[1].width,
                outs[1].height,
                outs[1].scale
            ),
            ("DP-1", 3440, 1440, 1.25)
        );
    }

    // The render target is the largest ENABLED output, regardless of list
    // order — the disabled 2880×1800 laptop panel must not win.
    #[test]
    fn render_target_is_the_largest_enabled_output() {
        let cosmic = parse_randr_outputs(COSMIC_TWO_OUTPUTS);
        assert_eq!(
            pick_render_target(&cosmic).map(|o| o.name.as_str()),
            Some("DP-1")
        );
        let wlr = parse_randr_outputs(WLR_TWO_OUTPUTS);
        assert_eq!(
            pick_render_target(&wlr).map(|o| o.name.as_str()),
            Some("DP-1")
        );
        assert!(pick_render_target(&[]).is_none());
        let only_disabled =
            parse_randr_outputs("eDP-1 (disabled)\n  Modes:\n    2880x1800 @ 60 Hz (current)\n");
        assert!(pick_render_target(&only_disabled).is_none());
    }

    #[test]
    fn strip_ansi_handles_unterminated() {
        // Mid-CSI without final letter — the loop drains chars but never
        // breaks. Acceptable: the input is malformed.
        let out = strip_ansi("normal\x1b[31");
        assert_eq!(out, "normal");
    }
}
