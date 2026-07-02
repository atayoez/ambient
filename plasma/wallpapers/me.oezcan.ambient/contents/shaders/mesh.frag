// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o mesh.frag.qsb mesh.frag
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
    float p1; // bubble count
    float p2; // softness 0..1
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
  float maxDim = max(w, h);

  int count = int(clamp(p1, 3.0, 24.0));
  float softness = clamp(p2, 0.0, 1.0);

  vec3 col = _pal(0);
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
      sin(iTime * (0.05 + hsx * 0.08) + hx * TWO_PI),
      cos(iTime * (0.05 + hsy * 0.08) + hy * TWO_PI)
    ) * maxDim * 0.12;
    float radius = mix(0.40, 0.72, hr) * maxDim;
    float alpha = mix(0.55, 0.9, ha);
    float dd = distance(frag, pos) / radius;
    float fall = pow(clamp(1.0 - dd, 0.0, 1.0), mix(2.6, 1.2, softness));
    col = mix(col, paletteColor(i), alpha * fall);
  }
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

