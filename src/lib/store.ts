import { load, type Store } from '@tauri-apps/plugin-store';
import { DEFAULT_SETTINGS, type Settings, type Wallpaper } from './types';

let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await load('ambient.json', { defaults: {}, autoSave: true });
  }
  return _store;
}

export async function loadSettings(): Promise<Settings> {
  const store = await getStore();
  const saved = await store.get<Partial<Settings>>('settings');
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
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

// Generic key/value access for component-level persisted state. Used by
// usePersistedState so each consumer can pick a unique key (e.g.
// "patterns.config", "generate.prompt") without growing this file.
export async function loadKey<T>(key: string): Promise<T | null> {
  const store = await getStore();
  return ((await store.get<T>(key)) as T | undefined) ?? null;
}

export async function saveKey<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
