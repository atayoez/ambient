// BYO API keys (Unsplash, Pexels, OpenAI) moved out of plain-JSON
// settings storage and into the OS keyring (macOS Keychain, Windows
// Credential Manager, libsecret on Linux GNOME/KDE) in Phase 3. The
// useSecret hook below mimics the useDraftState shape: typing into a
// password input updates local state immediately, persistence happens
// on a 400ms debounce so we don't burn keyring writes per keystroke.
//
// State is module-level (a cache + per-secret subscriber sets, same
// pattern as lib/toast.ts) rather than per-hook-instance: tabs stay
// mounted after their first visit, so a key typed into Settings must
// also update the useSecret('unsplash_key') instance a mounted Sources
// tab is holding — per-instance useState copies silently desynced.

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type SecretName =
  | 'unsplash_key'
  | 'pexels_key'
  | 'openai_key'
  | 'pollinations_key'
  | 'wallhaven_key';

// ---------------------------------------------------------------------
// Module-level store: one source of truth per secret, shared by every
// mounted hook instance.
// ---------------------------------------------------------------------

const cache = new Map<SecretName, string>();
const loadedSet = new Set<SecretName>();
const pendingLoads = new Set<SecretName>();
const listeners = new Map<SecretName, Set<() => void>>();
const writeTimers = new Map<SecretName, number>();

function emit(name: SecretName) {
  for (const l of listeners.get(name) ?? []) l();
}

// Kick off the initial keyring read for a secret (once per name).
function ensureLoaded(name: SecretName) {
  if (loadedSet.has(name) || pendingLoads.has(name)) return;
  pendingLoads.add(name);
  void invoke<string | null>('get_secret', { name }).then((v) => {
    pendingLoads.delete(name);
    // Only seed from the keyring if the user hasn't typed since mount.
    // The read is a sub-ms RAM hit in practice, but guarding against
    // the cold-start race costs nothing.
    if (!cache.has(name)) cache.set(name, v ?? '');
    loadedSet.add(name);
    emit(name);
  });
}

export async function getSecret(name: SecretName): Promise<string | null> {
  return invoke<string | null>('get_secret', { name });
}

// The raw writers keep the shared cache in sync so any mounted useSecret
// instance reflects a direct set/clear immediately.
export async function setSecret(name: SecretName, value: string): Promise<void> {
  cache.set(name, value);
  loadedSet.add(name);
  emit(name);
  return invoke<void>('set_secret', { name, value });
}

export async function clearSecret(name: SecretName): Promise<void> {
  cache.set(name, '');
  loadedSet.add(name);
  emit(name);
  return invoke<void>('clear_secret', { name });
}

// Update the shared value now; persist to the keyring after `debounceMs`
// of quiet. The timer is module-level so a remount mid-debounce doesn't
// drop the pending write.
function updateSecret(name: SecretName, next: string, debounceMs: number) {
  cache.set(name, next);
  emit(name);
  // Don't persist before the initial read resolves — the user's first
  // keystroke shouldn't race the keyring load.
  if (!loadedSet.has(name)) return;
  const t = writeTimers.get(name);
  if (t !== undefined) window.clearTimeout(t);
  writeTimers.set(
    name,
    window.setTimeout(() => {
      writeTimers.delete(name);
      void (next ? setSecret(name, next) : clearSecret(name));
    }, debounceMs),
  );
}

/// Reactive binding to a keyring secret. Returns [value, setValue, loaded].
/// loaded flips true once the initial read resolves so consumers can avoid
/// rendering "key missing" UI before the read returns. All instances for
/// the same name share one value — an edit in one tab updates them all.
export function useSecret(
  name: SecretName,
  debounceMs = 400,
): [string, (value: string) => void, boolean] {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    [name],
  );

  useEffect(() => ensureLoaded(name), [name]);

  const value = useSyncExternalStore(subscribe, () => cache.get(name) ?? '');
  const loaded = useSyncExternalStore(subscribe, () => loadedSet.has(name));

  const update = useCallback(
    (next: string) => updateSecret(name, next, debounceMs),
    [name, debounceMs],
  );

  return [value, update, loaded];
}
