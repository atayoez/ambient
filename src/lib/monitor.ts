import { invoke } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';

export interface MonitorSize {
  w: number;
  h: number;
  source: string;
}

interface RustMonitorInfo {
  width: number;
  height: number;
  scale: number;
  source: string;
}

// 1920×1080 is the smallest mainstream desktop size — better to under-
// render than blow up to 8K of zero detail when both detection paths
// return unusable values.
const FALLBACK: MonitorSize = { w: 1920, h: 1080, source: 'fallback' };

// Single resolver for primary-monitor pixel dimensions. Tries the Rust
// command (which on Linux shells out to cosmic-randr / wlr-randr /
// xrandr — see src-tauri/src/monitor.rs), then falls back to Tauri's
// own primaryMonitor() API, then to the 1080p baseline. Callers should
// never reach for either underlying API directly.
export async function getMonitorSize(): Promise<MonitorSize> {
  try {
    const info = await invoke<RustMonitorInfo>('get_primary_monitor_pixels');
    return { w: info.width, h: info.height, source: info.source };
  } catch {
    // Rust path failed — try the Tauri window API. primaryMonitor()
    // returns null on COSMIC Wayland (the reason monitor.rs exists in
    // the first place), so this is mostly the macOS / Windows path.
    try {
      const m = await primaryMonitor();
      if (m?.size) {
        return { w: m.size.width, h: m.size.height, source: 'tauri-api' };
      }
    } catch {
      // fall through to fallback
    }
  }
  return FALLBACK;
}
