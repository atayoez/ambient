// Pure helpers behind the live-wallpaper widgets (components/widgets/):
// placement, text tone, and the clock / calendar / countdown maths. Kept
// free of React so they're unit-testable and so the Plasma plugin's QML
// twin (plasma/.../contents/ui/Widgets.qml) has one readable reference to
// mirror.

import type { ClockPosition, LiveClock, LiveWidgets } from './types';

export type WidgetId = 'clock' | 'weather' | 'calendar' | 'countdown' | 'note';
export type ExtraWidgetId = Exclude<WidgetId, 'clock'>;

/** Placement fields every widget carries (see LiveClock in types.rs). */
export interface Placement {
  enabled: boolean;
  position: ClockPosition;
  x: number;
  y: number;
  size: number;
}

/** Mirrors `impl Default for LiveWidgets` in types.rs — shown until settings load. */
export const DEFAULT_LIVE_WIDGETS: LiveWidgets = {
  style: 'plain',
  weather: {
    enabled: false,
    position: 'top-left',
    x: 4,
    y: 4,
    size: 6,
    location: '',
    latitude: 0,
    longitude: 0,
    unit: 'celsius',
    showForecast: true,
  },
  calendar: {
    enabled: false,
    position: 'bottom-left',
    x: 4,
    y: 96,
    size: 2,
    weekStartsMonday: true,
  },
  countdown: {
    enabled: false,
    position: 'center',
    x: 50,
    y: 50,
    size: 6,
    label: '',
    date: '',
  },
  note: {
    enabled: false,
    position: 'bottom-right',
    x: 96,
    y: 96,
    size: 2.5,
    text: '',
  },
};

// Where a freshly chosen anchor snaps to — 4% in from its edges, or dead
// centre. Mirrors ClockPosition::default_xy in types.rs.
export function anchorDefaults(anchor: ClockPosition): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x: 4, y: 4 };
    case 'top-right':
      return { x: 96, y: 4 };
    case 'bottom-left':
      return { x: 4, y: 96 };
    case 'bottom-right':
      return { x: 96, y: 96 };
    default:
      return { x: 50, y: 50 };
  }
}

/** Per-anchor CSS translate that puts the anchored corner on the (x, y) point. */
export const ANCHOR_TRANSLATE: Record<ClockPosition, string> = {
  'top-left': '0 0',
  'top-right': '-100% 0',
  'bottom-left': '0 -100%',
  'bottom-right': '-100% -100%',
  center: '-50% -50%',
};

export const ANCHOR_ALIGN: Record<ClockPosition, 'left' | 'right' | 'center'> = {
  'top-left': 'left',
  'top-right': 'right',
  'bottom-left': 'left',
  'bottom-right': 'right',
  center: 'center',
};

// Dark text over light base colours (sRGB relative luminance of the
// pattern's background colour), light text otherwise — legible on any
// palette. Same 0.6 cut-off as the QML twin.
export function onLightBackground(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

export function formatClock(
  now: Date,
  clock: LiveClock,
): { time: string; date: string | null } {
  // hourCycle (not hour12) so 24-hour midnight reads "00:xx", not "24:xx".
  const time = new Intl.DateTimeFormat(undefined, {
    hour: clock.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    second: clock.showSeconds ? '2-digit' : undefined,
    hourCycle: clock.hour12 ? 'h12' : 'h23',
  }).format(now);
  const date = clock.showDate
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now)
    : null;
  return { time, date };
}

export interface CalendarMonth {
  title: string;
  /** Narrow weekday labels in display order. */
  weekdays: string[];
  /** Day numbers in display order, null for the leading / trailing blanks. Whole weeks. */
  cells: (number | null)[];
  today: number;
}

export function calendarMonth(now: Date, weekStartsMonday: boolean): CalendarMonth {
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const startDow = weekStartsMonday ? 1 : 0;
  const lead = (first.getDay() - startDow + 7) % 7;
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  // 2023-01-01 was a Sunday; walk a week from the chosen first day.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    wdFmt.format(new Date(2023, 0, 1 + startDow + i)),
  );
  const title = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { title, weekdays, cells, today: now.getDate() };
}

/** Parse a local `YYYY-MM-DD` date; null when empty or malformed. */
export function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

/**
 * Whole calendar days from `now`'s date to `iso` (negative once it's past),
 * or null when no valid date is set. Counted on local dates, so it flips at
 * midnight and a DST change can't make it off by one.
 */
export function daysUntil(now: Date, iso: string): number | null {
  const target = parseLocalDate(iso);
  if (!target) return null;
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** The countdown's big value + unit and its caption under it. */
export function formatCountdown(
  days: number | null,
  label: string,
): { value: string; unit: string; caption: string } {
  const name = label.trim();
  if (days === null) return { value: '–', unit: '', caption: 'Pick a date' };
  if (days === 0) return { value: 'Today', unit: '', caption: name };
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  if (days > 0)
    return { value: String(n), unit, caption: name ? `until ${name}` : 'to go' };
  return { value: String(n), unit, caption: name ? `since ${name}` : 'ago' };
}
