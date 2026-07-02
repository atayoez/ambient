// Polar license validation, owned by Rust. Loads the stored key in
// setup() so the License gate decision is made before the webview's
// first paint (no loading flash). Stale (>24h) caches trigger an
// async background revalidation that emits a `license-revoked` event
// if Polar explicitly rejects; transient failures (5xx, network) keep
// the user trusting the local cache.
//
// Storage: `ambient-license.json` in app_data_dir. First-run migration
// lifts `license.state` out of the legacy tauri-plugin-store
// `ambient.json` blob, mirroring the settings + library migration in
// Phase 1.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::settings::{strip_keys_from_legacy, write_atomic};
use crate::util::ms_since_epoch;

const POLAR_BASE: &str = "https://api.polar.sh";
const POLAR_ORG_ID: &str = "ebe08965-e42c-47bc-8716-ca78b904204e";
const REVALIDATE_AFTER_MS: u64 = 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_SECS: u64 = 10;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LicenseInfo {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub activated_at: u64,
    pub last_validated: u64,
    /// Key expiry (ms since epoch), present on time-limited keys — i.e. the
    /// 7-day trial product, whose license-key benefit is configured in Polar
    /// to expire after grant. Absent on purchased (perpetual) keys. The UI
    /// uses it to show trial state; the shell schedules a revalidation at
    /// this instant so an expired trial gates without waiting for the next
    /// launch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StartupLicense {
    Valid { info: LicenseInfo },
    /// License was previously stored but Polar said no in the most
    /// recent revalidation. UI shows the gate with `message` as banner.
    Invalid { message: String },
    /// No stored license — fresh install or post-clear state.
    None,
}

pub struct LicenseState {
    inner: Arc<RwLock<Option<LicenseInfo>>>,
    startup: Arc<RwLock<StartupLicense>>,
    path: PathBuf,
}

impl LicenseState {
    pub fn new(initial: Option<LicenseInfo>, startup: StartupLicense, path: PathBuf) -> Self {
        Self {
            inner: Arc::new(RwLock::new(initial)),
            startup: Arc::new(RwLock::new(startup)),
            path,
        }
    }

    pub async fn current(&self) -> Option<LicenseInfo> {
        self.inner.read().await.clone()
    }

    pub async fn startup(&self) -> StartupLicense {
        self.startup.read().await.clone()
    }

    // set/clear/mark_invalid acquire BOTH write guards (inner first, then
    // startup — one consistent order) before mutating either, so a reader
    // can never observe inner and startup mid-update / out of sync.

    pub async fn set(&self, info: LicenseInfo) -> Result<(), String> {
        write_atomic(&self.path, &info)?;
        let mut inner = self.inner.write().await;
        let mut startup = self.startup.write().await;
        *inner = Some(info.clone());
        *startup = StartupLicense::Valid { info };
        Ok(())
    }

    pub async fn clear(&self) {
        let mut inner = self.inner.write().await;
        let mut startup = self.startup.write().await;
        *inner = None;
        *startup = StartupLicense::None;
        let _ = std::fs::remove_file(&self.path);
    }

    pub async fn mark_invalid(&self, message: String) {
        // Don't drop the in-memory key — keep it so the user can re-try
        // activation later without re-pasting if the rejection was
        // transient (key revoked then un-revoked, e.g. payment fixed).
        // The inner guard is still taken (unmodified) to keep the
        // inner→startup update atomic with respect to set()/clear().
        let _inner = self.inner.write().await;
        *self.startup.write().await = StartupLicense::Invalid { message };
    }
}

/// Load license from disk (with legacy migration), but DON'T hit Polar.
/// Returns (info, startup_state, needs_revalidation). Caller spawns
/// `revalidate_background` if needs_revalidation is true so the
/// frontend mounts immediately on cached state.
pub fn load_at_startup(app_data_dir: &Path) -> (Option<LicenseInfo>, StartupLicense, bool) {
    let info = match load_or_migrate(app_data_dir) {
        Some(i) => i,
        None => return (None, StartupLicense::None, false),
    };
    let now = ms_since_epoch();
    let stale = now.saturating_sub(info.last_validated) >= REVALIDATE_AFTER_MS;
    (
        Some(info.clone()),
        StartupLicense::Valid { info },
        stale,
    )
}

