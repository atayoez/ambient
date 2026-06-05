// Labelled slider row — eyebrow label, intrinsic-width range, live value.
// One of the two genuinely shared form bits across the full-bleed tabs.

import type { CSSProperties } from 'react';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface ControlRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}

export function ControlRow({
  label,
  value,
  min,
  max,
  onChange,
  suffix = '',
}: ControlRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ ['--p' as string]: `${clamp(pct, 0, 100)}%` } as CSSProperties}
        aria-label={label}
      />
      <span className="control-value">
        {value}
        {suffix}
      </span>
    </div>
  );
}
