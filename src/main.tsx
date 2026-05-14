import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Suppress the default webview right-click context menu — this is a desktop
// app, not a webpage, and the OS-level Inspect / Copy / Paste menu isn't a
// native interaction we want exposed.
document.addEventListener('contextmenu', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
