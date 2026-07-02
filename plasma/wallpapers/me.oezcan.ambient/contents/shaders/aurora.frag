// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o aurora.frag.qsb aurora.frag
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
    float p1; // bands
    float p2; // sway 0..1
    float p3; // spread 0..1
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

const float SPEED = 0.20;
void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 p = qt_TexCoord0 * iResolution;
  float v = p.y / h;

  int bands = int(max(p1, 2.0));
  float bandsF = float(bands);
  float spread = clamp(p3, 0.0, 1.0);
  float amp = clamp(p2, 0.0, 1.0);
  float curtainW = w * (0.05 + spread * 0.15);
  float sway = amp * w * 0.1;
  float gphase = hash(1.0) * TWO_PI;

  vec3 col = _pal(0);
  for (int band = 0; band < 16; band++) {
    if (band >= bands) break;
    float fb = float(band);
    float bx = (fb + 0.5) / bandsF * w + (hash(fb + 2.0) - 0.5) * (w / bandsF) * 0.5;
    // Parallax depth: later bands read as nearer and sway faster.
    float depth = bandsF > 1.0 ? fb / (bandsF - 1.0) : 0.5;
    float phase = gphase + fb * 0.9 + iTime * SPEED * mix(0.45, 1.3, depth);
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
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

