import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Library from './components/Library';
import Patterns from './components/Patterns';
import Sources from './components/Sources';
import Generate from './components/Generate';
import SettingsView from './components/Settings';

type Tab = 'patterns' | 'sources' | 'library' | 'generate' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'patterns', label: 'Patterns' },
  { id: 'sources', label: 'Sources' },
  { id: 'library', label: 'Library' },
  { id: 'generate', label: 'Generate' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('patterns');

  useEffect(() => {
    const unsub = listen('rotate-now', () => setTab('sources'));
    return () => {
      unsub.then((fn) => fn()).catch(() => {});
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
  async function toggleMaximize() {
    await getCurrentWindow().toggleMaximize();
  }
  async function closeWindow() {
    // We want hide-to-tray, not actual quit. Calling .hide() directly skips
    // the CloseRequested → prevent_close round-trip and works with the
    // allow-hide capability we already have. (close() would need an extra
    // allow-close permission, but the end state is the same anyway.)
    await getCurrentWindow().hide();
  }

  const activeTabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="app">
      <header className="titlebar" onMouseDown={onTitlebarMouseDown}>
        <nav
          className="tabs"
          style={{ ['--active-tab' as string]: String(activeTabIndex) } as React.CSSProperties}
        >
          <div className="tab-indicator" />
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="window-controls">
          <button onClick={minimize} aria-label="Minimize" className="wc">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={toggleMaximize} aria-label="Toggle maximize" className="wc">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" rx="0.5" />
            </svg>
          </button>
          <button onClick={closeWindow} aria-label="Close" className="wc close">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>
      <main className="content">
        {tab === 'patterns' && <Patterns />}
        {tab === 'sources' && <Sources />}
        {tab === 'library' && <Library />}
        {tab === 'generate' && <Generate />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
