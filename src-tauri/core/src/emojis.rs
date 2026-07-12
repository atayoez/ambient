// Bundled Fluent 3D emoji assets. The full set of emojis the UI can
// produce — every COLOR_PRESET, the System accent preset, and every
// glyph in the EmojiPicker grid — ships inside the binary via
// include_bytes!, so emoji rendering is fully offline with no network
// dependency. There is no free-text emoji entry, so the bundle is the
// complete universe of inputs; an unbundled key simply doesn't render.
//
// (Earlier builds fell back to emojicdn.elk.sh for unbundled glyphs,
// but that endpoint dropped its `microsoft` style — so the fallback
// both stopped working and became unreachable once the bundle went
// complete. It was removed rather than left as dead code.)

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

use image::DynamicImage;

const FETCH_TIMEOUT_SECS: u64 = 10;

// The curated Fluent 3D emoji PNGs (256×256 RGBA) live in assets/emojis/;
// core/build.rs turns that directory listing into BUNDLED_ENTRIES at build
// time (filename minus .png = codepoint key — lowercase hex, joined by
// underscore for ZWJ sequences, matching codepoint_key below). The set
// covers every emoji reachable from the UI — the COLOR_PRESETS, the System
// accent preset, and every glyph in the EmojiPicker grid — so neither
// picking a preset nor choosing from the picker ever needs the network.
// Adding an emoji to the bundle = dropping its PNG into assets/emojis/.
// The artwork is Microsoft Fluent 3D via @lobehub/fluent-emoji-3d
// (codepoint-indexed), re-encoded to PNG.
//
// 1f9d9 (🧙 Mage) doesn't have a gender-neutral 3D asset in the
// fluentui-emoji repo — Microsoft only ships the gendered
// "Man mage" variant in 3D, which is what we bundle.
include!(concat!(env!("OUT_DIR"), "/emoji_bundle.rs"));

static BUNDLED: LazyLock<HashMap<&'static str, &'static [u8]>> =
    LazyLock::new(|| BUNDLED_ENTRIES.iter().copied().collect());

// Process-lifetime decoded image cache. Decode is the expensive step;
// loaders hit this map first and decode only on miss.
static DECODED: LazyLock<RwLock<HashMap<String, DynamicImage>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

// On-disk cache dir for glyphs fetched on demand (the picker now offers
// the full Unicode emoji set, far more than we bundle). Set at startup.
static CACHE_DIR: LazyLock<RwLock<Option<PathBuf>>> = LazyLock::new(|| RwLock::new(None));

/// Point the on-disk emoji cache at app_data/emoji_cache. Call once at
/// startup. Without it, fetched glyphs still render (cached in DECODED
/// for the session) but aren't persisted across launches.
pub fn init(app_data_dir: &Path) {
    *CACHE_DIR.write().expect("emoji cache dir lock") =
        Some(app_data_dir.join("emoji_cache"));
}

fn cache_path(key: &str) -> Option<PathBuf> {
    let dir = CACHE_DIR.read().expect("cache dir lock").clone()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join(format!("{key}.png")))
}

/// Convert an emoji cluster (single emoji char or ZWJ sequence) to the
/// codepoint key. Strips VS16 (U+FE0F) and joins remaining codepoints
/// with `_`.
pub fn codepoint_key(emoji: &str) -> String {
    emoji
        .chars()
        .filter(|c| *c as u32 != 0xFE0F)
        .map(|c| format!("{:x}", c as u32))
        .collect::<Vec<_>>()
        .join("_")
}

/// Load a decoded emoji image WITHOUT network access (sync — safe inside
/// spawn_blocking). Resolution order: in-memory cache → bundled asset →
/// on-disk cache from a prior fetch. Returns None for anything not yet
/// available locally; `preload` fetches those over the network first.
pub fn load(emoji: &str) -> Option<DynamicImage> {
    let key = codepoint_key(emoji);
    if key.is_empty() {
        return None;
    }

    if let Some(img) = DECODED.read().expect("decoded lock").get(&key).cloned() {
        return Some(img);
    }

    if let Some(&bytes) = BUNDLED.get(key.as_str()) {
        let img = image::load_from_memory(bytes).ok()?;
        DECODED.write().expect("decoded lock").insert(key, img.clone());
        return Some(img);
    }

    // Previously fetched + persisted to disk.
    if let Some(path) = cache_path(&key) {
        if let Ok(img) = image::open(&path) {
            DECODED.write().expect("decoded lock").insert(key, img.clone());
            return Some(img);
        }
    }

    None
}

