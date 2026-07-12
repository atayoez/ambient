// Minimal WebGL2 runner for the live pattern shaders (lib/shaders.ts).
// Drives one full-screen fragment shader per animatable PatternConfig,
// advancing u_time each frame so Flow/Waves/Aurora drift. Used by the
// in-app LivePreview now; the same shaders later feed the desktop live
// window (WebGL) and Android (GLES). Degrades cleanly: returns null when
// WebGL2 is unavailable so callers can fall back to the static <img>.

import { type PatternConfig, type PatternType, TYPE_SPECS } from './patterns';
import { FRAG_SHADERS, matrixTextSlots, SHADER_MAX_COLORS, VERT_SHADER } from './shaders';

// Preview defaults, used when the config doesn't carry explicit caps:
// cap the backing resolution — wallpaper-smoothness isn't needed for an
// in-app preview, and an uncapped DPR×window canvas with a 100-line Flow
// loop is needless GPU load. object-fit: cover scales it to the stage.
// The wallpaper window overrides both via the spec's maxRenderEdge/fps
// (stamped by Rust from the quality setting) — before that existed, the
// desktop wallpaper itself was silently capped to 1600 px / 30 fps no
// matter what quality the user picked.
const PREVIEW_MAX_DIM = 1600;
const PREVIEW_FPS = 30;

/** What the shader runner actually consumes: a PatternConfig, optionally
 * extended with the live-spec fields Rust stamps in for the wallpaper
 * window (LiveWallpaper.tsx passes the full spec straight through). */
export type LiveShaderConfig = PatternConfig & {
  /** Render cap for the canvas long edge in px; 0 = uncapped (native). */
  maxRenderEdge?: number;
  /** Frame-rate cap. */
  fps?: number;
  /** Global animation-speed multiplier (Settings → Animation speed). */
  speed?: number;
};

const UNIFORM_NAMES = [
  'u_resolution',
  'u_time',
  'u_colors',
  'u_colorCount',
  'u_seed',
  'u_size',
  'u_p1',
  'u_t0',
  'u_t1',
  'u_t2',
  'u_t3',
  'u_p2',
  'u_p3',
] as const;

export interface LiveShaderHandle {
  setConfig(config: LiveShaderConfig): void;
  destroy(): void;
}

export function isLiveShaderSupported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Per-type knob mapping → (p1, p2, p3), driven entirely by the manifest's
// uniform tags (patternManifest.json via TYPE_SPECS). Enum knobs encode as
// their choice index — the index IS the numeric wire code the shaders
// decode, see the manifest comment. Numeric knobs pass through, falling
// back to their manifest default when a persisted config predates the
// field. The Rust packer (renderer::knobs) resolves the same manifest, so
// the two can't drift.
const UNIFORM_SLOT = { p1: 0, p2: 1, p3: 2 } as const;

function knobs(c: PatternConfig): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const spec = TYPE_SPECS[c.type];
  if (!spec) return out;
  for (const k of spec.knobs) {
    if (!k.uniform) continue;
    const raw = (c as unknown as Record<string, unknown>)[k.key] ?? k.default;
    out[UNIFORM_SLOT[k.uniform]] = k.choices
      ? // Unknown/legacy enum value → code 0 (mix/solid), like the old maps.
        Math.max(
          0,
          k.choices.findIndex((ch) => ch.id === raw),
        )
      : typeof raw === 'number'
        ? raw
        : 0;
  }
  return out;
}

