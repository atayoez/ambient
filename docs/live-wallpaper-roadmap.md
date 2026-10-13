# Live Wallpaper — Roadmap for the backlog

Follow-up to the live-wallpaper feature shipped 2026-06-18 (branch feat/tauri-mobile,
commit 86ad1ac): an Animate toggle in Patterns turns the single Apply button into a
live-wallpaper apply, delivered on KDE Plasma 6 via a bundled wallpaper plugin. See the
project_live_wallpaper memory for the full architecture + gotchas.

DONE 2026-06-19 — section C: every pattern now animates as a real shader (bokeh = rising
swirling bubbles, stripes = directional scroll, geometric = drifting/spinning SDF shapes,
flower = symmetric counter-rotating petal rings, mesh = drifting metaball gradient). Plus
a render-quality selector (Settings → resolution/fps caps) and an app-triggered
plasmashell reload when the plugin upgrades (Plasma caches plugin QML per session, so new
types rendered blank otherwise). Next: per-pattern selectable animation styles.

Remaining: B2 (Android). A (video/GIF), B1 (desktop windows) and B3 (GNOME) are implemented.

## Carry-forward gotchas (don't rediscover these)
- qsb MUST bake GLES variants ("100es,300es" on top of "150,330,440" — gen-shaders.ts owns
  the list). Plasma/Qt Quick runs an OpenGL ES context on some machines (seen: aarch64 +
  NVIDIA), where a desktop-GL-only bake fails with "No GLSL shader code found (versions
  tried: 320, 310, 300, 100)" in the plasmashell journal and every ShaderEffect pattern
  renders blank — only the shaderless emoji field survives. That journal line is the
  fingerprint; check it before suspecting the renderer.
- NVIDIA + Wayland webview crash ("Error 71... dispatching to Wayland display") is NVIDIA's
  EGL registering wp_linux_drm_syncobj explicit sync while GTK3 commits without an acquire
  point. Fix is __NV_DISABLE_EXPLICIT_SYNC=1 (lib.rs), NOT WEBKIT_DISABLE_DMABUF_RENDERER=1
  — the latter also kills GPU compositing and with it every backdrop-filter glass blur.
- Qt6 ShaderEffect on Plasma's GL backend needs our own wallpaper.vert pass-through vertex
  shader (built-in fails "qt_TexCoord0 ... no matching output").
- GPU cap is mandatory: drive the clock from a ~30fps Timer (not FrameAnimation) and render
  into a reduced-res layer.textureSize. Bump PLUGIN_VERSION in live.rs on any plugin change.
- Plasma caches plugin QML per shell session: after a PLUGIN_VERSION bump the running
  plasmashell still runs the OLD main.qml, so new pattern types render blank. install_plugin
  returns whether it upgraded; set_kde_live restarts plasmashell (systemctl --user) on upgrade.
- Cell-grid shaders (dots/geometric): use a FIXED AA width, never fwidth(sd) — sd jumps across
  cell borders so fwidth spikes there and smears colour into faint grid seams.
- Regular polygons: use an exact radial-boundary coverage (boundary = s*cos(pi/n)/cos(angle));
  the iq "fold" n-gon SDF reports far points along vertex axes as inside -> giant filled wedges.
- WebGL is dead in the app's webview on NVIDIA (WEBKIT_DISABLE_DMABUF_RENDERER=1 kills it);
  the KDE plugin renders in Qt so it's fine, but the desktop override-window (B1) inherits
  this on Linux/NVIDIA.
- Dev loop: edit .frag -> qsb --glsl "150,330,440" -o x.frag.qsb x.frag ->
  kpackagetool6 --type Plasma/Wallpaper --upgrade <dir> ->
  systemctl --user restart plasma-plasmashell.service -> apply via qdbus6 evaluateScript.
  plasmoidviewer/qmlscene are NOT installed; verify via real apply + journalctl --user.

## C. Depth for the 5 flat static patterns  — DONE 2026-06-19
mesh, geometric, stripes, flower, bokeh all ported to procedural shaders (no longer the flat
Image Ken-Burns drift). bokeh = rising/swirling bubbles; stripes = seeded directional scroll;
geometric = drifting+spinning SDF shapes (circle/triangle/square/hexagon/star/plus, radial-
boundary polygons, fixed AA); flower = symmetric counter-rotating petal rings, reach-capped to
fit + opaque; mesh = drifting metaball gradient. Original plan kept below for reference.

