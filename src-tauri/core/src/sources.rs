// Image-source fetchers (NASA APOD, Unsplash, Pexels) running entirely
// in Rust. Phase 3 collapsed the pre-existing two-step pattern
// (JS: get URL from source API → JS: invoke download command) into a
// single Rust command — `fetch_source_wallpaper` reads settings, pulls
// the relevant key from the OS keyring (via secrets.rs), calls the
// source API, downloads the image, prepends to the library, and
// returns the new Wallpaper entry to the frontend.

use std::sync::LazyLock;

use tokio::sync::RwLock;

use crate::library::download_and_save;
use crate::library_store::prepend_entry;
use crate::secrets;
use crate::types::{Settings, SourceKind, Wallpaper};
use crate::util::{local_today_key, ms_since_epoch};

const HTTP_TIMEOUT_SECS: u64 = 30;

#[derive(Clone)]
struct ApodCache {
    date: String,
    path: String,
    title: Option<String>,
}

// NASA APOD publishes once per day. Cache the fetched local path +
// title in-process so repeat clicks (or multiple rotation ticks within
// a day) skip the API call and re-apply the existing file.
static APOD_CACHE: LazyLock<RwLock<Option<ApodCache>>> =
    LazyLock::new(|| RwLock::new(None));

fn http_client() -> Result<reqwest::Client, String> {
    crate::util::http_client(HTTP_TIMEOUT_SECS)
}

fn source_name(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::NasaApod => "nasa-apod",
        SourceKind::Bing => "bing",
        SourceKind::Unsplash => "unsplash",
        SourceKind::Pexels => "pexels",
        SourceKind::Wallhaven => "wallhaven",
        SourceKind::Picsum => "picsum",
    }
}

pub async fn fetch_source_wallpaper() -> Result<Wallpaper, String> {
    let settings = crate::state::settings().get().await;
    let entry = match settings.source {
        SourceKind::NasaApod => fetch_nasa_apod().await?,
        SourceKind::Bing => fetch_bing().await?,
        SourceKind::Unsplash => fetch_unsplash(&settings).await?,
        SourceKind::Pexels => fetch_pexels(&settings).await?,
        SourceKind::Wallhaven => fetch_wallhaven(&settings).await?,
        SourceKind::Picsum => fetch_picsum().await?,
    };
    // Best-effort prepend — a failure here means the image was fetched
    // and written but the index isn't updated. The Library tab's
    // mount-time orphan sweep handles eventual consistency.
    let _ = prepend_entry(entry.clone()).await;
    Ok(entry)
}

async fn fetch_nasa_apod() -> Result<Wallpaper, String> {
    let today = local_today_key();

    // Cache hit?
    {
        let cache = APOD_CACHE.read().await;
        if let Some(c) = cache.as_ref() {
            if c.date == today && std::path::PathBuf::from(&c.path).exists() {
                // If the entry is already in the library, preserve its
                // original added_at — re-use carries no new event.
                let lib = crate::state::library().get().await;
                if let Some(existing) = lib.iter().find(|w| w.path == c.path) {
                    return Ok(existing.clone());
                }
                return Ok(Wallpaper {
                    path: c.path.clone(),
                    source: source_name(SourceKind::NasaApod).to_string(),
                    added_at: ms_since_epoch(),
                    prompt: None,
                    title: c.title.clone(),
                    mode: crate::types::WallpaperMode::Both,
                });
            }
        }
    }

    // Fresh fetch
    let client = http_client()?;
    let res = client
        .get("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY")
        .send()
        .await
        .map_err(|e| format!("NASA APOD request: {}", e))?;

    if res.status().as_u16() == 429 {
        return Err(
            "NASA's shared DEMO_KEY is rate-limited right now. Try again in a few minutes — Ambient only refreshes once a day, so this should be rare."
                .to_string(),
        );
    }
    if !res.status().is_success() {
        return Err(format!("NASA APOD HTTP {}", res.status()));
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("parse NASA APOD response: {}", e))?;
    let url = body
        .get("hdurl")
        .or_else(|| body.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            "NASA APOD: no image URL returned (today might be a video).".to_string()
        })?;
    let date = body
        .get("date")
        .and_then(|v| v.as_str())
        .unwrap_or(today.as_str());
    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .map(String::from);
    let filename = format!("nasa-{}.jpg", date);

    let local_path = download_and_save(url, &filename).await?;

    *APOD_CACHE.write().await = Some(ApodCache {
        date: today,
        path: local_path.clone(),
        title: title.clone(),
    });

    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::NasaApod).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title,
        mode: crate::types::WallpaperMode::Both,
    })
}

