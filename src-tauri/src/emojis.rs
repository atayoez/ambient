// Bundled Fluent 3D emoji assets + on-demand CDN fallback. The
// curated set of ~40 wallpaper-friendly emojis ships inside the binary
// via include_bytes!, so Pattern apply works with zero network access
// for the common case. Anything outside the curated map falls back to
// emojicdn.elk.sh, persisted under app_data/emoji_cache/<key>.png so
// repeat encounters of the same custom emoji don't re-hit the network.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

use image::DynamicImage;

const CDN_TIMEOUT_SECS: u64 = 10;

// 84 curated Fluent 3D emoji PNGs, ~22-40KB each, all 256×256 RGBA.
// Total binary impact: ~2.9 MB. Covers every emoji used by the seven
// COLOR_PRESETS in src/lib/patterns.ts so picking a preset never
// drops the user into the CDN fallback path. Keys are unicode
// codepoints (lowercase hex, joined by underscore for ZWJ sequences);
// matches the JS codepointKey() logic the renderer originally used.
//
// 1f9d9 (🧙 Mage) doesn't have a gender-neutral 3D asset in the
// fluentui-emoji repo — Microsoft only ships the gendered
// "Man mage" variant in 3D, which is what we bundle here.
static BUNDLED: LazyLock<HashMap<&'static str, &'static [u8]>> = LazyLock::new(|| {
    let mut m: HashMap<&'static str, &'static [u8]> = HashMap::new();
    m.insert("1f305", include_bytes!("../assets/emojis/1f305.png"));
    m.insert("1f307", include_bytes!("../assets/emojis/1f307.png"));
    m.insert("1f308", include_bytes!("../assets/emojis/1f308.png"));
    m.insert("1f30a", include_bytes!("../assets/emojis/1f30a.png"));
    m.insert("1f30c", include_bytes!("../assets/emojis/1f30c.png"));
    m.insert("1f311", include_bytes!("../assets/emojis/1f311.png"));
    m.insert("1f312", include_bytes!("../assets/emojis/1f312.png"));
    m.insert("1f313", include_bytes!("../assets/emojis/1f313.png"));
    m.insert("1f314", include_bytes!("../assets/emojis/1f314.png"));
    m.insert("1f315", include_bytes!("../assets/emojis/1f315.png"));
    m.insert("1f316", include_bytes!("../assets/emojis/1f316.png"));
    m.insert("1f317", include_bytes!("../assets/emojis/1f317.png"));
    m.insert("1f318", include_bytes!("../assets/emojis/1f318.png"));
    m.insert("1f319", include_bytes!("../assets/emojis/1f319.png"));
    m.insert("1f31e", include_bytes!("../assets/emojis/1f31e.png"));
    m.insert("1f31f", include_bytes!("../assets/emojis/1f31f.png"));
    m.insert("1f320", include_bytes!("../assets/emojis/1f320.png"));
    m.insert("1f331", include_bytes!("../assets/emojis/1f331.png"));
    m.insert("1f333", include_bytes!("../assets/emojis/1f333.png"));
    m.insert("1f334", include_bytes!("../assets/emojis/1f334.png"));
    m.insert("1f335", include_bytes!("../assets/emojis/1f335.png"));
    m.insert("1f337", include_bytes!("../assets/emojis/1f337.png"));
    m.insert("1f338", include_bytes!("../assets/emojis/1f338.png"));
    m.insert("1f339", include_bytes!("../assets/emojis/1f339.png"));
    m.insert("1f33a", include_bytes!("../assets/emojis/1f33a.png"));
    m.insert("1f33b", include_bytes!("../assets/emojis/1f33b.png"));
    m.insert("1f33c", include_bytes!("../assets/emojis/1f33c.png"));
    m.insert("1f33e", include_bytes!("../assets/emojis/1f33e.png"));
    m.insert("1f33f", include_bytes!("../assets/emojis/1f33f.png"));
    m.insert("1f343", include_bytes!("../assets/emojis/1f343.png"));
    m.insert("1f344", include_bytes!("../assets/emojis/1f344.png"));
    m.insert("1f351", include_bytes!("../assets/emojis/1f351.png"));
    m.insert("1f352", include_bytes!("../assets/emojis/1f352.png"));
    m.insert("1f353", include_bytes!("../assets/emojis/1f353.png"));
    m.insert("1f361", include_bytes!("../assets/emojis/1f361.png"));
    m.insert("1f36c", include_bytes!("../assets/emojis/1f36c.png"));
    m.insert("1f380", include_bytes!("../assets/emojis/1f380.png"));
    m.insert("1f381", include_bytes!("../assets/emojis/1f381.png"));
    m.insert("1f382", include_bytes!("../assets/emojis/1f382.png"));
    m.insert("1f383", include_bytes!("../assets/emojis/1f383.png"));
    m.insert("1f388", include_bytes!("../assets/emojis/1f388.png"));
    m.insert("1f389", include_bytes!("../assets/emojis/1f389.png"));
    m.insert("1f38a", include_bytes!("../assets/emojis/1f38a.png"));
    m.insert("1f3dd", include_bytes!("../assets/emojis/1f3dd.png"));
    m.insert("1f419", include_bytes!("../assets/emojis/1f419.png"));
    m.insert("1f41a", include_bytes!("../assets/emojis/1f41a.png"));
    m.insert("1f41d", include_bytes!("../assets/emojis/1f41d.png"));
    m.insert("1f420", include_bytes!("../assets/emojis/1f420.png"));
    m.insert("1f421", include_bytes!("../assets/emojis/1f421.png"));
    m.insert("1f430", include_bytes!("../assets/emojis/1f430.png"));
    m.insert("1f433", include_bytes!("../assets/emojis/1f433.png"));
    m.insert("1f47b", include_bytes!("../assets/emojis/1f47b.png"));
    m.insert("1f480", include_bytes!("../assets/emojis/1f480.png"));
    m.insert("1f48e", include_bytes!("../assets/emojis/1f48e.png"));
    m.insert("1f499", include_bytes!("../assets/emojis/1f499.png"));
    m.insert("1f49a", include_bytes!("../assets/emojis/1f49a.png"));
    m.insert("1f49b", include_bytes!("../assets/emojis/1f49b.png"));
    m.insert("1f49c", include_bytes!("../assets/emojis/1f49c.png"));
    m.insert("1f4ab", include_bytes!("../assets/emojis/1f4ab.png"));
    m.insert("1f525", include_bytes!("../assets/emojis/1f525.png"));
    m.insert("1f577", include_bytes!("../assets/emojis/1f577.png"));
    m.insert("1f578", include_bytes!("../assets/emojis/1f578.png"));
    m.insert("1f980", include_bytes!("../assets/emojis/1f980.png"));
    m.insert("1f984", include_bytes!("../assets/emojis/1f984.png"));
    m.insert("1f987", include_bytes!("../assets/emojis/1f987.png"));
    m.insert("1f988", include_bytes!("../assets/emojis/1f988.png"));
    m.insert("1f98b", include_bytes!("../assets/emojis/1f98b.png"));
    m.insert("1f9a9", include_bytes!("../assets/emojis/1f9a9.png"));
    m.insert("1f9d9", include_bytes!("../assets/emojis/1f9d9.png"));
    m.insert("1f9e1", include_bytes!("../assets/emojis/1f9e1.png"));
    m.insert("1f9f8", include_bytes!("../assets/emojis/1f9f8.png"));
    m.insert("1fa70", include_bytes!("../assets/emojis/1fa70.png"));
    m.insert("1fa84", include_bytes!("../assets/emojis/1fa84.png"));
    m.insert("1fa90", include_bytes!("../assets/emojis/1fa90.png"));
    m.insert("1fab8", include_bytes!("../assets/emojis/1fab8.png"));
    m.insert("2600", include_bytes!("../assets/emojis/2600.png"));
    m.insert("2601", include_bytes!("../assets/emojis/2601.png"));
    m.insert("2604", include_bytes!("../assets/emojis/2604.png"));
    m.insert("26a1", include_bytes!("../assets/emojis/26a1.png"));
    m.insert("26b0", include_bytes!("../assets/emojis/26b0.png"));
    m.insert("26f5", include_bytes!("../assets/emojis/26f5.png"));
    m.insert("2728", include_bytes!("../assets/emojis/2728.png"));
    m.insert("2764", include_bytes!("../assets/emojis/2764.png"));
    m.insert("2b50", include_bytes!("../assets/emojis/2b50.png"));
    m
});

