import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Platform tag on the root element. The earlier per-platform CSS (different
// backdrop-filter strengths, SVG turbulence on macOS only, lighter blur on
// WebKitGTK) is gone now that the window background is opaque + bleed-driven,
// but keeping the attribute means future surface-specific tweaks can still
// branch on it cheaply without re-introducing this setup.
const ua = navigator.userAgent;
const platform: 'macos' | 'windows' | 'linux' = /Mac OS X|Macintosh/.test(ua)
  ? 'macos'
  : /Windows/.test(ua)
    ? 'windows'
    : 'linux';
document.documentElement.dataset.platform = platform;

// Suppress the default webview right-click context menu — this is a desktop
// app, not a webpage, and the OS-level Inspect / Copy / Paste menu isn't a
// native interaction we want exposed.
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Strip out browser-shaped interactions that don't make sense in a packaged
// desktop app. The Tauri webview inherits Chromium / WebKit defaults for
// these, which include page zoom, reload, find-in-page, print, and image
// drag-to-save — all jarring inside a one-window utility. App-level
// shortcuts (Cmd/Ctrl + 1..4 for tab switching) remain because they don't
// collide with any of these.
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  // Browser zoom: Ctrl/Cmd + (+, =, -, 0)
  if (mod && (k === '+' || k === '=' || k === '-' || k === '0')) {
    e.preventDefault();
    return;
  }
  // Reload (Ctrl/Cmd+R, Ctrl/Cmd+Shift+R, F5)
  if ((mod && k === 'r') || k === 'f5') {
    e.preventDefault();
    return;
  }
  // Find-in-page (Ctrl/Cmd+F) — we don't have a search UI yet, swallow.
  if (mod && k === 'f') {
    e.preventDefault();
    return;
  }
  // Print (Ctrl/Cmd+P) — meaningless for a wallpaper app.
  if (mod && k === 'p') {
    e.preventDefault();
    return;
  }
  // Save-as dialog (Ctrl/Cmd+S) — the app already auto-persists.
  if (mod && k === 's') {
    e.preventDefault();
    return;
  }
});

// Ctrl + scroll-wheel triggers Chromium / WebKit page zoom. passive:false
// is required for preventDefault to actually take effect on wheel events.
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

// Safari/WebKit pinch-zoom on trackpads fires `gesture*` events even
// inside the webview. Chromium-based WebView2 ignores these listeners
// (events don't fire), so the call is no-op there.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

// Block native image-drag-to-save on every <img> and <canvas>. CSS handles
// the same thing for visual feedback (cursor doesn't change), this is the
// behavioral half — without it, dragging the Library card thumbnails would
// initiate a browser drag operation that we don't want surfacing in a
// desktop app context.
document.addEventListener('dragstart', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'IMG' || tag === 'CANVAS') e.preventDefault();
});

// The Windows live-wallpaper window (live_win.rs) loads `index.html#wallpaper`
// and parents itself behind the desktop icons. In that mode we mount only the
// fullscreen renderer — none of the app chrome — and deliberately skip
// StrictMode: its double-mount tears down and re-creates the WebGL context,
// which leaves the live shader running on a dead context (see the
// liveShader/StrictMode note in the live-wallpaper memory).
const root = ReactDOM.createRoot(document.getElementById('root')!);
if (window.location.hash === '#wallpaper') {
  import('./components/LiveWallpaper').then(({ default: LiveWallpaper }) => {
    root.render(<LiveWallpaper />);
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
