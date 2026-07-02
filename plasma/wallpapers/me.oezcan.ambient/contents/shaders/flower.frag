// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run `bun run gen:shaders` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o flower.frag.qsb flower.frag
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
    float p1; // petal count
    float p2; // twist (fullness) 0..1
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

const float PI = 3.14159265359;

// Foreground palette as a CLOSED cyclic ring: position runs 0..plen and
// wraps, so colouring a full revolution lands back on the start colour with
// no seam, for ANY petal/colour count. plen = colorCount-1 foreground hues.
// This is what makes the bloom independent of the number of colours — the
// old integer-index modulo left a hard seam whenever plen didn't divide the
// petal count (looked fine at 6 colours, broke at 4).
vec3 paletteRing(float pos) {
  int plen = colorCount - 1;
  if (plen < 1) return _pal(0);
  float fp = float(plen);
  float p = pos - fp * floor(pos / fp); // wrap into [0, plen)
  int i0 = int(p);
  int i1 = i0 + 1; if (i1 >= plen) i1 = 0;
  return mix(_pal(1 + i0), _pal(1 + i1), p - float(i0));
}

vec3 drawLayer(vec3 col, vec2 frag, vec2 center, float petals,
               float r0, float len, float hw, float rot, float alpha) {
  vec2 d = frag - center;
  float ang = atan(d.y, d.x);
  float rho = length(d);
  float seg = TWO_PI / petals;
  float baseIdx = floor((ang - rot) / seg + 0.5);
  int plen = colorCount - 1;
  float colorsPerRev = float(max(plen, 1));
  for (int k = -1; k <= 1; k++) {
    float pk = baseIdx + float(k);
    float la = ang - (rot + pk * seg);
    la = atan(sin(la), cos(la));
    float along = rho * cos(la);
    float lat = rho * sin(la);
    float u = (along - r0) / len;
    float uc = clamp(u, 0.0, 1.0);
    float wlat = hw * pow(max(sin(PI * uc), 0.0), 0.55);
    float latd = abs(lat);
    float aaLat = clamp(fwidth(latd), 1.0, 4.0);
    float cov = (1.0 - smoothstep(wlat - aaLat, wlat + aaLat, latd))
                * step(0.0, u) * step(u, 1.0);
    // Seamless cyclic colour: the petal index (mod petals) maps the full
    // ring onto exactly one palette cycle, so it wraps with no discontinuity
    // regardless of how many petals or colours there are. uc advances the
    // colour one petal's worth from base to tip.
    float pidx = pk - petals * floor(pk / petals);
    float cpos = (pidx / petals) * colorsPerRev;
    float cspan = colorsPerRev / petals;
    vec3 pcol = paletteRing(cpos + uc * cspan);
    // Shaded rim near the petal boundary so each petal's edge reads. The
    // shade is a deeper, slightly more saturated version of THIS petal's own
    // colour (saturation pushed up off its own luma, then darkened) rather
    // than a flat dark outline, so the edge keeps the petal's hue.
    float rimW = aaLat * 2.0 + wlat * 0.10;
    float rim = smoothstep(wlat - rimW, wlat, latd);
    float plum = dot(pcol, vec3(0.299, 0.587, 0.114));
    vec3 edgeCol = clamp(mix(vec3(plum), pcol, 1.3), 0.0, 1.0) * 0.6;
    pcol = mix(pcol, edgeCol, rim * 0.85);
    col = mix(col, pcol, alpha * cov);
  }
  return col;
}

void main() {
  float w = iResolution.x;
  float h = iResolution.y;
  vec2 frag = qt_TexCoord0 * iResolution;
  float minDim = min(w, h);

  float petals = clamp(p1, 3.0, 64.0);
  float twist = clamp(p2, 0.0, 1.0);
  float sizeScale = max(gSize, 10.0) / 100.0;

  vec2 center = vec2(w * 0.5, h * 0.5);
  float baseR = minDim * 0.02;
  float reach = min(minDim * 0.5 * sizeScale, minDim * 0.46);
  float globalRot = hash(3.0) * TWO_PI;
  float hwFactor = mix(0.95, 1.4, twist);

  vec3 col = _pal(0);

  int plen = colorCount - 1;
  float cpr = float(max(plen, 1));

  float glowR = reach * 0.5;
  float gt = clamp(distance(frag, center) / max(glowR, 1.0), 0.0, 1.0);
  col = mix(col, paletteRing(0.0), 0.5 * pow(1.0 - gt, 1.6));

  float len0 = reach;
  float len1 = reach * 0.62;
  float hw0 = len0 * sin(PI / petals) * hwFactor;
  float hw1 = len1 * sin(PI / petals) * hwFactor;
  col = drawLayer(col, frag, center, petals, baseR, len0, hw0,
                  globalRot + iTime * 0.10, 1.0);
  col = drawLayer(col, frag, center, petals, baseR, len1, hw1,
                  globalRot + PI / petals - iTime * 0.14, 1.0);

  float cr = reach * 0.10;
  col = mix(col, paletteRing(cpr * 0.5), 1.0 - smoothstep(cr * 0.7, cr, distance(frag, center)));

  fragColor = vec4(col, 1.0) * qt_Opacity;
}

