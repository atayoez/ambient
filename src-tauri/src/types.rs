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
    pub theme_follow_light_path: Option<String>,
    pub theme_follow_dark_path: Option<String>,
    // Newly introduced in Phase 1. `#[serde(default)]` so legacy stores
    // without this field deserialize cleanly to None.
    #[serde(default)]
    pub last_applied: Option<String>,
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
            theme_follow_light_path: None,
            theme_follow_dark_path: None,
            last_applied: None,
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
}
