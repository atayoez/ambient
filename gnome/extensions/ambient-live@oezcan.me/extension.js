// Ambient Live Wallpaper: the GNOME Shell half of Ambient's live wallpapers.
//
// GNOME doesn't offer wlr-layer-shell, so a Wayland client can't put a
// surface on the desktop layer by itself. The Ambient app creates an
// ordinary borderless window per monitor (live_gnome.rs), titled
// `ambient-live-wallpaper@x,y,w,h` with that monitor's logical geometry, and
// this extension turns each one into a wallpaper from inside the compositor:
//
// * GNOME 49+ (Mutter 17+): `set_type(DESKTOP)` puts the window on Mutter's
//   desktop layer (under every normal window, not focusable, not in the
//   overview / Alt+Tab / dash) and `hide_from_window_list()` makes sure.
//   This is the same desktop-window mechanism Desktop Icons NG uses.
// * GNOME 45-48 have no public API for that, so the window is kept at the
//   bottom of the stack instead (lower() on every raise) and the overview,
//   workspace thumbnails and Alt+Tab are patched to skip it.
//
// Either way the window is stuck to every workspace and sized to its
// monitor, and re-fitted whenever the monitor layout changes. The app sets an
// empty input region on the window, so clicks fall through to the shell's
// own background (right-click menu etc.).
//
// Feature-detected, not version-checked: `Meta.Window.set_type` is what
// decides the path.

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Mtk from 'gi://Mtk';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

// Must match TITLE_PREFIX in src-tauri/src/live_gnome.rs.
const TITLE_PREFIX = 'ambient-live-wallpaper';

/** The monitor rectangle the app asked for, from the window title. */
function parseHint(title) {
    const m = /@(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(title ?? '');
    if (!m)
        return null;
    return new Mtk.Rectangle({
        x: Number(m[1]),
        y: Number(m[2]),
        width: Number(m[3]),
        height: Number(m[4]),
    });
}

function isWallpaperTitle(title) {
    return typeof title === 'string' && title.startsWith(TITLE_PREFIX);
}

export default class AmbientLiveExtension extends Extension {
    enable() {
        // MetaWindow -> { ids: signal ids, monitor: target monitor index }
        this._tracked = new Map();
        // Untitled windows waiting for their first title: MetaWindow -> ids
        this._pending = new Map();
        this._relayoutId = 0;
        this._desktopType = typeof Meta.Window.prototype.set_type === 'function';

        if (!this._desktopType)
            this._patchShell();

        this._windowCreatedId = global.display.connect('window-created',
            (_display, win) => this._consider(win));
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
            () => this._queueRelayout());

        // Windows that already exist: the app was running before the
        // extension was enabled (or the screen was unlocked).
        for (const actor of global.get_window_actors())
            this._consider(actor.meta_window);
    }

    disable() {
        global.display.disconnect(this._windowCreatedId);
        Main.layoutManager.disconnect(this._monitorsChangedId);
        if (this._relayoutId) {
            GLib.source_remove(this._relayoutId);
            this._relayoutId = 0;
        }
        for (const [win, ids] of this._pending)
            ids.forEach(id => win.disconnect(id));
        this._pending.clear();

        // Hide the wallpaper windows rather than leave them behind as
        // ordinary windows: a later enable() picks them up again.
        for (const [win, entry] of this._tracked) {
            entry.ids.forEach(id => win.disconnect(id));
            win.minimize();
        }
        this._tracked.clear();

        this._unpatchShell();
    }

    _consider(win) {
        if (!win || this._tracked.has(win) || this._pending.has(win))
            return;
        if (win.get_client_type() !== Meta.WindowClientType.WAYLAND)
            return;

        const title = win.get_title();
        if (title) {
            if (isWallpaperTitle(title))
                this._adopt(win);
            return;
        }

        // GTK normally titles a window before it is mapped, but don't
        // depend on it: wait for the first title.
        const ids = [];
        const stopWaiting = () => {
            ids.forEach(id => win.disconnect(id));
            this._pending.delete(win);
        };
        ids.push(win.connect('notify::title', () => {
            const t = win.get_title();
            if (!t)
                return;
            stopWaiting();
            if (isWallpaperTitle(t))
                this._adopt(win);
        }));
        ids.push(win.connect('unmanaged', stopWaiting));
        this._pending.set(win, ids);
    }

    _adopt(win) {
        if (this._desktopType) {
            win.set_type(Meta.WindowType.DESKTOP);
            win.hide_from_window_list();
        } else {
            win.lower();
        }
        win.stick();
        if (win.minimized)
            win.unminimize();

        const ids = [
            win.connect('unmanaged', () => this._forget(win)),
            // A Wayland window's first map is when its size actually takes;
            // fit it again then in case the first request raced the map.
            win.connect('shown', () => this._place(win)),
        ];
        if (!this._desktopType)
            ids.push(win.connect('raised', () => win.lower()));

        const hint = parseHint(win.get_title());
        const monitor = hint
            ? global.display.get_monitor_index_for_rect(hint)
            : win.get_monitor();
        this._tracked.set(win, {ids, monitor});
        this._place(win);
    }

    _forget(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;
        entry.ids.forEach(id => win.disconnect(id));
        this._tracked.delete(win);
    }

    /** Size and move `win` to exactly cover its monitor. */
    _place(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;
        const n = global.display.get_n_monitors();
        let monitor = entry.monitor;
        if (monitor < 0 || monitor >= n)
            monitor = win.get_monitor();
        if (monitor < 0 || monitor >= n)
            monitor = global.display.get_primary_monitor();
        entry.monitor = monitor;

        const geo = global.display.get_monitor_geometry(monitor);
        const rect = win.get_frame_rect();
        if (rect.x === geo.x && rect.y === geo.y &&
            rect.width === geo.width && rect.height === geo.height)
            return;
        win.move_resize_frame(false, geo.x, geo.y, geo.width, geo.height);
    }

    /**
     * Monitors were added, removed or resized. Each window stays with the
     * monitor it overlaps most and is re-fitted to it; the app adds a window
     * for a new monitor and drops the one of a removed monitor itself.
     */
    _queueRelayout() {
        if (this._relayoutId)
            return;
        this._relayoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._relayoutId = 0;
            for (const [win, entry] of this._tracked) {
                entry.monitor = global.display.get_monitor_index_for_rect(win.get_frame_rect());
                this._place(win);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // GNOME 45-48 only: keep the (normal-type) wallpaper windows out of the
    // overview, the workspace thumbnails and Alt+Tab. Both switchers (apps
    // and windows) build their lists from Meta.Display.get_tab_list().
    _patchShell() {
        const tracked = win => this._tracked.has(win?.meta_window ?? win);
        this._patches = [];
        const patch = (proto, name, wrap) => {
            const orig = proto?.[name];
            if (typeof orig !== 'function')
                return;
            proto[name] = wrap(orig);
            this._patches.push([proto, name, orig]);
        };

        patch(Workspace.Workspace?.prototype, '_isOverviewWindow', orig =>
            function (win) {
                return tracked(win) ? false : orig.call(this, win);
            });
        patch(WorkspaceThumbnail.WorkspaceThumbnail?.prototype, '_isOverviewWindow', orig =>
            function (win) {
                return tracked(win) ? false : orig.call(this, win);
            });
        patch(Meta.Display.prototype, 'get_tab_list', orig =>
            function (...args) {
                return orig.apply(this, args).filter(w => !tracked(w));
            });
    }

    _unpatchShell() {
        for (const [proto, name, orig] of this._patches ?? [])
            proto[name] = orig;
        this._patches = [];
    }
}
