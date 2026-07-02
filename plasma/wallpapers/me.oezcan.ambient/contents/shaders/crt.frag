// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o crt.frag.qsb crt.frag
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
    float p1; // scanlines 0..1
    float p2; // curvature 0..1
    float p3; // noise 0..1
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
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;
  vec2 uv = frag / vec2(w, h);

  // Barrel distortion — the curved glass. Outside the tube = bezel.
  float curv = clamp(p2, 0.0, 1.0);
  vec2 cc = uv * 2.0 - 1.0;
  cc *= 1.0 + curv * 0.16 * dot(cc, cc);
  uv = (cc + 1.0) * 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(_pal(0) * 0.25, 1.0);
    return;
  }

  // Horizontal sync glitch: every few seconds a burst of row shear tears
  // through for a fraction of a second, like a failing H-hold.
  float burst = hash(floor(iTime * 0.5) + 31.0);
  float burstOn = step(0.72, burst) * step(fract(iTime * 0.5), 0.12);
  float shear = burstOn * (hash21(vec2(floor(uv.y * 90.0), floor(iTime * 24.0))) - 0.5) * 0.06;
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
  float scanStrength = clamp(p1, 0.0, 1.0);
  float scan = 1.0 - scanStrength * 0.3 * (0.5 + 0.5 * sin(frag.y * 3.14159));
  // Rolling brightness band sweeping down the tube — the classic slow
  // "hum bar", bright enough to clearly move.
  float band = fract(uv.y * 0.9 - iTime * 0.11);
  float roll = 1.0 + 0.10 * exp(-pow((band - 0.5) * 6.0, 2.0))
             + 0.03 * sin(TWO_PI * (uv.y * 1.4 - iTime * 0.16));
  // Analogue noise, re-seeded every frame, plus a heavier static band
  // that sweeps through every few seconds.
  float noiseAmt = clamp(p3, 0.0, 1.0);
  float staticBand = exp(-pow((fract(uv.y + iTime * 0.043) - 0.5) * 10.0, 2.0));
  float n = (hash21(frag + fract(iTime) * vec2(917.3, 113.7)) - 0.5)
          * noiseAmt * (0.16 + staticBand * 0.5);
  // Global mains flicker — subtle fast brightness shimmer.
  float flicker = 1.0 + 0.02 * sin(iTime * 47.0) + 0.012 * sin(iTime * 13.7);
  // Corner falloff — stronger with more curvature.
  float vig = 1.0 - (0.15 + curv * 0.25) * dot(cc, cc);

  col = col * scan * roll * vig * flicker + n;
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

