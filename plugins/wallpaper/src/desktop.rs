use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<Wallpaper<R>> {
  Ok(Wallpaper(app.clone()))
}

/// Desktop stub. Ambient's desktop builds set wallpapers through
/// ambient-core's own pipeline (`wallpaper` crate + DE-specific paths)
/// and never call this plugin — the stub exists so the plugin type
/// checks on desktop without cfg gymnastics at call sites.
pub struct Wallpaper<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Wallpaper<R> {
  pub fn set_wallpaper(&self, _path: String, _target: WallpaperTarget) -> crate::Result<()> {
    Err(crate::Error::UnsupportedPlatform)
  }
}
