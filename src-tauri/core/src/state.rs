// Process-global backend state: the app-data dir + the settings /
// library / license singletons. Replaces Tauri's `app.manage(..)` /
// `State<T>` plumbing so core modules reach shared state without an
// AppHandle parameter.
//
// The data dir is INJECTED by the shell (`init(data_dir)`) rather than
// resolved here — the shell (Tauri's app.path(), or whatever a future
// shell uses) stays the single source of truth for where user data
// lives, so core can never silently fork settings/library/license into
// a second location.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::library_store::LibraryState;
use crate::license::LicenseState;
use crate::settings::SettingsState;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static SETTINGS: OnceLock<SettingsState> = OnceLock::new();
static LIBRARY: OnceLock<LibraryState> = OnceLock::new();
static LICENSE: OnceLock<LicenseState> = OnceLock::new();

/// One-time backend bootstrap, mirroring the pre-extraction lib.rs
/// setup() ordering exactly:
///
///   1. secrets backend init + key migration out of the settings JSON
///      (must run BEFORE the settings load so the migrated file is
///      already clean when Settings deserializes)
///   2. emoji cache dir
///   3. settings load → singleton
///   4. library load → singleton
///   5. license load → singleton
///
/// Returns true when the cached license is stale (>24h) and the shell
/// should spawn `license::revalidate_background()`. Idempotent: a
/// second call is a no-op returning false.
pub fn init(data_dir: PathBuf) -> bool {
    if DATA_DIR.get().is_some() {
        return false;
    }
    let _ = std::fs::create_dir_all(&data_dir);
    let _ = DATA_DIR.set(data_dir.clone());

    crate::secrets::init(&data_dir);
    crate::secrets::migrate_from_settings(&data_dir);
    crate::emojis::init(&data_dir);

    let settings = crate::settings::load_or_default(&data_dir);
    let _ = SETTINGS.set(SettingsState::new(
        settings,
        data_dir.join("ambient-settings.json"),
    ));

    let library = crate::library_store::load_or_default(&data_dir);
    let _ = LIBRARY.set(LibraryState::new(
        library,
        data_dir.join("ambient-library.json"),
    ));

    let (license_info, startup_state, needs_reval) =
        crate::license::load_at_startup(&data_dir);
    let _ = LICENSE.set(LicenseState::new(
        license_info,
        startup_state,
        data_dir.join("ambient-license.json"),
    ));

    needs_reval
}

/// The shell-injected app-data dir. Panics if `init` has not run —
/// a programming error, not a runtime condition.
pub fn data_dir() -> &'static Path {
    DATA_DIR
        .get()
        .expect("ambient_core::state::init must run before data_dir()")
        .as_path()
}

/// Settings store singleton. Panics if `init` has not run.
pub fn settings() -> &'static SettingsState {
    SETTINGS
        .get()
        .expect("ambient_core::state::init must run before settings()")
}

/// Library store singleton. Panics if `init` has not run.
pub fn library() -> &'static LibraryState {
    LIBRARY
        .get()
        .expect("ambient_core::state::init must run before library()")
}

/// License store singleton. Panics if `init` has not run.
pub fn license() -> &'static LicenseState {
    LICENSE
        .get()
        .expect("ambient_core::state::init must run before license()")
}
