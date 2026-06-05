// Icon segmented control — a small row of mutually-exclusive icon
// buttons with a sliding highlight behind the active one. Used for the
// theme switch (Auto / Light / Dark) where three text labels in an
// arrow-scroller read worse than three glyphs you can pick directly.
// Data-driven: pass an options array, each with an id, an icon, and an
// accessible label.

import type { ReactNode } from 'react';

export interface SegmentedIconOption<T extends string> {
  id: T;
  icon: ReactNode;
  label: string;
}

interface SegmentedIconsProps<T extends string> {
  options: SegmentedIconOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}

export default function SegmentedIcons<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedIconsProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  return (
    <div
      className="seg-icons"
      role="radiogroup"
      aria-label={ariaLabel}
      style={
        {
          '--seg-count': options.length,
          '--seg-active': activeIndex,
        } as React.CSSProperties
      }
    >
      <span className="seg-icons-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={o.id === value ? 'seg-icon active' : 'seg-icon'}
          onClick={() => onChange(o.id)}
          aria-label={o.label}
          title={o.label}
        >
          <span aria-hidden="true">{o.icon}</span>
        </button>
      ))}
    </div>
  );
}
