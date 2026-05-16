// Small set of cross-component React hooks. Domain-agnostic — anything
// in here should make sense in any component, not just one tab.
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadKey, saveKey } from './store';

// Returns a stable callback that fires `delayMs` after its LAST call.
// Use for "stop typing → persist" patterns where intermediate states
// shouldn't hit disk. Latest callback identity is captured in a ref
// so the returned function stays stable across re-renders even when
// the consumer passes a new arrow function each time.
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<number | null>(null);

  // Cancel pending fires on unmount so a tab that gets dismounted
  // mid-debounce doesn't write to disk after its component is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        callbackRef.current(...args);
        timerRef.current = null;
      }, delayMs);
    },
    [delayMs],
  );
}

// State that auto-persists on every change. Use for low-frequency
// values where instant persistence is the right model: theme-mode
// click, license info after a validate. Don't use for slider-driven
// state — that's what useDraftState is for.
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [state, setState] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKey<T>(key).then((v) => {
      if (cancelled) return;
      if (v != null) setState(v);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    void saveKey(key, state);
  }, [key, loaded, state]);

  return [state, setState, loaded];
}

// "Draft" state — loads from disk on mount, then lives only in memory
// until the consumer calls save() explicitly. Use for tweak-heavy state
// behind an Apply gesture: Patterns config (slider drags, palette
// edits), Generate prompt, etc. Unsaved drafts are lost on tab unmount
// or app close, which is the intended trade — the Apply tick is the
// commit. save() accepts an optional value override for the
// setState-then-save pattern where the ref hasn't caught up to the
// most recent set call yet.
export function useDraftState<T>(
  key: string,
  initial: T,
): [
  T,
  React.Dispatch<React.SetStateAction<T>>,
  (override?: T) => Promise<void>,
  boolean,
] {
  const [state, setState] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKey<T>(key).then((v) => {
      if (cancelled) return;
      if (v != null) setState(v);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const save = useCallback(
    async (override?: T) => {
      // Don't persist initial defaults on top of legitimate disk state
      // before the load resolves. The user hasn't gestured yet anyway.
      if (!loadedRef.current) return;
      const value = override !== undefined ? override : stateRef.current;
      await saveKey(key, value);
    },
    [key],
  );

  return [state, setState, save, loaded];
}

interface KeydownOptions {
  cmdOrCtrl?: boolean;
  shift?: boolean;
  // Don't fire when typing in a text field. Defaults to false — most
  // shortcuts (Cmd+Enter to submit, Cmd+1..5 to switch tabs) should still
  // work from inside an input.
  notInInputs?: boolean;
}

export function useKeydown(
  key: string,
  handler: (e: KeyboardEvent) => void,
  { cmdOrCtrl = false, shift = false, notInInputs = false }: KeydownOptions = {},
) {
  // Hold the handler in a ref so we can keep one listener for the
  // lifetime of the component while still calling the latest closure.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (cmdOrCtrl && !(e.metaKey || e.ctrlKey)) return;
      if (!cmdOrCtrl && (e.metaKey || e.ctrlKey)) return;
      if (shift && !e.shiftKey) return;
      if (!shift && e.shiftKey) return;
      if (notInInputs) {
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        )
          return;
      }
      handlerRef.current(e);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, cmdOrCtrl, shift, notInInputs]);
}
