import { useEffect, useState } from 'react';
import { generateWallpaper } from '../lib/aigen';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../lib/store';
import { DEFAULT_SETTINGS, type GenProvider, type Settings } from '../lib/types';

export default function Generate() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState(
    'a calm misty mountain valley at dawn, painterly, soft light',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  async function changeProvider(next: GenProvider) {
    const updated = { ...settings, genProvider: next };
    setSettings(updated);
    await saveSettings(updated);
  }

  async function go() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setStatus(
      settings.genProvider === 'pollinations' ? 'Generating (5–15s)…' : 'Generating via OpenAI…',
    );
    try {
      const current = await loadSettings();
      const generated = await generateWallpaper(current, prompt);

      setStatus('Downloading…');
      const localPath = await downloadAndSave(generated.url, generated.filename);

      const library = await loadLibrary();
      await saveLibrary([
        {
          path: localPath,
          source: 'generated',
          prompt,
          addedAt: Date.now(),
          title: prompt.slice(0, 60),
        },
        ...library,
      ]);
      setStatus('Setting wallpaper…');
      await setWallpaper(localPath);
      setStatus('Applied — added to Library');
      setTimeout(() => setStatus(null), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="generate">
      <div className="row">
        <label>
          <span>Provider</span>
          <select
            value={settings.genProvider}
            onChange={(e) => changeProvider(e.target.value as GenProvider)}
            disabled={busy}
          >
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
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="describe the wallpaper you want…"
          disabled={busy}
        />
      </label>

      <div className="row">
        <button onClick={go} disabled={busy || !prompt.trim()} className="primary">
          {busy ? 'Working…' : 'Generate + apply'}
        </button>
        {status && <span className="status">{status}</span>}
        {error && <span className="error">{error}</span>}
      </div>

      <p className="muted">
        {settings.genProvider === 'pollinations'
          ? 'Pollinations.ai — free, anonymous, capped at ~2048/side. For higher quality try OpenAI or the Patterns tab.'
          : 'OpenAI DALL-E 3 HD — ~$0.08/image, capped at 1792×1024. Set your key in Settings.'}
      </p>
    </div>
  );
}
