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
// Matrix text slots: 15 glyph indices into MATRIX_CHARSET + count in
// u_t3.w (0 = no custom text, rain uses the whole charset). Zero for
// every other pattern type.
uniform vec4 u_t0;
uniform vec4 u_t1;
uniform vec4 u_t2;
uniform vec4 u_t3;
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

// --- Bokeh: soft out-of-focus light discs that rise like undersea bubbles,
// each swaying sideways as it drifts upward and wrapping bottom→top.
const BOKEH_MAIN = `
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);

  float scale = max(w, h) / 1920.0;
  int count = int(clamp(u_p1, 4.0, 64.0));
  float baseR = max(u_size * scale * 2.2, 8.0);
  float minDim = min(w, h);

  vec3 col = u_colors[0];
  for (int i = 0; i < 64; i++) {
    if (i >= count) break;
    float fi = float(i) + 1.0;
    float hx = hash(fi * 2.0);
    float hy = hash(fi * 2.0 + 1.0);
    float hr = hash(fi + 19.0);
    float ha = hash(fi + 41.0);
    float hs = hash(fi + 7.0);
    float hf = hash(fi + 23.0);
    float hsp = hash(fi + 53.0);

    float rad = baseR * mix(0.4, 1.5, hr);
    // Rise upward (decreasing y), wrapping through the full height + margin;
    // bigger/lighter discs rise a touch faster.
    float riseSpeed = minDim * (0.018 + hs * 0.05);
    float span = h + 2.0 * rad;
    float cy = mod(hy * h - u_time * riseSpeed, span) - rad;
    // Sideways swirl as it rises.
    float swirlAmp = rad * mix(0.3, 1.0, hf);
    float swirlFreq = 0.3 + hsp * 0.6;
    float cx = hx * w + swirlAmp * sin(u_time * swirlFreq + hsp * TWO_PI);
    vec2 center = vec2(cx, cy);

    float dd = distance(frag, center) / max(rad, 1.0);
    float core = mix(0.45, 1.0, smoothstep(0.0, 0.72, dd));
    float edge = 1.0 - smoothstep(0.86, 1.0, dd);
    float a = core * edge * mix(0.16, 0.5, ha);
    if (a <= 0.0) continue;
    col = mix(col, paletteColor(i), a);
  }
  fragColor = vec4(col, 1.0);
}
`;

// --- Stripes: a stripe field at u_p1 degrees scrolling along its normal
// (up/down or left/right; seed picks the sense), with a gentle width-var
// undulation.
const STRIPES_MAIN = `
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  vec2 pc = frag - 0.5 * u_resolution;

  float scale = max(w, h) / 1920.0;
  float theta = radians(clamp(u_p1, 0.0, 90.0));
  vec2 n = vec2(cos(theta), sin(theta));
  vec2 t = vec2(-n.y, n.x);
  float bw = max(u_size * scale * 1.5, 2.0);
  float widthVar = clamp(u_p2, 0.0, 1.0);

  float d = dot(pc, n);
  float along = dot(pc, t);
  float dir = hash(1.0) < 0.5 ? -1.0 : 1.0;
  float coord = d / bw;
  coord += dir * u_time * 0.06;
  coord += widthVar * 0.35 * sin(along / max(h, 1.0) * TWO_PI * 1.5 + u_time * 0.4);
  coord += 4096.0; // keep the stripe index positive for the cyclic palette

  float idx = floor(coord);
  float f = fract(coord);
  float aaw = clamp(fwidth(coord), 1e-4, 0.49);

  vec3 ca = paletteColor(int(idx));
  vec3 col;
  if (f < aaw)
    col = mix(paletteColor(int(idx) - 1), ca, 0.5 + 0.5 * f / aaw);
  else if (f > 1.0 - aaw)
    col = mix(ca, paletteColor(int(idx) + 1), 0.5 + 0.5 * (f - (1.0 - aaw)) / aaw);
  else
    col = ca;
  fragColor = vec4(col, 1.0);
}
`;

