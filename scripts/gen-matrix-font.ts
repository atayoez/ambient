#!/usr/bin/env bun
// Single source of truth for the Matrix rain's baked 5x7 glyph font.
//
// The font used to exist only as pre-baked bit-packed arrays (GLSL `FONT`
// in src/lib/shaders.ts, `MATRIX_FONT` in renderer.rs) whose generator was
// never committed — the charset was effectively frozen. This script makes
// the font editable again:
//
//   scripts/matrix-font.txt      human-readable glyph atlas (one 5x7
//                                ASCII-art block per charset character;
//                                '#' = lit, '.' = dark)
//   bun run scripts/gen-matrix-font.ts            rewrite both baked arrays
//   bun run scripts/gen-matrix-font.ts --check    fail if out of sync
//   bun run scripts/gen-matrix-font.ts --decode   regenerate the atlas FROM
//                                                 the current GLSL array
//                                                 (bootstrap / recovery)
//
// Charset order comes from patternManifest.json (matrixCharset) — the index
// of a glyph in the atlas IS its wire index in the shader's text slots.
//
// Bit packing (the wire contract with glyphPx() in the GLSL and Rust):
// rows 0-5 pack 5 bits each into the first u32 (row r occupies bits
// r*5..r*5+4), row 6 goes into the second u32; within a row, bit = column
// (col 0 = leftmost = LSB).

import patternManifest from '../src/lib/patternManifest.json';

const CHARSET: string = patternManifest.matrixCharset;
const ATLAS_PATH = new URL('./matrix-font.txt', import.meta.url).pathname;
const SHADERS_TS = new URL('../src/lib/shaders.ts', import.meta.url).pathname;
const RENDERER_RS = new URL(
  '../src-tauri/core/src/renderer.rs',
  import.meta.url,
).pathname;

const COLS = 5;
const ROWS = 7;

type Glyph = [number, number]; // (rows 0-5 packed, row 6)

// --- atlas <-> bits ---------------------------------------------------

function glyphToArt(g: Glyph): string {
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const bits = row < 6 ? g[0] >>> (row * COLS) : g[1];
    let line = '';
    for (let col = 0; col < COLS; col++) {
      line += (bits >>> col) & 1 ? '#' : '.';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function artToGlyph(art: string[], where: string): Glyph {
  if (art.length !== ROWS) throw new Error(`${where}: expected ${ROWS} rows`);
  let lo = 0;
  let row6 = 0;
  art.forEach((line, row) => {
    if (line.length !== COLS) throw new Error(`${where} row ${row}: expected ${COLS} cols`);
    let bits = 0;
    for (let col = 0; col < COLS; col++) {
      const ch = line[col];
      if (ch !== '#' && ch !== '.') throw new Error(`${where}: bad char '${ch}'`);
      if (ch === '#') bits |= 1 << col;
    }
    if (row < 6) lo |= bits << (row * COLS);
    else row6 = bits;
  });
  return [lo >>> 0, row6 >>> 0];
}

function parseAtlas(text: string): Glyph[] {
  // Comment lines are "# " prefixed (glyph rows are 5 chars of #/., so a
  // lit-first row "#...." never matches "# ").
  const withoutComments = text
    .split('\n')
    .filter((l) => !l.startsWith('# '))
    .join('\n');
  // Blocks separated by blank lines; each block: "── <char>" header + 7 rows.
  const blocks = withoutComments
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const glyphs: Glyph[] = [];
  const chars = [...CHARSET];
  blocks.forEach((block, i) => {
    const lines = block.split('\n').map((l) => l.trim());
    const header = lines.shift() ?? '';
    const ch = chars[i] ?? '?';
    if (!header.startsWith('──')) throw new Error(`glyph ${i}: missing header`);
    if (!header.includes(ch)) {
      throw new Error(`glyph ${i}: header "${header}" doesn't match charset char "${ch}"`);
    }
    glyphs.push(artToGlyph(lines, `glyph ${i} (${ch})`));
  });
  if (glyphs.length !== chars.length) {
    throw new Error(`atlas has ${glyphs.length} glyphs; charset needs ${chars.length}`);
  }
  return glyphs;
}

function renderAtlas(glyphs: Glyph[]): string {
  const chars = [...CHARSET];
  const head =
    '# Matrix rain glyph atlas — the SOURCE for the baked FONT arrays in\n' +
    "# src/lib/shaders.ts and renderer.rs. '#' = lit, '.' = dark, 5x7 per\n" +
    '# glyph. Order = patternManifest.json matrixCharset (the wire index).\n' +
    '# After editing: bun run scripts/gen-matrix-font.ts\n';
  const blocks = glyphs.map((g, i) => `── ${chars[i]}\n${glyphToArt(g)}`);
  return `${head}\n${blocks.join('\n\n')}\n`;
}

// --- baked-array formats ----------------------------------------------

function glslArray(glyphs: Glyph[]): string {
  const items = glyphs.map((g) => `uvec2(${g[0]}u, ${g[1]}u)`).join(', ');
  return `const uvec2 FONT[${glyphs.length}] = uvec2[${glyphs.length}](${items});`;
}

function rustArray(glyphs: Glyph[]): string {
  const items = glyphs.map((g) => `(${g[0]}, ${g[1]})`).join(', ');
  return `const MATRIX_FONT: [(u32, u32); ${glyphs.length}] = [${items}];`;
}

const GLSL_RE = /const uvec2 FONT\[\d+\] = uvec2\[\d+\]\([^)]*(?:\([^)]*\)[^)]*)*\);/;
const GLSL_N_RE = /const int FONT_N = \d+;/;
const RUST_RE = /const MATRIX_FONT: \[\(u32, u32\); \d+\] = \[[^\]]*\];/;

