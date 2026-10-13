import { useEffect, useState } from 'react';
import type {
  CalendarWidget,
  CountdownWidget,
  LiveClock,
  NoteWidget,
  WeatherWidget,
} from '../../lib/types';
import {
  fetchWeather,
  formatTemp,
  WEATHER_REFRESH_MS,
  type Weather,
  weatherKind,
  weatherLabel,
} from '../../lib/weather';
import {
  calendarMonth,
  daysUntil,
  formatClock,
  formatCountdown,
} from '../../lib/widgets';
import WeatherIcon from './WeatherIcon';

// The content of each widget. WidgetLayer places them; every size in here
// is in em of the widget's headline size (the box's font-size), so a face
// scales as one piece on a 4K output and in the preview pane alike.

/** The current time, re-rendered on each `periodMs` boundary (not drifting behind it). */
export function useNow(periodMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        periodMs - (Date.now() % periodMs) + 10,
      );
    };
    setNow(new Date());
    schedule();
    return () => clearTimeout(timer);
  }, [periodMs]);
  return now;
}

export function ClockFace({ clock }: { clock: LiveClock }) {
  const now = useNow(clock.showSeconds ? 1000 : 60_000);
  const { time, date } = formatClock(now, clock);
  return (
    <>
      <div className="wclock-time">{time}</div>
      {date && <div className="wclock-date">{date}</div>}
    </>
  );
}

type WeatherState =
  | { status: 'idle' }
  | { status: 'ok'; weather: Weather }
  | { status: 'error'; weather?: Weather };

function useWeather(w: WeatherWidget): WeatherState {
  const [state, setState] = useState<WeatherState>({ status: 'idle' });
  const has = w.location.trim() !== '';
  const { latitude, longitude, unit } = w;
  useEffect(() => {
    if (!has) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchWeather(latitude, longitude, unit).then(
        (weather) => !cancelled && setState({ status: 'ok', weather }),
        // Keep showing the last good reading through a failed refresh.
        () =>
          !cancelled &&
          setState((s) => ({
            status: 'error',
            weather: s.status === 'idle' ? undefined : s.weather,
          })),
      );
    setState({ status: 'idle' });
    void load();
    const t = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [has, latitude, longitude, unit]);
  return state;
}

const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

export function WeatherFace({ widget }: { widget: WeatherWidget }) {
  const state = useWeather(widget);
  const place = widget.location.split(',')[0].trim();
  const weather = state.status === 'idle' ? undefined : state.weather;

  if (!widget.location.trim()) {
    return <div className="wweather-msg">Set a location for the weather</div>;
  }
  if (!weather) {
    return (
      <div className="wweather-msg">
        {state.status === 'error' ? `Weather unavailable · ${place}` : place}
      </div>
    );
  }
  const today = weather.daily[0];
  return (
    <>
      <div className="wweather-now">
        <WeatherIcon
          kind={weatherKind(weather.code, weather.isDay)}
          className="wweather-icon"
        />
        <span className="wweather-temp">{formatTemp(weather.temperature)}</span>
      </div>
      <div className="wweather-line">
        {weatherLabel(weather.code)} · {place}
      </div>
      {today && (
        <div className="wweather-sub">
          H {formatTemp(today.max)} L {formatTemp(today.min)} · Feels{' '}
          {formatTemp(weather.apparent)}
        </div>
      )}
      {widget.showForecast && weather.daily.length > 1 && (
        <div className="wweather-days">
          {weather.daily.slice(1, 4).map((d) => (
            <div key={d.date} className="wweather-day">
              <span>{shortDay.format(new Date(`${d.date}T12:00:00`))}</span>
              <WeatherIcon kind={weatherKind(d.code)} className="wweather-day-icon" />
              <span>
                {formatTemp(d.max)}
                <span className="wweather-min"> {formatTemp(d.min)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function CalendarFace({ widget }: { widget: CalendarWidget }) {
  const now = useNow(60_000);
  const m = calendarMonth(now, widget.weekStartsMonday);
  return (
    <>
      <div className="wcal-title">{m.title}</div>
      <div className="wcal-grid">
        {m.weekdays.map((d, i) => (
          <span key={`h${i}`} className="wcal-head">
            {d}
          </span>
        ))}
        {m.cells.map((d, i) => (
          <span key={i} className={d === m.today ? 'wcal-day wcal-today' : 'wcal-day'}>
            {d ?? ''}
          </span>
        ))}
      </div>
    </>
  );
}

export function CountdownFace({ widget }: { widget: CountdownWidget }) {
  const now = useNow(60_000);
  const c = formatCountdown(daysUntil(now, widget.date), widget.label);
  return (
    <>
      <div className="wcount-value">
        {c.value}
        {c.unit && <span className="wcount-unit"> {c.unit}</span>}
      </div>
      {c.caption && <div className="wcount-caption">{c.caption}</div>}
    </>
  );
}

export function NoteFace({ widget }: { widget: NoteWidget }) {
  const text = widget.text.trim();
  return (
    <div className={text ? 'wnote' : 'wnote wnote-empty'}>{text || 'Write a note'}</div>
  );
}
