import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { type ReactNode, useEffect, useState } from 'react';
import { useLiveClock, useLiveWidgets, useSettings } from '../lib/appHooks';
import type { ClockPosition, LiveClock, LiveWidgets, WeatherWidget } from '../lib/types';
import { type Place, searchPlaces } from '../lib/weather';
import {
  anchorDefaults,
  daysUntil,
  formatClock,
  formatCountdown,
  type Placement,
  type WidgetId,
} from '../lib/widgets';
import { ControlRow, OptionScroller } from '../ui';
import { CalendarIcon, ClockIcon, CloudSunIcon, HourglassIcon, NoteIcon } from './Icons';
import WidgetLayer from './widgets/WidgetLayer';

// Widgets tab — things drawn ON TOP of the live wallpaper by every delivery
// (the Plasma plugin, the desktop-layer webview windows): a clock, weather,
// this month's calendar, a countdown and a note.
//
// Top to bottom: a screen-shaped stage (the real monitor aspect) of the last
// applied wallpaper with every enabled widget laid over it — drag one to
// move it; a tile per widget to switch it on and pick it; the shared style;
// and the picked widget's settings. Everything edits live state (see
// useLiveClock / useLiveWidgets), so the stage follows each drag before
// anything is persisted.

const ANCHOR_OPTIONS: { id: ClockPosition; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'center', label: 'Center' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

const FORMAT_OPTIONS: { id: '24' | '12'; label: string }[] = [
  { id: '24', label: '24-hour' },
  { id: '12', label: '12-hour' },
];

const STYLE_OPTIONS: { id: LiveWidgets['style']; label: string }[] = [
  { id: 'plain', label: 'Plain text' },
  { id: 'glass', label: 'Glass cards' },
];

const UNIT_OPTIONS: { id: WeatherWidget['unit']; label: string }[] = [
  { id: 'celsius', label: 'Celsius (°C)' },
  { id: 'fahrenheit', label: 'Fahrenheit (°F)' },
];

const WEEK_OPTIONS: { id: 'mon' | 'sun'; label: string }[] = [
  { id: 'mon', label: 'Monday' },
  { id: 'sun', label: 'Sunday' },
];

interface WidgetMeta {
  id: WidgetId;
  name: string;
  icon: ReactNode;
  /** Size slider range, in % of the shorter screen edge. */
  size: [min: number, max: number, step: number];
}

const WIDGETS: WidgetMeta[] = [
  { id: 'clock', name: 'Clock', icon: <ClockIcon size={18} />, size: [2, 40, 0.5] },
  {
    id: 'weather',
    name: 'Weather',
    icon: <CloudSunIcon size={18} />,
    size: [2, 20, 0.5],
  },
  {
    id: 'calendar',
    name: 'Calendar',
    icon: <CalendarIcon size={18} />,
    size: [1, 6, 0.1],
  },
  {
    id: 'countdown',
    name: 'Countdown',
    icon: <HourglassIcon size={18} />,
    size: [2, 24, 0.5],
  },
  { id: 'note', name: 'Note', icon: <NoteIcon size={18} />, size: [1, 12, 0.1] },
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
  const [widgets, patchWidget, setStyle] = useLiveWidgets();
  const [settings] = useSettings({ subscribe: true });
  const [selected, setSelected] = useState<WidgetId>('clock');
  const aspect = useMonitorAspect();
  // Backdrop for the stage: the last applied still. (When a live wallpaper
  // is up this is the still before it — close enough to judge contrast.)
  const backdrop = settings?.lastApplied ? convertFileSrc(settings.lastApplied) : null;
  const backdropColor =
    firstColor(settings?.liveWallpaper) ?? firstColor(settings?.lastPattern);

  const placementOf = (id: WidgetId): Placement => (id === 'clock' ? clock : widgets[id]);
  const patchPlacement = (id: WidgetId, p: Partial<Placement>) => {
    if (id === 'clock') patchClock(p);
    else patchWidget(id, p);
  };
  const anyOn = WIDGETS.some((w) => placementOf(w.id).enabled);
  const meta = WIDGETS.find((w) => w.id === selected) ?? WIDGETS[0];
  const current = placementOf(selected);

  return (
    <div className="settings widgets">
      <div className="settings-inner widgets-inner">
        <section className="set-group widget-stage-group">
          <div
            className="widget-stage"
            style={{ aspectRatio: aspect, background: backdropColor ?? undefined }}
          >
            {backdrop && <img src={backdrop} alt="" />}
            <WidgetLayer
              clock={clock}
              widgets={widgets}
              background={backdropColor ?? undefined}
              edit={{
                selected,
                onSelect: setSelected,
                onMove: (id, x, y) => patchPlacement(id, { x, y }),
              }}
            />
            {!anyOn && <div className="widget-stage-empty">Switch on a widget below</div>}
          </div>
          <p className="widget-hint">
            Drag a widget to move it, or focus it and use the arrow keys. Changes go
            straight to the live wallpaper.
          </p>
        </section>

        <div className="widget-gallery">
          {WIDGETS.map((w) => {
            const p = placementOf(w.id);
            const cls = `widget-tile${w.id === selected ? ' is-selected' : ''}${p.enabled ? ' is-on' : ''}`;
            return (
              <div key={w.id} className={cls}>
                <button
                  type="button"
                  className="widget-tile-main"
                  onClick={() => setSelected(w.id)}
                  aria-pressed={w.id === selected}
                >
                  <span className="widget-tile-icon">{w.icon}</span>
                  <span className="widget-tile-name">{w.name}</span>
                  <span className="widget-tile-sub">
                    {p.enabled ? tileSummary(w.id, clock, widgets) : 'Off'}
                  </span>
                </button>
                <label className="switch widget-tile-switch">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => {
                      patchPlacement(w.id, { enabled: e.target.checked });
                      if (e.target.checked) setSelected(w.id);
                    }}
                    aria-label={`Show the ${w.name.toLowerCase()} widget`}
                  />
                  <span className="switch-track" />
                </label>
              </div>
            );
          })}
        </div>

        <section className="set-group">
          <div className="set-row">
            <span>Style</span>
            <OptionScroller
              options={STYLE_OPTIONS}
              value={widgets.style}
              onChange={setStyle}
              ariaLabel="How widgets are drawn"
            />
          </div>
        </section>

        <section className="set-group">
          <h3 className="set-title">{meta.name}</h3>

          {selected === 'weather' && (
            <WeatherSettings
              widget={widgets.weather}
              patch={(p) => patchWidget('weather', p)}
            />
          )}
          {selected === 'clock' && <ClockSettings clock={clock} patch={patchClock} />}
          {selected === 'calendar' && (
            <div className="set-row">
              <span>Week starts on</span>
              <OptionScroller
                options={WEEK_OPTIONS}
                value={widgets.calendar.weekStartsMonday ? 'mon' : 'sun'}
                onChange={(v) =>
                  patchWidget('calendar', { weekStartsMonday: v === 'mon' })
                }
                ariaLabel="First day of the week"
              />
            </div>
          )}
          {selected === 'countdown' && (
            <>
              <div className="set-row">
                <span>Date</span>
                <input
                  type="date"
                  value={widgets.countdown.date}
                  placeholder="YYYY-MM-DD"
                  onChange={(e) => patchWidget('countdown', { date: e.target.value })}
                  aria-label="Date to count down to"
                />
              </div>
              <div className="set-row">
                <span>Label</span>
                <input
                  type="text"
                  value={widgets.countdown.label}
                  maxLength={60}
                  placeholder="Summer trip"
                  onChange={(e) => patchWidget('countdown', { label: e.target.value })}
                  aria-label="What the countdown is for"
                />
              </div>
            </>
          )}
          {selected === 'note' && (
            <textarea
              className="widget-note-input"
              value={widgets.note.text}
              maxLength={280}
              rows={3}
              placeholder="A quote, a reminder, anything"
              onChange={(e) => patchWidget('note', { text: e.target.value })}
              aria-label="Note text"
            />
          )}

          <PlacementRows
            p={current}
            size={meta.size}
            onChange={(p) => patchPlacement(selected, p)}
          />
          {selected === 'weather' && (
            <p className="widget-credit">Weather data by Open-Meteo.com (CC BY 4.0)</p>
          )}
        </section>
      </div>
    </div>
  );
}

