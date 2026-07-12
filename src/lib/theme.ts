// System color-scheme tracking. Apps that want to follow the OS's
// dark/light setting subscribe via the hook below — it stays in sync
// with `(prefers-color-scheme: dark)` media changes, so toggling the
// system theme updates consumers on the next frame.
import { useEffect, useState } from 'react';

// Re-exported from the ts-rs generated bindings (Rust owns the enum —
// core/src/types.rs ThemeMode); helpers below are TS-only.
export type { ThemeMode } from './generated/ThemeMode';

import type { ThemeMode } from './generated/ThemeMode';

function prefersDarkNow(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState<boolean>(prefersDarkNow);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

// Returns true if a theme mode + current system state should render dark.
export function isDarkForMode(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return systemDark;
}
