import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type GenProvider,
  type GenResolution,
  type PollinationsModel,
  type Settings,
} from '../lib/types';
import { InspectorSection } from './layout';

const PROVIDER_OPTIONS: { value: GenProvider; label: string }[] = [
  { value: 'pollinations', label: 'Pollinations (free, no key)' },
  { value: 'openai', label: 'OpenAI DALL-E 3 (BYOK)' },
];

const RESOLUTION_OPTIONS: { value: GenResolution; label: string }[] = [
  { value: 'auto', label: 'Auto (match your primary monitor)' },
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

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  return (
    <div className="settings">
      <InspectorSection title="AI image generation">
        <label className="field">
          <span>Provider</span>
          <select
            value={settings.genProvider}
            onChange={(e) => update({ genProvider: e.target.value as GenProvider })}
          >
            {PROVIDER_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Resolution</span>
          <select
            value={settings.genResolution}
            onChange={(e) => update({ genResolution: e.target.value as GenResolution })}
          >
            {RESOLUTION_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {settings.genProvider === 'pollinations' && (
          <>
            <label className="field">
              <span>Model</span>
              <select
                value={settings.pollinationsModel}
                onChange={(e) =>
                  update({ pollinationsModel: e.target.value as PollinationsModel })
                }
              >
                {POLLINATIONS_MODELS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Free image generation via <code>pollinations.ai</code>. ~5–15s per image.
              Capped at ~2048/side.
            </p>
          </>
        )}

        {settings.genProvider === 'openai' && (
          <>
            <label className="field">
              <span>OpenAI API key</span>
              <input
                type="password"
                value={settings.openaiKey}
                onChange={(e) => update({ openaiKey: e.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={settings.openaiModel}
                onChange={(e) => update({ openaiModel: e.target.value })}
                placeholder="dall-e-3"
              />
            </label>
            <p className="muted small">
              HD quality, ~$0.08 per image, capped at 1792×1024.
            </p>
          </>
        )}
      </InspectorSection>

      <InspectorSection title="Rotation">
        <label className="row-toggle">
          <input
            type="checkbox"
            checked={settings.rotationEnabled}
            onChange={(e) => update({ rotationEnabled: e.target.checked })}
          />
          <span>Auto-rotate while the app is running</span>
        </label>
        <label className="field">
          <span>Interval (minutes)</span>
          <input
            type="number"
            min={5}
            value={settings.rotationIntervalMinutes}
            onChange={(e) =>
              update({
                rotationIntervalMinutes: Math.max(
                  5,
                  Number.parseInt(e.target.value) || 60,
                ),
              })
            }
          />
        </label>
        <p className="muted small">
          v0 rotation only fires while Ambient is open. Background/tray rotation lands in
          v0.1. Source configuration moved to the <em>Sources</em> tab.
        </p>
      </InspectorSection>

      {saved && <div className="save-toast">Saved</div>}
    </div>
  );
}
