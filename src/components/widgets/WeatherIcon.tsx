import type { WeatherKind } from '../../lib/weather';

// Line icons for the weather widget, Lucide geometry (24px viewBox, round
// joins, currentColor) like components/Icons.tsx. Sized in em by the caller
// so they scale with the widget. The Plasma plugin uses the desktop's own
// weather-* icon theme instead.

// The rain / drizzle / snow / fog cloud: open at the bottom for the drops.
const OPEN_CLOUD = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242';

const PATHS: Record<WeatherKind, string[]> = {
  clear: [
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  'clear-night': ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  partly: [
    'M12 2v2',
    'm4.93 4.93 1.41 1.41',
    'M20 12h2',
    'm19.07 4.93-1.41 1.41',
    'M15.947 12.65a4 4 0 0 0-5.925-4.128',
    'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z',
  ],
  'partly-night': [
    'M10.188 8.5A6 6 0 0 1 16 4a1 1 0 0 0 6 6 6 6 0 0 1-3 5.197',
    'M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z',
  ],
  cloudy: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  fog: [OPEN_CLOUD, 'M16 17H7', 'M17 21H9'],
  drizzle: [
    OPEN_CLOUD,
    'M8 19v1',
    'M8 14v1',
    'M16 19v1',
    'M16 14v1',
    'M12 21v1',
    'M12 16v1',
  ],
  rain: [OPEN_CLOUD, 'M16 14v6', 'M8 14v6', 'M12 16v6'],
  snow: [
    OPEN_CLOUD,
    'M8 15h.01',
    'M8 19h.01',
    'M12 17h.01',
    'M12 21h.01',
    'M16 15h.01',
    'M16 19h.01',
  ],
  storm: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'm13 12-3 5h4l-3 5'],
};

export default function WeatherIcon({
  kind,
  className,
}: {
  kind: WeatherKind;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
