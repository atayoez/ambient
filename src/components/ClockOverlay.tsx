import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { ClockPosition, LiveClock } from '../lib/types';

// Live clock drawn over a live wallpaper. One component serves both the
// desktop-layer wallpaper window (LiveWallpaper) and the in-app Patterns
// preview, so the preview shows exactly what the desktop will. The Plasma
// plugin draws a QML twin (plasma/.../contents/ui/main.qml) from the same
// `clock` block of the spec.
//
// Placement is anchor + free position (see LiveClock in types.rs): the
// clock's `position` corner (or centre) is pinned at (`x`%, `y`%) of the
// stage, and the time's digit height is `size`% of the stage's SHORTER side —
// measured with a ResizeObserver so it comes out identical on a 4K output and
// in the preview pane. The date is 30% of the time.

/** Per-anchor CSS translate that puts the anchored corner on the (x, y) point. */
const ANCHOR_TRANSLATE: Record<ClockPosition, string> = {
  'top-left': '0 0',
  'top-right': '-100% 0',
  'bottom-left': '0 -100%',
  'bottom-right': '-100% -100%',
  center: '-50% -50%',
};
const ANCHOR_ALIGN: Record<ClockPosition, 'left' | 'right' | 'center'> = {
  'top-left': 'left',
  'top-right': 'right',
  'bottom-left': 'left',
  'bottom-right': 'right',
  center: 'center',
};

// Dark text over light base colours (sRGB relative luminance of the
// pattern's background colour), light text otherwise — legible on any
// palette without a box behind it.
export function clockOnLightBackground(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

export function formatClock(
  now: Date,
  clock: LiveClock,
): { time: string; date: string | null } {
  // hourCycle (not hour12) so 24-hour midnight reads "00:xx", not "24:xx".
  const time = new Intl.DateTimeFormat(undefined, {
    hour: clock.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    second: clock.showSeconds ? '2-digit' : undefined,
    hourCycle: clock.hour12 ? 'h12' : 'h23',
  }).format(now);
  const date = clock.showDate
    ? new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(now)
    : null;
  return { time, date };
}

export default function ClockOverlay({
  clock,
  background,
}: {
  clock: LiveClock;
  /** The pattern's base colour (colors[0]) — picks light vs dark text. */
  background?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  // 1% of the stage's shorter side, in px. 0 until measured (nothing drawn).
  const [unit, setUnit] = useState(0);

  // Tick on the next second / minute boundary so the shown time never lags
  // behind the system clock by a partial period.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const period = clock.showSeconds ? 1000 : 60_000;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        period - (Date.now() % period) + 10,
      );
    };
    setNow(new Date());
    schedule();
    return () => clearTimeout(timer);
  }, [clock.showSeconds]);

  // Measure the host stage (this overlay fills its positioned parent).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setUnit(Math.min(el.clientWidth, el.clientHeight) / 100);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { time, date } = formatClock(now, clock);
  const tone = clockOnLightBackground(background) ? ' live-clock--on-light' : '';
  const box: CSSProperties = {
    left: `${clock.x}%`,
    top: `${clock.y}%`,
    translate: ANCHOR_TRANSLATE[clock.position],
    ['--clock-size' as string]: `${unit * clock.size}px`,
  };

  return (
    <div
      ref={ref}
      className={`live-clock live-clock--align-${ANCHOR_ALIGN[clock.position]}${tone}`}
      aria-hidden="true"
    >
      {unit > 0 && (
        <div className="live-clock-box" style={box}>
          <div className="live-clock-time">{time}</div>
          {date && <div className="live-clock-date">{date}</div>}
        </div>
      )}
    </div>
  );
}
