// Pass-through vertex shader for the Ambient wallpaper ShaderEffect.
// Qt's built-in vertex shader emits qt_TexCoord0 WITHOUT an explicit
// location, which fails to link against our fragment's
// `layout(location = 0) in vec2 qt_TexCoord0` on the OpenGL RHI backend
// (GLSL 150/330) that Plasma uses ("no matching output"). Shipping our own
// vertex shader with the matching explicit location fixes it on every
// backend. Shared by flow/waves/aurora (identical std140 block).
//
// Bake:  /usr/lib/qt6/bin/qsb -b --glsl "150,330,440" -o wallpaper.vert.qsb wallpaper.vert
#version 440
layout(location = 0) in vec4 qt_Vertex;
layout(location = 1) in vec2 qt_MultiTexCoord0;
layout(location = 0) out vec2 qt_TexCoord0;

// Must match the fragment shaders' block byte-for-byte (std140).
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
    float p1;
    float p2;
    float p3;
};

void main() {
    qt_TexCoord0 = qt_MultiTexCoord0;
    gl_Position = qt_Matrix * qt_Vertex;
}
