import { useEffect, useState } from 'react';
import { loadSettings, patchSettings } from '../lib/store';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

interface Props {
  // Which rotation flavor this control owns. Sources tab passes 'sources'
  // (fetch a new image from the configured Source on a timer); Library
  // tab passes 'library' (shuffle through saved wallpapers). Only one
  // mode is active at any time — toggling this control on swings
  // `rotationSource` to `mode`, toggling off swings it back to `'off'`,
  // which automatically disables whichever other tab's RotationControl
  // was enabled before.
  mode: 'sources' | 'library';
  // Used as the checkbox's aria-label only — there's no visible label
  // text. The section title above (Auto-rotate / Shuffle) tells the
  // user what the toggle does; the screen-reader name disambiguates
  // between the two instances when navigating without sight.
  ariaLabel: string;
  // Shown when the OTHER mode is currently active, to make the mutual
  // exclusion legible: "Currently shuffling Library — enabling here
  // switches" (or vice versa).
  otherInUseHint: string;
}

// Shared rotation toggle + interval. Renders in both Sources inspector and
// Library top bar. Each instance loads its own copy of the settings on
// mount and listens for 'ambient-settings-changed' so toggling rotation
// in one tab keeps the other tab's instance in sync without prop drilling.
export default function RotationControl({ mode, ariaLabel, otherInUseHint }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Decoupled draft for the interval input — clamping happens on blur
  // only, so the user can type "30" without "3" snapping to "5" mid-edit.
  const [intervalDraft, setIntervalDraft] = useState(
    String(DEFAULT_SETTINGS.rotationIntervalMinutes),
  );

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setSettings(s);
      setIntervalDraft(String(s.rotationIntervalMinutes));
    }
    void reload();
    const onChange = () => void reload();
    window.addEventListener('ambient-settings-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ambient-settings-changed', onChange);
    };
  }, []);

  async function update(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    // patchSettings is a serialized read-modify-write — only the
    // fields in `patch` are written; everything else is preserved
    // from fresh disk state. Avoids clobbering Library's themeMode
    // (and any other concurrent change) with a stale local copy.
    await patchSettings(patch);
    // App.tsx's rotation timer re-reads settings on this event.
    window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
  }

  function commitInterval() {
    const n = Number.parseInt(intervalDraft, 10);
    const clamped = Math.max(5, Number.isFinite(n) && n > 0 ? n : 60);
    setIntervalDraft(String(clamped));
    if (clamped !== settings.rotationIntervalMinutes) {
      void update({ rotationIntervalMinutes: clamped });
    }
  }

  const enabled = settings.rotationSource === mode;
  const otherMode = mode === 'sources' ? 'library' : 'sources';
  const otherInUse = settings.rotationSource === otherMode;

  return (
    <div className="rotation-control">
      <div className="rotation-row" data-enabled={enabled}>
        <input
          type="checkbox"
          checked={enabled}
          aria-label={ariaLabel}
          onChange={(e) =>
            void update({ rotationSource: e.target.checked ? mode : 'off' })
          }
        />
        <span>every</span>
        <input
          type="number"
          min={5}
          value={intervalDraft}
          disabled={!enabled}
          onChange={(e) => setIntervalDraft(e.target.value)}
          onBlur={commitInterval}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitInterval();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span>min</span>
      </div>
      {otherInUse && <p className="muted small">{otherInUseHint}</p>}
    </div>
  );
}
