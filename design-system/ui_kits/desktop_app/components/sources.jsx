// Sources tab — pick a source, preview, apply. The preview is faked using
// the canvas engine because we can't actually hit NASA/Unsplash/Pexels.

function Sources({ settings, onUpdate, onApply }) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(null);
  const [seed, setSeed] = React.useState(1);
  const canvasRef = React.useRef(null);

  const previewCfgFor = (src) => {
    if (src === 'nasa-apod') return { type: 'mesh', colors: window.PRESET_PALETTES.Cosmic, seed };
    if (src === 'unsplash') return { type: 'mesh', colors: window.PRESET_PALETTES.Forest, seed };
    return { type: 'mesh', colors: window.PRESET_PALETTES.Ocean, seed };
  };

  React.useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width = c.offsetWidth * 2;
    const h = c.height = c.offsetHeight * 2;
    window.renderPattern(ctx, w, h, { ...previewCfgFor(settings.source), density: 40, size: 80, randomness: 0.5 });
  }, [settings.source, seed]);

  function update(p) { onUpdate(p); }

  async function refetch() {
    setBusy(true); setStatus('Fetching from source…');
    await new Promise((r) => setTimeout(r, 400));
    setStatus('Downloading…');
    await new Promise((r) => setTimeout(r, 320));
    setSeed((s) => s + 1);
    setStatus('Preview ready');
    setTimeout(() => { setStatus(null); setBusy(false); }, 900);
  }

  async function apply() {
    setBusy(true); setStatus('Setting wallpaper…');
    await new Promise((r) => setTimeout(r, 500));
    onApply({
      title: settings.source === 'nasa-apod' ? 'NASA Astronomy Picture of the Day' :
             settings.source === 'unsplash' ? `Unsplash · ${settings.unsplashTopic || 'nature'}` :
             `Pexels · ${settings.pexelsQuery || 'mountains'}`,
      source: settings.source,
      type: previewCfgFor(settings.source).type,
      colors: previewCfgFor(settings.source).colors,
      seed,
    });
    setStatus('Applied — added to Library');
    setTimeout(() => { setStatus(null); setBusy(false); }, 1500);
  }

  const canFetch = settings.source === 'nasa-apod' ||
    (settings.source === 'unsplash' && settings.unsplashKey.trim()) ||
    (settings.source === 'pexels' && settings.pexelsKey.trim());

  return (
    <div className="settings">
      <header className="settings-header">
        <h1>Sources</h1>
      </header>

      <canvas ref={canvasRef} className="source-preview" />

      <section>
        <h2>Source</h2>
        <select value={settings.source} onChange={(e) => update({ source: e.target.value })}>
          <option value="nasa-apod">NASA APOD (free, no key, one image per day)</option>
          <option value="unsplash">Unsplash</option>
          <option value="pexels">Pexels</option>
        </select>
        <p className="muted">
          NASA Astronomy Picture of the Day needs no key but only gives ~1 image / day —
          we cache it so the preview is instant after the first fetch. Unsplash and
          Pexels need a free API key in exchange for endless search-driven variety.
        </p>
      </section>

      {settings.source === 'nasa-apod' && (
        <section>
          <h2>NASA (optional)</h2>
          <label>
            API key
            <input type="password" value={settings.nasaApiKey} onChange={(e) => update({ nasaApiKey: e.target.value })}
              placeholder="leave blank to use shared DEMO_KEY" />
          </label>
          <p className="muted">
            Optional. Without one, Ambient falls back to NASA's shared <code>DEMO_KEY</code> —
            usually fine for normal use, but it's rate-limited to 30 requests/hour and 50/day
            across the whole internet.
          </p>
        </section>
      )}

      {settings.source === 'unsplash' && (
        <section>
          <h2>Unsplash</h2>
          <label>Access key
            <input type="password" value={settings.unsplashKey} onChange={(e) => update({ unsplashKey: e.target.value })}
              placeholder="get one at unsplash.com/developers" />
          </label>
          <label>Topic / search query
            <input value={settings.unsplashTopic} onChange={(e) => update({ unsplashTopic: e.target.value })} placeholder="nature" />
          </label>
        </section>
      )}

      {settings.source === 'pexels' && (
        <section>
          <h2>Pexels</h2>
          <label>API key
            <input type="password" value={settings.pexelsKey} onChange={(e) => update({ pexelsKey: e.target.value })}
              placeholder="get one at pexels.com/api" />
          </label>
          <label>Search query
            <input value={settings.pexelsQuery} onChange={(e) => update({ pexelsQuery: e.target.value })} placeholder="mountains" />
          </label>
        </section>
      )}

      <div className="row">
        <button onClick={refetch} disabled={busy || !canFetch}>↻ Re-fetch</button>
        <button onClick={apply} disabled={busy || !canFetch} className="primary">
          {busy ? 'Working…' : 'Apply as wallpaper'}
        </button>
        {status && <span className="status">{status}</span>}
      </div>
    </div>
  );
}

window.Sources = Sources;
