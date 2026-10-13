import { describe, expect, it } from 'bun:test';
import type { LiveClock } from './types';
import {
  calendarMonth,
  daysUntil,
  formatClock,
  formatCountdown,
  onLightBackground,
  parseLocalDate,
} from './widgets';

const base: LiveClock = {
  enabled: true,
  position: 'top-right',
  x: 96,
  y: 4,
  size: 9,
  hour12: false,
  showSeconds: false,
  showDate: true,
};

// 2026-03-07 00:05:09 local — midnight is the case that trips hour12:false
// into "24:05" in some engines; hourCycle h23 keeps it "00:05".
const midnight = new Date(2026, 2, 7, 0, 5, 9);
const afternoon = new Date(2026, 2, 7, 15, 5, 9);

describe('formatClock', () => {
  it('renders 24-hour time with a two-digit hour and no seconds by default', () => {
    expect(formatClock(midnight, base).time).toBe('00:05');
    expect(formatClock(afternoon, base).time).toBe('15:05');
  });

  it('appends seconds when asked', () => {
    expect(formatClock(afternoon, { ...base, showSeconds: true }).time).toBe('15:05:09');
  });

  it('renders 12-hour time with a day period', () => {
    const t = formatClock(afternoon, { ...base, hour12: true }).time;
    expect(t).toMatch(/^3:05\s?PM$/i);
  });

  it('includes a long date only when showDate is on', () => {
    expect(formatClock(afternoon, base).date).toMatch(/Saturday/);
    expect(formatClock(afternoon, { ...base, showDate: false }).date).toBeNull();
  });
});

describe('onLightBackground', () => {
  it('picks dark text over light base colours and light text otherwise', () => {
    expect(onLightBackground('#ffffff')).toBe(true);
    expect(onLightBackground('#fcd34d')).toBe(true);
    expect(onLightBackground('#0e0e11')).toBe(false);
    expect(onLightBackground('#1f0e3d')).toBe(false);
    expect(onLightBackground(undefined)).toBe(false);
    expect(onLightBackground('not-a-colour')).toBe(false);
  });
});

describe('calendarMonth', () => {
  // March 2026 starts on a Sunday and has 31 days.
  const march = new Date(2026, 2, 18, 9, 0, 0);

  it('pads a Monday-first month to whole weeks', () => {
    const m = calendarMonth(march, true);
    expect(m.cells.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
    expect(m.cells.length % 7).toBe(0);
    expect(m.cells.filter((c) => c !== null).length).toBe(31);
    expect(m.today).toBe(18);
    expect(m.weekdays.length).toBe(7);
  });

  it('starts on Sunday when asked', () => {
    const m = calendarMonth(march, false);
    expect(m.cells[0]).toBe(1);
    expect(m.cells.length).toBe(35);
  });
});

describe('countdown', () => {
  const now = new Date(2026, 2, 7, 23, 30, 0);

  it('parses only real local dates', () => {
    expect(parseLocalDate('2026-03-08')?.getDate()).toBe(8);
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('soon')).toBeNull();
  });

  it('counts calendar days, not 24-hour spans', () => {
    expect(daysUntil(now, '2026-03-08')).toBe(1);
    expect(daysUntil(now, '2026-03-07')).toBe(0);
    expect(daysUntil(now, '2026-03-01')).toBe(-6);
    // Across the March DST change in most zones.
    expect(daysUntil(now, '2026-04-07')).toBe(31);
    expect(daysUntil(now, '')).toBeNull();
  });

  it('words the result', () => {
    expect(formatCountdown(12, 'Summer trip')).toEqual({
      value: '12',
      unit: 'days',
      caption: 'until Summer trip',
    });
    expect(formatCountdown(1, '')).toEqual({ value: '1', unit: 'day', caption: 'to go' });
    expect(formatCountdown(0, 'Launch')).toEqual({
      value: 'Today',
      unit: '',
      caption: 'Launch',
    });
    expect(formatCountdown(-3, 'Launch').caption).toBe('since Launch');
    expect(formatCountdown(null, 'x').caption).toBe('Pick a date');
  });
});
