// Shared layout primitives. After the full-bleed redesign every tab
// builds its own stage (preview backdrop + floating glass panels), so
// the old TabLayout / Inspector / PreviewFrame / Select / Segmented
// document-inspector scaffolding is gone — only the two genuinely shared
// bits remain: the labelled slider row and the inline status line.
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

// Labelled slider — eyebrow label, intrinsic-width range, live value.
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

interface StatusInlineProps {
  status?: string | null;
  error?: string | null;
}

export function StatusInline({ status, error }: StatusInlineProps) {
  return (
    <>
      {status && <span className="status">{status}</span>}
      {error && <span className="error">{error}</span>}
    </>
  );
}
