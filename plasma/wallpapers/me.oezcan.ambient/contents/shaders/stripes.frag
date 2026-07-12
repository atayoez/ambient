// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o stripes.frag.qsb stripes.frag
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
    float p1; // angle (deg)
    float p2; // width var. 0..1
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
  vec2 pc = frag - 0.5 * iResolution;

  float scale = max(w, h) / 1920.0;
  float theta = radians(clamp(p1, 0.0, 90.0));
  vec2 n = vec2(cos(theta), sin(theta));
  vec2 t = vec2(-n.y, n.x);
  float bw = max(gSize * scale * 1.5, 2.0);
  float widthVar = clamp(p2, 0.0, 1.0);

  float d = dot(pc, n);
  float along = dot(pc, t);
  float dir = hash(1.0) < 0.5 ? -1.0 : 1.0;
  float coord = d / bw;
  coord += dir * iTime * 0.06;
  coord += widthVar * 0.35 * sin(along / max(h, 1.0) * TWO_PI * 1.5 + iTime * 0.4);
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
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

