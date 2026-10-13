import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { LiveClock, LiveWidgets } from '../../lib/types';
import {
  ANCHOR_ALIGN,
  ANCHOR_TRANSLATE,
  onLightBackground,
  type Placement,
  type WidgetId,
} from '../../lib/widgets';
import { CalendarFace, ClockFace, CountdownFace, NoteFace, WeatherFace } from './faces';

// Every live-wallpaper widget, drawn over whatever fills the positioned
// parent. One component serves the desktop-layer wallpaper window
// (LiveWallpaper), the Patterns preview and the Widgets tab stage, so the
// previews show exactly what the desktop will. The Plasma plugin draws a QML
// twin (plasma/.../contents/ui/Widgets.qml) from the same `clock` and
// `widgets` blocks of the spec.
//
// Placement is anchor + free position (see LiveClock in types.rs): a
// widget's `position` corner (or centre) is pinned at (`x`%, `y`%) of the
// stage, and its headline text height is `size`% of the stage's SHORTER
// side — measured here with a ResizeObserver so it comes out identical on a
// 4K output and in the preview pane.
//
// With `edit` set (the Widgets tab), widgets take the pointer: a press
// selects one and a drag moves it; arrow keys nudge the focused one.

export interface WidgetEdit {
  selected: WidgetId | null;
  onSelect: (id: WidgetId) => void;
  onMove: (id: WidgetId, x: number, y: number) => void;
}

const NAMES: Record<WidgetId, string> = {
  clock: 'clock',
  weather: 'weather',
  calendar: 'calendar',
  countdown: 'countdown',
  note: 'note',
};

const round1 = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

export default function WidgetLayer({
  clock,
  widgets,
  background,
  edit,
}: {
  clock?: LiveClock | null;
  widgets?: LiveWidgets | null;
  /** The pattern's base colour (colors[0]) — picks light vs dark text. */
  background?: string;
  edit?: WidgetEdit;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 1% of the stage's shorter side, in px. 0 until measured (nothing drawn).
  const [unit, setUnit] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setUnit(Math.min(el.clientWidth, el.clientHeight) / 100);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items: [WidgetId, Placement, ReactNode][] = [];
  if (widgets?.weather.enabled)
    items.push([
      'weather',
      widgets.weather,
      <WeatherFace key="weather" widget={widgets.weather} />,
    ]);
  if (widgets?.calendar.enabled)
    items.push([
      'calendar',
      widgets.calendar,
      <CalendarFace key="calendar" widget={widgets.calendar} />,
    ]);
  if (widgets?.countdown.enabled)
    items.push([
      'countdown',
      widgets.countdown,
      <CountdownFace key="countdown" widget={widgets.countdown} />,
    ]);
  // An empty note has nothing to show on the desktop; in the editor it
  // shows a placeholder so it can still be found and dragged.
  if (widgets?.note.enabled && (edit || widgets.note.text.trim()))
    items.push(['note', widgets.note, <NoteFace key="note" widget={widgets.note} />]);
  if (clock?.enabled)
    items.push(['clock', clock, <ClockFace key="clock" clock={clock} />]);

  const tone = onLightBackground(background) ? ' widget-layer--on-light' : '';
  const glass = widgets?.style === 'glass' ? ' widget-layer--glass' : '';

  return (
    <div
      ref={ref}
      className={`widget-layer${tone}${glass}${edit ? ' widget-layer--edit' : ''}`}
      aria-hidden={edit ? undefined : true}
    >
      {unit > 0 &&
        items.map(([id, p, face]) => (
          <WidgetBox key={id} id={id} p={p} unit={unit} edit={edit} layer={ref}>
            {face}
          </WidgetBox>
        ))}
    </div>
  );
}

function WidgetBox({
  id,
  p,
  unit,
  edit,
  layer,
  children,
}: {
  id: WidgetId;
  p: Placement;
  unit: number;
  edit?: WidgetEdit;
  layer: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const drag = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const style: CSSProperties = {
    left: `${p.x}%`,
    top: `${p.y}%`,
    translate: ANCHOR_TRANSLATE[p.position],
    ['--w-size' as string]: `${unit * p.size}px`,
  };
  const cls = `widget-box widget-${id} widget-box--align-${ANCHOR_ALIGN[p.position]}`;

  if (!edit) {
    return (
      <div className={cls} style={style}>
        {children}
      </div>
    );
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    edit.onSelect(id);
    const rect = layer.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      x: p.x,
      y: p.y,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    edit.onMove(
      id,
      round1(d.x + ((e.clientX - d.px) / d.w) * 100),
      round1(d.y + ((e.clientY - d.py) / d.h) * 100),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    edit.onSelect(id);
    edit.onMove(id, round1(p.x + m[0]), round1(p.y + m[1]));
  };

  return (
    <div
      className={`${cls} widget-box--editable${edit.selected === id ? ' is-selected' : ''}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`Move the ${NAMES[id]} widget`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onFocus={() => edit.onSelect(id)}
    >
      {children}
    </div>
  );
}
