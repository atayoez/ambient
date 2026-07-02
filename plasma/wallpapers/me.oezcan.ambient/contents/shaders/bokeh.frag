// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o bokeh.frag.qsb bokeh.frag
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
    float p1; // count
    float p2; // unused
    float p3; // unused
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

void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;

  float scale = max(w, h) / 1920.0;
  int count = int(clamp(p1, 4.0, 64.0));
  float baseR = max(gSize * scale * 2.2, 8.0);
  float minDim = min(w, h);

  vec3 col = _pal(0);
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
    float cy = mod(hy * h - iTime * riseSpeed, span) - rad;
    // Sideways swirl as it rises.
    float swirlAmp = rad * mix(0.3, 1.0, hf);
    float swirlFreq = 0.3 + hsp * 0.6;
    float cx = hx * w + swirlAmp * sin(iTime * swirlFreq + hsp * TWO_PI);
    vec2 center = vec2(cx, cy);

    float dd = distance(frag, center) / max(rad, 1.0);
    float core = mix(0.45, 1.0, smoothstep(0.0, 0.72, dd));
    float edge = 1.0 - smoothstep(0.86, 1.0, dd);
    float a = core * edge * mix(0.16, 0.5, ha);
    if (a <= 0.0) continue;
    col = mix(col, paletteColor(i), a);
  }
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

