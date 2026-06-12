// No JS-invokable commands — the plugin is driven from Rust via
// WallpaperExt, so the IPC permission system has nothing to gate.
const COMMANDS: &[&str] = &[];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
