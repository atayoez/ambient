// GLSL (WebGL2 / GLSL ES 3.00) ports of the three animatable pattern
// renderers — Flow, Waves, Aurora — from the Rust tiny-skia renderer
// (src-tauri/core/src/renderer.rs: render_flow ~789, render_waves ~886,
// render_aurora ~981). These are the source of LIVE motion: the same
// sin/cos phase fields, with the global `phase` advanced by u_time so the
// field drifts. tiny-skia stays the source of truth for stills and the
// seven static pattern types.
//
// Coordinate convention: the Rust renderer has its origin top-left (y down).
// GL's gl_FragCoord origin is bottom-left, so every main() flips y via
// `p = vec2(gl_FragCoord.x, h - gl_FragCoord.y)` to match.
//
// Uniform contract (set by lib/liveShader.ts):
//   u_resolution  canvas pixel size
//   u_time        seconds since start (frozen at 0 for reduced-motion)
//   u_colors[8]   palette as linear-ish sRGB triples; [0] is the background
//   u_colorCount  number of valid entries in u_colors
//   u_seed        config.seed (drives per-line/-layer/-band jitter + phase)
//   u_size        config.size (global; Flow uses it for line thickness)
//   u_p1/u_p2/u_p3  per-type knobs:
//                   flow  → lines, amplitude, frequency
//                   waves → layers, amplitude, frequency
//                   aurora→ bands, amplitude(sway), spread(width)
//
// Colours are mixed directly in sRGB (no gamma conversion) to match
// tiny-skia's sRGB-space gradient interpolation.

export const VERT_SHADER = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Shared header: uniforms + helpers. Composed in front of each main().
const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colors[8];
uniform int u_colorCount;
uniform float u_seed;
uniform float u_size;
uniform float u_p1;
uniform float u_p2;
uniform float u_p3;
out vec4 fragColor;
const float TWO_PI = 6.28318530718;

// Cheap hash for per-element jitter — replaces the Rust SeededRng. Not
// bit-identical, but a visually-equivalent random spread keyed off u_seed.
float hash(float n) {
  return fract(sin(n * 12.9898 + u_seed * 0.013) * 43758.5453123);
}

// 2D hash for per-dot randomness (cell coord -> pseudo-random scalar).
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed * 0.013) * 43758.5453);
}

