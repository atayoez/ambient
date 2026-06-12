// Shell event bridge. The embedding shell registers a sink once at
// startup; core modules fire app-level events through it. Payloads are
// serialized to serde_json::Value — the same JSON tauri's Emitter put on
// the wire pre-extraction — so the frontend contract is unchanged. With
// no sink registered (unit tests, headless tools) events drop silently.

use std::sync::OnceLock;

type Sink = Box<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

static SINK: OnceLock<Sink> = OnceLock::new();

/// Register the process-wide event sink. Later calls are ignored
/// (OnceLock) — one shell per process.
pub fn set_sink<F>(f: F)
where
    F: Fn(&'static str, serde_json::Value) + Send + Sync + 'static,
{
    let _ = SINK.set(Box::new(f));
}

/// Fire an app-level event through the registered sink. Serialization
/// failure or a missing sink drops the event — events here are
/// notifications, never load-bearing state.
pub(crate) fn emit<T: serde::Serialize>(name: &'static str, payload: &T) {
    if let Some(sink) = SINK.get() {
        if let Ok(value) = serde_json::to_value(payload) {
            sink(name, value);
        }
    }
}
