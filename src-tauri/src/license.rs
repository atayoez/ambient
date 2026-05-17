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
use tauri::{AppHandle, Emitter, Manager, State};
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

    pub async fn set(&self, info: LicenseInfo) -> Result<(), String> {
        write_atomic(&self.path, &info)?;
        *self.inner.write().await = Some(info.clone());
        *self.startup.write().await = StartupLicense::Valid { info };
        Ok(())
    }

    pub async fn clear(&self) {
        *self.inner.write().await = None;
        *self.startup.write().await = StartupLicense::None;
        let _ = std::fs::remove_file(&self.path);
    }

    pub async fn mark_invalid(&self, message: String) {
        // Don't drop the in-memory key — keep it so the user can re-try
        // activation later without re-pasting if the rejection was
        // transient (key revoked then un-revoked, e.g. payment fixed).
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
/// state to Invalid + emits a `license-revoked` Tauri event on explicit
/// rejection, no-op on transient failures.
pub async fn revalidate_background(app: AppHandle) {
    let state = app.state::<LicenseState>();
    let info = match state.current().await {
        Some(i) => i,
        None => return,
    };
    match call_polar_validate(&info.key).await {
        Ok(_) => {
            let mut updated = info;
            updated.last_validated = ms_since_epoch();
            let _ = state.set(updated).await;
        }
        Err(ValidateErr::Rejected(msg)) => {
            state.mark_invalid(msg.clone()).await;
            let _ = app.emit("license-revoked", &msg);
        }
        Err(ValidateErr::Transient(_)) => {
            // Trust local copy. The next launch will revalidate again.
        }
    }
}

#[derive(Debug)]
pub(crate) enum ValidateErr {
    Rejected(String),
    Transient(String),
}

pub(crate) async fn call_polar_validate(key: &str) -> Result<serde_json::Value, ValidateErr> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| ValidateErr::Transient(format!("build client: {}", e)))?;

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
        _ => format!("Activation failed (HTTP {}).", status),
    }
}

pub(crate) fn extract_email(body: &serde_json::Value) -> Option<String> {
    body.pointer("/customer/email")
        .and_then(|v| v.as_str())
        .or_else(|| body.pointer("/user/email").and_then(|v| v.as_str()))
        .map(String::from)
}

#[tauri::command]
pub async fn get_startup_license(
    state: State<'_, LicenseState>,
) -> Result<StartupLicense, String> {
    Ok(state.startup().await)
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: State<'_, LicenseState>,
) -> Result<LicenseInfo, String> {
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
            };
            state.set(info.clone()).await?;
            Ok(info)
        }
        Err(ValidateErr::Rejected(msg)) => Err(msg),
        Err(ValidateErr::Transient(msg)) => Err(msg),
    }
}

#[tauri::command]
pub async fn clear_license(state: State<'_, LicenseState>) -> Result<(), String> {
    state.clear().await;
    Ok(())
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
        };
        write_atomic(&tmp.join("ambient-license.json"), &info).unwrap();

        let (_, _startup, needs_reval) = load_at_startup(&tmp);
        assert!(!needs_reval, "fresh cache should not need revalidation");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
