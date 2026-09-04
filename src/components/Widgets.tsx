import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useLiveClock, useSettings } from '../lib/appHooks';
import type { ClockPosition } from '../lib/types';
import { ControlRow, OptionScroller } from '../ui';
import ClockOverlay from './ClockOverlay';

// Widgets tab — things drawn ON TOP of the live wallpaper by every delivery
// (the Plasma plugin, the desktop-layer webview windows). Today that is the
// clock; the tab is laid out one section per widget so more can slot in.
//
// The stage at the top is a screen-shaped preview (the real monitor aspect)
// of the last applied wallpaper with the widgets laid over it, driven by the
// same live-editable state the rows below write, so a drag on Horizontal /
// Vertical / Size moves the clock in place before anything is persisted.

// Anchor presets: which corner (or the centre) of the clock is pinned at
// (x, y). Ids are the Rust enum's serde names (types.rs ClockPosition).
const ANCHOR_OPTIONS: { id: ClockPosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'center', label: 'Center' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

// Where a freshly chosen anchor snaps to — 4% in from its edges, or dead
// centre. Mirrors ClockPosition::default_xy in types.rs.
function anchorDefaults(anchor: ClockPosition): { x: number; y: number } {
  switch (anchor) {
    case 'top-left':
      return { x: 4, y: 4 };
    case 'top-right':
      return { x: 96, y: 4 };
    case 'bottom-left':
      return { x: 4, y: 96 };
    case 'bottom-right':
      return { x: 96, y: 96 };
    default:
      return { x: 50, y: 50 };
  }
}

const FORMAT_OPTIONS: { id: '24' | '12'; label: string }[] = [
  { id: '24', label: '24-hour' },
  { id: '12', label: '12-hour' },
];

// The stage keeps the real screen's aspect so percent positions map 1:1.
function useMonitorAspect(): string {
  const [aspect, setAspect] = useState('16 / 9');
  useEffect(() => {
    invoke<{ width: number; height: number }>('get_primary_monitor_pixels')
      .then((m) => {
        if (m.width > 0 && m.height > 0) setAspect(`${m.width} / ${m.height}`);
      })
      .catch(() => {});
  }, []);
  return aspect;
}

export default function Widgets() {
  const [clock, patchClock] = useLiveClock();
  const [settings] = useSettings({ subscribe: true });
  const aspect = useMonitorAspect();
  // Backdrop for the stage: the last applied still. (When a live wallpaper
  // is up this is the still before it — close enough to judge contrast.)
  const backdrop = settings?.lastApplied ? convertFileSrc(settings.lastApplied) : null;
  const backdropColor =
    firstColor(settings?.liveWallpaper) ?? firstColor(settings?.lastPattern);

  return (
    <div className="settings widgets">
      <div className="settings-inner">
        <section className="set-group">
          <h3 className="set-title">Clock</h3>

          <div
            className="widget-stage"
            style={{ aspectRatio: aspect, background: backdropColor ?? undefined }}
            aria-hidden="true"
          >
            {backdrop && <img src={backdrop} alt="" />}
            {clock.enabled ? (
              <ClockOverlay clock={clock} background={backdropColor ?? undefined} />
            ) : (
              <div className="widget-stage-empty">Clock is off</div>
            )}
          </div>

          <div className="set-row">
            <span>Show clock</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={clock.enabled}
                onChange={(e) => patchClock({ enabled: e.target.checked })}
                aria-label="Show a clock on the live wallpaper"
              />
              <span className="switch-track" />
            </label>
          </div>

          <div className="set-row">
            <span>Anchor</span>
            <OptionScroller
              options={ANCHOR_OPTIONS}
              value={clock.position}
              onChange={(v) => patchClock({ position: v, ...anchorDefaults(v) })}
              ariaLabel="Which corner of the clock is pinned"
            />
          </div>
          <div className="set-row set-row-slider">
            <span>Horizontal position</span>
            <ControlRow
              label="Horizontal position"
              value={Math.round(clock.x)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => patchClock({ x: v })}
            />
          </div>
          <div className="set-row set-row-slider">
            <span>Vertical position</span>
            <ControlRow
              label="Vertical position"
              value={Math.round(clock.y)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => patchClock({ y: v })}
            />
          </div>
          <div className="set-row set-row-slider">
            <span>Size</span>
            <ControlRow
              label="Size"
              value={clock.size}
              min={2}
              max={40}
              step={0.5}
              format={(v) => `${Number(v.toFixed(1))}%`}
              onChange={(v) => patchClock({ size: v })}
            />
          </div>

          <div className="set-row">
            <span>Time format</span>
            <OptionScroller
              options={FORMAT_OPTIONS}
              value={clock.hour12 ? '12' : '24'}
              onChange={(v) => patchClock({ hour12: v === '12' })}
              ariaLabel="Clock time format"
            />
          </div>
          <div className="set-row">
            <span>Show seconds</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={clock.showSeconds}
                onChange={(e) => patchClock({ showSeconds: e.target.checked })}
                aria-label="Show seconds on the clock"
              />
              <span className="switch-track" />
            </label>
          </div>
          <div className="set-row">
            <span>Show date</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={clock.showDate}
                onChange={(e) => patchClock({ showDate: e.target.checked })}
                aria-label="Show the date under the clock"
              />
              <span className="switch-track" />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}

// colors[0] of an opaque PatternConfig JSON blob (liveWallpaper / lastPattern
// are `unknown` on the wire on purpose — Rust never inspects them).
function firstColor(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object') return null;
  const colors = (spec as { colors?: unknown }).colors;
  return Array.isArray(colors) && typeof colors[0] === 'string' ? colors[0] : null;
}