// Shape helpers for geometric. Regular polygons use an exact radial boundary
// (circumradius == s by construction → no SDF sign bugs / giant wedges);
// star/plus use signed-distance fields. shapeCov returns coverage with a
// fixed-width AA (no fwidth → no cell-grid seams).
const GEO_HELPERS = `
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdStar5(vec2 p, float r) {
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-0.809016994, -0.587785252);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = 0.4 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdPlus(vec2 p, float s) {
  vec2 a = abs(p);
  float t = s * 0.28;
  return min(max(a.x - t, a.y - s), max(a.x - s, a.y - t));
}
// Coverage (0..1) of one shape at local q, circumradius s. kind: 0 circle,
// 1 triangle, 2 square, 3 hexagon, 4 star, 5 plus.
float shapeCov(int kind, vec2 q, float s, bool outline, float aa, float stroke) {
  float sd;
  if (kind == 4) {
    sd = sdStar5(q, s);
  } else if (kind == 5) {
    sd = sdPlus(q, s);
  } else {
    float r = length(q);
    float boundary = s;
    if (kind != 0) {
      float n = (kind == 1) ? 3.0 : (kind == 2) ? 4.0 : 6.0;
      float seg = TWO_PI / n;
      float ia = mod(atan(q.y, q.x), seg) - 0.5 * seg;
      boundary = s * cos(0.5 * seg) / max(cos(ia), 1e-3);
    }
    sd = r - boundary; // correct sign everywhere
  }
  if (outline) {
    return 1.0 - smoothstep(stroke - aa, stroke + aa, abs(sd));
  }
  return 1.0 - smoothstep(-aa, aa, sd);
}
`;

// --- Geometric: a grid of shapes, each drifting + spinning in its own
// direction at its own speed (the emoji-field motion, with shapes). Shape
// pool (u_p2) and fill mode (u_p3) arrive encoded; see liveShader.ts.
const GEOMETRIC_MAIN = `
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);

  float scale = max(w, h) / 1920.0;
  float density = max(u_p1, 1.0);
  int shapeSel = int(u_p2 + 0.5);
  int fillSel = int(u_p3 + 0.5);
  float aspect = w / max(h, 1.0);
  float cols = max(floor(sqrt(density * aspect) + 0.5), 1.0);
  float rows = max(floor(density / cols + 0.5), 1.0);
  float cellW = w / cols;
  float cellH = h / rows;
  float cellMin = min(cellW, cellH);
  float baseSize = u_size * scale;

  vec2 gid = floor(vec2(frag.x / cellW, frag.y / cellH));
  vec3 col = u_colors[0];
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 c = gid + vec2(float(dx), float(dy));
      float r1 = hash21(c + 3.1);
      float r2 = hash21(c + 11.3);
      float r3 = hash21(c + 23.7);
      float r4 = hash21(c + 41.1);
      float r5 = hash21(c + 7.9);
      float r6 = hash21(c + 59.2);
      float r7 = hash21(c + 83.1);
      float r8 = hash21(c + 97.7);
      float rc = hash21(c + 13.1);
      float rf = hash21(c + 71.7);

      int kind = (shapeSel == 0) ? int(r1 * 6.0) : (shapeSel - 1);
      kind = clamp(kind, 0, 5);

      // Slow per-shape wander + spin, like the emoji field. Size is capped to
      // the cell so neighbours never overlap into blobs.
      vec2 center = (c + vec2(0.5)) * vec2(cellW, cellH);
      center += vec2(
        sin(u_time * (0.08 + r4 * 0.16) + r5 * TWO_PI),
        cos(u_time * (0.08 + r6 * 0.16) + r7 * TWO_PI)
      ) * cellMin * 0.14;
      float s = clamp(baseSize * (1.0 + (r8 - 0.5) * 0.28), 4.0, cellMin * 0.34);
      float rot = (r2 - 0.5) * TWO_PI + u_time * (r3 - 0.5) * 0.32;
      vec2 q = rot2(-rot) * (frag - center);

      bool outline = (fillSel == 1) || (fillSel == 2 && rf > 0.5);
      float aa = max(s * 0.035, 1.0);
      float stroke = max(s * 0.11, 1.0);
      float cov = shapeCov(kind, q, s, outline, aa, stroke);
      float a = cov * (0.78 + 0.22 * hash21(c + 31.5));
      col = mix(col, paletteColor(int(rc * 101.0)), a);
    }
  }
  fragColor = vec4(col, 1.0);
}
`;