function compileShader(
  gl: WebGL2RenderingContext,
  kind: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(kind);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

/**
 * Start rendering `initial`'s shader onto `canvas`. Returns a handle to
 * push config updates / tear down, or null if WebGL2 / the shader for this
 * type is unavailable (caller should then show the static preview).
 */
export function startLiveShader(
  canvas: HTMLCanvasElement,
  initial: LiveShaderConfig,
  opts: { reducedMotion?: boolean } = {},
): LiveShaderHandle | null {
  if (!FRAG_SHADERS[initial.type]) return null;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;

  let config = initial;
  let activeType: PatternType = initial.type;
  let program: WebGLProgram | null = null;
  let uniforms: Partial<
    Record<(typeof UNIFORM_NAMES)[number], WebGLUniformLocation | null>
  > = {};
  let raf = 0;
  // Shader time is ACCUMULATED (dt × speed each frame) rather than derived
  // from wall clock × speed, so a live speed change glides instead of
  // teleporting the animation to a different point in time.
  let timeSec = 0;
  let lastRenderMs = -1;
  let disposed = false;
  const colorBuf = new Float32Array(SHADER_MAX_COLORS * 3);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  // Full-screen triangle (oversized; clipped to the viewport).
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  function buildProgram(type: PatternType): boolean {
    const frag = FRAG_SHADERS[type];
    if (!frag || !gl) return false;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram failed');
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`program link failed: ${log}`);
    }
    if (program) gl.deleteProgram(program);
    program = p;
    activeType = type;
    uniforms = {};
    for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(p, name);
    return true;
  }

  function resize() {
    if (!gl) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    let w = Math.max(1, Math.round(rect.width * dpr));
    let h = Math.max(1, Math.round(rect.height * dpr));
    // Quality cap from the live spec (0 = uncapped/native); preview
    // default otherwise. Re-read per frame so a quality re-apply pushed
    // through setConfig takes effect without restarting the shader.
    const cap =
      config.maxRenderEdge === 0
        ? Number.POSITIVE_INFINITY
        : (config.maxRenderEdge ?? PREVIEW_MAX_DIM);
    const longEdge = Math.max(w, h);
    if (longEdge > cap) {
      const s = cap / longEdge;
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function render(timeSec: number) {
    if (!gl || !program) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    // gl.useProgram is the WebGL2 API; its `use` prefix trips the
    // rules-of-hooks heuristic, but it is not a React hook.
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL2 call, not a hook
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const list = config.colors ?? [];
    const last = list.length > 0 ? list[list.length - 1] : '#000000';
    for (let i = 0; i < SHADER_MAX_COLORS; i++) {
      const [r, g, b] = hexToRgb(list[i] ?? last);
      colorBuf[i * 3] = r;
      colorBuf[i * 3 + 1] = g;
      colorBuf[i * 3 + 2] = b;
    }
    const [p1, p2, p3] = knobs(config);
    gl.uniform2f(uniforms.u_resolution ?? null, canvas.width, canvas.height);
    gl.uniform1f(uniforms.u_time ?? null, timeSec);
    gl.uniform3fv(uniforms.u_colors ?? null, colorBuf);
    gl.uniform1i(
      uniforms.u_colorCount ?? null,
      Math.max(1, Math.min(SHADER_MAX_COLORS, list.length)),
    );
    gl.uniform1f(uniforms.u_seed ?? null, config.seed ?? 0);
    gl.uniform1f(uniforms.u_size ?? null, config.size ?? 80);
    gl.uniform1f(uniforms.u_p1 ?? null, p1);
    gl.uniform1f(uniforms.u_p2 ?? null, p2);
    gl.uniform1f(uniforms.u_p3 ?? null, p3);
    // Matrix custom-text slots (zeros for every other type).
    const slots = matrixTextSlots(config.type === 'matrix' ? config.matrixText : '');
    gl.uniform4f(uniforms.u_t0 ?? null, slots[0], slots[1], slots[2], slots[3]);
    gl.uniform4f(uniforms.u_t1 ?? null, slots[4], slots[5], slots[6], slots[7]);
    gl.uniform4f(uniforms.u_t2 ?? null, slots[8], slots[9], slots[10], slots[11]);
    gl.uniform4f(uniforms.u_t3 ?? null, slots[12], slots[13], slots[14], slots[15]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number) {
    if (disposed) return;
    const minFrameMs = 1000 / (config.fps ?? PREVIEW_FPS);
    if (lastRenderMs < 0) {
      lastRenderMs = now;
      render(0);
    } else if (now - lastRenderMs >= minFrameMs) {
      timeSec += ((now - lastRenderMs) / 1000) * (config.speed ?? 1);
      lastRenderMs = now;
      render(timeSec);
    }
    raf = requestAnimationFrame(frame);
  }

  try {
    if (!buildProgram(initial.type)) return null;
  } catch (err) {
    console.warn('[liveShader] build failed', err);
    return null;
  }

  // Reduced motion: paint one frozen frame and repaint only on resize.
  let ro: ResizeObserver | null = null;
  if (opts.reducedMotion) {
    render(0);
    ro = new ResizeObserver(() => {
      if (!disposed) render(0);
    });
    ro.observe(canvas);
  } else {
    raf = requestAnimationFrame(frame);
  }

  return {
    setConfig(next: LiveShaderConfig) {
      config = next;
      if (next.type !== activeType) {
        try {
          buildProgram(next.type);
        } catch (err) {
          console.warn('[liveShader] rebuild failed', err);
        }
      }
      if (opts.reducedMotion) render(0);
    },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      // Free this instance's GL objects, but do NOT loseContext(): a canvas
      // hands the SAME context object to every getContext('webgl2') call, so
      // losing it here would leave React StrictMode's immediate remount (and
      // any future LivePreview on this canvas) running on a dead context —
      // which silently falls back to the static preview ("didn't move").
      if (gl && program) gl.deleteProgram(program);
      if (gl && vbo) gl.deleteBuffer(vbo);
    },
  };
}