pub(crate) fn load_or_migrate(app_data_dir: &Path) -> Option<LicenseInfo> {
    let target = app_data_dir.join("ambient-license.json");
    if let Ok(bytes) = std::fs::read(&target) {
        if let Ok(info) = serde_json::from_slice::<LicenseInfo>(&bytes) {
            return Some(info);
        }
    }
    let legacy_path = app_data_dir.join("ambient.json");
    if let Ok(bytes) = std::fs::read(&legacy_path) {
        if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let extracted = value
                .as_object_mut()
                .and_then(|obj| obj.remove("license.state"))
                .and_then(|v| serde_json::from_value::<LicenseInfo>(v).ok());
            if let Some(info) = extracted {
                let _ = write_atomic(&target, &info);
                strip_keys_from_legacy(&legacy_path, value);
                return Some(info);
            }
        }
    }
    None
}

/// Background revalidation. Updates `last_validated` on success, flips
/// state to Invalid + fires a `license-revoked` app event on explicit
/// rejection, no-op on transient failures.
pub async fn revalidate_background() {
    let state = crate::state::license();
    let info = match state.current().await {
        Some(i) => i,
        None => return,
    };
    match call_polar_validate(&info.key).await {
        Ok(body) => {
            let mut updated = info;
            updated.last_validated = ms_since_epoch();
            updated.expires_at = extract_expires(&body);
            let _ = state.set(updated).await;
        }
        Err(ValidateErr::Rejected(msg)) => {
            state.mark_invalid(msg.clone()).await;
            crate::events::emit("license-revoked", &msg);
        }
        Err(ValidateErr::Transient(_)) => {
            // Trust local copy. The next launch will revalidate again.
        }
    }
}

/// Long-running watcher that turns a time-limited key (the 7-day trial)
/// into a runtime gate: sleeps until the key's expiry, then revalidates —
/// Polar rejects the lapsed key, which flips state to Invalid and emits
/// `license-revoked`, so the gate drops at the moment the trial ends
/// instead of at the next launch. Re-checks hourly to pick up keys
/// activated mid-session (e.g. signing into a trial after first launch).
pub async fn watch_expiry() {
    const HOUR_MS: u64 = 60 * 60 * 1000;
    loop {
        let next = crate::state::license()
            .current()
            .await
            .and_then(|i| i.expires_at);
        let now = ms_since_epoch();
        let sleep_ms = match next {
            // +30s past expiry so Polar's clock has definitely lapsed too.
            Some(at) if at.saturating_sub(now) < HOUR_MS => at.saturating_sub(now) + 30_000,
            _ => HOUR_MS,
        };
        tokio::time::sleep(std::time::Duration::from_millis(sleep_ms)).await;
        if let Some(at) = next {
            if ms_since_epoch() >= at {
                revalidate_background().await;
            }
        }
    }
}

#[derive(Debug)]
pub(crate) enum ValidateErr {
    Rejected(String),
    Transient(String),
}

pub(crate) async fn call_polar_validate(key: &str) -> Result<serde_json::Value, ValidateErr> {
    let client = portal_client().map_err(ValidateErr::Transient)?;

    let url = format!("{}/v1/customer-portal/license-keys/validate", POLAR_BASE);
    let body = serde_json::json!({ "key": key, "organization_id": POLAR_ORG_ID });

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| ValidateErr::Transient(format!("send: {}", e)))?;

    let status = res.status();
    let body_json: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);

    if status.is_success() {
        return Ok(body_json);
    }
    if status == 401 || status == 403 || status == 404 {
        return Err(ValidateErr::Rejected(extract_error_message(
            &body_json,
            status.as_u16(),
        )));
    }
    // 5xx, 429 etc — Polar's problem
    Err(ValidateErr::Transient(format!(
        "Polar HTTP {}",
        status.as_u16()
    )))
}

