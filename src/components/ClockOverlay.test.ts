import { describe, expect, it } from 'bun:test';
import type { LiveClock } from '../lib/types';
import { clockOnLightBackground, formatClock } from './ClockOverlay';

const base: LiveClock = {
  enabled: true,
  position: 'top-right',
  size: 'medium',
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

describe('clockOnLightBackground', () => {
  it('picks dark text over light base colours and light text otherwise', () => {
    expect(clockOnLightBackground('#ffffff')).toBe(true);
    expect(clockOnLightBackground('#fcd34d')).toBe(true);
    expect(clockOnLightBackground('#0e0e11')).toBe(false);
    expect(clockOnLightBackground('#1f0e3d')).toBe(false);
    expect(clockOnLightBackground(undefined)).toBe(false);
    expect(clockOnLightBackground('not-a-colour')).toBe(false);
  });
});
