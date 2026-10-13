import { describe, expect, it } from 'bun:test';
import {
  forecastUrl,
  formatTemp,
  parseForecast,
  weatherKind,
  weatherLabel,
} from './weather';

describe('weatherKind', () => {
  it('maps WMO codes to icon kinds, with night variants for clear skies', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(1, false)).toBe('clear-night');
    expect(weatherKind(2, false)).toBe('partly-night');
    expect(weatherKind(3)).toBe('cloudy');
    expect(weatherKind(45)).toBe('fog');
    expect(weatherKind(53)).toBe('drizzle');
    expect(weatherKind(63)).toBe('rain');
    expect(weatherKind(81)).toBe('rain');
    expect(weatherKind(75)).toBe('snow');
    expect(weatherKind(86)).toBe('snow');
    expect(weatherKind(99)).toBe('storm');
    expect(weatherLabel(2)).toBe('Partly cloudy');
  });
});

describe('forecast', () => {
  it('asks for Fahrenheit and mph only when the widget uses them', () => {
    expect(forecastUrl(52.52, 13.405, 'celsius')).not.toContain('temperature_unit');
    const f = forecastUrl(40.7128, -74.006, 'fahrenheit');
    expect(f).toContain('temperature_unit=fahrenheit');
    expect(f).toContain('wind_speed_unit=mph');
    expect(f).toContain('latitude=40.7128');
  });

  it('shapes the Open-Meteo response', () => {
    const w = parseForecast({
      current: {
        temperature_2m: 11.6,
        apparent_temperature: 9.2,
        weather_code: 61,
        is_day: 0,
        relative_humidity_2m: 80,
        wind_speed_10m: 14,
      },
      daily: {
        time: ['2026-10-13', '2026-10-14'],
        weather_code: [61, 2],
        temperature_2m_max: [13, 15.4],
        temperature_2m_min: [8, 7.1],
      },
    });
    expect(w?.isDay).toBe(false);
    expect(w?.daily).toEqual([
      { date: '2026-10-13', code: 61, max: 13, min: 8 },
      { date: '2026-10-14', code: 2, max: 15.4, min: 7.1 },
    ]);
    expect(parseForecast({})).toBeNull();
  });

  it('rounds temperatures without a negative zero', () => {
    expect(formatTemp(11.6)).toBe('12°');
    expect(formatTemp(-0.4)).toBe('0°');
    expect(formatTemp(-3.5)).toBe('-3°');
  });
});
