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
      return nasaApod(settings.nasaApiKey);
    case 'unsplash':
      return unsplash(settings.unsplashKey, settings.unsplashTopic);
    case 'pexels':
      return pexels(settings.pexelsKey, settings.pexelsQuery);
  }
}

async function nasaApod(apiKey: string): Promise<FetchedWallpaper> {
  const key = apiKey.trim() || 'DEMO_KEY';
  const res = await fetch(
    `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}`,
  );
  if (res.status === 429) {
    throw new Error(
      key === 'DEMO_KEY'
        ? "NASA's shared DEMO_KEY hit its rate limit (30/hr, 50/day). Grab a free personal key at api.nasa.gov and paste it into Sources → NASA — bumps the limit to 1000/hr."
        : 'NASA APOD rate-limited. Try again in a few minutes.',
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.msg ?? `NASA APOD ${res.status}`);
  const url: string | undefined = data.hdurl ?? data.url;
  if (!url) throw new Error('NASA APOD: no image URL returned (today might be a video).');
  const filename = `nasa-${data.date ?? Date.now()}.jpg`;
  return { url, filename, source: 'nasa-apod', title: data.title };
}

async function unsplash(key: string, topic: string): Promise<FetchedWallpaper> {
  if (!key) throw new Error('Set your Unsplash Access Key in Settings.');
  const u = new URL('https://api.unsplash.com/photos/random');
  u.searchParams.set('orientation', 'landscape');
  if (topic.trim()) u.searchParams.set('query', topic.trim());
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
  if (!key) throw new Error('Set your Pexels API key in Settings.');
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
