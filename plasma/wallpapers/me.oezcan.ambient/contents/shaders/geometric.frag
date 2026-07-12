// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o geometric.frag.qsb geometric.frag
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// std140 UBO: qt_Matrix (offset 0) + qt_Opacity (offset 64) are required
// first; QML ShaderEffect properties map to the rest by name.
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec2 iResolution;
    float iTime;
    int colorCount;
    vec4 c0;
    vec4 c1;
    vec4 c2;
    vec4 c3;
    vec4 c4;
    vec4 c5;
    float seed;
    float gSize;
    float p1; // shape count
    float p2; // shape code
    float p3; // fill code
    vec4 t0; // matrix text glyph indices 0-3
    vec4 t1; // 4-7
    vec4 t2; // 8-11
    vec4 t3; // 12-14 + count in .w (0 = no custom text)
};

// Palette (c0 = background) selected by index; the cyclic paletteColor /
// paletteRing helpers ported below do the wrapping. Matches the WebGL
// u_colors[] array (capped at the app's 6-colour palette).
vec3 _pal(int i) {
    vec4 cs[6] = vec4[6](c0, c1, c2, c3, c4, c5);
    return cs[clamp(i, 0, 5)].rgb;
}

const float TWO_PI = 6.28318530718;

// Cheap hash for per-element jitter — replaces the Rust SeededRng. Not
// bit-identical, but a visually-equivalent random spread keyed off seed.
float hash(float n) {
  return fract(sin(n * 12.9898 + seed * 0.013) * 43758.5453123);
}

// 2D hash for per-dot randomness (cell coord -> pseudo-random scalar).
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 0.013) * 43758.5453);
}

// Foreground palette is colors[1..]; index it cyclically like the Rust
// renderers (palette[i % palette.len()]). colorCount includes the bg.
vec3 paletteColor(int i) {
  int plen = colorCount - 1;
  if (plen < 1) return _pal(0);
  int idx = i - (i / plen) * plen; // i mod plen, i >= 0
  return _pal(1 + idx);
}

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

void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;

  float scale = max(w, h) / 1920.0;
  float density = max(p1, 1.0);
  int shapeSel = int(p2 + 0.5);
  int fillSel = int(p3 + 0.5);
  float aspect = w / max(h, 1.0);
  float cols = max(floor(sqrt(density * aspect) + 0.5), 1.0);
  float rows = max(floor(density / cols + 0.5), 1.0);
  float cellW = w / cols;
  float cellH = h / rows;
  float cellMin = min(cellW, cellH);
  float baseSize = gSize * scale;

  vec2 gid = floor(vec2(frag.x / cellW, frag.y / cellH));
  vec3 col = _pal(0);
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
        sin(iTime * (0.08 + r4 * 0.16) + r5 * TWO_PI),
        cos(iTime * (0.08 + r6 * 0.16) + r7 * TWO_PI)
      ) * cellMin * 0.14;
      float s = clamp(baseSize * (1.0 + (r8 - 0.5) * 0.28), 4.0, cellMin * 0.34);
      float rot = (r2 - 0.5) * TWO_PI + iTime * (r3 - 0.5) * 0.32;
      vec2 q = rot2(-rot) * (frag - center);

      bool outline = (fillSel == 1) || (fillSel == 2 && rf > 0.5);
      float aa = max(s * 0.035, 1.0);
      float stroke = max(s * 0.11, 1.0);
      float cov = shapeCov(kind, q, s, outline, aa, stroke);
      float a = cov * (0.78 + 0.22 * hash21(c + 31.5));
      col = mix(col, paletteColor(int(rc * 101.0)), a);
    }
  }
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

