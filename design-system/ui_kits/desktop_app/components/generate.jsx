// Generate tab — provider picker, prompt textarea, "Generate + apply" CTA.

function Generate({ settings, onUpdate, onApply }) {
  const [prompt, setPrompt] = React.useState('a calm misty mountain valley at dawn, painterly, soft light');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(null);

  function changeProvider(next) {
    onUpdate({ genProvider: next });
  }

  async function go() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setStatus(settings.genProvider === 'pollinations' ? 'Generating (5–15s)…' : 'Generating via OpenAI…');
    await new Promise((r) => setTimeout(r, 700));
    setStatus('Downloading…');
    await new Promise((r) => setTimeout(r, 300));
    setStatus('Setting wallpaper…');
    await new Promise((r) => setTimeout(r, 250));
    onApply({
      title: prompt.slice(0, 60),
      prompt,
      source: 'generated',
      type: 'mesh',
      colors: window.PRESET_PALETTES.Sunset,
      seed: Math.floor(Math.random() * 1e6),
    });
    setStatus('Applied — added to Library');
    setTimeout(() => { setStatus(null); setBusy(false); }, 1500);
  }

  return (
    <div className="generate">
      <header className="settings-header">
        <h1>Generate</h1>
      </header>
      <div className="row">
        <label>
          <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Provider</span>
          <select value={settings.genProvider} onChange={(e) => changeProvider(e.target.value)} disabled={busy}>
            <option value="pollinations">Pollinations (free, no key)</option>
            <option value="openai">OpenAI DALL-E 3 (BYOK)</option>
          </select>
        </label>
        <span className="muted">
          {settings.genProvider === 'pollinations'
            ? `model: ${settings.pollinationsModel}`
            : `model: ${settings.openaiModel || 'dall-e-3'} HD · ~$0.08/image`}
        </span>
      </div>

      <label className="prompt-field">
        <span>Prompt</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5}
          placeholder="describe the wallpaper you want…" disabled={busy} />
      </label>

      <div className="row">
        <button onClick={go} disabled={busy || !prompt.trim()} className="primary">
          {busy ? 'Working…' : 'Generate + apply'}
        </button>
        {status && <span className="status">{status}</span>}
      </div>

      <p className="muted">
        {settings.genProvider === 'pollinations'
          ? 'Pollinations.ai — free, anonymous, capped at ~2048/side. For higher quality try OpenAI or the Patterns tab.'
          : 'OpenAI DALL-E 3 HD — ~$0.08/image, capped at 1792×1024. Set your key in Settings.'}
      </p>
    </div>
  );
}

window.Generate = Generate;
