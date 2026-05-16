import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Generate from './components/Generate';
import Library from './components/Library';
import LicenseGate from './components/LicenseGate';
import Patterns from './components/Patterns';
import Sources from './components/Sources';
import UpdateBanner from './components/UpdateBanner';
import { type LicenseInfo, loadLicense, validateLicense } from './lib/license';
import { rotateNow } from './lib/rotation';
import { loadSettings } from './lib/store';
import type { RotationSource } from './lib/types';
import { checkForUpdate, type UpdateInfo } from './lib/updater';

type Tab = 'patterns' | 'sources' | 'library' | 'generate';

const TABS: { id: Tab; label: string }[] = [
  { id: 'patterns', label: 'Patterns' },
  { id: 'sources', label: 'Sources' },
  { id: 'generate', label: 'Generate' },
  { id: 'library', label: 'Library' },
];

// Run a rotation and announce the result on the window. Sources.tsx
// listens for the announcement so its in-tab preview reflects the freshly
// applied wallpaper without needing a manual re-fetch. Failures are
// swallowed — the timer is silent and we don't want it nagging.
async function rotateAndAnnounce(): Promise<void> {
  try {
    const entry = await rotateNow();
    window.dispatchEvent(new CustomEvent('ambient-wallpaper-rotated', { detail: entry }));
  } catch {
    // Common causes: source API rate-limited, network offline, BYOK
    // missing. Sources tab will surface a fresh error on its next manual
    // re-fetch; we don't toast here so the background timer stays quiet.
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('patterns');

  // Tracks whether the window is maximized so .app can drop its rounded
  // corners, border, and drop-shadow to sit flush against the screen edges,
  // and so the titlebar's toggle-maximize button can swap to a restore icon.
  // Updated initially from Tauri, then on every Resized event.
  const [isMaximized, setIsMaximized] = useState(false);

  // Snapshot of the rotation-relevant settings. Loaded on mount and
  // refreshed when any tab dispatches 'ambient-settings-changed'. Kept
  // as a small slice (not the full Settings object) so the interval
  // effect only re-runs when these two values actually change.
  const [rotationCfg, setRotationCfg] = useState<{
    source: RotationSource;
    intervalMinutes: number;
  } | null>(null);

  // License gate: load the stored license, then validate in the
  // background. Until both checks finish we show a tiny splash so we
  // don't flash the gate to legitimate users with valid licenses.
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  const [revokedMsg, setRevokedMsg] = useState<string | undefined>(undefined);

  // Update check fires after the licence gate is cleared. Cheap HTTP
  // GET to /downloads/latest.json on the marketing site; throttled to
  // once every 6h via localStorage.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!license) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const info = await checkForUpdate(current);
        if (!cancelled && info) setUpdateInfo(info);
      } catch {
        // Update check is best-effort. Don't surface failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [license]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadLicense();
      if (cancelled) return;
      if (!stored) {
        setLicenseLoaded(true);
        return;
      }
      // Show the app immediately on the cached license; revalidate in
      // the background. If validation explicitly rejects, kick back to
      // the gate. Transient (network) failures are ignored — see
      // lib/license.ts for the policy.
      setLicense(stored);
      setLicenseLoaded(true);
      const result = await validateLicense(stored);
      if (cancelled) return;
      if (!result.valid && !result.transient) {
        setLicense(null);
        setRevokedMsg(result.message ?? 'Your license is no longer valid.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Load rotation config on mount, and re-load whenever Settings.tsx
    // saves a change. Without this the auto-rotate interval below would
    // be stuck on whatever values existed at app start.
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setRotationCfg({
        source: s.rotationSource,
        intervalMinutes: s.rotationIntervalMinutes,
      });
    }
    void reload();
    const onChange = () => void reload();
    window.addEventListener('ambient-settings-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ambient-settings-changed', onChange);
    };
  }, []);

  useEffect(() => {
    // Auto-rotate timer. Silent — no tab switch, so we don't yank the
    // user around mid-task. Failures swallowed; the next tick retries.
    // Re-runs whenever the source or interval changes, so toggling
    // rotation off and back on (or switching between Sources/Library
    // shuffle) restarts the countdown cleanly. rotateNow() itself
    // branches on rotationSource — we just have to fire the tick.
    if (!rotationCfg || rotationCfg.source === 'off') return;
    const ms = Math.max(1, rotationCfg.intervalMinutes) * 60 * 1000;
    const id = window.setInterval(() => {
      void rotateAndAnnounce();
    }, ms);
    return () => clearInterval(id);
  }, [rotationCfg?.source, rotationCfg?.intervalMinutes]);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let unlistenResized: (() => void) | null = null;
    (async () => {
      try {
        const initial = await win.isMaximized();
        if (cancelled) return;
        setIsMaximized(initial);
        // onResized fires for both user drag-resizes and OS-driven
        // maximize/restore. We re-check isMaximized rather than diffing
        // sizes because some WMs (KDE Wayland especially) report
        // tiled-edge as "maximized" — the Tauri API gives the canonical
        // answer.
        unlistenResized = await win.onResized(async () => {
          try {
            const max = await win.isMaximized();
            if (cancelled) return;
            setIsMaximized(max);
          } catch {}
        });
      } catch {
        // No window API available (running outside Tauri, e.g. plain
        // vite dev in a browser tab). Stay in the windowed default.
      }
    })();
    return () => {
      cancelled = true;
      if (unlistenResized) unlistenResized();
    };
  }, []);

  // Cmd/Ctrl + 1..5 jumps to that tab — Apple desktop staple. Single
  // listener that fans out by key rather than one hook per tab, so we
  // don't pull React's rules-of-hooks loop trap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > TABS.length) return;
      e.preventDefault();
      setTab(TABS[n - 1].id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Motion-responsive specular + parallax tilt + per-card hover spotlight.
  // Three things share one mousemove listener:
  //   1. window-level --mouse-x / --mouse-y on :root for the titlebar +
  //      save-toast specular highlights.
  //   2. --tilt-x / --tilt-y on :root for the subtle 3D tilt on inner
  //      glass surfaces (.tabs, .preview-wrap, .license-card).
  //   3. local --mouse-x / --mouse-y on whichever `.has-spotlight`
  //      ancestor the cursor is currently over — the CSS cascade lets
  //      that local pair shadow the :root one inside the card, so the
  //      hover glow anchors to card-local coords.
  // RAF-throttled, gated on the user's reduced-motion preference.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    function onMove(e: MouseEvent) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const root = document.documentElement;
        const x = e.clientX;
        const y = e.clientY;
        root.style.setProperty('--mouse-x', `${x}px`);
        root.style.setProperty('--mouse-y', `${y}px`);
        // Tilt: cursor offset from window center, normalized to [-1, 1],
        // then mapped to a max ~1.5deg rotation in each axis. Sign is
        // inverted on X so the tilt "leans away" from the cursor,
        // matching how a real plane catching light would behave.
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        root.style.setProperty('--tilt-x', `${-dy * 1.5}deg`);
        root.style.setProperty('--tilt-y', `${dx * 1.5}deg`);

        // Hover spotlight: find the closest .has-spotlight ancestor of
        // the cursor target and stamp its card-local cursor coords. The
        // CSS for .has-spotlight reads these locals (shadowing the :root
        // ones inside the card) to anchor the radial-gradient ::before
        // at the cursor.
        const target = e.target as HTMLElement | null;
        const spotEl = target?.closest('.has-spotlight') as HTMLElement | null;
        if (spotEl) {
          const rect = spotEl.getBoundingClientRect();
          spotEl.style.setProperty('--mouse-x', `${x - rect.left}px`);
          spotEl.style.setProperty('--mouse-y', `${y - rect.top}px`);
        }

        raf = 0;
      });
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  function onTitlebarMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    void getCurrentWindow().startDragging();
  }

  async function minimize() {
    await getCurrentWindow().minimize();
  }
  async function closeWindow() {
    // We want hide-to-tray, not actual quit. Calling .hide() directly skips
    // the CloseRequested → prevent_close round-trip and works with the
    // allow-hide capability we already have. (close() would need an extra
    // allow-close permission, but the end state is the same anyway.)
    await getCurrentWindow().hide();
  }

  const activeTabIndex = TABS.findIndex((t) => t.id === tab);

  // Dynamic tab-pill sizing. The indicator's width and x-offset are
  // measured from the active tab's offsetLeft / offsetWidth, so labels of
  // any length (or future localizations) slot in cleanly without a
  // hardcoded 88px assumption. Re-measures on active-tab change and on
  // window resize (font swaps + width changes both invalidate the layout).
  const tabsContainerRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => {
    function measure() {
      const container = tabsContainerRef.current;
      const active = tabRefs.current[activeTabIndex];
      if (!container || !active) return;
      container.style.setProperty('--ind-x', `${active.offsetLeft}px`);
      container.style.setProperty('--ind-w', `${active.offsetWidth}px`);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTabIndex]);

  return (
    <div className="app" data-maximized={isMaximized || undefined}>
      <header className="titlebar" onMouseDown={onTitlebarMouseDown}>
        <div className="titlebar-drag" />
        <div className="window-controls">
          <button onClick={minimize} aria-label="Minimize" className="wc">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line
                x1="2"
                y1="5"
                x2="8"
                y2="5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {/* Maximize button removed — the window is fixed at 1100×720
              and tauri.conf.json sets resizable + maximizable to false.
              isMaximized state tracking stays as defensive code in case
              a window manager force-fullscreens despite the hint, but
              there's no longer a user-facing toggle for it. */}
          <button onClick={closeWindow} aria-label="Close" className="wc close">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line
                x1="2.5"
                y1="2.5"
                x2="7.5"
                y2="7.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <line
                x1="7.5"
                y1="2.5"
                x2="2.5"
                y2="7.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>
      <main className="content">
        {!licenseLoaded ? (
          // Briefly empty while loadLicense() finishes — usually a
          // single frame on warm disk cache.
          <div className="splash" />
        ) : !license ? (
          <LicenseGate
            revokedMessage={revokedMsg}
            onActivated={(info) => {
              setLicense(info);
              setRevokedMsg(undefined);
            }}
          />
        ) : (
          <>
            {updateInfo && (
              <UpdateBanner info={updateInfo} onDismiss={() => setUpdateInfo(null)} />
            )}
            {/* key={tab} re-mounts on tab switch so a captured error in
                one tab doesn't persist across tabs. */}
            <ErrorBoundary key={tab}>
              {tab === 'patterns' && <Patterns />}
              {tab === 'sources' && <Sources />}
              {tab === 'library' && <Library />}
              {tab === 'generate' && <Generate />}
            </ErrorBoundary>
          </>
        )}
      </main>
      {license && (
        // Floating tab bar — Liquid-Glass-style pill anchored at the
        // bottom-center of the window. Outside <main> so it doesn't
        // participate in tab-content scroll, and gated on `license` so the
        // gate screen isn't littered with non-functional nav.
        <nav className="tabs" ref={tabsContainerRef}>
          <div className="tab-indicator" />
          {TABS.map(({ id, label }, idx) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