// One ring of symmetric leaf petals, composited over `col`. No tangential
// sweep — petals stay radially symmetric (a flower, not a pinwheel). See
// flower.frag.
const FLOWER_HELPERS = `
const float PI = 3.14159265359;

// Foreground palette as a CLOSED cyclic ring: position runs 0..plen and
// wraps, so colouring a full revolution lands back on the start colour with
// no seam, for ANY petal/colour count. plen = colorCount-1 foreground hues.
// This is what makes the bloom independent of the number of colours — the
// old integer-index modulo left a hard seam whenever plen didn't divide the
// petal count (looked fine at 6 colours, broke at 4).
vec3 paletteRing(float pos) {
  int plen = u_colorCount - 1;
  if (plen < 1) return u_colors[0];
  float fp = float(plen);
  float p = pos - fp * floor(pos / fp); // wrap into [0, plen)
  int i0 = int(p);
  int i1 = i0 + 1; if (i1 >= plen) i1 = 0;
  return mix(u_colors[1 + i0], u_colors[1 + i1], p - float(i0));
}

vec3 drawLayer(vec3 col, vec2 frag, vec2 center, float petals,
               float r0, float len, float hw, float rot, float alpha) {
  vec2 d = frag - center;
  float ang = atan(d.y, d.x);
  float rho = length(d);
  float seg = TWO_PI / petals;
  float baseIdx = floor((ang - rot) / seg + 0.5);
  int plen = u_colorCount - 1;
  float colorsPerRev = float(max(plen, 1));
  for (int k = -1; k <= 1; k++) {
    float pk = baseIdx + float(k);
    float la = ang - (rot + pk * seg);
    la = atan(sin(la), cos(la));
    float along = rho * cos(la);
    float lat = rho * sin(la);
    float u = (along - r0) / len;
    float uc = clamp(u, 0.0, 1.0);
    float wlat = hw * pow(max(sin(PI * uc), 0.0), 0.55);
    float latd = abs(lat);
    float aaLat = clamp(fwidth(latd), 1.0, 4.0);
    float cov = (1.0 - smoothstep(wlat - aaLat, wlat + aaLat, latd))
                * step(0.0, u) * step(u, 1.0);
    // Seamless cyclic colour: the petal index (mod petals) maps the full
    // ring onto exactly one palette cycle, so it wraps with no discontinuity
    // regardless of how many petals or colours there are. uc advances the
    // colour one petal's worth from base to tip.
    float pidx = pk - petals * floor(pk / petals);
    float cpos = (pidx / petals) * colorsPerRev;
    float cspan = colorsPerRev / petals;
    vec3 pcol = paletteRing(cpos + uc * cspan);
    // Shaded rim near the petal boundary so each petal's edge reads. The
    // shade is a deeper, slightly more saturated version of THIS petal's own
    // colour (saturation pushed up off its own luma, then darkened) rather
    // than a flat dark outline, so the edge keeps the petal's hue.
    float rimW = aaLat * 2.0 + wlat * 0.10;
    float rim = smoothstep(wlat - rimW, wlat, latd);
    float plum = dot(pcol, vec3(0.299, 0.587, 0.114));
    vec3 edgeCol = clamp(mix(vec3(plum), pcol, 1.3), 0.0, 1.0) * 0.6;
    pcol = mix(pcol, edgeCol, rim * 0.85);
    col = mix(col, pcol, alpha * cov);
  }
  return col;
}
`;

