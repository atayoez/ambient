// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o matrix.frag.qsb matrix.frag
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
    float p1; // columns
    float p2; // trail 0..1
    float p3; // speed 0..1
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
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;

  float cols = max(p1, 8.0);
  float trail = mix(5.0, 30.0, clamp(p2, 0.0, 1.0));
  float speedK = mix(0.25, 1.6, clamp(p3, 0.0, 1.0));

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
  float head = mod(iTime * speed + offset, cycle);
  float age = head - gid.y;
  float bright = (age >= 0.0) ? clamp(1.0 - age / trail, 0.0, 1.0) : 0.0;
  bright *= bright; // phosphor decay

  // Which glyph lives in this cell: custom text reads down the column in
  // sequence (so it's literally readable top-to-bottom); otherwise a
  // random pick from the whole charset that re-rolls on its own clock.
  int textCount = int(t3.w + 0.5);
  int idx;
  if (textCount > 0) {
    int slot = int(mod(gid.y + floor(offset), float(textCount)));
    float v = (slot < 4) ? t0[slot]
            : (slot < 8) ? t1[slot - 4]
            : (slot < 12) ? t2[slot - 8]
            : t3[slot - 12];
    idx = int(v + 0.5);
  } else {
    float tick = floor(iTime * (0.5 + hash21(gid) * 2.5));
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

  vec3 col = mix(_pal(0), glyph, bright * lit);
  fragColor = vec4(col, 1.0) * qt_Opacity;
}

