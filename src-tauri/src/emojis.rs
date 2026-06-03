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
use std::time::Duration;

use image::DynamicImage;

const FETCH_TIMEOUT_SECS: u64 = 10;

// 211 curated Fluent 3D emoji PNGs, all 256×256 RGBA. Covers every
// emoji reachable from the UI — the seven COLOR_PRESETS, the System
// accent preset, and every glyph in the EmojiPicker grid — so neither
// picking a preset nor choosing from the picker ever drops the user
// into the (now defunct) CDN fallback path. Keys are unicode codepoints
// (lowercase hex, joined by underscore for ZWJ sequences); matches the
// JS codepointKey() logic the renderer originally used. The non-bundled
// additions were sourced as Microsoft Fluent 3D artwork via
// @lobehub/fluent-emoji-3d (codepoint-indexed) and re-encoded to PNG.
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
    m.insert("1f30b", include_bytes!("../assets/emojis/1f30b.png"));
    m.insert("1f30c", include_bytes!("../assets/emojis/1f30c.png"));
    m.insert("1f30d", include_bytes!("../assets/emojis/1f30d.png"));
    m.insert("1f30e", include_bytes!("../assets/emojis/1f30e.png"));
    m.insert("1f30f", include_bytes!("../assets/emojis/1f30f.png"));
    m.insert("1f311", include_bytes!("../assets/emojis/1f311.png"));
    m.insert("1f312", include_bytes!("../assets/emojis/1f312.png"));
    m.insert("1f313", include_bytes!("../assets/emojis/1f313.png"));
    m.insert("1f314", include_bytes!("../assets/emojis/1f314.png"));
    m.insert("1f315", include_bytes!("../assets/emojis/1f315.png"));
    m.insert("1f316", include_bytes!("../assets/emojis/1f316.png"));
    m.insert("1f317", include_bytes!("../assets/emojis/1f317.png"));
    m.insert("1f318", include_bytes!("../assets/emojis/1f318.png"));
    m.insert("1f319", include_bytes!("../assets/emojis/1f319.png"));
    m.insert("1f31b", include_bytes!("../assets/emojis/1f31b.png"));
    m.insert("1f31c", include_bytes!("../assets/emojis/1f31c.png"));
    m.insert("1f31d", include_bytes!("../assets/emojis/1f31d.png"));
    m.insert("1f31e", include_bytes!("../assets/emojis/1f31e.png"));
    m.insert("1f31f", include_bytes!("../assets/emojis/1f31f.png"));
    m.insert("1f320", include_bytes!("../assets/emojis/1f320.png"));
    m.insert("1f32d", include_bytes!("../assets/emojis/1f32d.png"));
    m.insert("1f331", include_bytes!("../assets/emojis/1f331.png"));
    m.insert("1f332", include_bytes!("../assets/emojis/1f332.png"));
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
    m.insert("1f340", include_bytes!("../assets/emojis/1f340.png"));
    m.insert("1f341", include_bytes!("../assets/emojis/1f341.png"));
    m.insert("1f342", include_bytes!("../assets/emojis/1f342.png"));
    m.insert("1f343", include_bytes!("../assets/emojis/1f343.png"));
    m.insert("1f344", include_bytes!("../assets/emojis/1f344.png"));
    m.insert("1f347", include_bytes!("../assets/emojis/1f347.png"));
    m.insert("1f349", include_bytes!("../assets/emojis/1f349.png"));
    m.insert("1f34c", include_bytes!("../assets/emojis/1f34c.png"));
    m.insert("1f34e", include_bytes!("../assets/emojis/1f34e.png"));
    m.insert("1f351", include_bytes!("../assets/emojis/1f351.png"));
    m.insert("1f352", include_bytes!("../assets/emojis/1f352.png"));
    m.insert("1f353", include_bytes!("../assets/emojis/1f353.png"));
    m.insert("1f354", include_bytes!("../assets/emojis/1f354.png"));
    m.insert("1f355", include_bytes!("../assets/emojis/1f355.png"));
    m.insert("1f35f", include_bytes!("../assets/emojis/1f35f.png"));
    m.insert("1f361", include_bytes!("../assets/emojis/1f361.png"));
    m.insert("1f369", include_bytes!("../assets/emojis/1f369.png"));
    m.insert("1f36a", include_bytes!("../assets/emojis/1f36a.png"));
    m.insert("1f36b", include_bytes!("../assets/emojis/1f36b.png"));
    m.insert("1f36c", include_bytes!("../assets/emojis/1f36c.png"));
    m.insert("1f36d", include_bytes!("../assets/emojis/1f36d.png"));
    m.insert("1f370", include_bytes!("../assets/emojis/1f370.png"));
    m.insert("1f37a", include_bytes!("../assets/emojis/1f37a.png"));
    m.insert("1f37f", include_bytes!("../assets/emojis/1f37f.png"));
    m.insert("1f380", include_bytes!("../assets/emojis/1f380.png"));
    m.insert("1f381", include_bytes!("../assets/emojis/1f381.png"));
    m.insert("1f382", include_bytes!("../assets/emojis/1f382.png"));
    m.insert("1f383", include_bytes!("../assets/emojis/1f383.png"));
    m.insert("1f388", include_bytes!("../assets/emojis/1f388.png"));
    m.insert("1f389", include_bytes!("../assets/emojis/1f389.png"));
    m.insert("1f38a", include_bytes!("../assets/emojis/1f38a.png"));
    m.insert("1f3a1", include_bytes!("../assets/emojis/1f3a1.png"));
    m.insert("1f3a4", include_bytes!("../assets/emojis/1f3a4.png"));
    m.insert("1f3a7", include_bytes!("../assets/emojis/1f3a7.png"));
    m.insert("1f3a8", include_bytes!("../assets/emojis/1f3a8.png"));
    m.insert("1f3ae", include_bytes!("../assets/emojis/1f3ae.png"));
    m.insert("1f3af", include_bytes!("../assets/emojis/1f3af.png"));
    m.insert("1f3b5", include_bytes!("../assets/emojis/1f3b5.png"));
    m.insert("1f3b6", include_bytes!("../assets/emojis/1f3b6.png"));
    m.insert("1f3b8", include_bytes!("../assets/emojis/1f3b8.png"));
    m.insert("1f3b9", include_bytes!("../assets/emojis/1f3b9.png"));
    m.insert("1f3ba", include_bytes!("../assets/emojis/1f3ba.png"));
    m.insert("1f3c6", include_bytes!("../assets/emojis/1f3c6.png"));
    m.insert("1f3ce", include_bytes!("../assets/emojis/1f3ce.png"));
    m.insert("1f3d4", include_bytes!("../assets/emojis/1f3d4.png"));
    m.insert("1f3d5", include_bytes!("../assets/emojis/1f3d5.png"));
    m.insert("1f3dd", include_bytes!("../assets/emojis/1f3dd.png"));
    m.insert("1f414", include_bytes!("../assets/emojis/1f414.png"));
    m.insert("1f419", include_bytes!("../assets/emojis/1f419.png"));
    m.insert("1f41a", include_bytes!("../assets/emojis/1f41a.png"));
    m.insert("1f41d", include_bytes!("../assets/emojis/1f41d.png"));
    m.insert("1f41e", include_bytes!("../assets/emojis/1f41e.png"));
    m.insert("1f41f", include_bytes!("../assets/emojis/1f41f.png"));
    m.insert("1f420", include_bytes!("../assets/emojis/1f420.png"));
    m.insert("1f421", include_bytes!("../assets/emojis/1f421.png"));
    m.insert("1f422", include_bytes!("../assets/emojis/1f422.png"));
    m.insert("1f427", include_bytes!("../assets/emojis/1f427.png"));
    m.insert("1f42c", include_bytes!("../assets/emojis/1f42c.png"));
    m.insert("1f42f", include_bytes!("../assets/emojis/1f42f.png"));
    m.insert("1f430", include_bytes!("../assets/emojis/1f430.png"));
    m.insert("1f431", include_bytes!("../assets/emojis/1f431.png"));
    m.insert("1f433", include_bytes!("../assets/emojis/1f433.png"));
    m.insert("1f435", include_bytes!("../assets/emojis/1f435.png"));
    m.insert("1f436", include_bytes!("../assets/emojis/1f436.png"));
    m.insert("1f438", include_bytes!("../assets/emojis/1f438.png"));
    m.insert("1f43b", include_bytes!("../assets/emojis/1f43b.png"));
    m.insert("1f43c", include_bytes!("../assets/emojis/1f43c.png"));
    m.insert("1f451", include_bytes!("../assets/emojis/1f451.png"));
    m.insert("1f47b", include_bytes!("../assets/emojis/1f47b.png"));
    m.insert("1f480", include_bytes!("../assets/emojis/1f480.png"));
    m.insert("1f48e", include_bytes!("../assets/emojis/1f48e.png"));
    m.insert("1f490", include_bytes!("../assets/emojis/1f490.png"));
    m.insert("1f493", include_bytes!("../assets/emojis/1f493.png"));
    m.insert("1f495", include_bytes!("../assets/emojis/1f495.png"));
    m.insert("1f496", include_bytes!("../assets/emojis/1f496.png"));
    m.insert("1f497", include_bytes!("../assets/emojis/1f497.png"));
    m.insert("1f499", include_bytes!("../assets/emojis/1f499.png"));
    m.insert("1f49a", include_bytes!("../assets/emojis/1f49a.png"));
    m.insert("1f49b", include_bytes!("../assets/emojis/1f49b.png"));
    m.insert("1f49c", include_bytes!("../assets/emojis/1f49c.png"));
    m.insert("1f49e", include_bytes!("../assets/emojis/1f49e.png"));
    m.insert("1f49f", include_bytes!("../assets/emojis/1f49f.png"));
    m.insert("1f4a0", include_bytes!("../assets/emojis/1f4a0.png"));
    m.insert("1f4a1", include_bytes!("../assets/emojis/1f4a1.png"));
    m.insert("1f4a7", include_bytes!("../assets/emojis/1f4a7.png"));
    m.insert("1f4ab", include_bytes!("../assets/emojis/1f4ab.png"));
    m.insert("1f4af", include_bytes!("../assets/emojis/1f4af.png"));
    m.insert("1f4f7", include_bytes!("../assets/emojis/1f4f7.png"));
    m.insert("1f514", include_bytes!("../assets/emojis/1f514.png"));
    m.insert("1f518", include_bytes!("../assets/emojis/1f518.png"));
    m.insert("1f525", include_bytes!("../assets/emojis/1f525.png"));
    m.insert("1f52e", include_bytes!("../assets/emojis/1f52e.png"));
    m.insert("1f535", include_bytes!("../assets/emojis/1f535.png"));
    m.insert("1f537", include_bytes!("../assets/emojis/1f537.png"));
    m.insert("1f539", include_bytes!("../assets/emojis/1f539.png"));
    m.insert("1f53a", include_bytes!("../assets/emojis/1f53a.png"));
    m.insert("1f577", include_bytes!("../assets/emojis/1f577.png"));
    m.insert("1f578", include_bytes!("../assets/emojis/1f578.png"));
    m.insert("1f579", include_bytes!("../assets/emojis/1f579.png"));
    m.insert("1f5a4", include_bytes!("../assets/emojis/1f5a4.png"));
    m.insert("1f5fa", include_bytes!("../assets/emojis/1f5fa.png"));
    m.insert("1f600", include_bytes!("../assets/emojis/1f600.png"));
    m.insert("1f601", include_bytes!("../assets/emojis/1f601.png"));
    m.insert("1f602", include_bytes!("../assets/emojis/1f602.png"));
    m.insert("1f603", include_bytes!("../assets/emojis/1f603.png"));
    m.insert("1f604", include_bytes!("../assets/emojis/1f604.png"));
    m.insert("1f605", include_bytes!("../assets/emojis/1f605.png"));
    m.insert("1f607", include_bytes!("../assets/emojis/1f607.png"));
    m.insert("1f60a", include_bytes!("../assets/emojis/1f60a.png"));
    m.insert("1f60b", include_bytes!("../assets/emojis/1f60b.png"));
    m.insert("1f60d", include_bytes!("../assets/emojis/1f60d.png"));
    m.insert("1f60e", include_bytes!("../assets/emojis/1f60e.png"));
    m.insert("1f618", include_bytes!("../assets/emojis/1f618.png"));
    m.insert("1f61c", include_bytes!("../assets/emojis/1f61c.png"));
    m.insert("1f62a", include_bytes!("../assets/emojis/1f62a.png"));
    m.insert("1f62d", include_bytes!("../assets/emojis/1f62d.png"));
    m.insert("1f634", include_bytes!("../assets/emojis/1f634.png"));
    m.insert("1f642", include_bytes!("../assets/emojis/1f642.png"));
    m.insert("1f680", include_bytes!("../assets/emojis/1f680.png"));
    m.insert("1f681", include_bytes!("../assets/emojis/1f681.png"));
    m.insert("1f697", include_bytes!("../assets/emojis/1f697.png"));
    m.insert("1f6a2", include_bytes!("../assets/emojis/1f6a2.png"));
    m.insert("1f6b2", include_bytes!("../assets/emojis/1f6b2.png"));
    m.insert("1f6f5", include_bytes!("../assets/emojis/1f6f5.png"));
    m.insert("1f7e6", include_bytes!("../assets/emojis/1f7e6.png"));
    m.insert("1f90d", include_bytes!("../assets/emojis/1f90d.png"));
    m.insert("1f90e", include_bytes!("../assets/emojis/1f90e.png"));
    m.insert("1f914", include_bytes!("../assets/emojis/1f914.png"));
    m.insert("1f917", include_bytes!("../assets/emojis/1f917.png"));
    m.insert("1f923", include_bytes!("../assets/emojis/1f923.png"));
    m.insert("1f924", include_bytes!("../assets/emojis/1f924.png"));
    m.insert("1f929", include_bytes!("../assets/emojis/1f929.png"));
    m.insert("1f92a", include_bytes!("../assets/emojis/1f92a.png"));
    m.insert("1f92f", include_bytes!("../assets/emojis/1f92f.png"));
    m.insert("1f941", include_bytes!("../assets/emojis/1f941.png"));
    m.insert("1f951", include_bytes!("../assets/emojis/1f951.png"));
    m.insert("1f970", include_bytes!("../assets/emojis/1f970.png"));
    m.insert("1f973", include_bytes!("../assets/emojis/1f973.png"));
    m.insert("1f97a", include_bytes!("../assets/emojis/1f97a.png"));
    m.insert("1f980", include_bytes!("../assets/emojis/1f980.png"));
    m.insert("1f981", include_bytes!("../assets/emojis/1f981.png"));
    m.insert("1f984", include_bytes!("../assets/emojis/1f984.png"));
    m.insert("1f987", include_bytes!("../assets/emojis/1f987.png"));
    m.insert("1f988", include_bytes!("../assets/emojis/1f988.png"));
    m.insert("1f98a", include_bytes!("../assets/emojis/1f98a.png"));
    m.insert("1f98b", include_bytes!("../assets/emojis/1f98b.png"));
    m.insert("1f993", include_bytes!("../assets/emojis/1f993.png"));
    m.insert("1f996", include_bytes!("../assets/emojis/1f996.png"));
    m.insert("1f9a9", include_bytes!("../assets/emojis/1f9a9.png"));
    m.insert("1f9c1", include_bytes!("../assets/emojis/1f9c1.png"));
    m.insert("1f9d9", include_bytes!("../assets/emojis/1f9d9.png"));
    m.insert("1f9e1", include_bytes!("../assets/emojis/1f9e1.png"));
    m.insert("1f9ed", include_bytes!("../assets/emojis/1f9ed.png"));
    m.insert("1f9f8", include_bytes!("../assets/emojis/1f9f8.png"));
    m.insert("1fa70", include_bytes!("../assets/emojis/1fa70.png"));
    m.insert("1fa84", include_bytes!("../assets/emojis/1fa84.png"));
    m.insert("1fa90", include_bytes!("../assets/emojis/1fa90.png"));
    m.insert("1fab8", include_bytes!("../assets/emojis/1fab8.png"));
    m.insert("2600", include_bytes!("../assets/emojis/2600.png"));
    m.insert("2601", include_bytes!("../assets/emojis/2601.png"));
    m.insert("2604", include_bytes!("../assets/emojis/2604.png"));
    m.insert("2615", include_bytes!("../assets/emojis/2615.png"));
    m.insert("2618", include_bytes!("../assets/emojis/2618.png"));
    m.insert("26a1", include_bytes!("../assets/emojis/26a1.png"));
    m.insert("26b0", include_bytes!("../assets/emojis/26b0.png"));
    m.insert("26f5", include_bytes!("../assets/emojis/26f5.png"));
    m.insert("2708", include_bytes!("../assets/emojis/2708.png"));
    m.insert("2728", include_bytes!("../assets/emojis/2728.png"));
    m.insert("2744", include_bytes!("../assets/emojis/2744.png"));
    m.insert("2764", include_bytes!("../assets/emojis/2764.png"));
    m.insert("2b1b", include_bytes!("../assets/emojis/2b1b.png"));
    m.insert("2b1c", include_bytes!("../assets/emojis/2b1c.png"));
    m.insert("2b50", include_bytes!("../assets/emojis/2b50.png"));
    m
});

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
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
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

}