// --- Flower: a symmetric radial bloom — central glow + defined centre under
// two rings of even, rounded leaf petals; the rings counter-rotate. Reach is
// capped so it always fits the screen; `twist` sets petal fullness.
const FLOWER_MAIN = `
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  float minDim = min(w, h);

  float petals = clamp(u_p1, 3.0, 64.0);
  float twist = clamp(u_p2, 0.0, 1.0);
  float sizeScale = max(u_size, 10.0) / 100.0;

  vec2 center = vec2(w * 0.5, h * 0.5);
  float baseR = minDim * 0.02;
  float reach = min(minDim * 0.5 * sizeScale, minDim * 0.46);
  float globalRot = hash(3.0) * TWO_PI;
  float hwFactor = mix(0.95, 1.4, twist);

  vec3 col = u_colors[0];

  int plen = u_colorCount - 1;
  float cpr = float(max(plen, 1));

  float glowR = reach * 0.5;
  float gt = clamp(distance(frag, center) / max(glowR, 1.0), 0.0, 1.0);
  col = mix(col, paletteRing(0.0), 0.5 * pow(1.0 - gt, 1.6));

  float len0 = reach;
  float len1 = reach * 0.62;
  float hw0 = len0 * sin(PI / petals) * hwFactor;
  float hw1 = len1 * sin(PI / petals) * hwFactor;
  col = drawLayer(col, frag, center, petals, baseR, len0, hw0,
                  globalRot + u_time * 0.10, 1.0);
  col = drawLayer(col, frag, center, petals, baseR, len1, hw1,
                  globalRot + PI / petals - u_time * 0.14, 1.0);

  float cr = reach * 0.10;
  col = mix(col, paletteRing(cpr * 0.5), 1.0 - smoothstep(cr * 0.7, cr, distance(frag, center)));

  fragColor = vec4(col, 1.0);
}
`;

// --- Mesh: large soft radial colour blobs drifting into a flowing
// mesh-gradient (the still's blobs + blur, animated). See mesh.frag.
const MESH_MAIN = `
void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  float maxDim = max(w, h);

  int count = int(clamp(u_p1, 3.0, 24.0));
  float softness = clamp(u_p2, 0.0, 1.0);

  vec3 col = u_colors[0];
  for (int i = 0; i < 24; i++) {
    if (i >= count) break;
    float fi = float(i) + 1.0;
    float hx = hash(fi * 1.7);
    float hy = hash(fi * 1.7 + 3.0);
    float hr = hash(fi + 11.0);
    float ha = hash(fi + 27.0);
    float hsx = hash(fi + 5.0);
    float hsy = hash(fi + 19.0);
    vec2 base = vec2((hx * 1.2 - 0.1) * w, (hy * 1.2 - 0.1) * h);
    vec2 pos = base + vec2(
      sin(u_time * (0.05 + hsx * 0.08) + hx * TWO_PI),
      cos(u_time * (0.05 + hsy * 0.08) + hy * TWO_PI)
    ) * maxDim * 0.12;
    float radius = mix(0.40, 0.72, hr) * maxDim;
    float alpha = mix(0.55, 0.9, ha);
    float dd = distance(frag, pos) / radius;
    float fall = pow(clamp(1.0 - dd, 0.0, 1.0), mix(2.6, 1.2, softness));
    col = mix(col, paletteColor(i), alpha * fall);
  }
  fragColor = vec4(col, 1.0);
}
`;

