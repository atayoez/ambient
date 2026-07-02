#!/usr/bin/env bun
// Single source of truth for every animated pattern shader.
//
// src/lib/shaders.ts holds the WebGL2 / GLSL ES 3.00 shaders that drive the
// in-app preview, the macOS live window and Android. The KDE Plasma wallpaper
// plugin renders through Qt's RHI ShaderEffect, which can't load that GLSL —
// it needs `#version 440` with a std140 uniform *block*, compiled to `.qsb`.
// Historically the two were hand-kept twins (flower.frag said "Mirrors
// src/lib/shaders.ts"), and a fix to one that missed the other made the live
// wallpaper drift from the app. This script removes the hand-sync: it derives
// each Plasma `.frag` from the WebGL source mechanically, then bakes the
// `.qsb`, so they can no longer diverge.
//
// Usage:
//   bun run scripts/gen-shaders.ts          # write .frag + bake .qsb
//   bun run scripts/gen-shaders.ts --check  # fail if committed output is stale
//
// The WebGL→Qt transform is purely regular (see TRANSFORMS below); the only
// semantic contract is that the palette is capped at 6 colours (c0 = bg),
// which matches the app's 6-colour palette limit and main.qml's clamp.

import { FRAG_SHADERS } from '../src/lib/shaders';

const SHADER_DIR = new URL(
  '../plasma/wallpapers/me.oezcan.ambient/contents/shaders/',
  import.meta.url,
).pathname;

// Per-type knob labels — purely cosmetic, mirrors main.qml's knob() mapping.
const KNOBS: Record<string, [string, string, string]> = {
  flow: ['lines', 'amplitude 0..1', 'frequency 0..1'],
  waves: ['layers', 'amplitude 0..1', 'frequency 0..1'],
  aurora: ['bands', 'sway 0..1', 'spread 0..1'],
  dots: ['density', 'jitter 0..1', 'size variance 0..1'],
  bokeh: ['count', 'unused', 'unused'],
  stripes: ['angle (deg)', 'width variance 0..1', 'unused'],
  geometric: ['density', 'shape code', 'fill code'],
  flower: ['petal count', 'twist (fullness) 0..1', 'unused'],
  mesh: ['bubble count', 'softness 0..1', 'unused'],
  matrix: ['columns', 'trail 0..1', 'speed 0..1'],
  crt: ['scanlines 0..1', 'curvature 0..1', 'noise 0..1'],
};

function header(type: string): string {
  const [k1, k2, k3] = KNOBS[type] ?? ['p1', 'p2', 'p3'];
  return `// GENERATED from src/lib/shaders.ts by scripts/gen-shaders.ts — DO NOT EDIT.
// Run \`bun run gen:shaders\` after changing the shader source. The WebGL
// (app/desktop/Android) and this Qt/RHI (KDE Plasma) shader are one source
// now, so they can no longer drift.
//
// Bake:  qsb --glsl "100es,300es,150,330,440" -o ${type}.frag.qsb ${type}.frag
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
    float p1; // ${k1}
    float p2; // ${k2}
    float p3; // ${k3}
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

`;
}

function toQt(type: string, webgl: string): string {
  // Drop the WebGL preamble (#version / precision / uniforms / out decl);
  // keep everything from the first shared helper (TWO_PI) onward.
  const cut = webgl.indexOf('const float TWO_PI');
  if (cut < 0) throw new Error(`${type}: no TWO_PI marker in source`);
  let body = webgl.slice(cut);

  // The y-flip the WebGL shaders apply (Rust origin is top-left, gl_FragCoord
  // is bottom-left); qt_TexCoord0 is already top-left, so it maps directly.
  body = body.replaceAll(
    'vec2(gl_FragCoord.x, h - gl_FragCoord.y)',
    'qt_TexCoord0 * iResolution',
  );
  // Palette array access -> _pal() selector (covers helpers + main inits).
  body = body.replace(/u_colors\[([^\]]*)\]/g, '_pal($1)');
  // Uniform renames (order matters: u_colors[..] handled above; u_colorCount
  // has no bracket so it survives, then is renamed here).
  body = body
    .replaceAll('u_resolution', 'iResolution')
    .replaceAll('u_time', 'iTime')
    .replaceAll('u_colorCount', 'colorCount')
    .replaceAll('u_seed', 'seed')
    .replaceAll('u_size', 'gSize')
    .replaceAll('u_p1', 'p1')
    .replaceAll('u_p2', 'p2')
    .replaceAll('u_p3', 'p3')
    .replaceAll('u_t0', 't0')
    .replaceAll('u_t1', 't1')
    .replaceAll('u_t2', 't2')
    .replaceAll('u_t3', 't3');
  // Premultiply by the item's opacity, as Qt's ShaderEffect expects.
  body = body.replace(
    /fragColor\s*=\s*vec4\(col,\s*1\.0\);/,
    'fragColor = vec4(col, 1.0) * qt_Opacity;',
  );
  if (!body.includes('* qt_Opacity')) {
    throw new Error(`${type}: did not find the final fragColor assignment`);
  }
  if (body.includes('u_') || body.includes('gl_FragCoord')) {
    throw new Error(`${type}: untranslated WebGL token remains`);
  }
  return header(type) + body.trimStart() + '\n';
}

const check = process.argv.includes('--check');
const QSB = process.env.QSB || '/usr/lib/qt6/bin/qsb';

// Desktop GL *and* GLES targets: Plasma on NVIDIA-aarch64 (and many ARM
// boards) runs Qt Quick on an OpenGL ES context, where a qsb baked only with
// desktop GLSL variants fails to load and the ShaderEffect renders nothing —
// every pattern except the shaderless emoji field showed a blank wallpaper.
const GLSL_TARGETS = '100es,300es,150,330,440';

function bake(fragPath: string, qsbPath: string): void {
  const baked = Bun.spawnSync([QSB, '--glsl', GLSL_TARGETS, '-o', qsbPath, fragPath]);
  if (baked.exitCode !== 0) {
    console.error(`bake failed for ${fragPath}:\n${baked.stderr.toString()}`);
    process.exit(1);
  }
}

let stale = 0;
for (const [type, webgl] of Object.entries(FRAG_SHADERS)) {
  const frag = toQt(type, webgl);
  const fragPath = `${SHADER_DIR}${type}.frag`;
  const qsbPath = `${fragPath}.qsb`;

  if (check) {
    const existing = await Bun.file(fragPath).text().catch(() => '');
    if (existing !== frag) {
      console.error(`stale: ${type}.frag differs from src/lib/shaders.ts`);
      stale++;
    }
    continue;
  }

  await Bun.write(fragPath, frag);
  bake(fragPath, qsbPath);
  console.log(`generated ${type}.frag + .qsb`);
}

// The pass-through vertex shader is hand-written (not derived from WebGL) but
// must be baked with the same target list, or a GLES-only context loads the
// fragment shader and still fails on the vertex stage.
if (!check) {
  const vertPath = `${SHADER_DIR}wallpaper.vert`;
  bake(vertPath, `${vertPath}.qsb`);
  console.log('baked wallpaper.vert.qsb');
}

if (check && stale > 0) {
  console.error(`\n${stale} shader(s) out of date — run \`bun run gen:shaders\``);
  process.exit(1);
}
if (check) console.log('all Plasma shaders are in sync with src/lib/shaders.ts');
