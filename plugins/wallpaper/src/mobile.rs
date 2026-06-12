use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

// Initializes the Kotlin plugin class.
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<Wallpaper<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("me.oezcan.ambient.wallpaper", "WallpaperPlugin")?;
  // iOS has no public set-wallpaper API — fail registration loudly so a
  // future iOS build can't silently ship a no-op apply path.
  #[cfg(target_os = "ios")]
  return Err(crate::Error::UnsupportedPlatform);
  #[cfg(target_os = "android")]
  Ok(Wallpaper(handle))
}

/// Access to the wallpaper API.
pub struct Wallpaper<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Wallpaper<R> {
  /// Set `path` as the device wallpaper. Blocking JNI round-trip into
  /// WallpaperManager.setStream — call off the UI thread (Ambient's
  /// apply pipeline already runs in async commands / the rotation task).
  pub fn set_wallpaper(&self, path: String, target: WallpaperTarget) -> crate::Result<()> {
    let _: serde_json::Value = self
      .0
      .run_mobile_plugin("setWallpaper", SetWallpaperRequest { path, target })?;
    Ok(())
  }
}
