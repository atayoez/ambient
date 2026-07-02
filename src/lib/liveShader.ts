// Minimal WebGL2 runner for the live pattern shaders (lib/shaders.ts).
// Drives one full-screen fragment shader per animatable PatternConfig,
// advancing u_time each frame so Flow/Waves/Aurora drift. Used by the
// in-app LivePreview now; the same shaders later feed the desktop live
// window (WebGL) and Android (GLES). Degrades cleanly: returns null when
// WebGL2 is unavailable so callers can fall back to the static <img>.

import { GEOMETRIC_SHAPES, type PatternConfig, type PatternType } from './patterns';
import { FRAG_SHADERS, matrixTextSlots, VERT_SHADER } from './shaders';

// Cap the backing resolution — wallpaper-smoothness isn't needed for an
// in-app preview, and an uncapped DPR×window canvas with a 100-line Flow
// loop is needless GPU load. object-fit: cover scales it to the stage.
const MAX_DIM = 1600;

// Throttle the preview to ~30fps — soft, slow motion doesn't need vsync
// rate, and an uncapped fullscreen shader loop is needless GPU/battery load.
const MIN_FRAME_MS = 1000 / 30;

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
  setConfig(config: PatternConfig): void;
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

// Geometric's shape pool + fill mode are enums; the shader takes numbers, so
// encode them into p2/p3 here (decoded in shaders.ts / main.qml GEOMETRIC).
// Derived from GEOMETRIC_SHAPES: the index in that list IS the numeric code
// the Rust/QML side decodes ('mix' = 0 … 'plus' = 6) — the list's order is
// a wire contract, see the comment on GEOMETRIC_SHAPES in patterns.ts.
const GEO_SHAPE_CODE: Record<string, number> = Object.fromEntries(
  GEOMETRIC_SHAPES.map((s, i) => [s.id, i]),
);
const GEO_FILL_CODE: Record<string, number> = { solid: 0, outline: 1, mix: 2 };

// Per-type knob mapping → (p1, p2, p3). Mirrors the uniform contract in
// shaders.ts. Defaults match the Rust renderer's unwrap_or values.
function knobs(c: PatternConfig): [number, number, number] {
  switch (c.type) {
    case 'flow':
      return [c.flowLines ?? 28, c.flowAmplitude ?? 0.5, c.flowFrequency ?? 0.4];
    case 'waves':
      return [c.wavesLayers ?? 7, c.wavesAmplitude ?? 0.5, c.wavesFrequency ?? 0.4];
    case 'aurora':
      return [c.auroraBands ?? 5, c.auroraAmplitude ?? 0.5, c.auroraSpread ?? 0.5];
    case 'dots':
      return [c.density ?? 18, c.dotsJitter ?? 0.5, c.dotsSizeVar ?? 0.7];
    case 'bokeh':
      return [c.density ?? 22, 0, 0];
    case 'stripes':
      return [c.stripesAngle ?? 30, c.stripesWidthVar ?? 0.5, 0];
    case 'geometric':
      return [
        c.density ?? 40,
        GEO_SHAPE_CODE[c.geometricShape ?? 'mix'] ?? 0,
        GEO_FILL_CODE[c.geometricFill ?? 'solid'] ?? 0,
      ];
    case 'flower':
      return [c.flowerPetals ?? 12, c.flowerTwist ?? 0.5, 0];
    case 'mesh':
      return [c.meshBubbles ?? 16, c.meshSoftness ?? 0.5, 0];
    case 'matrix':
      return [c.density ?? 48, c.matrixTrail ?? 0.5, c.matrixSpeed ?? 0.5];
    case 'crt':
      return [c.crtScanlines ?? 0.6, c.crtCurvature ?? 0.4, c.crtNoise ?? 0.25];
    default:
      return [1, 0.5, 0.5];
  }
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
  initial: PatternConfig,
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
  let startMs = -1;
  let lastRenderMs = -1;
  let disposed = false;
  const colorBuf = new Float32Array(8 * 3);

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
    const longEdge = Math.max(w, h);
    if (longEdge > MAX_DIM) {
      const s = MAX_DIM / longEdge;
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
    for (let i = 0; i < 8; i++) {
      const [r, g, b] = hexToRgb(list[i] ?? last);
      colorBuf[i * 3] = r;
      colorBuf[i * 3 + 1] = g;
      colorBuf[i * 3 + 2] = b;
    }
    const [p1, p2, p3] = knobs(config);
    gl.uniform2f(uniforms.u_resolution ?? null, canvas.width, canvas.height);
    gl.uniform1f(uniforms.u_time ?? null, timeSec);
    gl.uniform3fv(uniforms.u_colors ?? null, colorBuf);
    gl.uniform1i(uniforms.u_colorCount ?? null, Math.max(1, Math.min(8, list.length)));
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
    if (startMs < 0) startMs = now;
    if (lastRenderMs < 0 || now - lastRenderMs >= MIN_FRAME_MS) {
      lastRenderMs = now;
      render((now - startMs) / 1000);
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
    setConfig(next: PatternConfig) {
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
