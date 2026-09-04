// Shared serializable types. Mirror the TS interfaces in
// `src/lib/types.ts` field-for-field via `#[serde(rename_all = "camelCase")]`
// so the wire format is identical and the TS layer can keep using
// its existing PascalCase interfaces unchanged.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Every wire type below also derives ts_rs::TS and exports a TypeScript
// declaration into src/lib/generated/ (re-exported by src/lib/types.ts),
// so the frontend types are GENERATED from these structs instead of
// hand-mirrored. Regenerate with `bun run gen:types` (runs the ts-rs
// export tests); CI can diff the generated files to catch drift.
const TS_EXPORT_DIR: &str = "../../../src/lib/generated/";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    NasaApod,
    Bing,
    Unsplash,
    Pexels,
    Wallhaven,
    Picsum,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum GenProvider {
    Pollinations,
    Openai,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum RotationSource {
    Off,
    Sources,
    Library,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Auto,
    Light,
    Dark,
}

/// Per-wallpaper light/dark eligibility. `Both` (default) shows in either
/// system theme; `Light`/`Dark` restrict it. The rotation / "Next" pools
/// are derived from these tags — a light-tagged wallpaper is auto-included
/// in the light pool.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperMode {
    #[default]
    Both,
    Light,
    Dark,
}

impl WallpaperMode {
    /// Whether a wallpaper with this tag belongs in the pool for the
    /// given system theme. `Both` always; the others only in their mode.
    pub fn matches(self, dark: bool) -> bool {
        match self {
            WallpaperMode::Both => true,
            WallpaperMode::Light => !dark,
            WallpaperMode::Dark => dark,
        }
    }
}

/// Live-wallpaper render quality. Trades GPU load for sharpness by capping
/// the KDE plugin shader's internal render resolution (long edge in px; 0 =
/// uncapped) and frame rate. `resolve()` produces the numbers the plugin
/// reads from the spec.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum LiveQuality {
    Performance,
    #[default]
    Balanced,
    High,
    Native,
}

impl LiveQuality {
    /// `(max render long-edge px — 0 means uncapped, target fps)`.
    pub fn resolve(self) -> (u32, u32) {
        match self {
            LiveQuality::Performance => (960, 24),
            LiveQuality::Balanced => (1280, 30),
            LiveQuality::High => (1920, 30),
            LiveQuality::Native => (0, 30),
        }
    }
}

/// Where the live clock sits on the wallpaper.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "kebab-case")]
pub enum ClockPosition {
    TopLeft,
    #[default]
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

/// Live clock size, as a share of the shorter screen edge (small 6%,
/// medium 9%, large 14% — the renderers own the numbers).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "lowercase")]
pub enum ClockSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// Clock overlay drawn on top of a live wallpaper by every delivery (the
/// Plasma plugin's QML, the desktop-layer webview's ClockOverlay). Stamped
/// into the live spec as `clock` by live::build_spec; the in-app preview
/// shows the same overlay so placement can be judged before applying.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveClock {
    pub enabled: bool,
    pub position: ClockPosition,
    pub size: ClockSize,
    /// 12-hour clock with AM/PM; false = 24-hour.
    pub hour12: bool,
    pub show_seconds: bool,
    pub show_date: bool,
}