// Process-lifetime decoded image cache. PNG decode is the expensive
// step; loaders hit this map first and decode only on miss.
static DECODED: LazyLock<RwLock<HashMap<String, DynamicImage>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

// CDN cache directory — populated lazily on first miss. Set during
// app setup via init().
static CACHE_DIR: LazyLock<RwLock<Option<PathBuf>>> =
    LazyLock::new(|| RwLock::new(None));

pub fn init(app_data_dir: &Path) {
    *CACHE_DIR.write().expect("emoji cache dir lock") =
        Some(app_data_dir.join("emoji_cache"));
}

/// Convert an emoji cluster (single emoji char or ZWJ sequence) to the
/// codepoint key used by both the bundled HashMap and the CDN cache
/// filename. Mirrors JS `codepointKey` in pre-Phase-5 patterns.ts —
/// strips VS16 (U+FE0F) and joins remaining codepoints with `_`.
pub fn codepoint_key(emoji: &str) -> String {
    emoji
        .chars()
        .filter(|c| *c as u32 != 0xFE0F)
        .map(|c| format!("{:x}", c as u32))
        .collect::<Vec<_>>()
        .join("_")
}

/// Try to load a decoded emoji image WITHOUT network access. Returns
/// None if the emoji isn't bundled and hasn't been cached on disk by
/// a prior preload. Renderer uses this — fully sync, safe to call
/// from inside spawn_blocking.
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
        DECODED
            .write()
            .expect("decoded lock")
            .insert(key.clone(), img.clone());
        return Some(img);
    }

    if let Some(path) = cdn_cache_path(&key) {
        if let Ok(img) = image::open(&path) {
            DECODED
                .write()
                .expect("decoded lock")
                .insert(key.clone(), img.clone());
            return Some(img);
        }
    }

    None
}

