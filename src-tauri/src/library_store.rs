// Rust-owned Library index. Symmetric to settings.rs but with a tagged
// patch enum instead of arbitrary JSON merge — the library is an
// ordered list of Wallpaper rows, and the four ops (Prepend, Remove,
// PromoteToHead, RemoveOrphans) cover every mutation the TS layer
// currently performs. Wire shape per op is small so settings-style
// full-object patching would be unnecessary IPC overhead.
//
// All ops re-dedup by path after mutation (newest occurrence wins by
// staying at its slot), preserving the existing `dedupByPath` invariant
// from the deleted JS `mutateLibrary`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::RwLock;

use crate::settings::{strip_keys_from_legacy, write_atomic};
use crate::types::Wallpaper;

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "op", content = "data", rename_all = "camelCase")]
pub enum LibraryOp {
    Prepend(Wallpaper),
    Remove { path: String },
    PromoteToHead { path: String },
    /// Filter the library down to entries whose path appears in
    /// `existing`. Used by Library.tsx's mount-time orphan sweep
    /// (list files on disk, drop index rows pointing at deleted files).
    RemoveOrphans { existing: Vec<String> },
}

pub struct LibraryState {
    inner: Arc<RwLock<Vec<Wallpaper>>>,
    path: PathBuf,
}

impl LibraryState {
    pub fn new(initial: Vec<Wallpaper>, path: PathBuf) -> Self {
        Self {
            inner: Arc::new(RwLock::new(dedup_by_path(initial))),
            path,
        }
    }

    pub async fn get(&self) -> Vec<Wallpaper> {
        self.inner.read().await.clone()
    }

    pub async fn patch(
        &self,
        op: LibraryOp,
        app: &AppHandle,
    ) -> Result<Vec<Wallpaper>, String> {
        let mut guard = self.inner.write().await;
        let updated = apply_op(&guard, op);
        write_atomic(&self.path, &updated)?;
        *guard = updated.clone();
        drop(guard);
        let _ = app.emit("library-changed", &updated);
        Ok(updated)
    }
}

pub(crate) fn apply_op(current: &[Wallpaper], op: LibraryOp) -> Vec<Wallpaper> {
    let next: Vec<Wallpaper> = match op {
        LibraryOp::Prepend(entry) => {
            let mut next = Vec::with_capacity(current.len() + 1);
            next.push(entry);
            next.extend(current.iter().cloned());
            next
        }
        LibraryOp::Remove { path } => {
            current.iter().filter(|w| w.path != path).cloned().collect()
        }
        LibraryOp::PromoteToHead { path } => {
            let idx = current.iter().position(|w| w.path == path);
            match idx {
                Some(i) if i > 0 => {
                    let mut next = Vec::with_capacity(current.len());
                    next.push(current[i].clone());
                    next.extend(current[..i].iter().cloned());
                    next.extend(current[i + 1..].iter().cloned());
                    next
                }
                _ => current.to_vec(),
            }
        }
        LibraryOp::RemoveOrphans { existing } => {
            let set: HashSet<&str> = existing.iter().map(String::as_str).collect();
            current
                .iter()
                .filter(|w| set.contains(w.path.as_str()))
                .cloned()
                .collect()
        }
    };
    dedup_by_path(next)
}

pub(crate) fn dedup_by_path(list: Vec<Wallpaper>) -> Vec<Wallpaper> {
    let mut seen = HashSet::with_capacity(list.len());
    list.into_iter()
        .filter(|w| seen.insert(w.path.clone()))
        .collect()
}

pub fn load_or_default(app_data_dir: &Path) -> Vec<Wallpaper> {
    let target = app_data_dir.join("ambient-library.json");
    if let Ok(bytes) = std::fs::read(&target) {
        if let Ok(lib) = serde_json::from_slice::<Vec<Wallpaper>>(&bytes) {
            return dedup_by_path(lib);
        }
    }
    let legacy_path = app_data_dir.join("ambient.json");
    if let Ok(bytes) = std::fs::read(&legacy_path) {
        if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let extracted = value
                .as_object_mut()
                .and_then(|obj| obj.remove("library"))
                .and_then(|v| serde_json::from_value::<Vec<Wallpaper>>(v).ok());
            if let Some(library) = extracted {
                let deduped = dedup_by_path(library);
                let _ = write_atomic(&target, &deduped);
                strip_keys_from_legacy(&legacy_path, value);
                return deduped;
            }
        }
    }
    Vec::new()
}

