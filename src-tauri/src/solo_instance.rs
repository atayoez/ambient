// "New launch wins" solo-instance pattern.
//
// Standard tauri-plugin-single-instance has the inverse policy: the
// SECOND launch detects the first via a lock-file, fires a callback in
// the first to focus its window, and exits the second silently. That
// preserves running state but can feel sticky on Linux — if the tray
// process is wedged, hidden, or the window manager refused the focus
// request, the user is left wondering why nothing happened.
//
// Ambient inverts the policy: the NEW launch takes over. We:
//   1. Read the PID file written by the previous instance (if any).
//   2. Look the PID up via sysinfo; only act if the live process is
//      actually an `ambient` binary (defends against PID rollover —
//      otherwise we'd risk SIGTERMing a stranger).
//   3. SIGTERM and wait up to ~1s for graceful exit. Tauri's
//      RunEvent::Exit path runs on SIGTERM, which lets the old
//      process release the tray icon, drop its WebView, and flush
//      any in-flight settings writes before we replace it.
//   4. Write our own PID, register cleanup on graceful exit.
//
// Pure stdlib + sysinfo. No tokio, no Tauri runtime — runs synchronously
// at the very top of `run()`, before any plugin initializes, so the
// new instance never has two webviews / two trays competing for the
// same shared state files.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Call once at startup, before the tauri::Builder runs. Best-effort
/// throughout: any error here just logs and continues — we'd rather
/// briefly have two processes than refuse to launch.
pub fn ensure_solo() {
    let path = pid_path();
    take_over_previous(&path);
    write_our_pid(&path);
}

/// Call from the RunEvent::Exit path so a graceful shutdown clears the
/// PID file. Crashes leave a stale file; that's fine — the next launch
/// will look the PID up, find no matching `ambient` process, and skip
/// the kill step.
pub fn cleanup() {
    let path = pid_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if content.trim().parse::<u32>() == Ok(std::process::id()) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Derive the PID file path without needing Tauri's AppHandle (which
/// isn't available until inside Builder::setup, by which point a second
/// instance would already be racing us). Three branches, all dep-free:
///   Unix:    $HOME/.cache/ambient.pid
///   Windows: %LOCALAPPDATA%\Ambient\ambient.pid
///   Fallback: std::env::temp_dir()/ambient.pid
fn pid_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        return home.join(".cache").join("ambient.pid");
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        return local.join("Ambient").join("ambient.pid");
    }
    std::env::temp_dir().join("ambient.pid")
}

fn take_over_previous(pid_path: &Path) {
    let Ok(content) = std::fs::read_to_string(pid_path) else { return };
    let Ok(old_pid) = content.trim().parse::<u32>() else { return };
    if old_pid == std::process::id() {
        return;
    }

    let pid = Pid::from_u32(old_pid);
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );

    let Some(proc) = sys.process(pid) else {
        // Stale PID file from a crash — no process to take over from.
        return;
    };

    // PID-rollover guard: only kill processes whose name looks like
    // ours. `name()` returns the executable filename (no directory
    // component), so a case-insensitive contains check works on
    // ambient / ambient.exe / Ambient / target/debug/ambient alike.
    let name = proc.name().to_string_lossy().to_lowercase();
    if !name.contains("ambient") {
        tracing::warn!(
            pid = old_pid,
            name = %name,
            "solo-instance: stale PID points to unrelated process, skipping",
        );
        return;
    }

    tracing::info!(pid = old_pid, "solo-instance: replacing previous instance");
    // SIGKILL, not SIGTERM. The polite SIGTERM path runs Tauri's
    // WebKitGTK teardown (destroy the WebView, tear down the GPU process,
    // join AVIF encoder threads), which races the shutdown and can
    // heap-corrupt on the way out — the dying instance was aborting with
    // "free(): corrupted unsorted chunks". A hard kill skips teardown
    // entirely. It's safe here: settings + library writes are atomic
    // (temp-file + rename, so a mid-write kill leaves the real file
    // intact), and the StatusNotifier tray item is reclaimed by the host
    // the moment our D-Bus connection drops.
    proc.kill(); // SIGKILL

    // Brief wait so the new instance doesn't race the old on the shared
    // settings/library files before it's fully gone.
    let deadline = Instant::now() + Duration::from_millis(800);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing(),
        );
        if sys.process(pid).is_none() {
            return;
        }
    }
    tracing::warn!(pid = old_pid, "solo-instance: previous instance still present after SIGKILL");
}

fn write_our_pid(pid_path: &Path) {
    if let Some(parent) = pid_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(pid_path, std::process::id().to_string()) {
        tracing::warn!(error = %e, "solo-instance: failed to write PID file");
    }
}
