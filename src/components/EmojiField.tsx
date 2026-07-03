import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { PatternConfig } from '../lib/patterns';

// Deterministic per-glyph pseudo-random in [0,1), keyed by index + seed so
// the layout is stable across re-renders (not jumping every frame).
function rnd(i: number, salt: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233 + seed * 0.013) * 43758.5453;
  return x - Math.floor(x);
}

// Animated emoji field for the in-app preview: a grid of glyphs, each
// drifting in its own random direction at its own random speed and spinning
// at its own random rate/direction. Pure CSS (individual `translate` +
// `rotate` properties, so the two animations don't fight) — no per-frame JS,
// and it works in the app's WebKit webview where WebGL doesn't. Mirrors the
// QML emoji field the KDE plugin renders on the desktop.
export default function EmojiField({
  config,
  className,
}: {
  config: PatternConfig;
  className?: string;
}) {
  const seed = config.seed ?? 0;
  const size = config.size ?? 90;
  const spacing = config.emojiSpacing ?? 175;
  const sizeVar = config.emojiSizeVar ?? 0.75;
  const glyphs = config.emojis?.length ? config.emojis : ['✨'];
  const bg = config.colors?.[0] ?? '#000000';
  // Global animation-speed multiplier, present when this renders the live
  // wallpaper spec (Rust stamps it in); the in-app preview stays at 1×.
  const speed = Math.max(0.05, (config as { speed?: number }).speed ?? 1);

  // Fluent 3D art for each glyph, exported to disk by the backend and loaded
  // through the asset protocol — the same files the KDE plugin renders, so
  // the preview matches the desktop instead of showing font glyphs. Entries
  // are '' while loading or for glyphs with no art (those keep the text
  // fallback).
  const [images, setImages] = useState<string[]>([]);
  // Effect keyed on glyph content — `glyphs` itself is a fresh array every
  // render, which as a dep would re-invoke (and re-render) forever.
  const glyphsKey = glyphs.join('\n');
  useEffect(() => {
    let stale = false;
    invoke<string[]>('export_emoji_pngs', { emojis: glyphsKey.split('\n') })
      .then((paths) => {
        if (!stale) setImages(paths.map((p) => (p ? convertFileSrc(p) : '')));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [glyphsKey]);

  // Nominal 16:9 grid, positioned in %, so it's resolution-independent.
  const cell = Math.max(size * (spacing / 100), 24);
  const cols = Math.min(Math.max(Math.round(1280 / cell), 3), 22);
  const rows = Math.min(Math.max(Math.round(720 / cell), 2), 14);

  const items = useMemo(() => {
    const out: Array<{ key: number; glyph: string; style: CSSProperties }> = [];
    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const style = {
        left: `${((col + 0.5) / cols) * 100}%`,
        top: `${((row + 0.5) / rows) * 100}%`,
        fontSize: `${size * (1 - sizeVar * 0.4 + sizeVar * 0.8 * rnd(i, 8, seed))}px`,
        animationDuration: `${(40 + rnd(i, 1, seed) * 50) / speed}s, ${(60 + rnd(i, 4, seed) * 90) / speed}s`,
        animationDelay: `${-rnd(i, 2, seed) * 40}s, ${-rnd(i, 5, seed) * 40}s`,
        animationDirection: `${rnd(i, 3, seed) > 0.5 ? 'reverse' : 'normal'}, ${
          rnd(i, 7, seed) > 0.5 ? 'reverse' : 'normal'
        }`,
        '--amp': `${4 + rnd(i, 9, seed) * 9}px`,
      } as CSSProperties;
      out.push({ key: i, glyph: glyphs[i % glyphs.length], style });
    }
    return out;
  }, [cols, rows, glyphs, seed, size, sizeVar, speed]);

  return (
    <div
      className={className}
      style={{ backgroundColor: bg, overflow: 'hidden' }}
      aria-hidden="true"
    >
      {items.map((it) => {
        const img = images[it.key % glyphs.length] || '';
        return (
          <span key={it.key} className="emoji-field-item" style={it.style}>
            {img ? (
              <img className="fluent-emoji" src={img} alt={it.glyph} draggable={false} />
            ) : (
              it.glyph
            )}
          </span>
        );
      })}
    </div>
  );
}