- Easy wins:
  - bokeh ~ dots with a large soft radial falloff (copy dots.frag/DOTS_MAIN, widen radius,
    soften edge, drop sizeVar's hard cutoff).
  - stripes — a scrolling/waving stripe field (1D phase along the stripe-angle normal).
  - geometric — drifting + slowly rotating polygons (dots but SDF shapes per cell).
- Harder (defer or keep drift): mesh (metaballs) and flower (rotating petals).
- Per-pattern wiring (grep "dots" for every touch point): add <name>.frag (Qt) + <NAME>_MAIN
  (shaders.ts), bake .qsb, add to ANIMATABLE (patterns.ts), FRAG_SHADERS (shaders.ts),
  knobs() (liveShader.ts), Rust renders_in_plugin (live.rs), isGenerative + knob() (main.qml).
- Effort: ~half a day for bokeh+stripes+geometric.

## A. Video / GIF import live wallpaper  — IMPLEMENTED 2026-10-13 (needs on-device verification)
Shipped for every delivery at once, not KDE first. Spec `{ kind: "video", video, format }`
(live.rs build_video_spec stamps format/speed/clock); import_live_video (shell, Rust-side
tauri-plugin-dialog) → live::import_video copies into <app data>/live (hash-named, prunes
every older import except the active clip). Webview: VideoFill.tsx (<video> loop muted /
<img> for GIF, playbackRate = speed; CSP gained media-src asset:). KDE: AnimatedImage for
GIF; video via contents/ui/VideoLayer.qml behind a Loader so a missing QtMultimedia only
breaks video, never every pattern. Tray "Random" no-ops on a video (not a pattern).
Not done: pause when the desktop is covered; WebKitGTK needs gst-plugins for the codec.
Original plan kept below.
- Data model: add a kind discriminator — { "kind": "video", "video": "/abs/path.mp4" } vs
  the pattern spec. Plugin branches on spec.kind === "video".
- Import (Rust): new command import_video(src) — Tauri file dialog (mp4/webm/gif), validate,
  copy into the wallpaper dir, return path; then write the video spec + set the plugin.
- KDE plugin: a Video branch in main.qml — import QtMultimedia + MediaPlayer (loops:
  Infinite, muted) + VideoOutput (fillMode: PreserveAspectCrop); GIF via AnimatedImage.
  References: plasma-smart-video-wallpaper-reborn, TuxPapers. Confirm QtMultimedia/gstreamer;
  pause on onVisibilityChanged.
- Preview: <video loop muted playsinline> in the gen-stage (small new component).
- UI: an "Import video..." entry near the Animate toggle (orthogonal — video is inherently live).
- Effort: ~1-1.5 days (KDE only). AI/Source photos still can't move — out of scope.

## B. Other delivery platforms  (biggest)

### B1. Desktop override-window (Windows + macOS + Linux layer-shell) — DONE
Windows (WorkerW, live_win.rs) and macOS (desktop-level NSWindow, live_mac.rs) shipped
in 1.2; Linux shipped 2026-09-04 as live_linux.rs: the same `#wallpaper` webview window
turned into a zwlr_layer_shell_v1 `background` surface via gtk-layer-shell (GTK3), which
covers COSMIC (primary), Sway, Hyprland, Niri, River, labwc, Wayfire. GNOME has no
layer-shell for third parties → still unsupported (the app says so). KDE keeps the plugin.
Gotchas: init_layer_shell MUST run before the GtkWindow is realized — Tauri leaves a
`.visible(false)` window unrealized, so create hidden → init → show. Anchor all 4 edges,
exclusive_zone -1 (run under panels), keyboard_mode None, empty input region (click-through).
The window dies with the process → live::restore_if_active re-applies it after a restart (or a compositor close)
(all three window platforms; KDE skipped). Multi-monitor (2026-09-04): Linux = one surface
per gdk::Monitor via set_monitor, reconciled by ensure_surfaces on apply / monitor-added /
compositor close (label wallpaper-<n>, n never reused); macOS = one NSWindow per NSScreen,
rebuilt on NSApplicationDidChangeScreenParametersNotification (block2 observer, debounced);
Windows = one WorkerW child per monitor (EnumDisplayMonitors rects mapped into WorkerW client
space with MapWindowPoints — raw virtual-screen coords were off by the origin), no
WM_DISPLAYCHANGE listener yet. Windows/macOS paths are type-checked cross-target only
(scratch crates against x86_64-pc-windows-msvc / aarch64-apple-darwin); first real run is
the release matrix. Live clock (2026-09-04): Settings.live_clock → spec.clock → ClockOverlay.tsx
(webview + Patterns preview) and a QML twin in main.qml. Original plan kept below.

A second Tauri WebviewWindow ("live") pinned to the desktop layer, loading a live.html that
reuses the existing web renderers (LivePreview WebGL canvas + EmojiField DOM + drift img +
<video>) full-screen — a windowless "live mode" of the preview.
- Per-OS pin from the native handle: Windows WorkerW reparent (windows crate); macOS NSWindow
  desktop level (objc2-app-kit); X11 _NET_WM_WINDOW_TYPE_DESKTOP.
- Owned by the tray process (survives main-window close via existing prevent_exit). Add the
  "live" window to Tauri capabilities; create it AFTER the WebKit env guards in lib.rs.
- Honest limits: GNOME-Wayland can't host a desktop-layer window -> frame-cycling fallback or
  unsupported. Linux/NVIDIA WebGL caveat applies (KDE already has the plugin — keep it there).
- Effort: ~2-3 days Win+macOS; X11/Wayland fallback extra.

### B3. GNOME — IMPLEMENTED 2026-10-13 (needs on-device verification)
Mutter has no layer-shell, so a GNOME Shell extension does the placing:
gnome/extensions/ambient-live@oezcan.me (embedded + installed by live_gnome.rs into
~/.local/share/gnome-shell/extensions). live_linux.rs picks a `Delivery` at startup
(LayerShell if gtk-layer-shell is supported, else Gnome if XDG_CURRENT_DESKTOP says GNOME)
and on GNOME creates the same `wallpaper-<n>` webview windows as ordinary toplevels titled
`ambient-live-wallpaper@x,y,w,h` (the GDK monitor's logical geometry). The extension
matches that title on window-created and, on GNOME 49+ (feature-detected via
`Meta.Window.prototype.set_type`), calls set_type(DESKTOP) + hide_from_window_list() —
the public replacement for Meta.WaylandClient.make_desktop, which was removed in 49 and
only ever worked for clients the shell spawned itself. GNOME 45-48 fallback: lower() on
every raise + patched Workspace/WorkspaceThumbnail._isOverviewWindow and
Meta.Display.get_tab_list (both Alt+Tab switchers read it); the app may still show as
running in the dash there.
Both: stick(), move_resize_frame to the monitor, re-fit on monitors-changed.
Gotchas: GNOME Shell on Wayland only loads newly installed extensions at login, so the
first apply writes enabled-extensions via gsettings and asks for a relogin; apply checks
GetExtensionInfo over gdbus and refuses to create windows until the extension is ACTIVE
(a window without it would cover the desktop). Never auto-enable an INACTIVE extension
(the user turned it off; the restore path would fight them). The window must be
resizable — Tauri's resizable(false) pins min = max size and Mutter can't fit it.
session-modes includes unlock-dialog so locking the screen doesn't disable it.
Not done: overview / lock screen show GNOME's static background (a Clutter.Clone of
the window into the background actors would fix that); publishing on extensions.gnome.org
(InstallRemoteExtension would load without a relogin).

### B2. Android WallpaperService
- Generative/dots: a GLSurfaceView-on-Engine-SurfaceHolder running the shaders adapted to
  GLES2/3 (the WebGL GLSL ES is close). Emoji: Canvas.drawText, or GLES. Video: ExoPlayer.
- Manifest: service + res/xml/wallpaper.xml + BIND_WALLPAPER; launch via
  ACTION_CHANGE_LIVE_WALLPAPER. Read the spec from filesDir. Lives in plugins/wallpaper/.
  Honor onVisibilityChanged; cap fps.
- Effort: ~3-4 days (Kotlin + GLES + spec bridge). Largest item.

## Verification (per item)
- C: apply via qdbus6 + journalctl --user for shader errors; eyeball motion; GPU stays capped.
- A: import a clip -> desktop plays it looped/muted; preview <video> matches; revert works.
- B1: the live window sits behind icons, survives main-window close, ignores clicks (Win/macOS).
- B2: on-device — the system live-wallpaper picker shows Ambient; home/lock animate; pause works.

## Key files to reuse
- Shaders: src/lib/shaders.ts (+ liveShader.ts, LivePreview.tsx); Qt
  plasma/wallpapers/me.oezcan.ambient/contents/shaders/*.frag (+ .qsb).
- Emoji: src/components/EmojiField.tsx + the QML Repeater in main.qml.
- KDE delivery + spec + install: src-tauri/core/src/live.rs.
- Data model / rotation guard: Settings.live_wallpaper (types.rs), rotation.rs.
- Commands: apply_live_pattern / clear_live_wallpaper / get_live_wallpaper (commands.rs, lib.rs).