function tileSummary(id: WidgetId, clock: LiveClock, widgets: LiveWidgets): string {
  switch (id) {
    case 'clock':
      return formatClock(new Date(), clock).time;
    case 'weather':
      return widgets.weather.location.split(',')[0] || 'No location yet';
    case 'calendar':
      return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date());
    case 'countdown': {
      const c = formatCountdown(daysUntil(new Date(), widgets.countdown.date), '');
      return c.unit ? `${c.value} ${c.unit}` : c.value === '–' ? 'No date yet' : c.value;
    }
    case 'note':
      return widgets.note.text.trim() || 'Empty';
  }
}

function PlacementRows({
  p,
  size,
  onChange,
}: {
  p: Placement;
  size: WidgetMeta['size'];
  onChange: (p: Partial<Placement>) => void;
}) {
  return (
    <>
      <div className="set-row">
        <span>Anchor</span>
        <OptionScroller
          options={ANCHOR_OPTIONS}
          value={p.position}
          onChange={(v) => onChange({ position: v, ...anchorDefaults(v) })}
          ariaLabel="Which corner of the widget is pinned"
        />
      </div>
      <div className="set-row set-row-slider">
        <span>Horizontal position</span>
        <ControlRow
          label="Horizontal position"
          value={Math.round(p.x)}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => onChange({ x: v })}
        />
      </div>
      <div className="set-row set-row-slider">
        <span>Vertical position</span>
        <ControlRow
          label="Vertical position"
          value={Math.round(p.y)}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => onChange({ y: v })}
        />
      </div>
      <div className="set-row set-row-slider">
        <span>Size</span>
        <ControlRow
          label="Size"
          value={p.size}
          min={size[0]}
          max={size[1]}
          step={size[2]}
          format={(v) => `${Number(v.toFixed(1))}%`}
          onChange={(v) => onChange({ size: v })}
        />
      </div>
    </>
  );
}