pub(crate) fn extract_error_message(body: &serde_json::Value, status: u16) -> String {
    if let Some(detail) = body.get("detail") {
        if let Some(s) = detail.as_str() {
            return s.to_string();
        }
        if let Some(arr) = detail.as_array() {
            if let Some(first) = arr.first().and_then(|f| f.get("msg")).and_then(|m| m.as_str()) {
                return first.to_string();
            }
        }
    }
    if let Some(err) = body.get("error").and_then(|e| e.as_str()) {
        return err.to_string();
    }
    match status {
        404 => "License key not found.".to_string(),
        401 | 403 => "License key is no longer valid.".to_string(),
        429 => "Too many attempts — wait a minute and try again.".to_string(),
        _ => format!("Activation failed (HTTP {}).", status),
    }
}

pub(crate) fn extract_email(body: &serde_json::Value) -> Option<String> {
    body.pointer("/customer/email")
        .and_then(|v| v.as_str())
        .or_else(|| body.pointer("/user/email").and_then(|v| v.as_str()))
        .map(String::from)
}

/// Key expiry from a Polar license-key payload (`expires_at`, RFC 3339) as
/// ms since epoch. None for perpetual keys or unparseable values.
pub(crate) fn extract_expires(body: &serde_json::Value) -> Option<u64> {
    let raw = body.get("expires_at")?.as_str()?;
    let dt = chrono::DateTime::parse_from_rfc3339(raw).ok()?;
    u64::try_from(dt.timestamp_millis()).ok()
}

/// The license decision the UI gates on at mount.
pub async fn get_startup_license() -> StartupLicense {
    crate::state::license().startup().await
}

/// Validate a key against Polar and persist it on success. Not exposed in
/// the UI anymore (login is email-only); `login_with_code` funnels through
/// here so there is a single validate-and-persist path.
pub async fn activate_license(key: String) -> Result<LicenseInfo, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("License key is empty.".to_string());
    }
    match call_polar_validate(&key).await {
        Ok(body) => {
            let now = ms_since_epoch();
            let info = LicenseInfo {
                key,
                email: extract_email(&body),
                activated_at: now,
                last_validated: now,
                expires_at: extract_expires(&body),
            };
            crate::state::license().set(info.clone()).await?;
            Ok(info)
        }
        Err(ValidateErr::Rejected(msg)) => Err(msg),
        Err(ValidateErr::Transient(msg)) => Err(msg),
    }
}

fn portal_client() -> Result<reqwest::Client, String> {
    crate::util::http_client(HTTP_TIMEOUT_SECS)
}

/// Ask Polar to email a one-time login code. Same unauthenticated
/// customer-portal endpoint Polar's own hosted portal login uses. Polar
/// deliberately answers 202 whether or not the email belongs to a customer
/// (no account enumeration), so success here only means "if you bought
/// Ambient with this address, a code is on its way".
pub async fn request_login_code(email: String) -> Result<(), String> {
    let email = email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') {
        return Err("Enter a valid email address.".to_string());
    }
    let res = portal_client()?
        .post(format!(
            "{POLAR_BASE}/v1/customer-portal/customer-session/request"
        ))
        .json(&serde_json::json!({
            "email": email,
            "organization_id": POLAR_ORG_ID,
        }))
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;

    let status = res.status();
    if status.is_success() {
        return Ok(());
    }
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if status == 409 {
        // Multiple Polar customers share this email; the request endpoint
        // wants a customer_id to disambiguate. Vanishingly rare for a
        // single-product org — surface it instead of building a picker.
        return Err(
            "Multiple accounts share this email. Please contact support to resolve it."
                .to_string(),
        );
    }
    Err(extract_error_message(&body, status.as_u16()))
}

