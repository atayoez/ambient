use serde::{Deserialize, Serialize};

/// Which surface(s) the wallpaper lands on. Maps to Android's
/// WallpaperManager FLAG_SYSTEM / FLAG_LOCK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperTarget {
  Home,
  Lock,
  Both,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWallpaperRequest {
  pub path: String,
  pub target: WallpaperTarget,
}
