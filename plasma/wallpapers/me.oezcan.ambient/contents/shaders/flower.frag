// Qt6/RHI animated flower: a symmetric radial bloom — a central glow + a
// defined centre under two rings of rounded, symmetric leaf petals that
// radiate evenly. The two rings (inner offset half a petal) rotate at
// different speeds and opposite directions, so the bloom turns gently. The
// reach is capped so the flower always fits the screen. `twist` controls
// petal fullness. Mirrors src/lib/shaders.ts FLOWER_MAIN.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o flower.frag.qsb flower.frag
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

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
    float p2; // twist (petal fullness) 0..1
    float p3; // unused
};

const float TWO_PI = 6.28318530718;
const float PI = 3.14159265359;

float hash(float n) {
    return fract(sin(n * 12.9898 + seed * 0.013) * 43758.5453123);
}

vec3 paletteColor(int i) {
    vec4 cols[6] = vec4[6](c0, c1, c2, c3, c4, c5);
    int plen = colorCount - 1;
    if (plen < 1) return cols[0].rgb;
    int idx = i - (i / plen) * plen;
    return cols[1 + idx].rgb;
}

// Foreground palette as a CLOSED cyclic ring: position runs 0..plen and
// wraps, so colouring a full revolution lands back on the start colour with
// no seam, for ANY petal/colour count. This is what makes the bloom
// independent of the number of colours — the old integer-index modulo left a
// hard seam whenever plen didn't divide the petal count (fine at 6, broke at 4).
vec3 paletteRing(float pos) {
    vec4 cols[6] = vec4[6](c0, c1, c2, c3, c4, c5);
    int plen = colorCount - 1;
    if (plen < 1) return cols[0].rgb;
    float fp = float(plen);
    float p = pos - fp * floor(pos / fp); // wrap into [0, plen)
    int i0 = int(p);
    int i1 = i0 + 1; if (i1 >= plen) i1 = 0;
    return mix(cols[1 + i0].rgb, cols[1 + i1].rgb, p - float(i0));
}

// One ring of symmetric leaf petals over `col`. Petals radiate from
// `center`, reach `len` from `r0`, half-width `hw`. Evaluates the 3 nearest
// petals so overlapping edges read as a continuous bloom. No tangential
// sweep — petals stay radially symmetric (a flower, not a pinwheel).
vec3 drawLayer(vec3 col, vec2 frag, vec2 center, float petals,
               float r0, float len, float hw, float rot, float alpha) {
    vec2 d = frag - center;
    float ang = atan(d.y, d.x);
    float rho = length(d);
    float seg = TWO_PI / petals;
    float baseIdx = floor((ang - rot) / seg + 0.5);
    for (int k = -1; k <= 1; k++) {
        float pk = baseIdx + float(k);
        float la = ang - (rot + pk * seg);
        la = atan(sin(la), cos(la)); // wrap into [-pi, pi]
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
        // ring onto exactly one palette cycle, so it wraps with no
        // discontinuity regardless of petal/colour count. uc advances the
        // colour one petal's worth from base to tip.
        float pidx = pk - petals * floor(pk / petals);
        float colorsPerRev = float(max(colorCount - 1, 1));
        float cpos = (pidx / petals) * colorsPerRev;
        float cspan = colorsPerRev / petals;
        vec3 pcol = paletteRing(cpos + uc * cspan);
        // Darkened rim near the petal boundary so each petal's edge reads.
        float rimW = aaLat * 2.0 + wlat * 0.10;
        float rim = smoothstep(wlat - rimW, wlat, latd);
        pcol = mix(pcol, pcol * 0.5, rim * 0.85);
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

    // Centred, with the reach capped so the bloom always fits the short side.
    vec2 center = vec2(w * 0.5, h * 0.5);
    float baseR = minDim * 0.02;
    float reach = min(minDim * 0.5 * sizeScale, minDim * 0.46);
    float globalRot = hash(3.0) * TWO_PI;
    float hwFactor = mix(0.95, 1.4, twist);

    vec3 col = c0.rgb;
    float cpr = float(max(colorCount - 1, 1));

    // Central bloom glow.
    float glowR = reach * 0.5;
    float gt = clamp(distance(frag, center) / max(glowR, 1.0), 0.0, 1.0);
    col = mix(col, paletteRing(0.0), 0.5 * pow(1.0 - gt, 1.6));

    // Two rings — the inner offset half a petal, counter-rotating. Opaque
    // petals (the AA edges still blend); the rings stack solidly.
    float len0 = reach;
    float len1 = reach * 0.62;
    float hw0 = len0 * sin(PI / petals) * hwFactor;
    float hw1 = len1 * sin(PI / petals) * hwFactor;
    col = drawLayer(col, frag, center, petals, baseR, len0, hw0,
                    globalRot + iTime * 0.10, 1.0);
    col = drawLayer(col, frag, center, petals, baseR, len1, hw1,
                    globalRot + PI / petals - iTime * 0.14, 1.0);

    // A small solid centre (pistil) so it reads as a real flower.
    float cr = reach * 0.10;
    col = mix(col, paletteRing(cpr * 0.5), 1.0 - smoothstep(cr * 0.7, cr, distance(frag, center)));

    fragColor = vec4(col, 1.0) * qt_Opacity;
}
