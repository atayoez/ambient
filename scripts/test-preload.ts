// `bun test` preload (bunfig.toml [test].preload).
//
// The unit tests exercise pure modules, but src/lib/events.ts talks to
// `window` as an EventTarget (dispatchEvent / addEventListener with
// CustomEvent). Bun ships CustomEvent and EventTarget but no `window`, so
// give the tests one — a bare EventTarget is exactly the surface the bus
// uses, and it is a real event target, not a mock. Nothing DOM-shaped
// beyond that is provided on purpose: a test that needs another browser
// global stubs it explicitly (see updater.test.ts and its localStorage).
if (!('window' in globalThis)) {
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
}
