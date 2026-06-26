// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "150,330,440" -o dots.frag.qsb dots.frag
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
    float p1; // density
    float p2; // jitter 0..1
    float p3; // size variance 0..1
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

const float SPEED = 0.6;
void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;

  float scale = max(w, h) / 1920.0;
  float density = max(p1, 2.0);
  float jitter = clamp(p2, 0.0, 1.0);
  float sizeVar = clamp(p3, 0.0, 1.0);
  float cell = w / density;
  float rad0 = gSize * scale * 0.5;

  vec2 gid = floor(frag / cell);
  vec3 col = _pal(0);
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
        sin(iTime * SPEED * (0.3 + r3 * 1.2) + r5 * TWO_PI),
        cos(iTime * SPEED * (0.3 + r4 * 1.2) + r6 * TWO_PI)
      ) * (cell * 0.30);
      float rad = rad0 * (1.0 - sizeVar * 0.6 + sizeVar * 1.2 * r7);
      vec3 dc = paletteColor(int(r8 * 101.0));
      float a = 1.0 - smoothstep(rad * 0.82, rad, distance(frag, center));
      col = mix(col, dc, a);
    }
  }
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

