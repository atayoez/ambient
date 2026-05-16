import { load, type Store } from '@tauri-apps/plugin-store';
import { DEFAULT_SETTINGS, type Settings, type Wallpaper } from './types';

let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    // autoSave is OFF. Every persisting call site is explicit: saveKey,
    // saveSettings, saveLibrary all flush to disk via store.save(). High
    // frequency UI state (Patterns slider tweaks, the Generate prompt)
    // doesn't auto-persist — it's saved only when the user clicks the
    // Apply tick, matching the explicit "draft → commit" model.
    _store = await load('ambient.json', { defaults: {}, autoSave: false });
  }
  return _store;
}

export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  // The widened type covers the migration case: pre-rotationSource
  // installs persisted a boolean `rotationEnabled` field instead. Read
  // both and translate the legacy form below.
  const saved = await store.get<
    Partial<Settings> & { rotationEnabled?: boolean; unsplashTopic?: string }
  >('settings');
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  if (saved && 'rotationEnabled' in saved && !('rotationSource' in saved)) {
    // Legacy: only Sources rotation existed and it was gated by a bool.
    merged.rotationSource = saved.rotationEnabled ? 'sources' : 'off';
  }
  // Field rename: unsplashTopic → unsplashQuery (matches pexelsQuery
  // naming, and "query" is closer to Unsplash's own API parameter).
  if (
    saved &&
    'unsplashTopic' in saved &&
    !('unsplashQuery' in saved) &&
    saved.unsplashTopic
  ) {
    merged.unsplashQuery = saved.unsplashTopic;
  }
  return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const store = await getStore();
  await store.set('settings', settings);
  await store.save();
}

export async function loadLibrary(): Promise<Wallpaper[]> {
  const store = await getStore();
  return (await store.get<Wallpaper[]>('library')) ?? [];
}

export async function saveLibrary(library: Wallpaper[]): Promise<void> {
  const store = await getStore();
  await store.set('library', library);
  await store.save();
}

// Serialized read-modify-write for the library. All callers that previously
// did `const lib = await loadLibrary(); await saveLibrary(mutator(lib))`
// should use this instead — that pattern races whenever two callers (e.g.
// rotation-timer + user delete) interleave their reads and writes, causing
// the slower writer to clobber the faster one's change. Symptom in v0.1:
// deleted Library entries reappearing after rotation fired in the background.
//
// A simple Promise chain enforces sequential execution. Each pending
// mutation waits for the previous to finish before reading. Errors are
// caught on the chain so one failed mutation doesn't permanently jam
// subsequent ones, but the caller still gets the rejection on its own
// returned promise.
//
// After the mutator runs, the result is deduplicated by `path` (keeping
// the first occurrence, which is typically the freshest because callers
// prepend new entries). This silently absorbs the re-fetch-same-NASA-image
// case where the same path would otherwise produce duplicate cards.
let _libraryChain: Promise<unknown> = Promise.resolve();

export function mutateLibrary(
  mutator: (current: Wallpaper[]) => Wallpaper[],
): Promise<Wallpaper[]> {
  const next = _libraryChain.then(async () => {
    const current = await loadLibrary();
    const updated = dedupByPath(mutator(current));
    await saveLibrary(updated);
    return updated;
  });
  _libraryChain = next.catch(() => {});
  return next;
}

function dedupByPath(list: Wallpaper[]): Wallpaper[] {
  const seen = new Set<string>();
  const out: Wallpaper[] = [];
  for (const entry of list) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}

// Generic key/value access for component-level persisted state. Used by
// usePersistedState so each consumer can pick a unique key (e.g.
// "patterns.config", "generate.prompt") without growing this file.
export async function loadKey<T>(key: string): Promise<T | null> {
  const store = await getStore();
  return ((await store.get<T>(key)) as T | undefined) ?? null;
}

export async function saveKey<T>(key: string, value: T): Promise<void> {
  // Explicit set + save. The plugin's autoSave is off (see getStore),
  // so this is the only path that persists key/value state. Callers
  // are expected to be explicit user gestures: useDraftState's save(),
  // license validation, theme-mode click, etc. — none high frequency.
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