// Foreground palette is colors[1..]; index it cyclically like the Rust
// renderers (palette[i % palette.len()]). colorCount includes the bg.
vec3 paletteColor(int i) {
  int plen = u_colorCount - 1;
  if (plen < 1) return u_colors[0];
  int idx = i - (i / plen) * plen; // i mod plen, i >= 0
  return u_colors[1 + idx];
}
`;

// --- Flow: smooth wavy strokes spanning the width, drifting horizontally.
const FLOW_MAIN = `
const float SPEED = 0.22;
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 p = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  float u = p.x / w;

  float scale = max(w, h) / 1920.0;
  float thickness = max(u_size * scale * 0.12, 1.0);
  float cycles = 0.5 + clamp(u_p3, 0.0, 1.0) * 2.5;
  float ampPx = clamp(u_p2, 0.0, 1.0) * h * 0.16;
  int lines = int(max(u_p1, 1.0));
  float linesF = float(lines);
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = u_colors[0];
  for (int i = 0; i < 128; i++) {
    if (i >= lines) break;
    float li = float(i);
    float baseline = (li + 0.5) / linesF * h;
    // Parallax depth: near (lower) lines drift faster than far (upper) ones.
    float depth = (li + 0.5) / linesF;
    float phase = gphase + li * 0.22 + u_time * SPEED * mix(0.45, 1.3, depth);
    float ampI = ampPx * (0.8 + hash(li + 3.0) * 0.4);
    float a = sin(phase + u * cycles * TWO_PI);
    float b = sin(phase * 1.7 + u * cycles * 1.9 * TWO_PI);
    float wy = baseline + ampI * (a + 0.4 * b) * 0.7;
    float d = abs(p.y - wy);
    float aa = 1.0 - smoothstep(thickness * 0.5 - 1.0, thickness * 0.5 + 1.0, d);
    if (aa > 0.0) {
      vec3 lc = mix(paletteColor(i), paletteColor(i + 1), u);
      col = mix(col, lc, aa * 0.7);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

// --- Waves: stacked translucent silk bands, traveling horizontally.
const WAVES_MAIN = `
const float SPEED = 0.16;
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 p = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  float u = p.x / w;

  float cycles = 0.5 + clamp(u_p3, 0.0, 1.0) * 2.5;
  float ampPx = clamp(u_p2, 0.0, 1.0) * h * 0.11;
  int layers = int(max(u_p1, 2.0));
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = u_colors[0];
  for (int layer = 0; layer < 24; layer++) {
    if (layer >= layers) break;
    float t = layers > 1 ? float(layer) / float(layers - 1) : 0.5;
    float baseline = h * (0.12 + t * 0.78);
    // Parallax depth: front (near, t toward 1) layers drift faster than far.
    float phase = gphase + float(layer) * 0.7 + u_time * SPEED * mix(0.45, 1.3, t);
    float ampL = ampPx * (0.6 + hash(float(layer) + 5.0) * 0.6);
    float a = sin(phase + u * cycles * TWO_PI);
    float b = sin(phase * 1.6 + u * cycles * 2.1 * TWO_PI);
    float wy = baseline + ampL * (a + 0.35 * b);
    float cover = smoothstep(wy - 1.0, wy + 1.0, p.y);
    if (cover > 0.0) {
      float gtop = baseline - ampL;
      float tg = clamp((p.y - gtop) / max(h - gtop, 1.0), 0.0, 1.0);
      vec3 lc = mix(paletteColor(layer), paletteColor(layer + 1), tg);
      col = mix(col, lc, cover);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

// --- Aurora: vertical curtains of light, swaying horizontally over time.
const AURORA_MAIN = `
const float SPEED = 0.20;
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 p = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  float v = p.y / h;

  int bands = int(max(u_p1, 2.0));
  float bandsF = float(bands);
  float spread = clamp(u_p3, 0.0, 1.0);
  float amp = clamp(u_p2, 0.0, 1.0);
  float curtainW = w * (0.05 + spread * 0.15);
  float sway = amp * w * 0.1;
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = u_colors[0];
  for (int band = 0; band < 16; band++) {
    if (band >= bands) break;
    float fb = float(band);
    float bx = (fb + 0.5) / bandsF * w + (hash(fb + 2.0) - 0.5) * (w / bandsF) * 0.5;
    // Parallax depth: later bands read as nearer and sway faster.
    float depth = bandsF > 1.0 ? fb / (bandsF - 1.0) : 0.5;
    float phase = gphase + fb * 0.9 + u_time * SPEED * mix(0.45, 1.3, depth);
    float hw = curtainW * (0.6 + hash(fb + 9.0) * 0.7) * 0.5;
    float cx = bx + sway * (sin(phase + v * 1.6 * TWO_PI) + 0.4 * sin(phase * 1.9 + v * TWO_PI));
    float dx = abs(p.x - cx);
    float hf = 1.0 - smoothstep(hw * 0.25, hw, dx);
    // Vertical fade: 0 → 0.75 (at .45) → 0.5 (at .75) → 0 — a hanging curtain.
    float va;
    if (v < 0.45) va = mix(0.0, 0.75, v / 0.45);
    else if (v < 0.75) va = mix(0.75, 0.5, (v - 0.45) / 0.30);
    else va = mix(0.5, 0.0, (v - 0.75) / 0.25);
    col = mix(col, paletteColor(band), va * hf);
  }
  fragColor = vec4(col, 1.0);
}
`;

// --- Dots: a grid of dots, each wandering in its own random direction at
// its own random speed (procedural; 3x3 neighbour check).
const DOTS_MAIN = `
const float SPEED = 0.6;
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);

  float scale = max(w, h) / 1920.0;
  float density = max(u_p1, 2.0);
  float jitter = clamp(u_p2, 0.0, 1.0);
  float sizeVar = clamp(u_p3, 0.0, 1.0);
  float cell = w / density;
  float rad0 = u_size * scale * 0.5;

  vec2 gid = floor(frag / cell);
  vec3 col = u_colors[0];
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 c = gid + vec2(float(dx), float(dy));
      float r1 = hash21(c);
      float r2 = hash21(c + 11.3);
      float r3 = hash21(c + 23.7);
      float r4 = hash21(c + 41.1);
      float r5 = hash21(c + 7.9);
      float r6 = hash21(c + 59.2);
      float r7 = hash21(c + 83.1);
      float r8 = hash21(c + 97.7);
      vec2 base = (c + vec2(0.5) + (vec2(r1, r2) - 0.5) * jitter) * cell;
      vec2 center = base + vec2(
        sin(u_time * SPEED * (0.3 + r3 * 1.2) + r5 * TWO_PI),
        cos(u_time * SPEED * (0.3 + r4 * 1.2) + r6 * TWO_PI)
      ) * (cell * 0.30);
      float rad = rad0 * (1.0 - sizeVar * 0.6 + sizeVar * 1.2 * r7);
      vec3 dc = paletteColor(int(r8 * 101.0));
      float a = 1.0 - smoothstep(rad * 0.82, rad, distance(frag, center));
      col = mix(col, dc, a);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

// Animatable pattern types → their fragment shader. Mirrors ANIMATABLE in
// lib/patterns.ts. Types absent here have no live shader (static only).
export const FRAG_SHADERS: Record<string, string> = {
  flow: HEAD + FLOW_MAIN,
  waves: HEAD + WAVES_MAIN,
  aurora: HEAD + AURORA_MAIN,
  dots: HEAD + DOTS_MAIN,
};
