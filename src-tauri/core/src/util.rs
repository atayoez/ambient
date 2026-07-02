// Tiny shared utilities — kept in one module so modules that need them
// (license, sources, aigen, library, etc.) don't grow duplicate copies.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch. Returns 0 if the system clock is
/// before 1970 — practically never, but the unwrap-or means callers
/// never have to handle the error.
pub fn ms_since_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pseudo-random u32 derived from a process-lifetime counter mixed with
/// the current wall time. Not cryptographically secure — fine for image
/// seeds + filename uniqueness; do NOT use for license keys, nonces,
/// or anything security-sensitive.
pub fn pseudo_seed() -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = ms_since_epoch() as u32;
    t.wrapping_mul(0x9E3779B1)
        .wrapping_add(c.wrapping_mul(2654435761))
}

/// Shared reqwest client constructor — one place for the builder chain so
/// the per-module copies (sources, aigen, license, emojis) can't drift.
/// Callers pass their own timeout since fetch budgets differ per API.
pub(crate) fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("build HTTP client: {}", e))
}

/// Local-date string in YYYY-MM-DD format. Used by NASA APOD cache:
/// matches the user's perspective of "today" even when UTC has rolled
/// over (consistent with the pre-Phase-3 TS behavior). Chrono pulls in
/// no timezone database — uses the OS's localtime offset directly.
pub fn local_today_key() -> String {
    use chrono::{Datelike, Local};
    let now = Local::now();
    format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
}
