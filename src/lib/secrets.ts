// BYO API keys (Unsplash, Pexels, OpenAI) moved out of plain-JSON
// settings storage and into the OS keyring (macOS Keychain, Windows
// Credential Manager, libsecret on Linux GNOME/KDE) in Phase 3. The
// useSecret hook below mimics the useDraftState shape: typing into a
// password input updates local state immediately, persistence happens
// on a 400ms debounce so we don't burn keyring writes per keystroke.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';

export type SecretName = 'unsplash_key' | 'pexels_key' | 'openai_key';

export async function getSecret(name: SecretName): Promise<string | null> {
  return invoke<string | null>('get_secret', { name });
}

export async function setSecret(name: SecretName, value: string): Promise<void> {
  return invoke<void>('set_secret', { name, value });
}

export async function clearSecret(name: SecretName): Promise<void> {
  return invoke<void>('clear_secret', { name });
}

/// Reactive binding to a keyring secret. Returns [value, setValue, loaded].
/// loaded flips true once the initial read resolves so consumers can avoid
/// rendering "key missing" UI before the read returns.
export function useSecret(
  name: SecretName,
  debounceMs = 400,
): [string, (value: string) => void, boolean] {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getSecret(name).then((v) => {
      if (cancelled) return;
      // Functional update: only overwrite if the user hasn't typed
      // since mount. getSecret is a sub-ms RAM read in practice, but
      // guarding against the cold-start race costs nothing.
      setValue((current) => (current === '' ? (v ?? '') : current));
      loadedRef.current = true;
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [name]);

  function update(next: string) {
    setValue(next);
    if (!loadedRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void (next ? setSecret(name, next) : clearSecret(name));
    }, debounceMs);
  }

  return [value, update, loaded];
}
