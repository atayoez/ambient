// Arrow scroller — the app's port of the marketing site's wallpaper
// pill. A glass control that shows the current option with prev/next
// arrows that cycle (wrapping) through a list. Replaces dropdown
// <Select>s and chip rows in the full-bleed tabs.
//
// Generic over the option id type. Each option carries a label and an
// optional leading icon. (The old `emoji` field was removed — the
// pattern/palette scrollers no longer prefix a glyph; bare labels read
// cleaner and consistently.)

import type { ReactNode } from 'react';

interface Option<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface OptionScrollerProps<T extends string> {
  /** Small label above the value (e.g. "Pattern"). */
  label?: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}

const ChevronLeft = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 4L6 8l4 4" />
  </svg>
);

const ChevronRight = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export default function OptionScroller<T extends string>({
  label,
  options,
  value,
  onChange,
  ariaLabel,
}: OptionScrollerProps<T>) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const current = options[idx] ?? options[0];
  const n = options.length;

  const go = (delta: number) => {
    if (n === 0) return;
    const next = options[(((idx + delta) % n) + n) % n];
    onChange(next.id);
  };

  return (
    <div
      className="opt-scroller"
      role="group"
      aria-label={ariaLabel ?? label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
      }}
    >
      {label ? <span className="opt-scroller-eyebrow">{label}</span> : null}
      <div className="opt-scroller-row">
        <button
          type="button"
          className="opt-arrow"
          onClick={() => go(-1)}
          disabled={n <= 1}
          aria-label="Previous"
        >
          {ChevronLeft}
        </button>
        <span className="opt-value" aria-live="polite">
          {current?.icon ? (
            <span className="opt-value-icon" aria-hidden="true">
              {current.icon}
            </span>
          ) : null}
          <span className="opt-value-label">{current?.label ?? ''}</span>
        </span>
        <button
          type="button"
          className="opt-arrow"
          onClick={() => go(1)}
          disabled={n <= 1}
          aria-label="Next"
        >
          {ChevronRight}
        </button>
      </div>
    </div>
  );
}
