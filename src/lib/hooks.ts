// Small set of cross-component React hooks. Domain-agnostic — anything
// in here should make sense in any component, not just one tab.
import { useEffect, useRef, useState } from 'react';
import { loadKey, saveKey } from './store';

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
