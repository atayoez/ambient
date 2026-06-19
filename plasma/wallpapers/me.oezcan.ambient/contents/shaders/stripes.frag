// Qt6/RHI animated stripes: a stripe field at `stripesAngle` that scrolls
// steadily along its normal — left/right for vertical stripes, up/down for
// horizontal, diagonal in between — the direction chosen by the seed. A
// gentle `stripesWidthVar` undulation makes the bands breathe.
// Mirrors src/lib/shaders.ts STRIPES_MAIN. See flow.frag for conventions.
//
// Bake:  /usr/lib/qt6/bin/qsb --glsl "150,330,440" -o stripes.frag.qsb stripes.frag
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
    float p1; // angle degrees (0 = vertical, 90 = horizontal)
    float p2; // width variation 0..1
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
    vec2 pc = frag - 0.5 * iResolution;

    float scale = max(w, h) / 1920.0;
    float theta = radians(clamp(p1, 0.0, 90.0));
    vec2 n = vec2(cos(theta), sin(theta)); // stripe normal
    vec2 t = vec2(-n.y, n.x);              // along the stripe
    float bw = max(gSize * scale * 1.5, 2.0);
    float widthVar = clamp(p2, 0.0, 1.0);

    float d = dot(pc, n);
    float along = dot(pc, t);
    // Scroll direction (+/- along the normal) is seeded, so different
    // wallpapers march opposite ways.
    float dir = hash(1.0) < 0.5 ? -1.0 : 1.0;
    float coord = d / bw;
    coord += dir * iTime * 0.06;
    coord += widthVar * 0.35 * sin(along / max(h, 1.0) * TWO_PI * 1.5 + iTime * 0.4);
    coord += 4096.0; // keep the stripe index positive for the cyclic palette

    float idx = floor(coord);
    float f = fract(coord);
    float aaw = clamp(fwidth(coord), 1e-4, 0.49);

    vec3 ca = paletteColor(int(idx));
    vec3 col;
    if (f < aaw)
        col = mix(paletteColor(int(idx) - 1), ca, 0.5 + 0.5 * f / aaw);
    else if (f > 1.0 - aaw)
        col = mix(ca, paletteColor(int(idx) + 1), 0.5 + 0.5 * (f - (1.0 - aaw)) / aaw);
    else
        col = ca;
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
