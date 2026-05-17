---
name: ambient-design
description: Use this skill to generate well-branded interfaces and assets for Ambient, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Ambient design

Ambient is a **Linux wallpaper-generator desktop app, distributed as a Flatpak on Flathub** (Tauri 2 + React + TS). One window, five tabs, a frosted-glass aesthetic with a sliding-pill tab indicator floating over the user's live desktop wallpaper. Dark by default; full light-mode override. Native COSMIC desktop integration (writes directly to `cosmic-bg`'s RON config); GNOME/KDE/sway/X11 via the `wallpaper` crate. macOS/Windows/mobile/web are explicitly **future, not v0**.

Repo: [github.com/atayozcan/ambient](https://github.com/atayozcan/ambient) (proprietary). App ID: `com.ambient.app`. AppStream summary: *"Wallpaper generator with patterns, emoji, and AI."*

## What's in here

- `README.md` — full context. Read this first. Covers product positioning, content fundamentals (voice / tone / casing), visual foundations (color, type, spacing, motion, shadows, blur, radii, layout), and iconography.
- `colors_and_type.css` — all design tokens as CSS variables (`--accent`, `--surface`, `--radius-inline`, `--ease-pill`, etc.) plus semantic role helpers (`.ds-h1`, `.ds-eyebrow`). Importable.
- `assets/` — `app-icon.svg` + `app-icon.png` (1024×1024 cosmic squircle with an aurora ribbon across the lower half). The only brand mark Ambient has.
- `preview/` — 24 static HTML cards covering every primitive (palettes, surfaces, type, radii, shadows, blur, motion, buttons, inputs, chips, tabs, library cards, empty/status/toast, iconography). Use these for visual cross-reference.
- `ui_kits/desktop_app/` — a full click-through React recreation of the Ambient window. `index.html` boots without a build step. Read its `README.md` for component coverage.
- `reference/` — read-only copies of the original Ambient source (CSS + key component JSX + README). Source of truth.

## When you're asked to design

If the user invokes this skill without other guidance, ask them what they want to build (a new tab in Ambient? a marketing page? a docs site? a screenshot for an app store?) and a few clarifying questions. Then act as an expert designer.

When creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out of this skill folder and create static HTML files for the user to view.

When working on production code, copy `colors_and_type.css` and refer to the JSX in `ui_kits/desktop_app/components/` for component implementations.

## The non-negotiables — anything you ship as "Ambient" needs

1. **The frosted-glass aesthetic.** Translucent white-on-tinted-dark surfaces, `backdrop-filter: blur(40px) saturate(180%)` on the app shell. Never solid fills.
2. **The sliding-pill tab indicator.** A separate `.tab-indicator` element absolutely positioned, transformed with `cubic-bezier(0.32, 0.72, 0, 1)` over 380ms. The tabs themselves are transparent — the pill IS the selected state.
3. **Three radii only.** 8 / 12 / 14 + 999 for pills. Documented in code as a hard rule.
4. **Cosmic palette as primary brand color.** Lavender `#b794f6` (accent), pink `#ec4899`, amber `#fbbf24` — the canonical 5-stop gradient.
5. **System font stack** — no webfont. `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif`.
6. **Sentence case + UPPERCASE eyebrows.** Buttons say *Apply as wallpaper*, sections are eyebrowed `COLORS` / `RANDOMNESS` at 12px / `letter-spacing: 0.05em`.
7. **Voice = honest, technical, opinionated.** Read the CONTENT FUNDAMENTALS section in `README.md` for examples. No exclamation points, no "amazing," no emoji in body copy.

## Hard nos

- No icon font, no Lucide/Heroicons drop-in unless extending beyond the existing app. Ambient ships exactly **three inline SVGs** (window controls) + emoji-as-pattern-icons.
- No bluish-purple gradient backgrounds *as decoration* — the cosmic gradient is content (it's in wallpapers / patterns / the app icon), never a background-fill for cards or sections.
- No outer drop-shadow on cards, inputs, or sections. Only the window and floating overlays cast outer shadow. Elevation is opacity + inset top sheen.
- No emoji in body copy. Emoji exist as content (pattern previews) and as labels in the pattern-tabs pill — never anywhere else.
- No scroll-snap, no parallax, no bouncy springs. The only motion easing is `cubic-bezier(0.32, 0.72, 0, 1)`; the only timing options are 120 / 220 / 380ms.
