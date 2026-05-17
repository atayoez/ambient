import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { generateWallpaper } from '../lib/aigen';
import { useDebouncedCallback, useDraftState, useKeydown } from '../lib/hooks';
import { loadSettings, mutateLibrary, patchSettings } from '../lib/store';
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
      window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
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
      // Commit lastResult so a fresh launch shows the most recent
      // result in the preview frame. Pass the value explicitly because
      // the useState ref hasn't caught up to the set call above yet.
      try {
        await saveLastResult(localPath);
      } catch {}
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
              <Select
                options={PROVIDER_OPTIONS.map((p) => ({ id: p.id, label: p.name }))}
                value={settings.genProvider}
                onChange={(v) => update({ genProvider: v })}
                disabled={busy}
                ariaLabel="Provider"
              />
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

            <InspectorSection title="Model">
              {settings.genProvider === 'pollinations' ? (
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
              ) : (
                <input
                  type="text"
                  value={settings.openaiModel}
                  onChange={(e) => update({ openaiModel: e.target.value })}
                  placeholder="dall-e-3"
                  disabled={busy}
                  aria-label="OpenAI model"
                />
              )}
            </InspectorSection>

            <InspectorSection title="Prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="describe the wallpaper you want…"
                disabled={busy}
              />
            </InspectorSection>

            {settings.genProvider === 'openai' && (
              <InspectorSection title="API key">
                <input
                  type="password"
                  value={settings.openaiKey}
                  onChange={(e) => update({ openaiKey: e.target.value })}
                  placeholder="sk-..."
                  disabled={busy}
                  aria-label="OpenAI API key"
                />
              </InspectorSection>
            )}
          </>
        }
        actions={
          <>
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
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
