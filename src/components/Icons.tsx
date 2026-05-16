// Lightweight inline-SVG icon set used to replace text on action buttons.
// All icons are 14×14 by default, stroke-only, currentColor — so a parent
// button's color rules (incl. .primary's white) carry through unchanged.
// Style based on Lucide's geometry (24px viewBox, 2px stroke, round joins).

import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

// Each icon component renders aria-hidden directly on the <svg> element
// (rather than spreading via a helper) because Biome's
// lint/a11y/noSvgWithoutTitle rule can't see the attribute when it
// arrives through a JSX spread. Buttons that render these icons supply
// their own aria-label, so aria-hidden on the svg is the correct call —
// the icon is purely decorative inside an already-labelled control.

interface BaseSvgProps {
  size: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

function SvgRoot({
  size,
  className,
  style,
  strokeWidth = 2,
  children,
}: BaseSvgProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {children}
    </svg>
  );
}

export function TrashIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </SvgRoot>
  );
}

export function XIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </SvgRoot>
  );
}

export function CheckIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style} strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </SvgRoot>
  );
}

export function RefreshIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </SvgRoot>
  );
}

export function ShuffleIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </SvgRoot>
  );
}

export function WandIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="m21 21-9-9" />
      <path d="m12 3 1 4 4 1-4 1-1 4-1-4-4-1 4-1z" />
      <path d="M19 12h2" />
      <path d="M17 17l1.5 1.5" />
      <path d="M17 7l1.5-1.5" />
    </SvgRoot>
  );
}

export function PlusIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </SvgRoot>
  );
}