impl Default for LiveClock {
    fn default() -> Self {
        Self {
            enabled: false,
            position: ClockPosition::default(),
            size: ClockSize::default(),
            hour12: false,
            show_seconds: false,
            show_date: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub source: SourceKind,
    pub unsplash_query: String,
    pub pexels_query: String,
    #[serde(default)]
    pub wallhaven_query: String,
    // Wallhaven search options. Empty (legacy stores) → Rust falls back to
    // the defaults in fetch_wallhaven. `sorting` is the raw API value
    // (random/toplist/date_added/views); `categories`/`purity` are the
    // API's 3-bit / 3-bit strings (general·anime·people / sfw·sketchy·nsfw).
    #[serde(default)]
    pub wallhaven_sorting: String,
    #[serde(default)]
    pub wallhaven_categories: String,
    #[serde(default)]
    pub wallhaven_purity: String,
    pub gen_provider: GenProvider,
    // pollinations_model, gen_resolution, openai_model are kept as
    // free-form strings — the TS layer is the source of truth for which
    // values are valid, and we don't want a Rust-side enum mismatch to
    // reject a future model name added in JS first.
    pub pollinations_model: String,
    pub gen_resolution: String,
    pub openai_model: String,
    pub rotation_source: RotationSource,
    pub rotation_interval_minutes: u32,
    pub theme_mode: ThemeMode,
    // Also mirror the applied wallpaper onto the OS lock screen (KDE).
    // `#[serde(default)]` so legacy stores deserialize to false.
    #[serde(default)]
    pub lockscreen: bool,
    // Newly introduced in Phase 1. `#[serde(default)]` so legacy stores
    // without this field deserialize cleanly to None.
    #[serde(default)]
    pub last_applied: Option<String>,
    // User-saved palettes (colours + emojis). Pure frontend data — Rust
    // never inspects it, just persists it — so it's stored as an opaque
    // JSON array rather than a mirrored CustomPreset struct. Moved here
    // from the old tauri-plugin-store `patterns.customPresets` key so the
    // app has one source of truth for real data (drafts stay in the
    // webview's localStorage). `#[serde(default)]` for legacy stores.
    #[serde(default)]
    #[ts(type = "Array<{ id: string; name: string; colors: string[]; emojis: string[] }>")]
    pub custom_presets: Vec<serde_json::Value>,
    // The active live (animated) wallpaper's PatternConfig, or None when a
    // static wallpaper is set. Kept here (not a separate file) so the
    // rotation + theme-follow tasks watch it via the settings channel and
    // stand down while a live wallpaper owns the desktop. Opaque JSON —
    // Rust only persists it and checks presence; the KDE plugin renders it.
    #[serde(default)]
    #[ts(type = "unknown")]
    pub live_wallpaper: Option<serde_json::Value>,
    // The last committed static pattern's PatternConfig. Stamped by
    // renderer::apply_pattern so the tray "Random wallpaper" action can
    // re-roll the current pattern's seed without the webview running.
    // Opaque JSON for the same reason as live_wallpaper.
    #[serde(default)]
    #[ts(type = "unknown")]
    pub last_pattern: Option<serde_json::Value>,
    // Live-wallpaper render quality — caps the KDE plugin shader's internal
    // resolution + fps. `#[serde(default)]` → legacy stores land on Balanced.
    #[serde(default)]
    pub live_wallpaper_quality: LiveQuality,
    // Saved-wallpaper cache cap in whole GB; 0 = unlimited. Enforced after
    // every save (library::enforce_cache_limit): oldest files across the
    // wallpaper dirs are evicted — thumbs and library rows too — until the
    // total is back under the cap. The currently-applied wallpaper is never
    // evicted. Named default (not 0) so legacy stores land on the cap.
    #[serde(default = "default_cache_limit_gb")]
    pub cache_limit_gb: u32,
    // Global speed multiplier for live/animated wallpapers (shaders, emoji
    // drift, the Ken Burns still drift). 1.0 = the shipped pace; stamped
    // into the live spec by live::build_spec.
    #[serde(default = "default_animation_speed")]
    pub animation_speed: f32,
    // Live-clock overlay for live wallpapers. `#[serde(default)]` → legacy
    // stores land on "off" with the default placement.
    #[serde(default)]
    pub live_clock: LiveClock,
}

fn default_cache_limit_gb() -> u32 {
    2
}

fn default_animation_speed() -> f32 {
    1.0
}

// NOTE: these values must match DEFAULT_SETTINGS in src/lib/types.ts —
// the TS layer assumes both sides agree on what an unset field means.
impl Default for Settings {
    fn default() -> Self {
        Self {
            source: SourceKind::NasaApod,
            unsplash_query: String::new(),
            pexels_query: String::new(),
            wallhaven_query: String::new(),
            wallhaven_sorting: "random".to_string(),
            wallhaven_categories: "100".to_string(),
            wallhaven_purity: "100".to_string(),
            gen_provider: GenProvider::Pollinations,
            pollinations_model: "flux".to_string(),
            gen_resolution: "auto".to_string(),
            openai_model: "dall-e-3".to_string(),
            rotation_source: RotationSource::Off,
            rotation_interval_minutes: 60,
            theme_mode: ThemeMode::Auto,
            lockscreen: false,
            last_applied: None,
            custom_presets: Vec::new(),
            live_wallpaper: None,
            last_pattern: None,
            live_wallpaper_quality: LiveQuality::default(),
            cache_limit_gb: default_cache_limit_gb(),
            animation_speed: default_animation_speed(),
            live_clock: LiveClock::default(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = TS_EXPORT_DIR)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
    pub path: String,
    // `source` carries the historical origin of an entry as a free-form
    // string ("nasa-apod" | "unsplash" | "pexels" | "generated"). No
    // Rust code branches on it; the TS layer presents it as a label,
    // so a String avoids future-proofing churn when new sources arrive.
    pub source: String,
    // ts-rs maps u64 → bigint by default, but the wire is a JSON number
    // (ms since epoch, safely < 2^53) and the TS side does arithmetic on it.
    #[ts(type = "number")]
    pub added_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    // Light/dark eligibility tag. Defaults to Both for legacy entries.
    #[serde(default)]
    pub mode: WallpaperMode,
}
