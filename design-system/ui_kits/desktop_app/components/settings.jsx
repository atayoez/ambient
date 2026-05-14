// Settings tab — AI provider config + rotation toggle.

function Settings({ settings, onUpdate, saved }) {
  function update(p) { onUpdate(p); }
  return (
    <div className="settings">
      <header className="settings-header">
        <h1>Settings</h1>
        {saved && <span className="saved" style={{ color: 'var(--success)', fontSize: 11 }}>Saved</span>}
      </header>

      <section>
        <h2>AI image generation</h2>
        <label>Provider
          <select value={settings.genProvider} onChange={(e) => update({ genProvider: e.target.value })}>
            <option value="pollinations">Pollinations (free, no key)</option>
            <option value="openai">OpenAI DALL-E 3 (BYOK)</option>
          </select>
        </label>
        <label>Resolution
          <select value={settings.genResolution} onChange={(e) => update({ genResolution: e.target.value })}>
            <option value="auto">Auto (match your primary monitor)</option>
            <option value="1920x1080">1920 × 1080 (FHD)</option>
            <option value="2560x1440">2560 × 1440 (QHD)</option>
            <option value="3440x1440">3440 × 1440 (ultrawide)</option>
            <option value="3840x2160">3840 × 2160 (4K UHD)</option>
            <option value="5120x2880">5120 × 2880 (5K)</option>
          </select>
        </label>

        {settings.genProvider === 'pollinations' && (
          <>
            <label>Model
              <select value={settings.pollinationsModel} onChange={(e) => update({ pollinationsModel: e.target.value })}>
                <option value="flux">FLUX (default)</option>
                <option value="flux-realism">FLUX Realism</option>
                <option value="flux-anime">FLUX Anime</option>
                <option value="flux-3d">FLUX 3D</option>
                <option value="turbo">Turbo (faster, lower quality)</option>
                <option value="sdxl">SDXL</option>
              </select>
            </label>
            <p className="muted">
              Free image generation via <code>pollinations.ai</code>. ~5–15s per image. Capped at ~2048/side.
            </p>
          </>
        )}
        {settings.genProvider === 'openai' && (
          <>
            <label>OpenAI API key
              <input type="password" value={settings.openaiKey} onChange={(e) => update({ openaiKey: e.target.value })} placeholder="sk-..." />
            </label>
            <label>Model
              <input value={settings.openaiModel} onChange={(e) => update({ openaiModel: e.target.value })} placeholder="dall-e-3" />
            </label>
            <p className="muted">HD quality, ~$0.08 per image, capped at 1792×1024.</p>
          </>
        )}
      </section>

      <section>
        <h2>Rotation</h2>
        <label className="row-label">
          <input type="checkbox" checked={settings.rotationEnabled} onChange={(e) => update({ rotationEnabled: e.target.checked })} />
          <span>Auto-rotate while the app is running</span>
        </label>
        <label>Interval (minutes)
          <input type="number" min={5} value={settings.rotationIntervalMinutes}
            onChange={(e) => update({ rotationIntervalMinutes: Math.max(5, parseInt(e.target.value) || 60) })} />
        </label>
        <p className="muted">
          v0 rotation only fires while Ambient is open. Background/tray rotation lands in v0.1.
          Source configuration moved to the <em>Sources</em> tab.
        </p>
      </section>
    </div>
  );
}

window.Settings = Settings;