// Animatable pattern types → their fragment shader. Single source of truth
// for the animatable set: ANIMATABLE in lib/patterns.ts is derived from
// these keys. Types absent here have no live shader (static only).
// --- Matrix: digital-rain glyph columns. Each column drops a bright head
// with a fading trail; "glyphs" are per-cell 4×5 sub-block masks that
// re-roll on their own clock, so the rain shimmers like changing
// characters without a font. Trail colour cycles the foreground palette
// (classic look = a green preset), head flashes near-white.
//   p1 = column count, p2 = trail length 0..1, p3 = fall speed 0..1
const MATRIX_MAIN = `
// GENERATED FONT — 5x7 bitmaps for MATRIX_CHARSET (see scripts note in
// matrixCharIndices): rows 0-5 packed 5 bits each into .x, row 6 in .y.
const int FONT_N = 88;
const uvec2 FONT[88] = uvec2[88](uvec2(71447071u, 2u), uvec2(102672u, 0u), uvec2(285788132u, 6u), uvec2(138547359u, 31u), uvec2(312882120u, 12u), uvec2(623530948u, 25u), uvec2(142479812u, 4u), uvec2(142920644u, 2u), uvec2(138718146u, 2u), uvec2(554189343u, 31u), uvec2(277162314u, 4u), uvec2(143148034u, 2u), uvec2(616702238u, 17u), uvec2(69564994u, 28u), uvec2(142887473u, 2u), uvec2(143051716u, 2u), uvec2(138547342u, 2u), uvec2(142886564u, 2u), uvec2(138574862u, 2u), uvec2(35030049u, 1u), uvec2(4357252u, 2u), uvec2(14u, 31u), uvec2(751184414u, 3u), uvec2(141697476u, 4u), uvec2(138682896u, 3u), uvec2(587802954u, 17u), uvec2(34649121u, 31u), uvec2(142885407u, 2u), uvec2(538224838u, 16u), uvec2(726798788u, 4u), uvec2(138748447u, 8u), uvec2(101059086u, 8u), uvec2(1009059844u, 17u), uvec2(616966416u, 1u), uvec2(139432078u, 28u), uvec2(138829634u, 4u), uvec2(277094670u, 31u), uvec2(554648095u, 31u), uvec2(277380110u, 6u), uvec2(285787697u, 4u), uvec2(191043782u, 13u), uvec2(177767457u, 3u), uvec2(588826175u, 17u), uvec2(277366335u, 6u), uvec2(142622785u, 3u), uvec2(588826158u, 14u), uvec2(138547334u, 31u), uvec2(209994254u, 31u), uvec2(554058254u, 31u), uvec2(301279624u, 8u), uvec2(554186830u, 15u), uvec2(589136958u, 14u), uvec2(138551583u, 4u), uvec2(588728878u, 30u), uvec2(558679598u, 15u), uvec2(585443460u, 17u), uvec2(588752431u, 15u), uvec2(34636862u, 30u), uvec2(588826159u, 15u), uvec2(35095615u, 31u), uvec2(35095615u, 1u), uvec2(589071422u, 30u), uvec2(589284913u, 17u), uvec2(1073741823u, 31u), uvec2(554189328u, 31u), uvec2(311661881u, 17u), uvec2(34636833u, 31u), uvec2(725478961u, 17u), uvec2(865783409u, 17u), uvec2(588826158u, 14u), uvec2(35112511u, 1u), uvec2(488162862u, 24u), uvec2(307742255u, 17u), uvec2(554044462u, 31u), uvec2(138547359u, 4u), uvec2(588826161u, 14u), uvec2(145031729u, 4u), uvec2(344512165u, 10u), uvec2(346175825u, 17u), uvec2(138553361u, 4u), uvec2(69345566u, 31u), uvec2(414u, 30u), uvec2(408983952u, 16u), uvec2(214446273u, 1u), uvec2(350745732u, 10u), uvec2(139432068u, 4u), uvec2(31u, 31u), uvec2(1073741823u, 31u));

// Bit test for glyph idx at sub-cell (col,row); col 0 = left, row 0 = top.
float glyphPx(int idx, int col, int row) {
  uvec2 g = FONT[idx - (idx / FONT_N) * FONT_N];
  uint bits = (row < 6) ? (g.x >> uint(row * 5)) : g.y;
  return float((bits >> uint(col)) & 1u);
}

void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);

  float cols = max(u_p1, 8.0);
  float trail = mix(5.0, 30.0, clamp(u_p2, 0.0, 1.0));
  float speedK = mix(0.25, 1.6, clamp(u_p3, 0.0, 1.0));

  float cellW = w / cols;
  float cellH = cellW * 1.5;
  vec2 cell = vec2(cellW, cellH);
  vec2 gid = floor(frag / cell);
  float rows = h / cellH;

  // Per-column speed + phase so columns never march in lockstep.
  float colR = hash(gid.x * 7.31);
  float speed = (2.0 + colR * 6.0) * speedK;
  float offset = hash(gid.x * 13.7) * 977.0;

  float cycle = rows + trail;
  float head = mod(u_time * speed + offset, cycle);
  float age = head - gid.y;
  float bright = (age >= 0.0) ? clamp(1.0 - age / trail, 0.0, 1.0) : 0.0;
  bright *= bright; // phosphor decay

  // Which glyph lives in this cell: custom text reads down the column in
  // sequence (so it's literally readable top-to-bottom); otherwise a
  // random pick from the whole charset that re-rolls on its own clock.
  int textCount = int(u_t3.w + 0.5);
  int idx;
  if (textCount > 0) {
    int slot = int(mod(gid.y + floor(offset), float(textCount)));
    float v = (slot < 4) ? u_t0[slot]
            : (slot < 8) ? u_t1[slot - 4]
            : (slot < 12) ? u_t2[slot - 8]
            : u_t3[slot - 12];
    idx = int(v + 0.5);
  } else {
    float tick = floor(u_time * (0.5 + hash21(gid) * 2.5));
    idx = int(hash21(gid * 3.17 + tick * 0.618) * float(FONT_N));
  }

  // Rasterize the 5x7 glyph inside the cell (one sub-cell of padding).
  vec2 f = fract(frag / cell);
  vec2 sub = floor(f * vec2(6.0, 8.0));
  float lit = 0.0;
  if (sub.x < 5.0 && sub.y < 7.0) {
    lit = glyphPx(idx, int(sub.x), int(sub.y));
  }

  vec3 rain = paletteColor(int(colR * 101.0));
  float headGlow = step(age, 1.0) * step(0.0, age);
  vec3 glyph = mix(rain, vec3(1.0), headGlow * 0.75);

  vec3 col = mix(u_colors[0], glyph, bright * lit);
  fragColor = vec4(col, 1.0);
}
`;

