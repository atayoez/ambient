// Qt6/RHI port of the Flow generative pattern for the Plasma wallpaper
// plugin's ShaderEffect. Same sin/cos field math as the WebGL version
// (src/lib/shaders.ts) and the Rust tiny-skia renderer (renderer.rs
// render_flow); only the I/O wrapper differs — qt_TexCoord0 is already
// top-left origin (matches tiny-skia), so no y-flip is needed here.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o flow.frag.qsb flow.frag
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

// std140 UBO: qt_Matrix (offset 0) + qt_Opacity (offset 64) are required
// first; QML properties on the ShaderEffect map to the rest by name.
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
};

const float TWO_PI = 6.28318530718;
const float SPEED = 0.22;

float hash(float n) { return fract(sin(n * 12.9898 + seed * 0.013) * 43758.5453123); }

// Foreground palette is c1.. (c0 is the background), indexed cyclically.
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

    float scale = max(w, h) / 1920.0;
    float thickness = max(gSize * scale * 0.12, 1.0);
    float cycles = 0.5 + clamp(p3, 0.0, 1.0) * 2.5;
    float ampPx = clamp(p2, 0.0, 1.0) * h * 0.16;
    int lines = int(max(p1, 1.0));
    float linesF = float(lines);
    float gphase = hash(1.0) * TWO_PI;

    vec3 col = c0.rgb;
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
