// Qt6/RHI port of the Aurora generative pattern (see flow.frag header).
// Mirrors src/lib/shaders.ts AURORA_MAIN and renderer.rs render_aurora.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o aurora.frag.qsb aurora.frag
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
    float p1; // bands
    float p2; // amplitude (sway) 0..1
    float p3; // spread (width) 0..1
};

const float TWO_PI = 6.28318530718;
const float SPEED = 0.20;

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
    float v = p.y / h;

    int bands = int(max(p1, 2.0));
    float bandsF = float(bands);
    float spread = clamp(p3, 0.0, 1.0);
    float amp = clamp(p2, 0.0, 1.0);
    float curtainW = w * (0.05 + spread * 0.15);
    float sway = amp * w * 0.1;
    float gphase = hash(1.0) * TWO_PI;

    vec3 col = c0.rgb;
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
        float va;
        if (v < 0.45) va = mix(0.0, 0.75, v / 0.45);
        else if (v < 0.75) va = mix(0.75, 0.5, (v - 0.45) / 0.30);
        else va = mix(0.5, 0.0, (v - 0.75) / 0.25);
        col = mix(col, paletteColor(band), va * hf);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