// --- CRT test pattern: SMPTE-style 75% colour bars with castellation and
// PLUGE strips, curved glass, scanlines, a slow rolling brightness band,
// and analogue noise. The bar colours are the broadcast standard, NOT the
// user palette — a test card isn't a test card in pastel. u_colors[0] is
// only used outside the tube (the bezel).
//   p1 = scanline strength 0..1, p2 = curvature 0..1, p3 = noise 0..1
const CRT_MAIN = `
vec3 smpteBar(float u) {
  // 7 equal top bars: 75% gray, yellow, cyan, green, magenta, red, blue.
  int i = int(clamp(u, 0.0, 0.999) * 7.0);
  if (i == 0) return vec3(0.75, 0.75, 0.75);
  if (i == 1) return vec3(0.75, 0.75, 0.0);
  if (i == 2) return vec3(0.0, 0.75, 0.75);
  if (i == 3) return vec3(0.0, 0.75, 0.0);
  if (i == 4) return vec3(0.75, 0.0, 0.75);
  if (i == 5) return vec3(0.75, 0.0, 0.0);
  return vec3(0.0, 0.0, 0.75);
}

vec3 castellation(float u) {
  // Reverse-order strip: blue, black, magenta, black, cyan, black, gray.
  int i = int(clamp(u, 0.0, 0.999) * 7.0);
  if (i == 0) return vec3(0.0, 0.0, 0.75);
  if (i == 2) return vec3(0.75, 0.0, 0.75);
  if (i == 4) return vec3(0.0, 0.75, 0.75);
  if (i == 6) return vec3(0.75, 0.75, 0.75);
  return vec3(0.0);
}

vec3 bottomStrip(float u) {
  // -I, 100% white, +Q, black, then the PLUGE steps, black.
  if (u < 0.125) return vec3(0.0, 0.129, 0.298);
  if (u < 0.25) return vec3(1.0);
  if (u < 0.375) return vec3(0.192, 0.0, 0.42);
  if (u < 0.625) return vec3(0.0);
  if (u < 0.708) return vec3(0.015);
  if (u < 0.791) return vec3(0.045);
  if (u < 0.875) return vec3(0.09);
  return vec3(0.0);
}

void main() {
  float w = u_resolution.x;
  float h = u_resolution.y;
  vec2 frag = vec2(gl_FragCoord.x, h - gl_FragCoord.y);
  vec2 uv = frag / vec2(w, h);

  // Barrel distortion — the curved glass. Outside the tube = bezel.
  float curv = clamp(u_p2, 0.0, 1.0);
  vec2 cc = uv * 2.0 - 1.0;
  cc *= 1.0 + curv * 0.16 * dot(cc, cc);
  uv = (cc + 1.0) * 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(u_colors[0] * 0.25, 1.0);
    return;
  }

  // Horizontal sync glitch: every few seconds a burst of row shear tears
  // through for a fraction of a second, like a failing H-hold.
  float burst = hash(floor(u_time * 0.5) + 31.0);
  float burstOn = step(0.72, burst) * step(fract(u_time * 0.5), 0.12);
  float shear = burstOn * (hash21(vec2(floor(uv.y * 90.0), floor(u_time * 24.0))) - 0.5) * 0.06;
  uv.x = clamp(uv.x + shear, 0.0, 1.0);

  vec3 col;
  if (uv.y < 0.67) {
    col = smpteBar(uv.x);
  } else if (uv.y < 0.75) {
    col = castellation(uv.x);
  } else {
    col = bottomStrip(uv.x);
  }

  // Scanlines (pixel-space so they stay crisp at any size).
  float scanStrength = clamp(u_p1, 0.0, 1.0);
  float scan = 1.0 - scanStrength * 0.3 * (0.5 + 0.5 * sin(frag.y * 3.14159));
  // Rolling brightness band sweeping down the tube — the classic slow
  // "hum bar", bright enough to clearly move.
  float band = fract(uv.y * 0.9 - u_time * 0.11);
  float roll = 1.0 + 0.10 * exp(-pow((band - 0.5) * 6.0, 2.0))
             + 0.03 * sin(TWO_PI * (uv.y * 1.4 - u_time * 0.16));
  // Analogue noise, re-seeded every frame, plus a heavier static band
  // that sweeps through every few seconds.
  float noiseAmt = clamp(u_p3, 0.0, 1.0);
  float staticBand = exp(-pow((fract(uv.y + u_time * 0.043) - 0.5) * 10.0, 2.0));
  float n = (hash21(frag + fract(u_time) * vec2(917.3, 113.7)) - 0.5)
          * noiseAmt * (0.16 + staticBand * 0.5);
  // Global mains flicker — subtle fast brightness shimmer.
  float flicker = 1.0 + 0.02 * sin(u_time * 47.0) + 0.012 * sin(u_time * 13.7);
  // Corner falloff — stronger with more curvature.
  float vig = 1.0 - (0.15 + curv * 0.25) * dot(cc, cc);

  col = col * scan * roll * vig * flicker + n;
  fragColor = vec4(col, 1.0);
}
`;

