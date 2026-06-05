import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { generateWallpaper } from '../lib/aigen';
import { dispatch } from '../lib/events';
import { useDebouncedCallback, useDraftState, useKeydown } from '../lib/hooks';
import { loadSettings, patchSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type GenProvider,
  type GenResolution,
  type PollinationsModel,
  type Settings,
} from '../lib/types';
import { setWallpaper } from '../lib/wallpaper';
import { WandIcon } from './Icons';
import { StatusInline } from './layout';
import OptionScroller from './OptionScroller';

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
  // generate.prompt + generate.lastResult are draft state: typing into
  // the prompt or getting a result back stays in memory until the user
  // clicks Generate, which commits both. Matches the "tick = save"
  // model used on Patterns.
  const [prompt, setPrompt, savePrompt] = useDraftState<string>(
    'generate.prompt',
    DEFAULT_PROMPT,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastResult, setLastResult, saveLastResult] = useDraftState<string | null>(
    'generate.lastResult',
    null,
  );
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // Generic settings patcher used by every config field in this tab.
  // Patches accumulate in a ref and flush through patchSettings (a
  // serialized read-modify-write) so concurrent changes from other
  // tabs — Library's themeMode picker is the canonical example —
  // aren't clobbered by this tab's stale full-Settings copy.
  const pendingPatchRef = useRef<Partial<Settings>>({});
  const debouncedFlush = useDebouncedCallback(() => {
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    void patchSettings(patch).then(() => {
      dispatch('settings-changed');
    });
  }, 400);

  function update(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    debouncedFlush();
  }

  async function go() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    // Commit the prompt before the long-running generation. Save errors
    // are swallowed — a transient store hiccup shouldn't block the
    // generation, which is the meaningful action.
    try {
      await savePrompt();
    } catch {}
    setStatus(
      settings.genProvider === 'pollinations'
        ? 'Generating (5–15s)…'
        : 'Generating via OpenAI…',
    );
    try {
      // Rust reads settings + OpenAI key (from keyring) and handles
      // the entire pipeline: model API call, download, library prepend.
      // Frontend just consumes the resulting Wallpaper entry.
      const entry = await generateWallpaper(prompt);
      setLastResult(entry.path);
      // Commit lastResult so a fresh launch shows the most recent
      // result in the preview frame. Pass the value explicitly because
      // the useState ref hasn't caught up to the set call above yet.
      try {
        await saveLastResult(entry.path);
      } catch {}
      setStatus('Setting wallpaper…');
      await setWallpaper(entry.path);
      setStatus('Applied — added to Library');
      setTimeout(() => setStatus(null), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  // Cmd/Ctrl+Enter kicks off a generation from anywhere in the tab,
  // including inside the prompt textarea — matches the iMessage /
  // Chat-style "send" gesture.
  useKeydown('Enter', () => void go(), { cmdOrCtrl: true });

  return (
    <div className="generate">
      {/* Full-bleed stage: the result (or a tinted empty field) spans the
          whole pane like the site's backdrop, and the settings + prompt
          float over it in glass panels. */}
      <div className="gen-stage">
        {lastResult ? (
          <img className="gen-bg" src={convertFileSrc(lastResult)} alt={prompt} />
        ) : (
          <div className="gen-bg gen-bg-empty" aria-hidden="true" />
        )}

        {/* Top tray — same as the other tabs: the primary pickers. */}
        <div className="gen-panel pat-top">
          <OptionScroller
            label="Provider"
            options={PROVIDER_OPTIONS.map((p) => ({ id: p.id, label: p.name }))}
            value={settings.genProvider}
            onChange={(v) => update({ genProvider: v })}
            ariaLabel="Provider"
          />
          {settings.genProvider === 'pollinations' && (
            <OptionScroller
              label="Model"
              options={POLLINATIONS_MODELS.map((m) => ({ id: m.value, label: m.label }))}
              value={settings.pollinationsModel}
              onChange={(v) => update({ pollinationsModel: v })}
              ariaLabel="Pollinations model"
            />
          )}
          <OptionScroller
            label="Resolution"
            options={RESOLUTION_OPTIONS.map((r) => ({ id: r.value, label: r.label }))}
            value={settings.genResolution}
            onChange={(v) => update({ genResolution: v })}
            ariaLabel="Resolution"
          />
        </div>

        {!lastResult && (
          <p className="gen-empty-hint">
            Describe a wallpaper and hit Generate — it lands here and on your desktop.
          </p>
        )}

        {/* Side panel — prompt + (model/key for OpenAI), like the others. */}
        <div className="gen-panel pat-side" inert={busy || undefined}>
          <label className="field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="describe the wallpaper you want…"
              aria-label="Prompt"
            />
          </label>
          {settings.genProvider === 'openai' && (
            <label className="field">
              <span>Model</span>
              <input
                type="text"
                value={settings.openaiModel}
                onChange={(e) => update({ openaiModel: e.target.value })}
                placeholder="dall-e-3"
                aria-label="OpenAI model"
              />
            </label>
          )}
        </div>

        <div className="pat-actions">
          <StatusInline status={status} error={error} />
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
        </div>
      </div>
    </div>
  );
}
