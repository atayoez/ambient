// Shared serializable types. Mirror the TS interfaces in
// `src/lib/types.ts` field-for-field via `#[serde(rename_all = "camelCase")]`
// so the wire format is identical and the TS layer can keep using
// its existing PascalCase interfaces unchanged.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    NasaApod,
    Unsplash,
    Pexels,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GenProvider {
    Pollinations,
    Openai,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RotationSource {
    Off,
    Sources,
    Library,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
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
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub source: SourceKind,
    pub unsplash_query: String,
    pub pexels_query: String,
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
    pub custom_presets: Vec<serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            source: SourceKind::NasaApod,
            unsplash_query: String::new(),
            pexels_query: String::new(),
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
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
    pub path: String,
    // `source` carries the historical origin of an entry as a free-form
    // string ("nasa-apod" | "unsplash" | "pexels" | "generated"). No
    // Rust code branches on it; the TS layer presents it as a label,
    // so a String avoids future-proofing churn when new sources arrive.
    pub source: String,
    pub added_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    // Light/dark eligibility tag. Defaults to Both for legacy entries.
    #[serde(default)]
    pub mode: WallpaperMode,
}
