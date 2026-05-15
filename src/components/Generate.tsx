import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { generateWallpaper } from '../lib/aigen';
import { useKeydown, usePersistedState } from '../lib/hooks';
import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../lib/store';
import { DEFAULT_SETTINGS, type GenProvider, type Settings } from '../lib/types';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { InspectorSection, PreviewFrame, StatusInline, TabLayout } from './layout';

const PROVIDER_OPTIONS: { id: GenProvider; name: string; description: string }[] = [
  { id: 'pollinations', name: 'Pollinations', description: 'Free, no key required' },
  { id: 'openai', name: 'OpenAI DALL-E 3', description: 'Bring your own API key' },
];

const DEFAULT_PROMPT = 'a calm misty mountain valley at dawn, painterly, soft light';

export default function Generate() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = usePersistedState<string>(
    'generate.prompt',
    DEFAULT_PROMPT,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastResult, setLastResult] = usePersistedState<string | null>(
    'generate.lastResult',
    null,
  );

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
      settings.genProvider === 'pollinations'
        ? 'Generating (5–15s)…'
        : 'Generating via OpenAI…',
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
      setLastResult(localPath);
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

  const modelLine =
    settings.genProvider === 'pollinations'
      ? `Model: ${settings.pollinationsModel}`
      : `Model: ${settings.openaiModel || 'dall-e-3'} HD · ~$0.08/image`;

  const providerHint =
    settings.genProvider === 'pollinations'
      ? 'Pollinations.ai — free, anonymous, capped at ~2048/side.'
      : 'OpenAI DALL-E 3 HD — set your API key in Settings.';

  // Cmd/Ctrl+Enter kicks off a generation from anywhere in the tab,
  // including inside the prompt textarea — matches the iMessage /
  // Chat-style "send" gesture.
  useKeydown('Enter', () => void go(), { cmdOrCtrl: true });

  return (
    <div className="generate">
      <TabLayout
        preview={
          <PreviewFrame empty="Type a prompt and hit Generate to see a result here.">
            {lastResult ? <img src={convertFileSrc(lastResult)} alt={prompt} /> : null}
          </PreviewFrame>
        }
        inspector={
          <>
            <InspectorSection title="Provider">
              <div className="type-list" role="radiogroup" aria-label="Provider">
                {PROVIDER_OPTIONS.map(({ id, name, description }) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={settings.genProvider === id}
                    className={
                      settings.genProvider === id ? 'type-row active' : 'type-row'
                    }
                    onClick={() => changeProvider(id)}
                    disabled={busy}
                  >
                    <span className="type-text">
                      <span className="type-name">{name}</span>
                      <span className="type-desc">{description}</span>
                    </span>
                    {settings.genProvider === id && (
                      <span className="type-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="muted small">{modelLine}</p>
            </InspectorSection>

            <InspectorSection title="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="describe the wallpaper you want…"
                disabled={busy}
              />
              <p className="muted small">{providerHint}</p>
            </InspectorSection>
          </>
        }
        actions={
          <>
            <button onClick={go} disabled={busy || !prompt.trim()} className="primary">
              {busy ? 'Working…' : 'Generate + apply'}
            </button>
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
