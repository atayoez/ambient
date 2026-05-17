// OS keyring storage for BYO API keys (Unsplash, Pexels, OpenAI).
// First call to `init()` probes whether keyring is usable on this host;
// if not (headless Linux without DBus, locked-down container, etc.) the
// module falls back to a mode-0600 JSON file under app_data_dir. The
// backend choice is made once and cached for the process lifetime.
//
// Migration: `migrate_from_settings` lifts any unsplashKey / pexelsKey /
// openaiKey fields out of `ambient-settings.json` on first launch
// post-Phase-3, writes them into the chosen backend, and strips them
// from the settings file. Idempotent — subsequent runs find no fields,
// no-op.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

const SERVICE: &str = "ambient";

#[derive(Debug, Clone)]
enum Backend {
    Keyring,
    JsonFallback(PathBuf),
}

static BACKEND: LazyLock<RwLock<Option<Backend>>> =
    LazyLock::new(|| RwLock::new(None));
static JSON_CACHE: LazyLock<RwLock<HashMap<String, String>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Decide which backend to use by probing keyring with a throwaway
/// entry. Call once at app startup before any get/set.
pub fn init(app_data_dir: &Path) {
    let fallback_path = app_data_dir.join("ambient-secrets.json");

    let keyring_ok = match keyring::Entry::new(SERVICE, "_probe") {
        Ok(entry) => match entry.set_password("_v") {
            Ok(_) => {
                let _ = entry.delete_credential();
                true
            }
            Err(_) => false,
        },
        Err(_) => false,
    };

    if keyring_ok {
        *BACKEND.write().expect("backend lock") = Some(Backend::Keyring);
    } else {
        // Preload existing JSON fallback into cache so reads are sync.
        if let Ok(bytes) = std::fs::read(&fallback_path) {
            if let Ok(map) =
                serde_json::from_slice::<HashMap<String, String>>(&bytes)
            {
                *JSON_CACHE.write().expect("cache lock") = map;
            }
        }
        *BACKEND.write().expect("backend lock") =
            Some(Backend::JsonFallback(fallback_path));
        eprintln!(
            "[ambient] keyring unavailable; secrets falling back to plain JSON file"
        );
    }
}

fn current_backend() -> Backend {
    BACKEND
        .read()
        .expect("backend lock")
        .clone()
        .expect("secrets::init must run before get/set")
}

pub fn get(name: &str) -> Result<Option<String>, String> {
    match current_backend() {
        Backend::Keyring => {
            let entry =
                keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
            match entry.get_password() {
                Ok(p) => Ok(Some(p)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        Backend::JsonFallback(_) => {
            Ok(JSON_CACHE.read().expect("cache lock").get(name).cloned())
        }
    }
}

pub fn set(name: &str, value: &str) -> Result<(), String> {
    match current_backend() {
        Backend::Keyring => {
            let entry =
                keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
            entry.set_password(value).map_err(|e| e.to_string())
        }
        Backend::JsonFallback(path) => {
            let mut map = JSON_CACHE.write().expect("cache lock");
            map.insert(name.to_string(), value.to_string());
            write_json_secrets(&path, &map)
        }
    }
}

pub fn clear(name: &str) -> Result<(), String> {
    match current_backend() {
        Backend::Keyring => {
            let entry =
                keyring::Entry::new(SERVICE, name).map_err(|e| e.to_string())?;
            match entry.delete_credential() {
                Ok(_) => Ok(()),
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
        Backend::JsonFallback(path) => {
            let mut map = JSON_CACHE.write().expect("cache lock");
            map.remove(name);
            write_json_secrets(&path, &map)
        }
    }
}

fn write_json_secrets(
    path: &Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "no parent dir for secrets file".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
    let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perm = meta.permissions();
            perm.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perm);
        }
    }
    Ok(())
}

/// One-time migration: read ambient-settings.json, pull any
/// unsplashKey / pexelsKey / openaiKey fields out, push them into the
/// secrets backend, and rewrite the settings file without those keys.
/// Idempotent.
pub fn migrate_from_settings(app_data_dir: &Path) {
    let settings_path = app_data_dir.join("ambient-settings.json");
    let bytes = match std::fs::read(&settings_path) {
        Ok(b) => b,
        Err(_) => return,
    };
    let mut value: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return,
    };
    let obj = match value.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    let pairs = [
        ("unsplashKey", "unsplash_key"),
        ("pexelsKey", "pexels_key"),
        ("openaiKey", "openai_key"),
    ];
    let mut touched = false;
    for (json_name, keyring_name) in pairs {
        if let Some(v) = obj.remove(json_name) {
            touched = true;
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    let _ = set(keyring_name, s);
                }
            }
        }
    }
    if touched {
        let _ = crate::settings::write_atomic(&settings_path, &value);
    }
}

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    get(&name)
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    set(&name, &value)
}

#[tauri::command]
pub fn clear_secret(name: String) -> Result<(), String> {
    clear(&name)
}