/// Exchange the emailed code for a Polar customer session, look up the
/// customer's Ambient license key through it, and activate that key. The
/// session token is used once and dropped — long-term auth stays the stored
/// license key + the existing 24h revalidation.
pub async fn login_with_code(code: String) -> Result<LicenseInfo, String> {
    let code = code.trim().to_string();
    if code.is_empty() {
        return Err("Enter the code from the email.".to_string());
    }
    let client = portal_client()?;

    let res = client
        .post(format!(
            "{POLAR_BASE}/v1/customer-portal/customer-session/authenticate"
        ))
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        if status == 401 {
            return Err("That code is invalid or has expired. Request a new one.".to_string());
        }
        return Err(extract_error_message(&body, status.as_u16()));
    }
    let token = body
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Polar returned no session token.".to_string())?;

    let res = client
        .get(format!(
            "{POLAR_BASE}/v1/customer-portal/license-keys/?limit=100"
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        return Err(extract_error_message(&body, status.as_u16()));
    }
    let candidates = candidate_keys(&body);
    if candidates.is_empty() {
        return Err("No Ambient license is attached to this email. \
             If you just bought one, try again in a minute."
            .to_string());
    }
    // A customer can hold several keys — e.g. an expired 7-day trial key
    // plus a purchased one. Try each until one validates; only if every
    // key is rejected (all expired/revoked) surface the last rejection,
    // which for a lapsed trial reads as the expiry message.
    let mut last_err = String::new();
    for key in candidates {
        match activate_license(key).await {
            Ok(info) => return Ok(info),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// Keys from a customer-portal license-keys listing in the order worth
/// trying: `granted` keys first (perpetual purchases before soon-expiring
/// trial keys), then everything else — validate() has the final say on
/// each (Polar statuses: granted / disabled / revoked).
pub(crate) fn candidate_keys(body: &serde_json::Value) -> Vec<String> {
    let Some(items) = body.get("items").and_then(|i| i.as_array()) else {
        return Vec::new();
    };
    let key_of = |it: &serde_json::Value| {
        it.get("key")
            .and_then(|k| k.as_str())
            .map(String::from)
    };
    let is_granted =
        |it: &&serde_json::Value| it.get("status").and_then(|s| s.as_str()) == Some("granted");
    let perpetual =
        |it: &&serde_json::Value| it.get("expires_at").map_or(true, |e| e.is_null());

    let mut ordered: Vec<String> = Vec::new();
    for filter in [
        // granted + no expiry (a real purchase) beats granted-but-expiring
        // (an active trial), which beats anything revoked/disabled.
        Box::new(|it: &&serde_json::Value| is_granted(it) && perpetual(it))
            as Box<dyn Fn(&&serde_json::Value) -> bool>,
        Box::new(|it: &&serde_json::Value| is_granted(it) && !perpetual(it)),
        Box::new(|it: &&serde_json::Value| !is_granted(it)),
    ] {
        ordered.extend(items.iter().filter(&filter).filter_map(key_of));
    }
    ordered
}

/// Drop the stored license (Settings → "Sign out").
pub async fn clear_license() {
    crate::state::license().clear().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_email_handles_customer_path() {
        let body = serde_json::json!({
            "customer": { "email": "a@b.com" }
        });
        assert_eq!(extract_email(&body).as_deref(), Some("a@b.com"));
    }

    #[test]
    fn extract_email_handles_user_fallback() {
        let body = serde_json::json!({
            "user": { "email": "u@v.com" }
        });
        assert_eq!(extract_email(&body).as_deref(), Some("u@v.com"));
    }

    #[test]
    fn extract_email_returns_none_when_absent() {
        let body = serde_json::json!({});
        assert!(extract_email(&body).is_none());
    }

    #[test]
    fn extract_error_string_detail() {
        let body = serde_json::json!({ "detail": "Key revoked." });
        assert_eq!(extract_error_message(&body, 403), "Key revoked.");
    }

    #[test]
    fn extract_error_array_detail() {
        let body = serde_json::json!({
            "detail": [{ "msg": "Invalid format." }]
        });
        assert_eq!(extract_error_message(&body, 422), "Invalid format.");
    }

    #[test]
    fn extract_error_falls_back_to_status_message() {
        let body = serde_json::json!({});
        assert_eq!(extract_error_message(&body, 404), "License key not found.");
        assert_eq!(
            extract_error_message(&body, 401),
            "License key is no longer valid."
        );
        assert_eq!(
            extract_error_message(&body, 500),
            "Activation failed (HTTP 500)."
        );
    }

    #[test]
    fn candidate_keys_orders_purchase_trial_then_rest() {
        let body = serde_json::json!({
            "items": [
                { "key": "revoked-key", "status": "revoked", "expires_at": null },
                { "key": "trial-key", "status": "granted", "expires_at": "2026-07-09T00:00:00Z" },
                { "key": "purchase-key", "status": "granted", "expires_at": null }
            ]
        });
        assert_eq!(
            candidate_keys(&body),
            vec!["purchase-key", "trial-key", "revoked-key"]
        );
    }

    #[test]
    fn candidate_keys_includes_non_granted_last() {
        let body = serde_json::json!({
            "items": [{ "key": "only-key", "status": "disabled" }]
        });
        assert_eq!(candidate_keys(&body), vec!["only-key"]);
    }

    #[test]
    fn candidate_keys_empty_when_no_items() {
        assert!(candidate_keys(&serde_json::json!({ "items": [] })).is_empty());
        assert!(candidate_keys(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn extract_expires_parses_rfc3339() {
        let body = serde_json::json!({ "expires_at": "2026-07-09T12:00:00Z" });
        let ms = extract_expires(&body).expect("should parse");
        assert_eq!(ms, 1_783_598_400_000);
        assert!(extract_expires(&serde_json::json!({ "expires_at": null })).is_none());
        assert!(extract_expires(&serde_json::json!({})).is_none());
    }

    #[test]
    fn load_or_migrate_returns_none_when_nothing_present() {
        let tmp = std::env::temp_dir().join("ambient-test-license-empty");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(load_or_migrate(&tmp).is_none());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn load_or_migrate_lifts_license_from_legacy() {
        let tmp = std::env::temp_dir().join("ambient-test-license-migrate");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let legacy = serde_json::json!({
            "license.state": {
                "key": "abc-uuid",
                "email": "x@y.com",
                "activatedAt": 1000,
                "lastValidated": 2000
            },
            "patterns.config": { "type": "mesh" }
        });
        std::fs::write(
            tmp.join("ambient.json"),
            serde_json::to_string(&legacy).unwrap(),
        )
        .unwrap();

        let loaded = load_or_migrate(&tmp).unwrap();
        assert_eq!(loaded.key, "abc-uuid");
        assert_eq!(loaded.email.as_deref(), Some("x@y.com"));
        assert_eq!(loaded.last_validated, 2000);

        assert!(tmp.join("ambient-license.json").exists());
        let remaining: serde_json::Value =
            serde_json::from_slice(&std::fs::read(tmp.join("ambient.json")).unwrap()).unwrap();
        assert!(remaining.get("license.state").is_none());
        assert!(remaining.get("patterns.config").is_some());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn load_at_startup_flags_stale_caches() {
        let tmp = std::env::temp_dir().join("ambient-test-license-stale");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // Stored license validated 48h ago — past the 24h threshold.
        let now = ms_since_epoch();
        let two_days_ago = now.saturating_sub(48 * 60 * 60 * 1000);
        let info = LicenseInfo {
            key: "k".to_string(),
            email: None,
            activated_at: two_days_ago,
            last_validated: two_days_ago,
            expires_at: None,
        };
        write_atomic(&tmp.join("ambient-license.json"), &info).unwrap();

        let (_, startup, needs_reval) = load_at_startup(&tmp);
        assert!(matches!(startup, StartupLicense::Valid { .. }));
        assert!(needs_reval, "48h-old cache should be flagged stale");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn load_at_startup_fresh_cache_not_stale() {
        let tmp = std::env::temp_dir().join("ambient-test-license-fresh");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let info = LicenseInfo {
            key: "k".to_string(),
            email: None,
            activated_at: ms_since_epoch(),
            last_validated: ms_since_epoch(),
            expires_at: None,
        };
        write_atomic(&tmp.join("ambient-license.json"), &info).unwrap();

        let (_, _startup, needs_reval) = load_at_startup(&tmp);
        assert!(!needs_reval, "fresh cache should not need revalidation");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
