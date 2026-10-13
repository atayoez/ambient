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

export function LiveIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="M2 6c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 1.3 0 1.9-.5 2.5-1" />
    </SvgRoot>
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
  // Lucide's `wand` icon — a clean diagonal stick + an 8-direction
  // sparkle around a center dot. The previous design had a 4-pointed
  // star whose bottom tip was 1px past where the stick started, so
  // they overlapped instead of meeting end-to-end.
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="m3 21 9-9" />
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="M12.2 6.2 11 5" />
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

export function InfoIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </SvgRoot>
  );
}

export function ClockIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </SvgRoot>
  );
}

export function GearIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </SvgRoot>
  );
}

export function SunIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </SvgRoot>
  );
}

export function MoonIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </SvgRoot>
  );
}

export function AutoThemeIcon({ size = 14, className, style }: IconProps) {
  // Half-filled circle (Lucide's Contrast). Reads as "half day, half
  // night" — the canonical "follow system theme" indicator.
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" stroke="none" />
    </SvgRoot>
  );
}

export function PaletteIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <circle cx="13.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </SvgRoot>
  );
}

export function ImageIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </SvgRoot>
  );
}

export function LayoutGridIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </SvgRoot>
  );
}

export function FilmIcon({ size = 14, className, style }: IconProps) {
  return (
    <SvgRoot size={size} className={className} style={style}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
    </SvgRoot>
  );
}
