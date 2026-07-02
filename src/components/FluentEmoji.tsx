import { useState } from 'react';

// Codepoint key for an emoji cluster, matching Rust `emojis::codepoint_key`:
// strip VS16 (U+FE0F), join remaining codepoints with `_`.
export function codepointKey(emoji: string): string {
  return [...emoji]
    .map((c) => c.codePointAt(0) ?? 0)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('_');
}

const CDN = 'https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-3d/assets';

// Microsoft Fluent 3D artwork for a single emoji — the same art the Rust
// renderer composites into wallpapers — so pickers and previews stop
// depending on whatever color-emoji font the OS ships (flat or monochrome
// on most Linux setups). Loads lazily from the codepoint-indexed Fluent 3D
// mirror; LobeHub keys some VS16 emoji with a `-fe0f` suffix, so that
// variant is tried before falling back to the plain text glyph (offline /
// unsupported cluster).
export default function FluentEmoji({ emoji }: { emoji: string }) {
  // 0 = bare key, 1 = `-fe0f` suffixed key, 2 = text fallback
  const [attempt, setAttempt] = useState(0);
  const key = codepointKey(emoji);
  if (attempt > 1 || !key) return <>{emoji}</>;
  return (
    <img
      className="fluent-emoji"
      src={`${CDN}/${key}${attempt === 1 ? '-fe0f' : ''}.webp`}
      alt={emoji}
      loading="lazy"
      draggable={false}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
