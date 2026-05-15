import { primaryMonitor } from '@tauri-apps/api/window';
import { fetch } from '@tauri-apps/plugin-http';
import type { Settings } from './types';

export interface GeneratedWallpaper {
  url: string;
  filename: string;
  prompt: string;
  provider: 'pollinations' | 'openai';
}

const POLLINATIONS_MAX = 2048;

export async function generateWallpaper(
  settings: Settings,
  prompt: string,
): Promise<GeneratedWallpaper> {
  const { w, h } = await resolveDimensions(settings);
  switch (settings.genProvider) {
    case 'pollinations':
      return pollinations(prompt, settings.pollinationsModel, w, h);
    case 'openai':
      return openaiDalle(settings.openaiKey, settings.openaiModel, prompt, w, h);
  }
}

async function resolveDimensions(settings: Settings): Promise<{ w: number; h: number }> {
  if (settings.genResolution !== 'auto') {
    const [w, h] = settings.genResolution.split('x').map(Number);
    return { w, h };
  }
  try {
    const m = await primaryMonitor();
    if (m?.size) return { w: m.size.width, h: m.size.height };
  } catch {
    // fall through
  }
  return { w: 2560, h: 1440 };
}

function pollinations(
  prompt: string,
  model: string,
  width: number,
  height: number,
): GeneratedWallpaper {
  const { w, h } = clampToAspect(width, height, POLLINATIONS_MAX);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const u = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
  u.searchParams.set('width', String(w));
  u.searchParams.set('height', String(h));
  u.searchParams.set('model', model || 'flux');
  u.searchParams.set('nologo', 'true');
  u.searchParams.set('seed', String(seed));
  u.searchParams.set('enhance', 'true');
  return {
    url: u.toString(),
    filename: `ai-pollinations-${seed}.jpg`,
    prompt,
    provider: 'pollinations',
  };
}

function clampToAspect(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const scale = max / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

async function openaiDalle(
  key: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
): Promise<GeneratedWallpaper> {
  if (!key) throw new Error('Set your OpenAI API key in Settings.');
  let size: '1024x1024' | '1024x1792' | '1792x1024';
  if (width > height) size = '1792x1024';
  else if (height > width) size = '1024x1792';
  else size = '1024x1024';

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'hd',
      response_format: 'url',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `OpenAI ${res.status}`);
  const url: string | undefined = data.data?.[0]?.url;
  if (!url) throw new Error('OpenAI: no image URL returned.');
  return {
    url,
    filename: `ai-openai-${Date.now()}.png`,
    prompt,
    provider: 'openai',
  };
}