function ClockSettings({
  clock,
  patch,
}: {
  clock: LiveClock;
  patch: (p: Partial<LiveClock>) => void;
}) {
  return (
    <>
      <div className="set-row">
        <span>Time format</span>
        <OptionScroller
          options={FORMAT_OPTIONS}
          value={clock.hour12 ? '12' : '24'}
          onChange={(v) => patch({ hour12: v === '12' })}
          ariaLabel="Clock time format"
        />
      </div>
      <div className="set-row">
        <span>Show seconds</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={clock.showSeconds}
            onChange={(e) => patch({ showSeconds: e.target.checked })}
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
            onChange={(e) => patch({ showDate: e.target.checked })}
            aria-label="Show the date under the clock"
          />
          <span className="switch-track" />
        </label>
      </div>
    </>
  );
}

function WeatherSettings({
  widget,
  patch,
}: {
  widget: WeatherWidget;
  patch: (p: Partial<WeatherWidget>) => void;
}) {
  return (
    <>
      <LocationSearch
        location={widget.location}
        onPick={(pl) =>
          patch({ location: pl.label, latitude: pl.latitude, longitude: pl.longitude })
        }
      />
      <div className="set-row">
        <span>Units</span>
        <OptionScroller
          options={UNIT_OPTIONS}
          value={widget.unit}
          onChange={(v) => patch({ unit: v })}
          ariaLabel="Temperature unit"
        />
      </div>
      <div className="set-row">
        <span>Three-day forecast</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={widget.showForecast}
            onChange={(e) => patch({ showForecast: e.target.checked })}
            aria-label="Show the next three days"
          />
          <span className="switch-track" />
        </label>
      </div>
    </>
  );
}

// City search against Open-Meteo's geocoder, debounced while typing. Picking
// a result stores its label + coordinates; the field then shows the label.
function LocationSearch({
  location,
  onPick,
}: {
  location: string;
  onPick: (p: Place) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'none' | 'error'>('idle');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setStatus('searching');
      searchPlaces(q, ctrl.signal).then(
        (r) => {
          setResults(r);
          setStatus(r.length ? 'idle' : 'none');
        },
        (e: unknown) => {
          if ((e as Error)?.name !== 'AbortError') setStatus('error');
        },
      );
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const pick = (p: Place) => {
    onPick(p);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="widget-location">
      <div className="set-row">
        <span>Location</span>
        <input
          type="text"
          value={query}
          placeholder={location ? 'Search to change' : 'Search for a city'}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search for a city"
          spellCheck={false}
        />
      </div>
      {location && !query && <div className="widget-location-current">{location}</div>}
      {status === 'searching' && <div className="widget-location-status">Searching…</div>}
      {status === 'none' && (
        <div className="widget-location-status">No place by that name</div>
      )}
      {status === 'error' && (
        <div className="widget-location-status">
          Couldn't reach Open-Meteo. Check the connection.
        </div>
      )}
      {results.length > 0 && (
        <div
          className="widget-location-results"
          role="listbox"
          aria-label="Matching places"
        >
          {results.map((r) => (
            <button
              key={`${r.latitude},${r.longitude}`}
              type="button"
              role="option"
              aria-selected={false}
              className="widget-location-result"
              onClick={() => pick(r)}
            >
              <span>{r.name}</span>
              {r.detail && <span className="widget-location-detail">{r.detail}</span>}
            </button>
          ))}
        </div>
      )}
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
