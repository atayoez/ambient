// ambient-core — Ambient's backend with no Tauri (or any shell)
// dependency. The shell contract, in order:
//
//   1. events::set_sink(..)   — register the app-event bridge first so
//      no core event fires into the void.
//   2. state::init(data_dir)  — one-time bootstrap: secrets backend,
//      emoji cache, settings/library singletons.
//   3. Call any facade fn below from any thread/task.
//
// Events fired through the sink (names + payloads are the pre-extraction
// Tauri event contract, verbatim): `settings-changed` (Settings),
// `library-changed` (Vec<Wallpaper>), `wallpaper-applied` (path string).

pub mod accent;
pub mod aigen;
pub mod desktop;
pub mod emojis;
pub mod events;
// Headless GPU shader renderer — desktop-only (mobile falls back to tiny-skia).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod gpu;
pub mod library;
pub mod library_store;
pub mod live;
pub mod monitor;
pub mod renderer;
pub mod secrets;
pub mod settings;
pub mod sources;
pub mod state;
pub mod types;
pub mod util;
