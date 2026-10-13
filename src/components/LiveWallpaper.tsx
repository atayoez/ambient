import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type LiveShaderHandle, startLiveShader } from '../lib/liveShader';
import { ANIMATABLE, type PatternConfig, type PatternType } from '../lib/patterns';
import type { LiveClock } from '../lib/types';
import ClockOverlay from './ClockOverlay';
import EmojiField from './EmojiField';
import VideoFill from './VideoFill';

// Fullscreen wallpaper renderer for the desktop-layer live-wallpaper window
// (live_win.rs parents it behind the icons under WorkerW, live_mac.rs drops
// it to the desktop window level, live_linux.rs makes it a Wayland layer-shell
// background surface). It renders the SAME pattern the in-app preview does —
// shaders via startLiveShader, emoji via EmojiField, everything else as the
// pre-rendered still, imported clips via VideoFill — so all three get the KDE plugin's look without a
// second rendering path.
//
// The spec arrives two ways: baked into `window.__AMBIENT_SPEC__` by the
// shell's init-script before mount (first apply, no IPC race), and pushed
// over the `live-spec` event on every re-apply.

// The shader-backed subset — ANIMATABLE is derived from FRAG_SHADERS in
// lib/shaders.ts, so this Set always matches the shaders that actually exist.
const SHADER_TYPES = new Set<PatternType>(ANIMATABLE);

// The spec is a PatternConfig plus the quality caps + animation speed the
// shell stamps in and, for non-shader patterns, the path to the
// pre-rendered still. The stamped fields flow into startLiveShader via
// LiveShaderConfig, so the desktop honors the quality setting (the in-app
// preview keeps its own lighter caps).
type Spec = PatternConfig & {
  // Video / GIF live wallpaper (live.rs build_video_spec): no pattern
  // fields, just the imported clip's path and whether it's a GIF.
  kind?: 'video';
  video?: string;
  format?: 'gif' | 'video';
  image?: string;
  maxRenderEdge?: number;
  fps?: number;
  speed?: number;
  // Live-clock overlay config from Settings (see ClockOverlay).
  clock?: LiveClock;
};

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

  // The clock sits on top of whichever renderer is active below.
  const clock = spec.clock?.enabled ? (
    <ClockOverlay clock={spec.clock} background={spec.colors?.[0]} />
  ) : null;

  let content: React.ReactNode = null;
  if (spec.kind === 'video') {
    if (spec.video)
      content = <VideoFill path={spec.video} format={spec.format} speed={spec.speed} />;
  } else if (spec.type === 'emoji') {
    content = <EmojiField config={spec} className="live-wallpaper-emoji" />;
  } else if (SHADER_TYPES.has(spec.type)) {
    content = <ShaderFill spec={spec} />;
  } else if (spec.image) {
    // Static pattern: the shell rendered a still and stamped its path.
    content = (
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
    );
  }

  return (
    <div style={root}>
      {content}
      {clock}
    </div>
  );
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
