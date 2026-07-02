import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type LiveShaderHandle, startLiveShader } from '../lib/liveShader';
import { ANIMATABLE, type PatternConfig, type PatternType } from '../lib/patterns';
import EmojiField from './EmojiField';

// Fullscreen wallpaper renderer for the Windows live-wallpaper window
// (live_win.rs parents this view behind the desktop icons). It renders the
// SAME pattern the in-app preview does — shaders via startLiveShader, emoji
// via EmojiField, everything else as the pre-rendered still — so Windows
// gets the same look as the KDE plugin without a second rendering path.
//
// The spec arrives two ways: baked into `window.__AMBIENT_SPEC__` by the
// shell's init-script before mount (first apply, no IPC race), and pushed
// over the `live-spec` event on every re-apply.

// The shader-backed subset — ANIMATABLE is derived from FRAG_SHADERS in
// lib/shaders.ts, so this Set always matches the shaders that actually exist.
const SHADER_TYPES = new Set<PatternType>(ANIMATABLE);

// The spec is a PatternConfig plus the quality caps the shell stamps in and,
// for non-shader patterns, the path to the pre-rendered still.
type Spec = PatternConfig & { image?: string };

declare global {
  interface Window {
    __AMBIENT_SPEC__?: unknown;
  }
}

function parseSpec(v: unknown): Spec | null {
  return v && typeof v === 'object' ? (v as Spec) : null;
}

export default function LiveWallpaper() {
  const [spec, setSpec] = useState<Spec | null>(() => parseSpec(window.__AMBIENT_SPEC__));

  // Re-apply pushes a fresh spec (JSON string) over this event.
  useEffect(() => {
    const pending = listen<string>('live-spec', (e) => {
      try {
        setSpec(parseSpec(JSON.parse(e.payload)));
      } catch {
        // Ignore a malformed spec rather than blanking the wallpaper.
      }
    });
    return () => {
      pending.then((un) => un());
    };
  }, []);

  // Opaque root in the pattern's base colour so the desktop never shows a
  // white flash while the shader/image warms up.
  const root: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    background: spec?.colors?.[0] ?? '#000000',
  };

  if (!spec) return <div style={root} />;

  if (spec.type === 'emoji') {
    return (
      <div style={root}>
        <EmojiField config={spec} className="live-wallpaper-emoji" />
      </div>
    );
  }

  if (SHADER_TYPES.has(spec.type)) {
    return (
      <div style={root}>
        <ShaderFill spec={spec} />
      </div>
    );
  }

  // Static pattern: the shell rendered a still and stamped its path.
  if (spec.image) {
    return (
      <div style={root}>
        <img
          src={convertFileSrc(spec.image)}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    );
  }

  return <div style={root} />;
}

// Start the shader once, push later spec edits through setConfig (no restart)
// — mirrors LivePreview so the live-wallpaper and in-app preview behave
// identically.
function ShaderFill({ spec }: { spec: Spec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<LiveShaderHandle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    handleRef.current = startLiveShader(canvas, spec);
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Start once; updates flow through setConfig below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setConfig(spec);
  }, [spec]);

  return (
    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
  );
}
