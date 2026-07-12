// Guards on the pattern manifest — the single source of truth for the
// per-type knob contract. These pin the invariants the consumers assume
// (patterns.ts derivations, liveShader.ts packing, Rust codegen, the
// generated shaders' wire codes).

import { describe, expect, it } from 'vitest';
import {
  ANIMATABLE,
  GEOMETRIC_SHAPES,
  PATTERN_MANIFEST,
  PATTERN_TYPES,
  TYPE_SPECS,
} from './patterns';
import { FRAG_SHADERS, MATRIX_CHARSET } from './shaders';

describe('patternManifest', () => {
  it('covers every shader type (a type is animatable iff it ships a shader)', () => {
    const ids = new Set(PATTERN_TYPES.map((t) => t.id));
    for (const key of Object.keys(FRAG_SHADERS)) {
      expect(ids.has(key as (typeof PATTERN_TYPES)[number]['id'])).toBe(true);
    }
    expect(ANIMATABLE.length).toBe(Object.keys(FRAG_SHADERS).length);
  });

  it('keeps numeric defaults inside their slider range', () => {
    for (const spec of PATTERN_MANIFEST.types) {
      for (const k of spec.knobs) {
        if (typeof k.default !== 'number') continue;
        expect(k.default, `${spec.id}.${k.key}`).toBeGreaterThanOrEqual(k.min ?? 0);
        expect(k.default, `${spec.id}.${k.key}`).toBeLessThanOrEqual(k.max ?? 1);
      }
    }
  });

  it('never assigns one uniform slot twice within a type', () => {
    for (const spec of PATTERN_MANIFEST.types) {
      const used = spec.knobs.map((k) => k.uniform).filter(Boolean);
      expect(new Set(used).size, spec.id).toBe(used.length);
    }
  });

  it('pins the geometric wire codes (choice order is the shader contract)', () => {
    expect(GEOMETRIC_SHAPES.map((s) => s.id)).toEqual([
      'mix',
      'circles',
      'triangles',
      'squares',
      'hexagons',
      'stars',
      'plus',
    ]);
    const fill = TYPE_SPECS.geometric.knobs.find((k) => k.key === 'geometricFill');
    expect(fill?.choices?.map((c) => c.id)).toEqual(['solid', 'outline', 'mix']);
  });

  it('keeps the matrix charset in lockstep with the baked shader font', () => {
    // The GLSL FONT array bakes 88 glyph bitmaps; the charset indexes them.
    expect(MATRIX_CHARSET.length).toBe(88);
    expect(FRAG_SHADERS.matrix).toContain('const int FONT_N = 88;');
  });
});