async fn fetch_unsplash(settings: &Settings) -> Result<Wallpaper, String> {
    let key = secrets::get("unsplash_key")?
        .ok_or_else(|| "Set your Unsplash API key in Sources first.".to_string())?;

    let client = http_client()?;
    let mut params: Vec<(&str, &str)> = vec![("orientation", "landscape")];
    let query = settings.unsplash_query.trim();
    if !query.is_empty() {
        params.push(("query", query));
    }
    let res = client
        .get("https://api.unsplash.com/photos/random")
        .query(&params)
        .header("Authorization", format!("Client-ID {}", key))
        .send()
        .await
        .map_err(|e| format!("Unsplash request: {}", e))?;

    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = body
            .get("errors")
            .and_then(|e| e.as_array())
            .and_then(|a| a.first())
            .and_then(|f| f.as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("Unsplash {}", status));
        return Err(msg);
    }
    let img_url = body
        .pointer("/urls/full")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Unsplash: no image URL in response".to_string())?;
    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let title = body
        .get("alt_description")
        .or_else(|| body.get("description"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let filename = format!("unsplash-{}.jpg", id);

    let local_path = download_and_save(img_url, &filename).await?;

    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::Unsplash).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title,
        mode: crate::types::WallpaperMode::Both,
    })
}

async fn fetch_pexels(settings: &Settings) -> Result<Wallpaper, String> {
    let key = secrets::get("pexels_key")?
        .ok_or_else(|| "Set your Pexels API key in Sources first.".to_string())?;

    let client = http_client()?;
    let query = settings.pexels_query.trim();
    let (url, params): (&str, Vec<(&str, &str)>) = if query.is_empty() {
        (
            "https://api.pexels.com/v1/curated",
            vec![("per_page", "1")],
        )
    } else {
        (
            "https://api.pexels.com/v1/search",
            vec![
                ("per_page", "1"),
                ("orientation", "landscape"),
                ("query", query),
            ],
        )
    };

    let res = client
        .get(url)
        .query(&params)
        .header("Authorization", &key)
        .send()
        .await
        .map_err(|e| format!("Pexels request: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("Pexels {}", status));
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("parse Pexels response: {}", e))?;
    let photo = body
        .get("photos")
        .and_then(|p| p.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "Pexels: no photo for this query.".to_string())?;
    let img_url = photo
        .pointer("/src/original")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Pexels: no image URL in response".to_string())?;
    let id = photo
        .get("id")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let title = photo
        .get("alt")
        .and_then(|v| v.as_str())
        .map(String::from);
    let filename = format!("pexels-{}.jpg", id);

    let local_path = download_and_save(img_url, &filename).await?;

    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::Pexels).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title,
        mode: crate::types::WallpaperMode::Both,
    })
}