/// Helper for Rust-side callers (sources.rs, aigen.rs) that want to
/// prepend a freshly-fetched Wallpaper into the index. TS-side callers
/// use the patch_library command + the prependLibrary JS helper.
pub async fn prepend_entry(
    app: &AppHandle,
    entry: Wallpaper,
) -> Result<Vec<Wallpaper>, String> {
    let state = app.state::<LibraryState>();
    state.patch(LibraryOp::Prepend(entry), app).await
}

#[tauri::command]
pub async fn get_library(state: State<'_, LibraryState>) -> Result<Vec<Wallpaper>, String> {
    Ok(state.get().await)
}

#[tauri::command]
pub async fn patch_library(
    op: LibraryOp,
    state: State<'_, LibraryState>,
    app: AppHandle,
) -> Result<Vec<Wallpaper>, String> {
    state.patch(op, &app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wp(path: &str) -> Wallpaper {
        Wallpaper {
            path: path.to_string(),
            source: "generated".to_string(),
            added_at: 0,
            prompt: None,
            title: None,
        }
    }

    #[test]
    fn prepend_adds_to_head_and_dedups() {
        let cur = vec![wp("/a"), wp("/b")];
        let next = apply_op(&cur, LibraryOp::Prepend(wp("/c")));
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/c", "/a", "/b"]);
    }

    #[test]
    fn prepend_existing_path_dedups_to_head() {
        let cur = vec![wp("/a"), wp("/b")];
        let next = apply_op(&cur, LibraryOp::Prepend(wp("/b")));
        // Prepended /b stays at head; the existing /b later in the list
        // is dropped by the dedup pass.
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/b", "/a"]);
    }

    #[test]
    fn remove_filters_out_path() {
        let cur = vec![wp("/a"), wp("/b"), wp("/c")];
        let next = apply_op(&cur, LibraryOp::Remove { path: "/b".to_string() });
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/a", "/c"]);
    }

    #[test]
    fn promote_to_head_moves_entry() {
        let cur = vec![wp("/a"), wp("/b"), wp("/c")];
        let next = apply_op(&cur, LibraryOp::PromoteToHead { path: "/c".to_string() });
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/c", "/a", "/b"]);
    }

    #[test]
    fn promote_to_head_no_op_when_already_first() {
        let cur = vec![wp("/a"), wp("/b")];
        let next = apply_op(&cur, LibraryOp::PromoteToHead { path: "/a".to_string() });
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/a", "/b"]);
    }

    #[test]
    fn promote_to_head_no_op_when_missing() {
        let cur = vec![wp("/a"), wp("/b")];
        let next = apply_op(&cur, LibraryOp::PromoteToHead { path: "/z".to_string() });
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/a", "/b"]);
    }

    #[test]
    fn remove_orphans_keeps_only_existing() {
        let cur = vec![wp("/a"), wp("/b"), wp("/c")];
        let next = apply_op(&cur, LibraryOp::RemoveOrphans {
            existing: vec!["/a".to_string(), "/c".to_string()],
        });
        assert_eq!(next.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/a", "/c"]);
    }

    #[test]
    fn dedup_keeps_first_occurrence() {
        let list = vec![wp("/a"), wp("/b"), wp("/a")];
        let deduped = dedup_by_path(list);
        assert_eq!(deduped.iter().map(|w| w.path.as_str()).collect::<Vec<_>>(),
                   vec!["/a", "/b"]);
    }

    #[test]
    fn load_or_default_migrates_legacy_library() {
        let tmp_dir = std::env::temp_dir().join("ambient-test-migrate-library");
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();

        let legacy = serde_json::json!({
            "library": [
                { "path": "/x/wp1.png", "source": "generated", "addedAt": 100 },
                { "path": "/x/wp2.png", "source": "nasa-apod", "addedAt": 200, "title": "Apod" }
            ],
            "license.state": { "key": "abc" }
        });
        std::fs::write(
            tmp_dir.join("ambient.json"),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();

        let loaded = load_or_default(&tmp_dir);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].path, "/x/wp1.png");
        assert_eq!(loaded[1].title.as_deref(), Some("Apod"));

        assert!(tmp_dir.join("ambient-library.json").exists());

        // license.state preserved in legacy file
        let remaining: serde_json::Value = serde_json::from_slice(
            &std::fs::read(tmp_dir.join("ambient.json")).unwrap(),
        )
        .unwrap();
        assert!(remaining.get("library").is_none());
        assert!(remaining.get("license.state").is_some());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn load_or_default_empty_when_nothing_present() {
        let tmp_dir = std::env::temp_dir().join("ambient-test-fresh-library");
        let _ = std::fs::remove_dir_all(&tmp_dir);
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let loaded = load_or_default(&tmp_dir);
        assert!(loaded.is_empty());
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
}
