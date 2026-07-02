import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { generateWallpaper, pollinationsModels } from '../lib/aigen';
import { useDebouncedSettingsPatch, useDraftState, useKeydown } from '../lib/hooks';
import { loadSettings, patchSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type GenProvider,
  type GenResolution,
  type Settings,
} from '../lib/types';
import { setWallpaper } from '../lib/wallpaper';
import { Field, IconButton, OptionScroller, StatusInline, toast } from '../ui';
import { WandIcon } from './Icons';

const PROVIDER_OPTIONS: { id: GenProvider; name: string }[] = [
  { id: 'pollinations', name: 'Pollinations' },
  { id: 'openai', name: 'OpenAI' },
];

const RESOLUTION_OPTIONS: { value: GenResolution; label: string }[] = [
  { value: 'auto', label: 'Auto (match screen)' },
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '2560x1440', label: '2560 × 1440' },
  { value: '3440x1440', label: '3440 × 1440' },
  { value: '3840x2160', label: '3840 × 2160' },
  { value: '5120x2880', label: '5120 × 2880' },
];

// Shown only until the live list arrives (or if the fetch fails) so the
// Model scroller is never empty. The real options come from the server.
const FALLBACK_MODELS = ['flux'];

const DEFAULT_PROMPT = 'a calm misty mountain valley at dawn, painterly, soft light';

// `active` — whether this is the visible tab; gates the window-level
// Cmd+Enter shortcut (tabs stay mounted after their first visit).
export default function Generate({ active = true }: { active?: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  // generate.prompt + generate.lastResult are draft state: typing into
  // the prompt or getting a result back stays in memory until the user
  // clicks Generate, which commits both.
  const [prompt, setPrompt, savePrompt] = useDraftState<string>(
    'generate.prompt',
    DEFAULT_PROMPT,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastResult, setLastResult, saveLastResult] = useDraftState<string | null>(
    'generate.lastResult',
    null,
  );

  useEffect(() => {
    loadSettings().then(setSettings);
    // Pull Pollinations' live model catalogue. The set is server-owned
    // (it has shrunk over time), so we render exactly what's offered
    // instead of a hardcoded list. Best-effort: keep the fallback on
    // failure rather than blocking the tab.
    void pollinationsModels()
      .then((list) => {
        if (list.length) setModels(list);
      })
      .catch(() => {});
  }, []);

  // If the stored model isn't in the live list (service dropped it, or
  // it was the old made-up default), fall back to the first offered one
  // so the scroller shows a real, selectable value.
  const activeModel = models.includes(settings.pollinationsModel)
    ? settings.pollinationsModel
    : (models[0] ?? 'flux');

  // Persist the reconciliation: when the live list lands and the stored
  // model isn't in it, write the first real one back so generation uses
  // what the scroller shows (the Rust side reads settings, not activeModel).
  useEffect(() => {
    if (models.length && !models.includes(settings.pollinationsModel)) {
      void patchSettings({ pollinationsModel: models[0] }).then(() => {
        setSettings((s) => ({ ...s, pollinationsModel: models[0] }));
      });
    }
  }, [models, settings.pollinationsModel]);

  // Coalesced 400ms settings writes; the Rust-emitted settings-changed
  // event (bridged in App.tsx) notifies every other consumer.
  const queuePatch = useDebouncedSettingsPatch();

  function update(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    queuePatch(patch);
  }

  async function go() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    try {
      await savePrompt();
    } catch {}
    setStatus('Generating…');
    try {
      const entry = await generateWallpaper(prompt);
      setLastResult(entry.path);
      try {
        await saveLastResult(entry.path);
      } catch {}
      setStatus('Applying…');
      await setWallpaper(entry.path);
      setStatus(null);
      toast.success('Applied');
    } catch (e: unknown) {
      toast.fromError(e);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  // Cmd/Ctrl+Enter kicks off a generation from anywhere in the tab —
  // but only while this is the visible tab.
  useKeydown('Enter', () => void go(), { cmdOrCtrl: true, enabled: active });

  return (
    <div className="generate">
      <div className="gen-stage">
        {lastResult ? (
          <img className="gen-bg" src={convertFileSrc(lastResult)} alt={prompt} />
        ) : (
          <div className="gen-bg gen-bg-empty" aria-hidden="true" />
        )}

        {/* Top tray — the primary pickers. */}
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
              options={models.map((m) => ({ id: m, label: m }))}
              value={activeModel}
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

        {/* Side panel — prompt + (model for OpenAI). */}
        <div className="gen-panel pat-side" inert={busy || undefined}>
          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="describe the wallpaper you want…"
              aria-label="Prompt"
            />
          </Field>
          {settings.genProvider === 'openai' && (
            <Field label="Model">
              <input
                type="text"
                value={settings.openaiModel}
                onChange={(e) => update({ openaiModel: e.target.value })}
                placeholder="dall-e-3"
                aria-label="OpenAI model"
              />
            </Field>
          )}
        </div>

        <div className="pat-actions">
          <StatusInline status={status} />
          <IconButton
            variant="primary"
            onClick={go}
            disabled={busy || !prompt.trim()}
            label="Generate and apply"
            title="Generate and apply (⌘⏎)"
          >
            <WandIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
