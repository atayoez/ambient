// The single notification surface for the whole app. Mounted once in
// App.tsx, it subscribes to the toast store and renders a bottom-right
// stack. Every success/error/info anywhere in the app lands here with
// identical styling — see lib/toast.ts for the why.

import { useSyncExternalStore } from 'react';
import { CheckIcon, InfoIcon, XIcon } from '../components/Icons';
import { dismiss, getToasts, subscribe, type ToastKind } from '../lib/toast';

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckIcon size={13} />,
  error: <XIcon size={13} />,
  info: <InfoIcon size={13} />,
};

export default function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          aria-label={`${t.kind}: ${t.message}. Dismiss`}
        >
          <span className="toast-icon" aria-hidden="true">
            {ICONS[t.kind]}
          </span>
          <span className="toast-msg">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
