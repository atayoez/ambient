// Unified notification store. Before this, three different surfaces
// competed to tell the user what happened: an inline grey `.status`
// span, an inline red `.error` span (both rendered next to whatever
// button triggered the action, so they appeared in a different place
// on every tab), and a one-off `.save-toast` div in Sources. The user
// called this out — "errors are displayed randomly unlike the saved
// notification style." Now everything terminal (a success or a
// failure) flows through one toast stack rendered by <Toaster>, so a
// fetch error on Sources looks identical to an apply error on Patterns
// looks identical to a generation error on Generate. Transient
// in-progress text ("Generating…") stays inline near its button — it's
// tied to a disabled control, not a fire-and-forget notification.
//
// Tiny on purpose: a module-level array + a Set of listeners, surfaced
// to React via useSyncExternalStore. No context provider, no deps.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

// How long each kind lingers before auto-dismiss. Errors stay up longer
// because the user may need to read a backend message; successes are
// just a confirmation glance.
const TTL: Record<ToastKind, number> = {
  success: 2000,
  error: 5000,
  info: 2500,
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function push(kind: ToastKind, message: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  // setTimeout is fine here — toasts are UI-only and never need to
  // survive a webview teardown (unlike the rotation timer, which lives
  // in Rust). If the message is empty, skip: nothing to show.
  window.setTimeout(() => dismiss(id), TTL[kind]);
  return id;
}

export function dismiss(id: number): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
  // Normalizes the `catch (e: unknown)` pattern repeated in every tab
  // into one call: `catch (e) { toast.fromError(e) }`.
  fromError: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)),
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}
