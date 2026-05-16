import { describe, expect, it } from 'vitest';
import { isDarkForMode } from './theme';

describe('isDarkForMode', () => {
  it('returns true for explicit dark regardless of system', () => {
    expect(isDarkForMode('dark', false)).toBe(true);
    expect(isDarkForMode('dark', true)).toBe(true);
  });

  it('returns false for explicit light regardless of system', () => {
    expect(isDarkForMode('light', false)).toBe(false);
    expect(isDarkForMode('light', true)).toBe(false);
  });

  it('follows system preference when set to auto', () => {
    expect(isDarkForMode('auto', false)).toBe(false);
    expect(isDarkForMode('auto', true)).toBe(true);
  });
});