/// Async preload — for every emoji in the input that isn't already
/// loadable via `load()`, fetch from emojicdn.elk.sh and persist into
/// app_data/emoji_cache/. Call this in apply_pattern / before
/// rendering preview so the subsequent sync renderer hits cache. Best-
/// effort: individual CDN failures are silently ignored (the emoji
/// just won't render at all for that glyph).
pub async fn preload(emojis: &[String]) {
    let needed: Vec<String> = emojis
        .iter()
        .filter(|e| load(e).is_none())
        .cloned()
        .collect();
    if needed.is_empty() {
        return;
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CDN_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    for emoji in needed {
        let _ = fetch_and_cache(&emoji, &client).await;
    }
}

async fn fetch_and_cache(emoji: &str, client: &reqwest::Client) -> Option<()> {
    let key = codepoint_key(emoji);
    let url = format!(
        "https://emojicdn.elk.sh/{}?style=microsoft",
        urlencoding::encode(emoji)
    );
    let bytes = client.get(&url).send().await.ok()?.bytes().await.ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    if let Some(path) = cdn_cache_path(&key) {
        let _ = img.save(&path);
    }
    DECODED.write().ok()?.insert(key, img);
    Some(())
}

fn cdn_cache_path(key: &str) -> Option<PathBuf> {
    let dir = CACHE_DIR.read().expect("cache dir lock").clone()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join(format!("{}.png", key)))
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
}
