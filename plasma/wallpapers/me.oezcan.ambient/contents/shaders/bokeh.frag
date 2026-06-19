// Qt6/RHI animated bokeh: soft out-of-focus light discs that rise like
// undersea bubbles — each drifts upward at its own speed with a sideways
// swirl, wrapping bottom->top. Mirrors src/lib/shaders.ts BOKEH_MAIN.
// See flow.frag for the UBO/IO conventions.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o bokeh.frag.qsb bokeh.frag
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
    float p1; // count (density)
    float p2; // unused
    float p3; // unused
};

const float TWO_PI = 6.28318530718;

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

void main() {
    float w = iResolution.x;
    float h = iResolution.y;
    vec2 frag = qt_TexCoord0 * iResolution;

    float scale = max(w, h) / 1920.0;
    int count = int(clamp(p1, 4.0, 64.0));
    float baseR = max(gSize * scale * 2.2, 8.0);
    float minDim = min(w, h);

    vec3 col = c0.rgb;
    for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        float fi = float(i) + 1.0;
        float hx = hash(fi * 2.0);
        float hy = hash(fi * 2.0 + 1.0);
        float hr = hash(fi + 19.0);
        float ha = hash(fi + 41.0);
        float hs = hash(fi + 7.0);
        float hf = hash(fi + 23.0);
        float hsp = hash(fi + 53.0);

        float rad = baseR * mix(0.4, 1.5, hr);
        // Rise upward (decreasing y) at a per-bubble speed; wrap through the
        // full height plus a margin so discs slide off the top and re-enter
        // from below. Bigger, lighter-looking discs rise a touch faster.
        float riseSpeed = minDim * (0.018 + hs * 0.05);
        float span = h + 2.0 * rad;
        float cy = mod(hy * h - iTime * riseSpeed, span) - rad;
        // Sideways swirl as it rises — a slow horizontal sway.
        float swirlAmp = rad * mix(0.3, 1.0, hf);
        float swirlFreq = 0.3 + hsp * 0.6;
        float cx = hx * w + swirlAmp * sin(iTime * swirlFreq + hsp * TWO_PI);
        vec2 center = vec2(cx, cy);

        float dd = distance(frag, center) / max(rad, 1.0);
        // Brighter rim than centre + soft outer fade reads as an
        // out-of-focus light disc rather than a filled dot.
        float core = mix(0.45, 1.0, smoothstep(0.0, 0.72, dd));
        float edge = 1.0 - smoothstep(0.86, 1.0, dd);
        float a = core * edge * mix(0.16, 0.5, ha);
        if (a <= 0.0) continue;
        col = mix(col, paletteColor(i), a);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
