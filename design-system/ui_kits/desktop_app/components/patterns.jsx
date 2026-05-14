// Patterns tab — high-fidelity recreation. Live canvas preview with the
// floating emoji-as-icon pattern tabs overlay; color chips; preset palette
// row; sliders; "Apply as wallpaper" primary action.

const PATTERN_INFO = [
  { id: 'mesh',      emoji: '🎨', name: 'Mesh gradient' },
  { id: 'geometric', emoji: '🔺', name: 'Geometric' },
  { id: 'dots',      emoji: '🔘', name: 'Dots' },
  { id: 'stripes',   emoji: '🦓', name: 'Stripes' },
  { id: 'emoji',     emoji: '😀', name: 'Emoji' },
];

function Patterns({ onApply }) {
  const [config, setConfig] = React.useState({
    type: 'mesh',
    colors: window.PRESET_PALETTES.Cosmic,
    density: 40,
    size: 80,
    randomness: 0.5,
    emojis: window.DEFAULT_EMOJIS,
    seed: Math.floor(Math.random() * 1_000_000),
  });
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(null);
  const [emojiImgs, setEmojiImgs] = React.useState([]);
  const canvasRef = React.useRef(null);

  // load emoji bitmaps when emoji-mode is active
  React.useEffect(() => {
    if (config.type !== 'emoji') return;
    let cancelled = false;
    Promise.all(config.emojis.map(window.loadEmojiImg)).then((imgs) => {
      if (!cancelled) setEmojiImgs(imgs.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [config.emojis, config.type]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    window.renderPattern(ctx, canvas.width, canvas.height, config, emojiImgs);
  }, [config, emojiImgs]);

  function patch(p) { setConfig((c) => ({ ...c, ...p })); }
  function reroll() { patch({ seed: Math.floor(Math.random() * 1_000_000) }); }
  function setColor(i, color) { patch({ colors: config.colors.map((x, idx) => idx === i ? color : x) }); }
  function addColor() { if (config.colors.length < 6) patch({ colors: [...config.colors, '#ffffff'] }); }
  function removeColor(i) { if (config.colors.length > 2) patch({ colors: config.colors.filter((_, idx) => idx !== i) }); }
  function applyPreset(name) { patch({ colors: [...window.PRESET_PALETTES[name]] }); }

  async function apply() {
    if (busy) return;
    setBusy(true);
    const steps = ['Reading screen size…', 'Rendering 1920×1080 at 2× for sharpness…', 'Encoding (lossless PNG)…', 'Saving…', 'Applying wallpaper…'];
    for (const s of steps) {
      setStatus(s);
      await new Promise((r) => setTimeout(r, 320));
    }
    setStatus('Applied');
    // Persist to fake library
    onApply?.({
      title: `${PATTERN_INFO.find(p => p.id === config.type)?.name} (${config.colors.length} colors)`,
      source: 'generated',
      colors: config.colors,
      type: config.type,
    });
    setTimeout(() => { setStatus(null); setBusy(false); }, 1400);
  }

  const activeIndex = PATTERN_INFO.findIndex((p) => p.id === config.type);

  return (
    <div className="patterns">
      <header className="settings-header">
        <h1>Patterns</h1>
      </header>
      <div className="preview-wrap">
        <canvas ref={canvasRef} className="pattern-preview" />
        <div className="pattern-tabs-overlay" style={{ opacity: 1, transform: 'translateX(-50%) translateY(0)', pointerEvents: 'auto' }}>
          <div className="pattern-tabs" style={{ '--active-index': String(activeIndex) }}>
            <div className="pattern-tab-indicator" />
            {PATTERN_INFO.map(({ id, emoji, name }) => (
              <button
                key={id}
                className={config.type === id ? 'pattern-tab active' : 'pattern-tab'}
                onClick={() => patch({ type: id })}
                data-label={name}
                aria-label={name}
              >
                <span className="pattern-tab-emoji">{emoji}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pattern-controls">
        <div className="control-group">
          <label>Colors</label>
          <div className="colors-row">
            {config.colors.map((c, i) => (
              <div key={i} className="color-chip">
                <input type="color" value={c} onChange={(e) => setColor(i, e.target.value)} aria-label={`color ${i+1}`} />
                {config.colors.length > 2 && (
                  <button onClick={() => removeColor(i)} className="chip-remove" aria-label="remove color">×</button>
                )}
              </div>
            ))}
            {config.colors.length < 6 && (
              <button onClick={addColor} className="add-color" aria-label="add color">+</button>
            )}
          </div>
          <div className="presets-row">
            {Object.keys(window.PRESET_PALETTES).map((name) => (
              <button key={name} onClick={() => applyPreset(name)} className="preset-btn">{name}</button>
            ))}
          </div>
        </div>

        {config.type !== 'mesh' && (
          <div className="control-group">
            <label>{config.type === 'dots' ? 'Density (dots / longest side)' : 'Amount'} <span className="muted">{config.density}</span></label>
            <input type="range" min={5} max={config.type === 'dots' ? 80 : 400} value={config.density} onChange={(e) => patch({ density: +e.target.value })} />
          </div>
        )}

        <div className="control-group">
          <label>Size <span className="muted">{config.size}px</span></label>
          <input type="range" min={8} max={200} value={config.size} onChange={(e) => patch({ size: +e.target.value })} />
        </div>

        <div className="control-group">
          <label>Randomness <span className="muted">{Math.round(config.randomness * 100)}%</span></label>
          <input type="range" min={0} max={100} value={Math.round(config.randomness * 100)} onChange={(e) => patch({ randomness: +e.target.value / 100 })} />
        </div>

        {config.type === 'emoji' && (
          <div className="control-group">
            <label>Emojis <span className="muted">(paste any string — Microsoft Fluent style)</span></label>
            <input type="text" value={config.emojis.join('')} onChange={(e) => patch({ emojis: Array.from(e.target.value).filter((c) => c.trim()) })} placeholder="✨🌙⭐💫🪐" />
          </div>
        )}
      </div>

      <div className="row">
        <button onClick={reroll} disabled={busy}>↻ Re-roll</button>
        <button onClick={apply} disabled={busy} className="primary">{busy ? 'Working…' : 'Apply as wallpaper'}</button>
        {status && <span className="status">{status}</span>}
      </div>
    </div>
  );
}

window.Patterns = Patterns;
window.PATTERN_INFO = PATTERN_INFO;
