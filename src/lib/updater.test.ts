import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { dismissUpdate } from './updater';

// Stub localStorage explicitly with a deterministic in-memory Map-backed
// implementation per test. Bun's test runner has no DOM (and no
// vi.stubGlobal), so the global is installed and removed by hand; saving the
// previous value keeps this correct even on a runtime that does ship one.
describe('dismissUpdate', () => {
  let store: Map<string, string>;
  let previous: PropertyDescriptor | undefined;

  beforeEach(() => {
    store = new Map();
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        get length() {
          return store.size;
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
      },
    });
  });

  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

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
