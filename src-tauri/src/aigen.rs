// AI image generation commands (Pollinations, OpenAI DALL-E). Phase 3
// — moved out of TS so the OpenAI API key sits in the OS keyring
// rather than ambient.json plaintext. Mirrors sources.rs in shape:
// one Tauri command that reads settings + secrets, dispatches to the
// configured provider, downloads, prepends to library, returns Wallpaper.

use tauri::{AppHandle, Manager};

use crate::library::download_and_save;
use crate::library_store::prepend_entry;
use crate::monitor::get_primary_monitor_pixels;
use crate::secrets;
use crate::settings::SettingsState;
use crate::types::{GenProvider, Settings, Wallpaper};
use crate::util::{ms_since_epoch, pseudo_seed};

const POLLINATIONS_MAX: u32 = 2048;
const HTTP_TIMEOUT_SECS: u64 = 60;

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("build HTTP client: {}", e))
}

fn resolve_dimensions(settings: &Settings) -> (u32, u32) {
    if settings.gen_resolution != "auto" {
        if let Some((w, h)) = parse_wxh(&settings.gen_resolution) {
            return (w, h);
        }
    }
    if let Ok(info) = get_primary_monitor_pixels() {
        return (info.width, info.height);
    }
    // Higher than the Pattern apply fallback (1920×1080) because AI
    // services handle QHD natively and there's no SSAA cost at this stage.
    (2560, 1440)
}

pub(crate) fn parse_wxh(s: &str) -> Option<(u32, u32)> {
    let (w, h) = s.split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

fn clamp_to(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w <= max && h <= max {
        return (w, h);
    }
    let scale = max as f32 / w.max(h) as f32;
    (
        (w as f32 * scale).round() as u32,
        (h as f32 * scale).round() as u32,
    )
}

#[tauri::command]
pub async fn generate_wallpaper(
    prompt: String,
    app: AppHandle,
) -> Result<Wallpaper, String> {
    let settings = app.state::<SettingsState>().get().await;
    let (w, h) = resolve_dimensions(&settings);
    let entry = match settings.gen_provider {
        GenProvider::Pollinations => {
            generate_pollinations(&app, &settings, &prompt, w, h).await?
        }
        GenProvider::Openai => generate_openai(&app, &settings, &prompt, w, h).await?,
    };
    let _ = prepend_entry(&app, entry.clone()).await;
    Ok(entry)
}

async fn generate_pollinations(
    app: &AppHandle,
    settings: &Settings,
    prompt: &str,
    width: u32,
    height: u32,
) -> Result<Wallpaper, String> {
    let (w, h) = clamp_to(width, height, POLLINATIONS_MAX);
    let seed = pseudo_seed();
    let model = if settings.pollinations_model.is_empty() {
        "flux"
    } else {
        &settings.pollinations_model
    };
    // Path-segment encoding: spaces and punctuation in the prompt must
    // be percent-encoded since they're embedded in the URL path, not
    // the query string. reqwest's .query() only handles the latter.
    let encoded_prompt = urlencoding::encode(prompt);
    let url = format!(
        "https://image.pollinations.ai/prompt/{}?width={}&height={}&model={}&nologo=true&seed={}&enhance=true",
        encoded_prompt, w, h, model, seed
    );
    let filename = format!("ai-pollinations-{}.jpg", seed);
    let local_path = download_and_save(&url, &filename, app).await?;
    Ok(Wallpaper {
        path: local_path,
        source: "generated".to_string(),
        added_at: ms_since_epoch(),
        prompt: Some(prompt.to_string()),
        title: Some(truncate(prompt, 60)),
        mode: crate::types::WallpaperMode::Both,
    })
}

async fn generate_openai(
    app: &AppHandle,
    settings: &Settings,
    prompt: &str,
    width: u32,
    height: u32,
) -> Result<Wallpaper, String> {
    let key = secrets::get("openai_key")?
        .ok_or_else(|| "Set your OpenAI API key in Generate first.".to_string())?;

    let size = openai_size(width, height);
    let model = if settings.openai_model.is_empty() {
        "dall-e-3"
    } else {
        &settings.openai_model
    };
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": "hd",
        "response_format": "url",
    });
    let client = http_client()?;
    let res = client
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request: {}", e))?;
    let status = res.status();
    let resp: serde_json::Value = res
        .json()
        .await
        .unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = resp
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("OpenAI {}", status));
        return Err(msg);
    }
    let img_url = resp
        .pointer("/data/0/url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "OpenAI: no image URL returned.".to_string())?;
    let filename = format!("ai-openai-{}.png", ms_since_epoch());
    let local_path = download_and_save(img_url, &filename, app).await?;
    Ok(Wallpaper {
        path: local_path,
        source: "generated".to_string(),
        added_at: ms_since_epoch(),
        prompt: Some(prompt.to_string()),
        title: Some(truncate(prompt, 60)),
        mode: crate::types::WallpaperMode::Both,
    })
}

pub(crate) fn openai_size(w: u32, h: u32) -> &'static str {
    if w > h {
        "1792x1024"
    } else if h > w {
        "1024x1792"
    } else {
        "1024x1024"
    }
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_wxh_round_trips_common_resolutions() {
        assert_eq!(parse_wxh("1920x1080"), Some((1920, 1080)));
        assert_eq!(parse_wxh("3840x2160"), Some((3840, 2160)));
        assert_eq!(parse_wxh("5120x2880"), Some((5120, 2880)));
    }

    #[test]
    fn parse_wxh_rejects_garbage() {
        assert_eq!(parse_wxh("auto"), None);
        assert_eq!(parse_wxh(""), None);
        assert_eq!(parse_wxh("1920"), None);
        assert_eq!(parse_wxh("axb"), None);
    }

    #[test]
    fn clamp_to_preserves_under_max() {
        assert_eq!(clamp_to(1920, 1080, 2048), (1920, 1080));
        assert_eq!(clamp_to(2048, 2048, 2048), (2048, 2048));
    }

    #[test]
    fn clamp_to_scales_down_preserving_aspect() {
        // 4000 → 2048 means scale = 0.512; 3000 * 0.512 = 1536
        assert_eq!(clamp_to(4000, 3000, 2048), (2048, 1536));
    }

    #[test]
    fn openai_size_picks_landscape_portrait_square() {
        assert_eq!(openai_size(1920, 1080), "1792x1024");
        assert_eq!(openai_size(1080, 1920), "1024x1792");
        assert_eq!(openai_size(1024, 1024), "1024x1024");
    }

    #[test]
    fn truncate_respects_char_boundary() {
        // 60-char prompt
        let p = "a".repeat(120);
        assert_eq!(truncate(&p, 60).len(), 60);
        // Non-ASCII chars (each multi-byte char counts as one)
        let p = "🎨".repeat(80);
        let truncated = truncate(&p, 60);
        assert_eq!(truncated.chars().count(), 60);
    }
}
