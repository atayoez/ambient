# Ambient Design System

> **A Linux wallpaper generator distributed as a Flatpak.** Pick colors, pick a pattern, render at your exact screen resolution, apply.

Ambient is a single-window Linux desktop app built with Tauri 2 + React 18 + TypeScript, shipped on Flathub. The product is one app with five tabs: **Patterns** (procedural generation), **Sources** (NASA APOD / Unsplash / Pexels), **Library** (everything you've applied), **Generate** (AI image gen via Pollinations or OpenAI DALL-E 3), and **Settings**.

**The headline feature is iOS-style emoji wallpapers using Microsoft Fluent 3D emojis** — staggered grids with random rotation + mirror, rendered pixel-perfect at the user's monitor resolution.

**Native COSMIC desktop integration is the moat.** Ambient writes directly to `cosmic-bg`'s RON config so wallpapers apply at correct physical pixel size on HiDPI displays without zoom or distortion. GNOME / KDE / sway / X11 are handled through the `wallpaper` crate. There's nothing like Fluent 3D emoji wallpapers on Linux today — Wallpaper Engine is Windows-only, Lively is Windows-only, Plash is macOS-only.

There is exactly one product surface: the **desktop app window**. No web marketing page, no docs site, no mobile companion. Future targets (macOS / Windows / mobile / web) are explicitly *not in v0*.

## Source materials

| Source | Path / link | Notes |
|---|---|---|
| **Repo** | [github.com/atayozcan/ambient](https://github.com/atayozcan/ambient) | Public, MIT-licensed. Source of truth. |
| Live tokens | `reference/index.css` | All `--*` vars; dark default + light overrides. |
| App shell | `reference/App.tsx` | Custom titlebar + sliding-pill tab nav. |
| Component JSX | `reference/Patterns.tsx`, `Library.tsx`, `Sources.tsx`, `Generate.tsx`, `Settings.tsx` | The five tabs. |
| Pattern engine | `reference/patterns.ts` | Preset palettes, Fluent 3D emoji loader, Halton sampling. |
| Type model | `reference/types.ts` | `Settings`, `Wallpaper`, defaults. |
| App icon | `assets/app-icon.svg` (source) + `app-icon.png` (generated) | Twilight-sunset squircle. |
| AppStream | `reference/flatpak/com.ambient.app.metainfo.xml` | Flathub metadata — name, summary, categories, release notes. |
| Flatpak manifest | `reference/flatpak/com.ambient.app.yaml` | Build + sandbox permissions. |
| Project README | `reference/AMBIENT_README.md` | Verbatim from the repo. |

No Figma file, no marketing site, no slide deck were provided — **the codebase is the source of truth.** All visual decisions in this design system come from `index.css` and the component JSX.

---

## CONTENT FUNDAMENTALS

Ambient's copy is **conversational, technically honest, and slightly opinionated** — it sounds like a developer explaining their own tool to another developer. Not corporate. Not chirpy.

**Voice & tone**
- **Pragmatic over polished.** Says exactly what something does, including caveats. From Settings: *"v0 rotation only fires while Ambient is open. Background/tray rotation lands in v0.1."* Doesn't pretend things work that don't.
- **Trade-offs upfront.** When DALL-E is the alternative: *"~$0.08 per image, capped at 1792×1024."* When Pollinations is free: *"capped at ~2048/side."* No FOMO copy, no hedging.
- **Linux-native vernacular.** Mentions COSMIC, cosmic-bg, RON, wlroots, gsettings, qdbus, HiDPI, Flatpak, Flathub by name — assumes the reader knows what they are.
- **Light personality, never twee.** From the README: *"There's nothing like this on Linux today."* Confident, dry, never exclamation points.
- **Direct address — "you," not "the user."** *"In Settings → AI image generation"*, *"hit Apply to reuse one."* User-second-person, never customer-second-person.

**Casing**
- **Sentence case for everything** — labels, buttons, headings. *Apply as wallpaper*. *Auto-rotate while the app is running*. Never Title Case Button Text.
- **UPPERCASE eyebrows for section H2s and field labels**, with `letter-spacing: 0.05em`. *COLORS*. *RANDOMNESS*. *NASA (OPTIONAL)*.
- **`code` for paths, env vars, CLI bits.** *"falls back to NASA's shared `DEMO_KEY`"*, *"`cdn.jsdelivr.net/gh/microsoft/fluentui-emoji`"*.

**Microcopy patterns**
- **Empty states explain the path forward,** with hyperlinks-as-text-italics: *"Empty library. Generate one from *Patterns*, pull from a curated *Source*, or prompt an AI in *Generate* — anything you apply lands here for re-use."*
- **Status strings are present-continuous and short:** *"Fetching from source…"* / *"Downloading…"* / *"Encoding (lossless PNG)…"* / *"Applied"*. Three dots while working, no dots on terminal states.
- **Buttons are verb + object:** *Apply as wallpaper*, *Fetch + apply*, *Generate + apply*, *Re-roll*, *Re-fetch*. Use `+` (not "and") to join two actions in a single button.
- **Numbers are exact, not rounded.** *"~5–15s per image"*. *"30 requests/hour and 50/day"*. *"~$0.08/image"*.

**What it never does**
- No emoji in body copy or microcopy. Emoji exist only as **content** in pattern previews and as **icons inside pattern-tab buttons** (see Iconography).
- No exclamation points. No "amazing." No "powered by."
- No marketing fluff like "beautiful," "stunning," "magical." Wallpapers may be those things; the copy is not.

**Naming conventions**
- App ID: `com.ambient.app` (reverse-DNS for Flatpak / D-Bus).
- AppStream summary: *"Wallpaper generator with patterns, emoji, and AI"* — eleven words, no adjectives, lists the three primary modes.
- Tab names are one word each: *Patterns*, *Sources*, *Library*, *Generate*, *Settings*. No exceptions, no two-word tabs.

---

## VISUAL FOUNDATIONS

Ambient's whole aesthetic is **one design idea, executed precisely**: a frosted-glass window with a sliding-pill tab bar floating over the user's live wallpaper. Everything reinforces that.

### Color
- **Dark by default, with a clean light override.** Detected via `prefers-color-scheme`.
- **Translucent surfaces over a tinted base.** `--bg-base` is `rgba(15, 13, 26, 0.78)` — *deliberately not opaque*, because the desktop wallpaper bleeds through the 40px backdrop-blur. The brand is glass.
- **Elevation through translucent whites,** not shadow. `--surface` → `--surface-2` → `--surface-3` are all `rgba(255,255,255,…)` at 4%/8%/14% opacity.
- **Brand color is lavender + cosmic pink.** `--accent: #b794f6`, `--accent-hover: #d6bcff`. The canonical "Cosmic" palette is `#0c0a1f → #7c5cff → #ec4899 → #fbbf24 → #f1ecff` — the dark-mode default for Patterns.
- **No flat fills on primary buttons** — they use `linear-gradient(180deg, var(--accent), var(--accent-hover))` with a purple drop-shadow (`0 6px 16px rgba(124, 92, 255, 0.35)`).
- **Imagery is full-bleed and cool/cosmic-leaning** — the app icon is a twilight-purple-to-pink-to-amber sunset. No grain, no b&w, no warm-photo aesthetic.

### Type
- **Single system font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif`. Root size 14px. No webfont is bundled — type renders in whatever the host OS uses (San Francisco / Segoe UI / Inter), which is intentional: Ambient is supposed to feel native to its host. On Flatpak'd Linux this falls through to **Inter** or whatever the host theme provides.
- **Only ~five sizes used** — 11, 12, 13, 14, 16. No display-scale type (this is a single small window, not a marketing page).
- **Two distinct treatments:** body text (sentence case, regular/medium weight) and **uppercase eyebrows** (`text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted)`).

### Spacing
- **Stack gaps in steps of 2, 4, 6, 8, 10, 12, 14, 18** — never random pixel values. Inline button padding is `6px 12px`; section padding is `14px`; cards have `padding: 14px`.
- Page max-widths are tight: Library/Patterns 1100px, Generate/Settings 720px. The AppStream metainfo declares `<display_length compare="ge">720</display_length>` as a minimum.

### Backgrounds
- **The app window itself uses two gradients stacked on a base:** `linear-gradient(180deg, var(--bg-tint-top), var(--bg-tint-bottom)), var(--bg-base)` — a purple-to-pink wash so faint it reads as "warm" rather than "purple."
- **No repeating patterns, no textures, no decorative SVGs.** The blurred wallpaper behind the window IS the decoration.
- **No hero images, no full-bleed photography in the UI.** Imagery only appears as wallpaper thumbnails inside `.card` (Library) and as the full-bleed `.source-preview` (Sources).

### Animation
- **One signature easing curve:** `cubic-bezier(0.32, 0.72, 0, 1)` — Apple's "snappy spring." Used on the sliding tab indicator (380ms) and the emoji pop hover.
- **Two other timings:** `120ms` for hover background fades, `220ms` for tab color crossfades and overlay fades. Tooltips fade in `140ms`.
- **Fades only — no bounces, no parallax, no scroll-tied animations.** A `save-in` keyframe nudges the saved-toast 8px upward as it appears; that's the most expressive animation in the entire app.
- **Hover states are background-color shifts** (`--surface-2` → `--surface-3`) or color shifts (`--muted` → `--text`). Not scale, not glow, not transform.
- **Press states do nothing visual on tabs/wc** — the sliding indicator is the entire selected-state UI. On generic buttons, press translates 1px down (`transform: translateY(1px)`).

### Borders + shadows
- **Hairline borders only:** `1px solid var(--border)` at 8% opacity, or `--border-strong` at 16%. Never thicker. Never dashed except for the `+` add-color chip and the empty-state container.
- **Outer shadow only on the window itself and on the floating pattern-tabs overlay.** `0 32px 80px rgba(0,0,0,0.35)` for the window; `0 12px 32px rgba(0,0,0,0.35)` for the overlay.
- **Inner top-edge highlight on every elevated surface:** `inset 0 1px 0 rgba(255,255,255,0.18)` — this is the "glass sheen" that makes translucent surfaces feel like physical glass.
- **No drop-shadow on cards, inputs, or sections.** Just inset sheen + hairline border. Elevation comes from opacity layering, not Y-offset.

### Transparency + blur
- **Backdrop-blur is load-bearing.** `backdrop-filter: blur(40px) saturate(180%)` on the app window; `blur(20px) saturate(180%)` on the tab tray; `blur(24px) saturate(180%)` on the overlay pattern tabs.
- **Saturation is always 180%** — never the default 100%. This is what gives the glass a faint chromatic shift instead of looking washed out.
- On Wayland (COSMIC, GNOME, sway) backdrop blur is honored by the compositor when available; on X11 it degrades to a flat translucent surface and the design still reads correctly.

### Corner radii
- **Exactly three values + pill.** `--radius-inline: 8px` (buttons, inputs, chips), `--radius-container: 12px` (cards, sections, tab trays), `--radius-window: 14px` (the app frame itself), `--radius-pill: 999px` (toasts). This three-value rule is documented in the live CSS as a constraint.

### Cards
- `background: var(--surface)` (4% white) + `border: 1px solid var(--border)` + `border-radius: 12px` + `box-shadow: inset 0 1px 0 var(--highlight-edge)`. **No outer shadow.** Card thumbnails are `aspect-ratio: 16/10` with `object-fit: cover`.

### Layout rules
- **Custom titlebar instead of native** — 42px tall, `grid-template-columns: 1fr auto 1fr` with the sliding-pill tabs perfectly centered and minimize/maximize/close right-aligned. The titlebar is also the window drag region.
- **No fixed sidebars, no top app bar.** Tabs are the entire global navigation.
- **All page content is `align-self: center` with a per-tab max-width** — the window can be resized wide, but content stays readable.
- **Scrollbars hidden but functional** (`scrollbar-width: none; ::-webkit-scrollbar { display: none }`) — pure scroll-by-drag, no visible track.

### Color vibe of imagery
- **Cool & cosmic.** Purple → pink → amber is the brand gradient (see app icon). When stock photography appears (Unsplash/Pexels/NASA), it's full-bleed `object-fit: cover` with no overlay — the app trusts whatever the source provides.

---

## ICONOGRAPHY

Ambient has **no icon font, no icon library, and no SVG icon set**. The codebase contains exactly **four hand-rolled inline SVGs** — minimize, maximize, close (in `App.tsx`) and the `<select>` chevron (as a data-URI in `index.css`). Everything else uses **emoji** or pure CSS shapes.

**Approach by surface**

- **Window controls** (minimize / maximize / close, top-right of titlebar): three tiny 10×10 inline SVGs drawn with `stroke="currentColor"`, stroke-width 1.2, rounded caps. Monochrome — they pick up the current text color and shift to white on the red `--danger` background only for the close button on hover.
- **Pattern tabs** (the floating glass pill at the bottom of the Patterns preview): **emoji as the icon.** `🎨 Mesh gradient`, `🔺 Geometric`, `🔘 Dots`, `🦓 Stripes`, `😀 Emoji`. Rendered at 18px inside a 40×36 button, with a tooltip-on-hover showing the human-readable label. This is unusual and intentional — Ambient is a wallpaper app, emoji are content not chrome.
- **Sliding-pill indicator**: pure CSS — `background: rgba(255,255,255,0.20)` + double-inset highlight + a faint `0 1px 3px` drop-shadow. No icon.
- **Chip controls** (color chips, add-color, remove-color): `+` and `×` as text characters, not icons. Color chips are native `<input type="color">` (the OS picker handles itself).
- **Status indicators**: text-only. The "Re-roll" / "Re-fetch" buttons prefix with `↻` (U+21BB clockwise open circle arrow). The save toast is text-only ("Saved" in green).

**Emoji policy**

Emoji are **never decoration in body copy**. They appear only:
1. As pattern-tab button labels (mapped to pattern types — chosen for shape, not mood).
2. As **content** in emoji-pattern wallpapers, where the canvas loads **Microsoft Fluent 3D PNGs** from `cdn.jsdelivr.net/gh/microsoft/fluentui-emoji` (MIT-licensed art) and falls back to **Fluent Color (flat)** via `emojicdn.elk.sh` for emojis not in the curated 3D set. Default emoji set: `✨🌙⭐💫🪐` — cosmic/space-themed, matching the brand gradient.

**Unicode symbols used as glyphs**

- `↻` U+21BB — re-roll, re-fetch
- `+` `×` — add / remove color chip
- The `<select>` chevron is a 10×10 inline data-URI SVG using `stroke: %23a59cc4` (the muted color). It's the *only* iconographic SVG inside the design system, and it exists purely because no browser exposes the native select chevron to styling.

**Logos & marks**

- One asset: `assets/app-icon.png` (1024×1024, generated) + `assets/app-icon.svg` (source). A squircle with a twilight-sunset gradient (`#15053D → #5B21B6 → #EC4899 → #FBBF24`), a soft sun halo, two mountain ridges, and a glass-gloss overlay. **No wordmark.** "Ambient" appears only as the window title (string), never set in a custom typeface. The Flatpak manifest installs it as `/app/share/icons/hicolor/128x128/apps/com.ambient.app.png`.

**Substitutions**

- **None needed.** Ambient ships exactly what's in this DS. If you build new product surfaces (a Flathub listing page, screenshot, social card) and need an icon set, **substitute Lucide** at stroke-width 1.5 — it matches the existing hand-rolled window-control icons' stroke style most closely. Flag the substitution to the user.

---

## SHIPPING + DISTRIBUTION

Ambient ships as a **Flatpak** to Flathub. This shapes a few visual / content decisions:

- **AppStream summary is the one-liner** that shows up in the Flathub store listing: *"Wallpaper generator with patterns, emoji, and AI."* Eleven words, no adjectives. Use this string verbatim wherever a short description is needed.
- **Categories** are `Utility` and `Graphics` (AppStream taxonomy). Not "Lifestyle," not "Personalization."
- **Minimum display length is 720px** — declared in `metainfo.xml`. The app window does not need to be responsive below this width; it's a desktop app.
- **D-Bus permissions:** `org.kde.StatusNotifierWatcher` (tray icon) and `org.freedesktop.Notifications` (toast notifications). Filesystem access is scoped to `xdg-config:rw` (for writing `cosmic-bg`'s config) and `xdg-pictures:rw` (for the optional local-folder source). Wayland-first; X11 is fallback only.
- **Self-containment matters.** Pattern generation is fully offline. Online dependencies are the emoji CDN, the three image sources, and AI gen — all gracefully fail offline.

---

## Manifest

Top-level files in this design system:

| Path | Purpose |
|---|---|
| `README.md` | This file. |
| `SKILL.md` | Agent-Skill front-matter — load this folder into Claude Code as `ambient-design`. |
| `colors_and_type.css` | All design tokens as CSS variables (color, type, motion, radii, shadow). Importable. |
| `assets/` | Brand assets — `app-icon.svg` (source) + `app-icon.png` (generated 1024×1024). |
| `preview/` | 25 static HTML cards rendered into the Design System tab. Split by group: Brand · Colors · Type · Spacing · Components. |
| `ui_kits/desktop_app/` | High-fidelity React recreation of the Ambient app window — click-through all five tabs, live canvas preview. Run `index.html` directly, no build. |
| `reference/` | Read-only mirror of the source repo: CSS + key components + pattern engine + types + Flatpak manifest + AppStream metainfo. Source of truth. |