// The Matrix glyph charset — index order IS the wire contract with the
// baked FONT bitmap array inside MATRIX_MAIN (generated from Noto Sans CJK
// at 5x7 via ImageMagick; regenerate both together if this ever changes).
// Mirrored in main.qml (JS copy) and renderer.rs (MATRIX_CHARSET).
export const MATRIX_CHARSET =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:<>*+=-';

// Encode user text for the matrix shader's u_t0..u_t3 slots: up to 15
// glyph indices (uppercased, unknown characters dropped) followed by the
// count in the 16th component. count 0 → the rain uses the whole charset.
export function matrixTextSlots(text: string | undefined): number[] {
  const out = new Array(16).fill(0);
  const chars = (text ?? '').toUpperCase();
  let n = 0;
  for (const ch of chars) {
    if (n >= 15) break;
    const idx = MATRIX_CHARSET.indexOf(ch);
    if (idx >= 0) out[n++] = idx;
  }
  out[15] = n;
  return out;
}

export const FRAG_SHADERS: Record<string, string> = {
  flow: HEAD + FLOW_MAIN,
  waves: HEAD + WAVES_MAIN,
  aurora: HEAD + AURORA_MAIN,
  dots: HEAD + DOTS_MAIN,
  bokeh: HEAD + BOKEH_MAIN,
  stripes: HEAD + STRIPES_MAIN,
  geometric: HEAD + GEO_HELPERS + GEOMETRIC_MAIN,
  flower: HEAD + FLOWER_HELPERS + FLOWER_MAIN,
  mesh: HEAD + MESH_MAIN,
  matrix: HEAD + MATRIX_MAIN,
  crt: HEAD + CRT_MAIN,
};
