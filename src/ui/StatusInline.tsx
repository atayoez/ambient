// Transient in-progress text shown next to the action button that
// triggered the work ("Generating…", "Applying…"). Terminal outcomes —
// successes and errors — go to the global toast stack (lib/toast.ts), so
// this only ever shows ephemeral progress tied to a disabled control.

interface StatusInlineProps {
  status?: string | null;
}

export function StatusInline({ status }: StatusInlineProps) {
  if (!status) return null;
  return <span className="status">{status}</span>;
}
