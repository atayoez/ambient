// Main app shell — custom titlebar with sliding-pill tabs, content area
// switches between the five tabs. Sample library entries provide content
// for the Library tab on first render.

const TABS = [
  { id: 'patterns', label: 'Patterns' },
  { id: 'sources',  label: 'Sources' },
  { id: 'library',  label: 'Library' },
  { id: 'generate', label: 'Generate' },
  { id: 'settings', label: 'Settings' },
];

const INITIAL_SETTINGS = {
  source: 'nasa-apod',
  nasaApiKey: '',
  unsplashKey: '',
  pexelsKey: '',
  unsplashTopic: 'nature',
  pexelsQuery: 'mountains',
  genProvider: 'pollinations',
  pollinationsModel: 'flux',
  genResolution: 'auto',
  openaiKey: '',
  openaiModel: 'dall-e-3',
  rotationEnabled: false,
  rotationIntervalMinutes: 60,
};

const SAMPLE_LIBRARY = [
  { id: 1, title: 'Mesh gradient (5 colors)', source: 'generated', type: 'mesh',      colors: window.PRESET_PALETTES.Cosmic,  seed: 41, size: 80, density: 40, randomness: 0.5 },
  { id: 2, title: 'NASA APOD — Andromeda',   source: 'nasa-apod', type: 'mesh',      colors: window.PRESET_PALETTES.Sunset,  seed: 7,  size: 80, density: 40, randomness: 0.5 },
  { id: 3, title: 'Geometric (5 colors)',     source: 'generated', type: 'geometric', colors: window.PRESET_PALETTES.Vibrant, seed: 22, size: 60, density: 80, randomness: 0.4 },
  { id: 4, title: 'Stripes',                  source: 'generated', type: 'stripes',   colors: window.PRESET_PALETTES.Pastel,  seed: 19, size: 50, density: 40, randomness: 0.6 },
  { id: 5, title: 'Unsplash · mountains',     source: 'unsplash',  type: 'mesh',      colors: window.PRESET_PALETTES.Forest,  seed: 51, size: 80, density: 40, randomness: 0.5 },
  { id: 6, title: 'Emoji — cosmic',           source: 'generated', type: 'emoji',     colors: ['#0c0a1f'], emojis: window.DEFAULT_EMOJIS, seed: 9, size: 36, density: 40, randomness: 0.4 },
];

function App() {
  const [tab, setTab] = React.useState('patterns');
  const [library, setLibrary] = React.useState(SAMPLE_LIBRARY);
  const [settings, setSettings] = React.useState(INITIAL_SETTINGS);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [applyingStatus, setApplyingStatus] = React.useState(null);
  const [toast, setToast] = React.useState(null);

  function updateSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  }

  function onApply(entry) {
    const next = { id: Date.now(), addedAt: Date.now(), ...entry };
    setLibrary((lib) => [next, ...lib]);
    setToast('Saved');
    setTimeout(() => setToast(null), 1400);
  }

  async function applyExisting(w) {
    setApplyingStatus('Setting wallpaper…');
    await new Promise((r) => setTimeout(r, 400));
    setApplyingStatus('Applied');
    setToast('Saved');
    setTimeout(() => setToast(null), 1400);
    setTimeout(() => setApplyingStatus(null), 1000);
  }

  function removeFromLibrary(w) {
    setLibrary((lib) => lib.filter((x) => x.id !== w.id));
  }

  const activeTabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="app" data-screen-label={`Ambient · ${TABS[activeTabIndex].label}`}>
      <header className="titlebar">
        <nav className="tabs" style={{ '--active-tab': String(activeTabIndex) }}>
          <div className="tab-indicator" />
          {TABS.map(({ id, label }) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="window-controls">
          <button aria-label="Minimize" className="wc"><window.IconMin /></button>
          <button aria-label="Toggle maximize" className="wc"><window.IconMax /></button>
          <button aria-label="Close" className="wc close"><window.IconClose /></button>
        </div>
      </header>
      <main className="content">
        {tab === 'patterns' && <window.Patterns onApply={onApply} />}
        {tab === 'sources'  && <window.Sources  settings={settings} onUpdate={updateSettings} onApply={onApply} />}
        {tab === 'library'  && <window.Library  library={library} onApply={applyExisting} onDelete={removeFromLibrary} applyingStatus={applyingStatus} />}
        {tab === 'generate' && <window.Generate settings={settings} onUpdate={updateSettings} onApply={onApply} />}
        {tab === 'settings' && <window.Settings settings={settings} onUpdate={updateSettings} saved={savedFlash} />}
      </main>
      {toast && <div className="save-toast">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
