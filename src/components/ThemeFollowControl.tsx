import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../lib/store';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

// Toggle for: "auto-switch the desktop wallpaper when the system
// flips between light and dark mode". The actual matchMedia listener
// + slot capture lives in App.tsx; this component just exposes the
// on/off + shows which wallpaper is currently remembered for each
// mode, so the user can verify the slots before relying on the
// switch.
//
// First-time UX: turning the toggle on doesn't pick anything for you.
// Both slots start empty; they fill in passively as the user applies
// wallpapers across the two modes. A "currently empty" hint surfaces
// which slot still needs an apply.
export default function ThemeFollowControl() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setSettings(s);
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
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
    window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
  }

  const enabled = settings.themeFollow;
  const lightPath = settings.themeFollowLightPath;
  const darkPath = settings.themeFollowDarkPath;

  return (
    <div className="theme-follow-control">
      <label className="row-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void update({ themeFollow: e.target.checked })}
        />
        <span>Switch wallpaper when system flips light / dark</span>
      </label>
      {enabled && (
        <p className="muted small">
          Whatever you apply in each mode becomes that mode's pick — the app reapplies it
          when the system swaps next.
          <br />
          Light: {lightPath ? basename(lightPath) : <em>not set yet</em>}
          <br />
          Dark: {darkPath ? basename(darkPath) : <em>not set yet</em>}
        </p>
      )}
    </div>
  );
}

function basename(p: string): string {
  return p.split('/').pop()?.split('\\').pop() ?? p;
}
