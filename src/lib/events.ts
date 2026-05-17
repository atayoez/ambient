// Typed in-process event bus. Wraps window.dispatchEvent/addEventListener
// with a string-name → payload type map so the wire format stays a single
// source of truth — adding a new event means adding one entry to EventMap
// and every dispatch/listen call site type-checks immediately.
//
// Phase 4 introduces Rust-originated events; a single subscriber in
// App.tsx forwards those Tauri events into this bus so consumers stay
// uniform.

import type { Wallpaper } from './types';

interface EventMap {
  'settings-changed': undefined;
  'wallpaper-applied': string;
  'wallpaper-rotated': Wallpaper;
  'library-changed': Wallpaper[];
}

const PREFIX = 'ambient-';

type DispatchArgs<K extends keyof EventMap> = undefined extends EventMap[K]
  ? [name: K]
  : [name: K, detail: EventMap[K]];

type Listener<K extends keyof EventMap> = undefined extends EventMap[K]
  ? () => void
  : (detail: EventMap[K]) => void;

export function dispatch<K extends keyof EventMap>(...args: DispatchArgs<K>): void {
  if (typeof window === 'undefined') return;
  const [name, detail] = args as [K, EventMap[K] | undefined];
  window.dispatchEvent(new CustomEvent(PREFIX + name, { detail }));
}

export function listen<K extends keyof EventMap>(
  name: K,
  handler: Listener<K>,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapped = (e: Event) => {
    const detail = (e as CustomEvent<EventMap[K]>).detail;
    (handler as (d: EventMap[K] | undefined) => void)(detail);
  };
  const full = PREFIX + name;
  window.addEventListener(full, wrapped);
  return () => window.removeEventListener(full, wrapped);
}
