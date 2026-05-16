import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { generateWallpaper } from '../lib/aigen';
import { useKeydown, usePersistedState } from '../lib/hooks';
import { loadSettings, mutateLibrary, saveSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type GenProvider,
  type GenResolution,
  type PollinationsModel,
  type Settings,
} from '../lib/types';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { WandIcon } from './Icons';
import {
  InspectorSection,
  PreviewFrame,
  Select,
  StatusInline,
  TabLayout,
} from './layout';
import ClickSpark from './reactbits/ClickSpark/ClickSpark';

const PROVIDER_OPTIONS: { id: GenProvider; name: string; description: string }[] = [
  { id: 'pollinations', name: 'Pollinations', description: 'Free, no key required' },
  { id: 'openai', name: 'OpenAI DALL-E 3', description: 'Bring your own API key' },
];

const RESOLUTION_OPTIONS: { value: GenResolution; label: string }[] = [
  { value: 'auto', label: 'Auto (match primary monitor)' },
  { value: '1920x1080', label: '1920 × 1080 (FHD)' },
  { value: '2560x1440', label: '2560 × 1440 (QHD)' },
  { value: '3440x1440', label: '3440 × 1440 (ultrawide)' },
  { value: '3840x2160', label: '3840 × 2160 (4K UHD)' },
  { value: '5120x2880', label: '5120 × 2880 (5K)' },
];

const POLLINATIONS_MODELS: { value: PollinationsModel; label: string }[] = [
  { value: 'flux', label: 'FLUX (default)' },
  { value: 'flux-realism', label: 'FLUX Realism' },
  { value: 'flux-anime', label: 'FLUX Anime' },
  { value: 'flux-3d', label: 'FLUX 3D' },
  { value: 'turbo', label: 'Turbo (faster, lower quality)' },
  { value: 'sdxl', label: 'SDXL' },
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

  // Debounces the disk save so typing into the OpenAI API key or model
  // input doesn't write to the Tauri store on every keystroke (and
  // wouldn't fire the cross-tab event a hundred times either).
  const saveDebounceRef = useRef<number | null>(null);

  // Generic settings patcher used by every config field in this tab.
  // setSettings is synchronous (UI stays responsive); disk save +
  // ambient-settings-changed dispatch are debounced 400ms so a burst of
  // keystrokes resolves to a single write.
  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (saveDebounceRef.current !== null) {
      window.clearTimeout(saveDebounceRef.current);
    }
    saveDebounceRef.current = window.setTimeout(() => {
      void saveSettings(next).then(() => {
        window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
      });
      saveDebounceRef.current = null;
    }, 400);
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

      await mutateLibrary((library) => [
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
      setTimeout(() => setStatus(null), 1500);
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
        title="Generate"
        preview={
          <PreviewFrame empty="Type a prompt and hit Generate to see a result here.">
            {lastResult ? <img src={convertFileSrc(lastResult)} alt={prompt} /> : null}
          </PreviewFrame>
        }
        inspector={
          <>
            <InspectorSection title="Provider">
              <Select
                options={PROVIDER_OPTIONS.map((p) => ({ id: p.id, label: p.name }))}
                value={settings.genProvider}
                onChange={(v) => update({ genProvider: v })}
                disabled={busy}
                ariaLabel="Provider"
              />
              <p className="muted small">{modelLine}</p>
            </InspectorSection>

            <InspectorSection title="Output">
              <Select
                options={RESOLUTION_OPTIONS.map((r) => ({
                  id: r.value,
                  label: r.label,
                }))}
                value={settings.genResolution}
                onChange={(v) => update({ genResolution: v })}
                disabled={busy}
                ariaLabel="Resolution"
              />
            </InspectorSection>

            {settings.genProvider === 'pollinations' && (
              <InspectorSection title="Model">
                <Select
                  options={POLLINATIONS_MODELS.map((m) => ({
                    id: m.value,
                    label: m.label,
                  }))}
                  value={settings.pollinationsModel}
                  onChange={(v) => update({ pollinationsModel: v })}
                  disabled={busy}
                  ariaLabel="Pollinations model"
                />
              </InspectorSection>
            )}

            {settings.genProvider === 'openai' && (
              <InspectorSection title="OpenAI">
                <label className="field">
                  <span>API key</span>
                  <input
                    type="password"
                    value={settings.openaiKey}
                    onChange={(e) => update({ openaiKey: e.target.value })}
                    placeholder="sk-..."
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>Model</span>
                  <input
                    type="text"
                    value={settings.openaiModel}
                    onChange={(e) => update({ openaiModel: e.target.value })}
                    placeholder="dall-e-3"
                    disabled={busy}
                  />
                </label>
                <p className="muted small">
                  HD quality, ~$0.08 per image, capped at 1792×1024.
                </p>
              </InspectorSection>
            )}

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
            <ClickSpark>
              <button
                type="button"
                onClick={go}
                disabled={busy || !prompt.trim()}
                className="primary icon-btn"
                aria-label="Generate and apply"
                title="Generate and apply (⌘⏎)"
              >
                <WandIcon />
              </button>
            </ClickSpark>
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
