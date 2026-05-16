// Adapted from React Bits (MIT + Commons Clause)
// https://github.com/DavidHDev/react-bits — src/ts-default/Components/SpotlightCard/SpotlightCard.tsx
// See THIRD_PARTY_LICENSES.md for the full notice.
//
// One deviation from upstream: the `spotlightColor` prop type is widened
// from the strict `rgba(R, G, B, A)` template literal to `string`, so we
// can pass `color-mix(...)` / CSS variables for theme-aware spotlights.
// The default also moves from a hardcoded white rgba to a color-mix
// expression that resolves against the wrapper's currentColor, so the
// spotlight auto-adapts to dark vs. light theme without per-call config.

import { useRef } from 'react';
import './SpotlightCard.css';

interface SpotlightCardProps extends React.PropsWithChildren {
  className?: string;
  spotlightColor?: string;
}

const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className = '',
  spotlightColor = 'color-mix(in srgb, currentColor 14%, transparent)',
}) => {
  const divRef = useRef<HTMLDivElement>(null);

  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    divRef.current.style.setProperty('--mouse-x', `${x}px`);
    divRef.current.style.setProperty('--mouse-y', `${y}px`);
    divRef.current.style.setProperty('--spotlight-color', spotlightColor);
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      className={`card-spotlight ${className}`}
    >
      {children}
    </div>
  );
};

export default SpotlightCard;
