import { fetch } from '@tauri-apps/plugin-http';
import type { Settings, SourceKind } from './types';

export interface FetchedWallpaper {
  url: string;
  filename: string;
  source: SourceKind;
  title?: string;
}

export async function fetchRandomFromSource(
  settings: Settings,
): Promise<FetchedWallpaper> {
  switch (settings.source) {
    case 'nasa-apod':
      return nasaApod();
    case 'unsplash':
      return unsplash(settings.unsplashKey, settings.unsplashQuery);
    case 'pexels':
      return pexels(settings.pexelsKey, settings.pexelsQuery);
  }
}

// NASA APOD publishes once per day, and rotation/preview is cache-gated
// to a single fetch per day per user. At that rate DEMO_KEY's 30/hr global
// cap effectively can't bind, so we don't bother surfacing a per-user
// API-key field — it was just noise in the inspector.
async function nasaApod(): Promise<FetchedWallpaper> {
  const res = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
  if (res.status === 429) {
    throw new Error(
      "NASA's shared DEMO_KEY is rate-limited right now. Try again in a few minutes — Ambient only refreshes once a day, so this should be rare.",
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg ?? `NASA APOD ${res.status}`);
  const url: string | undefined = data.hdurl ?? data.url;
  if (!url) throw new Error('NASA APOD: no image URL returned (today might be a video).');
  const filename = `nasa-${data.date ?? Date.now()}.jpg`;
  return { url, filename, source: 'nasa-apod', title: data.title };
}

async function unsplash(key: string, query: string): Promise<FetchedWallpaper> {
  if (!key) throw new Error('Set your Unsplash API key in Sources first.');
  const u = new URL('https://api.unsplash.com/photos/random');
  u.searchParams.set('orientation', 'landscape');
  if (query.trim()) u.searchParams.set('query', query.trim());
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Client-ID ${key}` },
  });
  const data = await res.json();
  if (!res.ok || !data?.urls?.full) {
    throw new Error(data?.errors?.[0] ?? `Unsplash ${res.status}`);
  }
  return {
    url: data.urls.full,
    filename: `unsplash-${data.id}.jpg`,
    source: 'unsplash',
    title: data.alt_description ?? data.description ?? '',
  };
}

async function pexels(key: string, query: string): Promise<FetchedWallpaper> {
  if (!key) throw new Error('Set your Pexels API key in Sources first.');
  const url = query.trim()
    ? `https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(query.trim())}`
    : 'https://api.pexels.com/v1/curated?per_page=1';
  const res = await fetch(url, { headers: { Authorization: key } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const photo = data.photos?.[0];
  if (!photo) throw new Error('Pexels: no photo for this query.');
  return {
    url: photo.src.original,
    filename: `pexels-${photo.id}.jpg`,
    source: 'pexels',
    title: photo.alt ?? '',
  };
}
