// Live UI tint derived from the current pattern palette.
//
// Mirrors the marketing site: the chrome's liquid-glass surfaces pick up
// a colour from whatever's currently in the preview, so building a
// pattern re-tints the whole window around it. The app window can't show
// the wallpaper directly (opaque on Linux/WebKitGTK), so the pattern's
// own palette is the tint source instead of a backdrop image.
//
// We publish the chosen colour as the `--tint-r/g/b` custom properties on
// <html>; the glass recipes in index.css read them. This is intentionally
// separate from `--accent-os` (the OS accent on functional controls) —
// the tint is decorative chrome colour, the accent is interaction state.

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  if (h.length !== 6) return null;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

/**
 * Pick the most "characterful" colour from a palette to tint the chrome:
 * the one with the best blend of saturation and brightness, so we avoid
 * near-black bases and washed-out neutrals. Returns null if nothing
 * parses (caller keeps the previous tint).
 */
export function pickTint(colors: string[]): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestScore = -1;
  for (const c of colors) {
    const rgb = hexToRgb(c);
    if (!rgb) continue;
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const val = max / 255;
    // Favour vivid colours but penalise both very dark and blown-out
    // ones, so the tint reads as "the colour of this palette".
    const score = sat * 0.65 + val * 0.35 - Math.abs(val - 0.7) * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = rgb;
    }
  }
  return best;
}

/** Write a tint triplet onto <html> for the glass recipes to read. */
export function applyTint(rgb: [number, number, number]): void {
  const root = document.documentElement;
  root.style.setProperty('--tint-r', String(rgb[0]));
  root.style.setProperty('--tint-g', String(rgb[1]));
  root.style.setProperty('--tint-b', String(rgb[2]));
}

/** Derive a tint from a palette and apply it; no-op if nothing parses. */
export function applyPaletteTint(colors: string[]): void {
  const rgb = pickTint(colors);
  if (rgb) applyTint(rgb);
}