function extractGlslGlyphs(source: string): Glyph[] {
  const m = source.match(/const uvec2 FONT\[\d+\] = uvec2\[\d+\]\((.*?)\);/s);
  if (!m) throw new Error('no FONT array found in shaders.ts');
  return [...m[1].matchAll(/uvec2\((\d+)u,\s*(\d+)u\)/g)].map((g) => [
    Number(g[1]),
    Number(g[2]),
  ]);
}

// --- main ---------------------------------------------------------------

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--decode')
    ? 'decode'
    : 'write';

const shadersSrc = await Bun.file(SHADERS_TS).text();

if (mode === 'decode') {
  const glyphs = extractGlslGlyphs(shadersSrc);
  if (glyphs.length !== [...CHARSET].length) {
    throw new Error(
      `GLSL FONT has ${glyphs.length} glyphs; manifest charset has ${[...CHARSET].length}`,
    );
  }
  await Bun.write(ATLAS_PATH, renderAtlas(glyphs));
  console.log(`decoded ${glyphs.length} glyphs → scripts/matrix-font.txt`);
  process.exit(0);
}

const atlas = parseAtlas(await Bun.file(ATLAS_PATH).text());
const wantGlsl = glslArray(atlas);
const wantGlslN = `const int FONT_N = ${atlas.length};`;
const wantRust = rustArray(atlas);
const rendererSrc = await Bun.file(RENDERER_RS).text();

const glslCurrent = shadersSrc.match(GLSL_RE)?.[0];
const glslNCurrent = shadersSrc.match(GLSL_N_RE)?.[0];
const rustCurrent = rendererSrc.match(RUST_RE)?.[0];
if (!glslCurrent || !glslNCurrent || !rustCurrent) {
  throw new Error('could not locate the baked FONT arrays to compare/replace');
}

const inSync =
  glslCurrent === wantGlsl && glslNCurrent === wantGlslN && rustCurrent === wantRust;

if (mode === 'check') {
  if (!inSync) {
    console.error(
      'stale: baked matrix FONT arrays differ from scripts/matrix-font.txt — run `bun run scripts/gen-matrix-font.ts`',
    );
    process.exit(1);
  }
  console.log('matrix font arrays are in sync with scripts/matrix-font.txt');
  process.exit(0);
}

if (inSync) {
  console.log('matrix font arrays already in sync');
} else {
  await Bun.write(
    SHADERS_TS,
    shadersSrc.replace(GLSL_RE, wantGlsl).replace(GLSL_N_RE, wantGlslN),
  );
  await Bun.write(RENDERER_RS, rendererSrc.replace(RUST_RE, wantRust));
  console.log(
    `wrote ${atlas.length}-glyph FONT arrays into shaders.ts + renderer.rs — run gen:shaders next`,
  );
}
