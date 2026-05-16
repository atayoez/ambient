// Wraps an image / canvas preview with a soft 4-sided edge glow whose
// colors come from a sample of the same image. The visual is the
// "ambient light" effect you see behind album art in music players —
// the image's edge colors bleed outward and fade into the surrounding
// chrome, with the rest of the background staying neutral.
//
// Implementation: a sibling <div> behind the children, absolutely
// positioned with `inset: -spread`, painted with the bleed image at
// `background-size: cover`, then heavily CSS-blurred. The blur softens
// the edges so the halo dies off smoothly into transparent without an
// explicit mask. Children sit on z-index: 1 above the halo.
//
// `bleedSrc` is required for the halo to appear; pass null / empty
// while the consumer is still loading and the component just renders
// children with no halo.

import type { CSSProperties, ReactNode } from 'react';
import './ImageBleed.css';

interface ImageBleedProps {
  /** Image URL or data: URI used as the source of the halo. For canvas
   *  consumers (Patterns), derive from a downscaled canvas.toDataURL.
   *  When null / undefined / '' the halo is omitted and children render
   *  bare. */
  bleedSrc?: string | null;
  /** How far the halo extends beyond the wrapped content, in px. Big
   *  single-image previews want ~60-80; small grid cards want ~15-20. */
  spread?: number;
  /** Halo opacity, 0..1. */
  intensity?: number;
  /** CSS blur radius applied to the halo image, in px. */
  blur?: number;
  className?: string;
  children: ReactNode;
}

export default function ImageBleed({
  bleedSrc,
  spread = 60,
  intensity = 0.6,
  blur = 50,
  className = '',
  children,
}: ImageBleedProps) {
  const styleVars = {
    '--bleed-spread': `${spread}px`,
    '--bleed-intensity': intensity,
    '--bleed-blur': `${blur}px`,
  } as CSSProperties;

  return (
    <div className={`image-bleed ${className}`.trim()} style={styleVars}>
      {bleedSrc ? (
        <div
          className="image-bleed__halo"
          style={{ backgroundImage: `url("${bleedSrc}")` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="image-bleed__content">{children}</div>
    </div>
  );
}
