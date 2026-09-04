import { useEffect, useRef } from 'react';
import {
  type LiveShaderConfig,
  type LiveShaderHandle,
  startLiveShader,
} from '../lib/liveShader';

// Live, animated preview for the animatable pattern types (Flow/Waves/
// Aurora). Renders a WebGL canvas that runs the same shader the live
// wallpaper will use. Mounted on top of the static <img> preview for
// ANIMATABLE types only; if WebGL2 (or this type's shader) is unavailable,
// the canvas hides itself and the <img> underneath shows through.
export default function LivePreview({
  config,
  className,
}: {
  /** PatternConfig plus the optional `speed` multiplier (glides live). */
  config: LiveShaderConfig;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<LiveShaderHandle | null>(null);

  // Honour the system motion preference — a frozen frame, not a loop, when
  // the user has asked for reduced motion (matches index.css a11y posture).
  const reducedMotion =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Start the shader once per mount (re-init only when the motion pref
  // flips). Config updates flow through setConfig below without restarting.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = startLiveShader(canvas, config, { reducedMotion });
    handleRef.current = handle;
    // Unsupported → keep the canvas out of the way so the <img> shows.
    canvas.style.display = handle ? '' : 'none';
    return () => {
      handle?.destroy();
      handleRef.current = null;
    };
    // config is intentionally excluded: updates are pushed via setConfig
    // below rather than by restarting the shader on every draft edit.
  }, [reducedMotion]);

  useEffect(() => {
    handleRef.current?.setConfig(config);
  }, [config]);

  return <canvas ref={canvasRef} className={className} />;
}
