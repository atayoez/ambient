// Labelled field wrapper — a label above a control, the pattern repeated
// in Generate (prompt, model) and elsewhere. Emits the existing `.field`
// class so styling is unchanged; this just stops each tab from
// re-writing the label/span/control scaffolding.
//
// Renders a <div> rather than a <label>: the control is passed as
// `children` (opaque to static analysis), and every control we drop in
// here already carries its own aria-label, so a wrapping <label> would
// be both unverifiable and redundant.

import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
}

export function Field({ label, children }: FieldProps) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
    </div>
  );
}
