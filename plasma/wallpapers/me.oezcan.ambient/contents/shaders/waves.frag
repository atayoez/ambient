// Qt6/RHI port of the Waves generative pattern (see flow.frag header).
// Mirrors src/lib/shaders.ts WAVES_MAIN and renderer.rs render_waves.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o waves.frag.qsb waves.frag
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
    float p1; // layers
    float p2; // amplitude 0..1
    float p3; // frequency 0..1
};

const float TWO_PI = 6.28318530718;
const float SPEED = 0.16;

float hash(float n) { return fract(sin(n * 12.9898 + seed * 0.013) * 43758.5453123); }

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
    vec2 p = qt_TexCoord0 * iResolution;
    float u = p.x / w;

    float cycles = 0.5 + clamp(p3, 0.0, 1.0) * 2.5;
    float ampPx = clamp(p2, 0.0, 1.0) * h * 0.11;
    int layers = int(max(p1, 2.0));
    float gphase = hash(1.0) * TWO_PI;

    vec3 col = c0.rgb;
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
