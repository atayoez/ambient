// Weather for the weather widget, from Open-Meteo (open-meteo.com): free,
// no API key, CC BY 4.0 data (credited in the Widgets tab). The webview
// renderers call it directly (CSP connect-src allows the two hosts); the
// Plasma plugin's Widgets.qml makes the same request with XMLHttpRequest and
// carries its own copy of the WMO code table below.

import type { TempUnit } from './types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** How long a fetched forecast is reused before asking again. */
export const WEATHER_REFRESH_MS = 15 * 60_000;

export interface Place {
  name: string;
  /** "Berlin, Germany"-style label stored as the widget's location. */
  label: string;
  /** Region + country, shown under the name in search results. */
  detail: string;
  latitude: number;
  longitude: number;
}

export interface DayForecast {
  /** Local `YYYY-MM-DD`. */
  date: string;
  code: number;
  max: number;
  min: number;
}

export interface Weather {
  temperature: number;
  apparent: number;
  code: number;
  isDay: boolean;
  humidity: number;
  wind: number;
  /** Today first. */
  daily: DayForecast[];
}

export type WeatherKind =
  | 'clear'
  | 'clear-night'
  | 'partly'
  | 'partly-night'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

// WMO weather interpretation codes (Open-Meteo `weather_code`).
export function weatherKind(code: number, isDay = true): WeatherKind {
  if (code === 0 || code === 1) return isDay ? 'clear' : 'clear-night';
  if (code === 2) return isDay ? 'partly' : 'partly-night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code >= 96) return 'Thunderstorm, hail';
  return 'Cloudy';
}

export function formatTemp(t: number): string {
  // Math.round(-0.4) is -0, which prints as "0" but keep it tidy anyway.
  return `${Math.round(t) || 0}°`;
}

export function forecastUrl(latitude: number, longitude: number, unit: TempUnit): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current:
      'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '4',
  });
  if (unit === 'fahrenheit') {
    q.set('temperature_unit', 'fahrenheit');
    q.set('wind_speed_unit', 'mph');
  }
  return `${FORECAST_URL}?${q}`;
}

/** Shape a raw Open-Meteo forecast response; null when it's missing the current block. */
export function parseForecast(json: unknown): Weather | null {
  const j = json as {
    current?: Record<string, number>;
    daily?: Record<string, unknown[]>;
  };
  const c = j?.current;
  if (!c || typeof c.temperature_2m !== 'number') return null;
  const d = j.daily ?? {};
  const dates = (d.time ?? []) as string[];
  const daily: DayForecast[] = dates.map((date, i) => ({
    date,
    code: Number((d.weather_code ?? [])[i] ?? 3),
    max: Number((d.temperature_2m_max ?? [])[i] ?? Number.NaN),
    min: Number((d.temperature_2m_min ?? [])[i] ?? Number.NaN),
  }));
  return {
    temperature: c.temperature_2m,
    apparent: c.apparent_temperature ?? c.temperature_2m,
    code: c.weather_code ?? 3,
    isDay: c.is_day !== 0,
    humidity: c.relative_humidity_2m ?? 0,
    wind: c.wind_speed_10m ?? 0,
    daily,
  };
}

// One in-flight / recent request per (place, unit), shared by every mounted
// widget — the Widgets stage, the Patterns preview and the desktop window
// in the same webview don't each hit the API.
const cache = new Map<string, { at: number; promise: Promise<Weather> }>();

export function fetchWeather(
  latitude: number,
  longitude: number,
  unit: TempUnit,
): Promise<Weather> {
  const url = forecastUrl(latitude, longitude, unit);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < WEATHER_REFRESH_MS - 5_000) return hit.promise;
  const promise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      return r.json();
    })
    .then((json) => {
      const w = parseForecast(json);
      if (!w) throw new Error('Open-Meteo sent no current weather');
      return w;
    });
  cache.set(url, { at: Date.now(), promise });
  // A failed request must not stick for the whole refresh window.
  promise.catch(() => {
    if (cache.get(url)?.promise === promise) cache.delete(url);
  });
  return promise;
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  const q = new URLSearchParams({ name, count: '6', format: 'json' });
  const lang = navigator.language?.split('-')[0];
  if (lang) q.set('language', lang);
  const r = await fetch(`${GEOCODE_URL}?${q}`, { signal });
  if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
  const json = (await r.json()) as {
    results?: {
      name: string;
      latitude: number;
      longitude: number;
      country?: string;
      admin1?: string;
    }[];
  };
  return (json.results ?? []).map((p) => {
    const detail = [p.admin1, p.country].filter((s) => s && s !== p.name).join(', ');
    return {
      name: p.name,
      label: p.country ? `${p.name}, ${p.country}` : p.name,
      detail,
      latitude: p.latitude,
      longitude: p.longitude,
    };
  });
}
