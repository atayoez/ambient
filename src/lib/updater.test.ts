import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissUpdate } from './updater';

// Stub localStorage explicitly. Vitest 4 + jsdom + bun didn't expose
// window.localStorage on globalThis reliably; stubGlobal sidesteps the
// environment discrepancy and gives us a deterministic in-memory
// Map-backed implementation per test.
describe('dismissUpdate', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists the dismissed version to localStorage', () => {
    dismissUpdate('0.4.0');
    expect(store.get('updater.dismissedVersion')).toBe('0.4.0');
  });

  it('overwrites previous dismissals (last one wins)', () => {
    dismissUpdate('0.3.0');
    dismissUpdate('0.4.0');
    expect(store.get('updater.dismissedVersion')).toBe('0.4.0');
  });
});
