// Shared layout primitives used by Patterns / Sources / Generate.
// Apple-style "document + inspector" arrangement: a preview on the left,
// a vertical inspector with eyebrow-headed sections on the right, and
// a single action bar across the bottom.
import type { CSSProperties, ReactNode } from 'react';
import BlurText from './reactbits/BlurText/BlurText';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface TabLayoutProps {
  title?: string;
  preview: ReactNode;
  inspector: ReactNode;
  actions: ReactNode;
}

export function TabLayout({ title, preview, inspector, actions }: TabLayoutProps) {
  return (
    <div className="tab-grid">
      <div className="preview-col">
        {/* Keyed on `title` so each new tab title remounts BlurText and
            the blur→clear animation re-fires on tab change. */}
        {title && <BlurText key={title} text={title} className="page-title" />}
        {preview}
        <div className="preview-actions">{actions}</div>
      </div>
      <aside className="inspector">{inspector}</aside>
    </div>
  );
}

interface PreviewFrameProps {
  children?: ReactNode;
  empty?: ReactNode;
}

export function PreviewFrame({ children, empty }: PreviewFrameProps) {
  return (
    <div className="preview-wrap">
      {children ?? (empty != null && <div className="preview-empty">{empty}</div>)}
    </div>
  );
}

interface InspectorSectionProps {
  title: string;
  children: ReactNode;
}

export function InspectorSection({ title, children }: InspectorSectionProps) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

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

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}

// Compact 2-3 option picker. Apple-style segmented control — used when the
// option list is short enough that radio rows would be excessive.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={value === id ? 'segment active' : 'segment'}
          onClick={() => onChange(id)}
        >
          {icon && (
            <span className="segment-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

interface SelectOption<T extends string> {
  id: T;
  label: string;
  // Optional prefix glyph rendered inside the option (e.g. pattern type
  // emojis like 🎨 Mesh). Bare strings keep options readable in the OS
  // dropdown popup; using a `<span>` here wouldn't render inside <option>.
  emoji?: string;
}

interface SelectProps<T extends string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

// Native dropdown wrapped as a typed component. Centralizes the API so the
// app-wide select styling (centered text, chevron, focus ring) lives in CSS
// once and every call site just passes options + value + onChange.
export function Select<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {options.map(({ id, label, emoji }) => (
        <option key={id} value={id}>
          {emoji ? `${emoji} ${label}` : label}
        </option>
      ))}
    </select>
  );
}
