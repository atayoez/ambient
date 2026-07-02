// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o flow.frag.qsb flow.frag
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
    float p1; // lines
    float p2; // amplitude 0..1
    float p3; // frequency 0..1
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

const float SPEED = 0.22;
void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 p = qt_TexCoord0 * iResolution;
  float u = p.x / w;

  float scale = max(w, h) / 1920.0;
  float thickness = max(gSize * scale * 0.12, 1.0);
  float cycles = 0.5 + clamp(p3, 0.0, 1.0) * 2.5;
  float ampPx = clamp(p2, 0.0, 1.0) * h * 0.16;
  int lines = int(max(p1, 1.0));
  float linesF = float(lines);
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = _pal(0);
  for (int i = 0; i < 128; i++) {
    if (i >= lines) break;
    float li = float(i);
    float baseline = (li + 0.5) / linesF * h;
    // Parallax depth: near (lower) lines drift faster than far (upper) ones.
    float depth = (li + 0.5) / linesF;
    float phase = gphase + li * 0.22 + iTime * SPEED * mix(0.45, 1.3, depth);
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
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