/// Async: for every emoji not already loadable, fetch its Fluent 3D
/// artwork (codepoint-indexed via @lobehub/fluent-emoji-3d on jsDelivr),
/// decode it, and persist to the disk cache so the subsequent sync
/// `load` calls inside the renderer hit cache. Best-effort — a glyph that
/// fails to fetch simply renders blank for that tile. Call before
/// rendering an emoji pattern (apply_pattern / render_preview).
pub async fn preload(emojis: &[String]) {
    let needed: Vec<String> = emojis
        .iter()
        .filter(|e| load(e).is_none())
        .cloned()
        .collect();
    if needed.is_empty() {
        return;
    }
    let client = match crate::util::http_client(FETCH_TIMEOUT_SECS) {
        Ok(c) => c,
        Err(_) => return,
    };
    for emoji in needed {
        let _ = fetch_and_cache(&emoji, &client).await;
    }
}

/// Materialize each emoji's Fluent 3D artwork as a PNG file on disk and
/// return its absolute path, so out-of-process renderers (the KDE Plasma
/// wallpaper plugin's QML) can show the same 3D art the in-app renderer
/// composites instead of falling back to flat system-font glyphs. Bundled
/// glyphs are written into the fetch cache dir on first use (raw bytes are
/// already PNG); fetched glyphs are already there. Returns one entry per
/// input, parallel to `emojis`; an unavailable glyph maps to an empty string
/// (callers/QML fall back to a text glyph for that tile).
pub async fn export_pngs(emojis: &[String]) -> Vec<String> {
    preload(emojis).await;
    emojis
        .iter()
        .map(|emoji| {
            let key = codepoint_key(emoji);
            if key.is_empty() {
                return String::new();
            }
            let Some(path) = cache_path(&key) else {
                return String::new();
            };
            if !path.exists() {
                match BUNDLED.get(key.as_str()) {
                    Some(&bytes) => {
                        if std::fs::write(&path, bytes).is_err() {
                            return String::new();
                        }
                    }
                    // Not bundled and preload didn't land it on disk
                    // (offline / fetch failed).
                    None => return String::new(),
                }
            }
            path.to_string_lossy().into_owned()
        })
        .collect()
}

async fn fetch_and_cache(emoji: &str, client: &reqwest::Client) -> Option<()> {
    let key = codepoint_key(emoji);
    // LobeHub keys VS16 emoji with a `-fe0f` suffix; our key strips VS16,
    // so try the bare codepoint then the suffixed form.
    const BASE: &str = "https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-3d/assets";
    let mut bytes = None;
    for name in [format!("{key}.webp"), format!("{key}-fe0f.webp")] {
        if let Ok(resp) = client.get(format!("{BASE}/{name}")).send().await {
            if resp.status().is_success() {
                if let Ok(b) = resp.bytes().await {
                    bytes = Some(b);
                    break;
                }
            }
        }
    }
    let img = image::load_from_memory(&bytes?).ok()?;
    if let Some(path) = cache_path(&key) {
        let _ = img.save(&path); // PNG by extension; persists for next launch
    }
    DECODED.write().ok()?.insert(key, img);
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codepoint_key_strips_vs16() {
        // ⭐ U+2B50
        assert_eq!(codepoint_key("⭐"), "2b50");
        // ✨ U+2728
        assert_eq!(codepoint_key("✨"), "2728");
        // ☄️ = U+2604 + U+FE0F → 2604 only
        assert_eq!(codepoint_key("☄️"), "2604");
    }

    #[test]
    fn codepoint_key_joins_zwj_sequences() {
        // Single multi-codepoint emoji (e.g. 🌙 is a single codepoint)
        assert_eq!(codepoint_key("🌙"), "1f319");
        // 🦄 unicorn
        assert_eq!(codepoint_key("🦄"), "1f984");
    }

    #[test]
    fn bundled_lookup_finds_curated_set() {
        assert!(BUNDLED.contains_key("2728"));
        assert!(BUNDLED.contains_key("1f984"));
        assert!(BUNDLED.contains_key("2600"));
    }

    #[test]
    fn load_decodes_bundled() {
        let img = load("✨").expect("sparkles should load");
        // Fluent 3D PNGs are 256x256
        assert!(img.width() > 0 && img.height() > 0);
    }

    #[tokio::test]
    async fn export_pngs_materializes_bundled_glyphs() {
        let tmp = std::env::temp_dir().join("ambient-test-emoji-export");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        init(&tmp);

        let paths = export_pngs(&["✨".to_string(), "🦄".to_string()]).await;
        assert_eq!(paths.len(), 2);
        for path in &paths {
            assert!(!path.is_empty(), "bundled glyph should export");
            let img = image::open(path).expect("exported file should be a decodable PNG");
            assert!(img.width() > 0);
        }

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
