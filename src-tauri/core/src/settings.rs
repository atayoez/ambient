// Rust-owned Settings store. SettingsState holds the in-memory
// authority behind a tokio::sync::RwLock; on patch we apply a JSON
// merge, persist atomically to ambient-settings.json, broadcast on a
// watch channel (so the shell's rotation task can react), and fire a
// `settings-changed` app event through the shell's event sink (so the
// UI layer can re-render).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{watch, RwLock};

use crate::types::Settings;

pub struct SettingsState {
    inner: Arc<RwLock<Settings>>,
    tx: watch::Sender<Settings>,
    path: PathBuf,
}

impl SettingsState {
    pub fn new(initial: Settings, path: PathBuf) -> Self {
        let (tx, _rx) = watch::channel(initial.clone());
        Self {
            inner: Arc::new(RwLock::new(initial)),
            tx,
            path,
        }
    }

    /// Subscribe to settings changes. Each subscriber gets the latest
    /// value on first borrow + every subsequent change. Used by the
    /// rotation task to reconfigure on interval / source flips without
    /// polling.
    pub fn subscribe(&self) -> watch::Receiver<Settings> {
        self.tx.subscribe()
    }

    pub async fn get(&self) -> Settings {
        self.inner.read().await.clone()
    }

    /// Apply a JSON patch (shallow merge of top-level keys), persist
    /// to disk, broadcast on the watch channel, and fire the
    /// `settings-changed` app event. All settings writes from any code
    /// path go through here.
    pub async fn patch(&self, patch: serde_json::Value) -> Result<Settings, String> {
        let mut guard = self.inner.write().await;
        let updated = apply_patch(&guard, patch)?;
        // Blocking fs write while holding the lock (ordering matters);
        // block_in_place keeps it from stalling the multithread runtime's
        // worker.
        tokio::task::block_in_place(|| write_atomic(&self.path, &updated))?;
        *guard = updated.clone();
        drop(guard);
        let _ = self.tx.send(updated.clone());
        crate::events::emit("settings-changed", &updated);
        Ok(updated)
    }
}

/// Pure: apply a JSON object patch (shallow merge) to a Settings and
/// re-deserialize. Errors when the merged JSON isn't a valid Settings
/// (e.g. enum got an unknown value, required field overwritten with null).
pub(crate) fn apply_patch(
    base: &Settings,
    patch: serde_json::Value,
) -> Result<Settings, String> {
    let mut merged =
        serde_json::to_value(base).map_err(|e| format!("serialize base: {}", e))?;
    let patch_obj = patch
        .as_object()
        .ok_or_else(|| "patch must be a JSON object".to_string())?;
    let merged_obj = merged
        .as_object_mut()
        .ok_or_else(|| "settings must serialize to a JSON object".to_string())?;
    for (k, v) in patch_obj {
        merged_obj.insert(k.clone(), v.clone());
    }
    serde_json::from_value(merged).map_err(|e| format!("apply patch: {}", e))
}

/// Tempfile + rename. The parent dir must exist (callers ensure this
/// in setup via app_data_dir resolution).
pub(crate) fn write_atomic<T: serde::Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {:?}", path))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("create dir {:?}: {}", parent, e))?;
    let tmp = path.with_extension("tmp");
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&tmp, json).map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {}", e))?;
    Ok(())
}

/// Load Settings from ambient-settings.json, falling back to defaults
/// when the file is missing or unparseable (a corrupted file is left in
/// place rather than overwritten with a guess — the next successful
/// patch rewrites it).
pub fn load_or_default(app_data_dir: &Path) -> Settings {
    let target = app_data_dir.join("ambient-settings.json");
    if let Ok(bytes) = std::fs::read(&target) {
        if let Ok(s) = serde_json::from_slice::<Settings>(&bytes) {
            return s;
        }
    }
    Settings::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{RotationSource, SourceKind, ThemeMode};

    #[test]
    fn apply_patch_merges_top_level_keys() {
        let base = Settings::default();
        let patch = serde_json::json!({ "rotationIntervalMinutes": 15 });
        let updated = apply_patch(&base, patch).unwrap();
        assert_eq!(updated.rotation_interval_minutes, 15);
        // Untouched fields stay at defaults
        assert!(matches!(updated.source, SourceKind::NasaApod));
        assert!(matches!(updated.theme_mode, ThemeMode::Auto));
    }

    #[test]
    fn apply_patch_overwrites_enum_field() {
        let base = Settings::default();
        let patch = serde_json::json!({ "rotationSource": "library" });
        let updated = apply_patch(&base, patch).unwrap();
        assert!(matches!(updated.rotation_source, RotationSource::Library));
    }

    #[test]
    fn apply_patch_rejects_unknown_enum_value() {
        let base = Settings::default();
        let patch = serde_json::json!({ "themeMode": "neon" });
        let result = apply_patch(&base, patch);
        assert!(result.is_err());
    }

    #[test]
    fn apply_patch_writes_last_applied() {
        let base = Settings::default();
        let patch = serde_json::json!({ "lastApplied": "/x/y.png" });
        let updated = apply_patch(&base, patch).unwrap();
        assert_eq!(updated.last_applied.as_deref(), Some("/x/y.png"));
    }

    #[test]
    fn apply_patch_requires_object() {
        let base = Settings::default();
        let result = apply_patch(&base, serde_json::json!("not an object"));
        assert!(result.is_err());
    }

    #[test]
    fn write_atomic_round_trips() {
        let tmp_dir = std::env::temp_dir().join("ambient-test-settings");
        let _ = std::fs::create_dir_all(&tmp_dir);
        let path = tmp_dir.join("ambient-settings.json");
        let _ = std::fs::remove_file(&path);

        let mut s = Settings::default();
        s.rotation_interval_minutes = 23;
        write_atomic(&path, &s).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        let round: Settings = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(round.rotation_interval_minutes, 23);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_or_default_returns_defaults_when_nothing_present() {
        let tmp_dir = std::env::temp_dir().join("ambient-test-fresh-settings");
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let loaded = load_or_default(&tmp_dir);
        assert!(matches!(loaded.source, SourceKind::NasaApod));
        assert_eq!(loaded.rotation_interval_minutes, 60);

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn load_or_default_reads_existing_file() {
        let tmp_dir = std::env::temp_dir().join("ambient-test-existing-settings");
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let mut s = Settings::default();
        s.rotation_interval_minutes = 99;
        write_atomic(&tmp_dir.join("ambient-settings.json"), &s).unwrap();

        let loaded = load_or_default(&tmp_dir);
        assert_eq!(loaded.rotation_interval_minutes, 99);

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
