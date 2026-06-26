// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "150,330,440" -o waves.frag.qsb waves.frag
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
    float p1; // layers
    float p2; // amplitude 0..1
    float p3; // frequency 0..1
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

const float SPEED = 0.16;
void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 p = qt_TexCoord0 * iResolution;
  float u = p.x / w;

  float cycles = 0.5 + clamp(p3, 0.0, 1.0) * 2.5;
  float ampPx = clamp(p2, 0.0, 1.0) * h * 0.11;
  int layers = int(max(p1, 2.0));
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = _pal(0);
  for (int layer = 0; layer < 24; layer++) {
    if (layer >= layers) break;
    float t = layers > 1 ? float(layer) / float(layers - 1) : 0.5;
    float baseline = h * (0.12 + t * 0.78);
    // Parallax depth: front (near, t toward 1) layers drift faster than far.
    float phase = gphase + float(layer) * 0.7 + iTime * SPEED * mix(0.45, 1.3, t);
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
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

