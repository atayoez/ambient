// Qt6/RHI animated mesh: large, soft radial colour blobs that drift slowly
// and overlap into a flowing mesh-gradient field. The still bakes the same
// blobs plus a gaussian blur; here the wide soft falloff (widened by the
// softness knob) stands in for the blur. Mirrors src/lib/shaders.ts
// MESH_MAIN. See flow.frag for the UBO/IO conventions.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o mesh.frag.qsb mesh.frag
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
    float p1; // blob count (mesh bubbles)
    float p2; // softness 0..1
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
    float maxDim = max(w, h);

    int count = int(clamp(p1, 3.0, 24.0));
    float softness = clamp(p2, 0.0, 1.0);

    vec3 col = c0.rgb;
    for (int i = 0; i < 24; i++) {
        if (i >= count) break;
        float fi = float(i) + 1.0;
        float hx = hash(fi * 1.7);
        float hy = hash(fi * 1.7 + 3.0);
        float hr = hash(fi + 11.0);
        float ha = hash(fi + 27.0);
        float hsx = hash(fi + 5.0);
        float hsy = hash(fi + 19.0);
        // Blobs may sit slightly off-screen (like the still's -0.1..1.1
        // placement) so edges stay covered as they drift.
        vec2 base = vec2((hx * 1.2 - 0.1) * w, (hy * 1.2 - 0.1) * h);
        vec2 pos = base + vec2(
            sin(iTime * (0.05 + hsx * 0.08) + hx * TWO_PI),
            cos(iTime * (0.05 + hsy * 0.08) + hy * TWO_PI)
        ) * maxDim * 0.12;
        float radius = mix(0.40, 0.72, hr) * maxDim;
        float alpha = mix(0.55, 0.9, ha);
        float dd = distance(frag, pos) / radius;
        // Soft radial falloff; softness widens it (lower exponent = broader).
        float fall = pow(clamp(1.0 - dd, 0.0, 1.0), mix(2.6, 1.2, softness));
        col = mix(col, paletteColor(i), alpha * fall);
    }
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
