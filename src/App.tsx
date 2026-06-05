import { listen as listenTauri } from '@tauri-apps/api/event';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Generate from './components/Generate';
import {
  GearIcon,
  ImageIcon,
  LayoutGridIcon,
  PaletteIcon,
  WandIcon,
} from './components/Icons';
import Library from './components/Library';
import LicenseGate from './components/LicenseGate';
import Patterns from './components/Patterns';
import Settings from './components/Settings';
import Sources from './components/Sources';
import UpdateBanner from './components/UpdateBanner';
import {
  useLicenseGate,
  useTabKeybindings,
  useTrayThemeSync,
  useUpdateBanner,
} from './lib/appHooks';
import { dispatch } from './lib/events';
import { usePersistedState } from './lib/hooks';
import type { Wallpaper } from './lib/types';

type Tab = 'patterns' | 'sources' | 'library' | 'generate' | 'settings';

// Tabs display an SVG icon (rendered big) in the bottom pill. `label`
// stays as the accessible name + the tooltip text; the icon is the
// visual surface inside the pill.
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'patterns', label: 'Patterns', icon: <PaletteIcon size={24} /> },
  { id: 'sources', label: 'Sources', icon: <ImageIcon size={24} /> },
  { id: 'generate', label: 'Generate', icon: <WandIcon size={24} /> },
  { id: 'library', label: 'Library', icon: <LayoutGridIcon size={24} /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon size={24} /> },
];
const TAB_IDS = TABS.map((t) => t.id) as readonly Tab[];

export default function App() {
  // Active tab is persisted so reopening the window lands the user on
  // the same tab they were last on (closing-to-tray and reopening
  // counts as "reopening" — the webview is destroyed on hide and
  // rebuilt on tray-click, so without persistence every reopen would
  // snap back to Patterns).
  const [tab, setTab] = usePersistedState<Tab>('app.tab', 'patterns');

  // Tabs are mounted lazily on first visit and stay mounted thereafter
  // (toggling display:contents → none on switch). This preserves
  // useDraftState across switches — slider tweaks in Patterns survive
  // a hop to Library without the Apply commit. Tradeoff: each tab's
  // useEffects fire once on first visit, then run permanently.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, [tab]);

  // Rust → typed-bus bridge. Rust modules emit Tauri events on every
  // state-changing operation (settings.patch, library_store.patch,
  // desktop::apply_wallpaper, rotation::tick); this effect forwards
  // them onto the in-process typed bus so every consumer (Library,
  // RotationControl, Sources, etc.) stays uniform regardless of where
  // the originating mutation came from (JS invoke vs background task).
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    void (async () => {
      unlistens.push(
        await listenTauri('settings-changed', () => {
          dispatch('settings-changed');
        }),
      );
      unlistens.push(
        await listenTauri<Wallpaper[]>('library-changed', (event) => {
          dispatch('library-changed', event.payload);
        }),
      );
      unlistens.push(
        await listenTauri<Wallpaper>('wallpaper-rotated', (event) => {
          dispatch('wallpaper-rotated', event.payload);
        }),
      );
      unlistens.push(
        await listenTauri<string>('wallpaper-applied', (event) => {
          dispatch('wallpaper-applied', event.payload);
        }),
      );
    })();
    return () => {
      for (const u of unlistens) u();
    };
  }, []);

  // Cross-cutting app concerns. Each hook owns one effect; App.tsx
  // stays declarative.
  const { license, licenseLoaded, revokedMsg, onActivated } = useLicenseGate();
  const { updateInfo, dismiss: dismissUpdate } = useUpdateBanner(license);
  // OS-accent chrome tinting intentionally removed: the app is fully
  // achromatic liquid glass now (colour comes from the preview behind the
  // glass, never the system accent). The System palette preset still
  // reads the accent via useSystemAccentColor — that's wallpaper content,
  // not chrome.
  useTrayThemeSync();
  useTabKeybindings<Tab>(TAB_IDS, setTab);

  const activeTabIndex = TABS.findIndex((t) => t.id === tab);

  // Dynamic tab-pill sizing. The indicator's width and x-offset are
  // measured from the active tab's offsetLeft / offsetWidth, so emoji
  // glyphs (or future localizations) slot in cleanly. Re-measures on
  // active-tab change and on window resize.
  const tabsContainerRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tabsInitialized, setTabsInitialized] = useState(false);
  useLayoutEffect(() => {
    function measure() {
      const container = tabsContainerRef.current;
      const active = tabRefs.current[activeTabIndex];
      if (!container || !active) return;
      container.style.setProperty('--ind-x', `${active.offsetLeft}px`);
      container.style.setProperty('--ind-w', `${active.offsetWidth}px`);
    }
    measure();
    setTabsInitialized(true);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTabIndex]);

  return (
    <div className="app">
      <main className="content">
        {!licenseLoaded ? (
          // Briefly empty while loadLicense() finishes — usually a
          // single frame on warm disk cache.
          <div className="splash" />
        ) : !license ? (
          <LicenseGate revokedMessage={revokedMsg} onActivated={onActivated} />
        ) : (
          <>
            {updateInfo && <UpdateBanner info={updateInfo} onDismiss={dismissUpdate} />}
            {TABS.map((t) => {
              // Lazy on first visit, sticky after — preserves draft
              // state across tab switches. display:contents makes the
              // wrapper transparent to flex layout so each tab's CSS
              // (.patterns/.sources/.library/.generate) keeps owning
              // its own flex/scroll geometry.
              if (!visited.has(t.id)) return null;
              return (
                <div
                  key={t.id}
                  style={tab === t.id ? { display: 'contents' } : { display: 'none' }}
                >
                  <ErrorBoundary>
                    {t.id === 'patterns' && <Patterns />}
                    {t.id === 'sources' && <Sources />}
                    {t.id === 'generate' && <Generate />}
                    {t.id === 'library' && <Library />}
                    {t.id === 'settings' && <Settings />}
                  </ErrorBoundary>
                </div>
              );
            })}
          </>
        )}
      </main>
      {license && (
        // Floating tab bar — Liquid-Glass-style pill anchored at the
        // bottom-center of the window. Outside <main> so it doesn't
        // participate in tab-content scroll, and gated on `license` so the
        // gate screen isn't littered with non-functional nav.
        <nav
          className={tabsInitialized ? 'tabs initialized' : 'tabs'}
          ref={tabsContainerRef}
        >
          <div className="tab-indicator" />
          {TABS.map(({ id, label, icon }, idx) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
              aria-label={label}
              title={label}
            >
              <span aria-hidden="true">{icon}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
