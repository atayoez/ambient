# Ambient UI kit — desktop app

A click-through recreation of the Ambient window. Every visual decision is lifted from `ambient/src/index.css` and `ambient/src/components/*.tsx` — see `reference/` for the originals.

## What works

- **Custom 42px titlebar** with the sliding-pill tab indicator (380ms `cubic-bezier(0.32, 0.72, 0, 1)`) and window controls on the right.
- **Patterns** — live canvas preview, color chips, preset palette row, size/randomness/density sliders, emoji input. Click a pattern type in the floating glass pill at the bottom of the preview to switch. The five types (mesh / geometric / dots / stripes / emoji) all render from `components/canvas.jsx`.
- **Sources** — pick NASA APOD / Unsplash / Pexels. Each has its own API-key + topic field; "Re-fetch" cycles a new seed and re-renders the preview.
- **Library** — six seeded sample wallpapers, with Apply / Delete. Applying or generating from any other tab adds a new card here.
- **Generate** — provider picker, prompt textarea, simulated "Generate + apply" flow with the real status-line copy.
- **Settings** — provider config, resolution dropdown, rotation toggle with interval. Saved-toast appears on every change.

## What's faked

- The preview canvas uses a simplified pattern engine (`components/canvas.jsx`); the production version (`ambient/src/lib/patterns.ts`) supports more nuanced color blending, a real Halton sequence for placement, and high-supersampling for export.
- Emoji rendering uses **Twemoji** PNGs from jsDelivr because they're tiny and reliable. Production Ambient uses **Microsoft Fluent 3D** PNGs with a Fluent-Color flat fallback — visually richer but a much bigger asset to load. Flag if you need Fluent here.
- No actual wallpaper-setting / file I/O / API calls — everything is local React state.

## Files

```
desktop_app/
├─ index.html              entry — boots React + Babel, loads each JSX module
├─ styles.css              verbatim copy of ambient/src/index.css
└─ components/
   ├─ icons.jsx            the 3 hand-rolled window-control SVGs
   ├─ canvas.jsx           pattern renderer + palette presets + emoji loader
   ├─ patterns.jsx         Patterns tab
   ├─ sources.jsx          Sources tab
   ├─ library.jsx          Library tab + live thumbnails
   ├─ generate.jsx         Generate tab
   ├─ settings.jsx         Settings tab
   └─ app.jsx              main shell, tab routing, fake library state
```

## Run

Open `index.html` directly. Nothing to build; everything is CDN.