// Bing's Photo of the Day — a fresh curated landscape daily, no key.
async fn fetch_bing() -> Result<Wallpaper, String> {
    let client = http_client()?;
    let res = client
        .get("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US")
        .send()
        .await
        .map_err(|e| format!("Bing request: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Bing HTTP {}", res.status()));
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("parse Bing response: {}", e))?;
    let img = body
        .pointer("/images/0")
        .ok_or_else(|| "Bing: no image in response".to_string())?;
    // The API returns a site-relative path (already at 1920x1080); resolve
    // it against the host.
    let path = img
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Bing: no image URL".to_string())?;
    let img_url = format!("https://www.bing.com{}", path);
    let date = img
        .get("startdate")
        .and_then(|v| v.as_str())
        .unwrap_or("today");
    let title = img
        .get("copyright")
        .and_then(|v| v.as_str())
        .map(String::from);
    let filename = format!("bing-{}.jpg", date);
    let local_path = download_and_save(&img_url, &filename).await?;
    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::Bing).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title,
        mode: crate::types::WallpaperMode::Both,
    })
}

// Wallhaven — random SFW "general" result, optionally search-filtered.
// The API key is optional (anonymous SFW works); a key raises rate limits
// and ties results to the user's account.
async fn fetch_wallhaven(settings: &Settings) -> Result<Wallpaper, String> {
    let client = http_client()?;
    // Empty (legacy settings) falls back to safe defaults.
    let nonempty = |s: &str, default: &'static str| {
        let t = s.trim();
        if t.is_empty() { default.to_string() } else { t.to_string() }
    };
    let mut params: Vec<(&str, String)> = vec![
        ("categories", nonempty(&settings.wallhaven_categories, "100")),
        // Cap purity at sfw+sketchy — NSFW would need the user's key and a
        // deliberate opt-in we don't expose. "111" is clamped to "110".
        (
            "purity",
            match nonempty(&settings.wallhaven_purity, "100").as_str() {
                "111" | "011" | "001" => "110".to_string(),
                other => other.to_string(),
            },
        ),
        ("sorting", nonempty(&settings.wallhaven_sorting, "random")),
    ];
    let query = settings.wallhaven_query.trim();
    if !query.is_empty() {
        params.push(("q", query.to_string()));
    }
    if let Ok(Some(key)) = secrets::get("wallhaven_key") {
        let key = key.trim().to_string();
        if !key.is_empty() {
            params.push(("apikey", key));
        }
    }
    let res = client
        .get("https://wallhaven.cc/api/v1/search")
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("Wallhaven request: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Wallhaven HTTP {}", res.status()));
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("parse Wallhaven response: {}", e))?;
    let first = body
        .pointer("/data/0")
        .ok_or_else(|| "Wallhaven: no results for that search.".to_string())?;
    let img_url = first
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Wallhaven: no image path".to_string())?;
    let id = first.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let ext = if img_url.ends_with(".png") { "png" } else { "jpg" };
    let filename = format!("wallhaven-{}.{}", id, ext);
    let local_path = download_and_save(img_url, &filename).await?;
    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::Wallhaven).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title: None,
        mode: crate::types::WallpaperMode::Both,
    })
}

// Lorem Picsum — a random photo at the screen's native resolution. No key.
async fn fetch_picsum() -> Result<Wallpaper, String> {
    let (w, h) = crate::monitor::get_primary_monitor_pixels()
        .map(|m| (m.width, m.height))
        .unwrap_or((1920, 1080));
    // /<w>/<h> redirects to a random image at that size; timestamp the
    // filename so repeated pulls stay distinct in the library.
    let url = format!("https://picsum.photos/{}/{}", w, h);
    let filename = format!("picsum-{}.jpg", ms_since_epoch());
    let local_path = download_and_save(&url, &filename).await?;
    Ok(Wallpaper {
        path: local_path,
        source: source_name(SourceKind::Picsum).to_string(),
        added_at: ms_since_epoch(),
        prompt: None,
        title: None,
        mode: crate::types::WallpaperMode::Both,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_name_matches_wire_format() {
        assert_eq!(source_name(SourceKind::NasaApod), "nasa-apod");
        assert_eq!(source_name(SourceKind::Unsplash), "unsplash");
        assert_eq!(source_name(SourceKind::Pexels), "pexels");
    }
}
