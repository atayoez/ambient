// Tiny inline-SVG icon set — exact copies of the four hand-rolled icons in
// the Ambient codebase. Window controls + select chevron. Nothing else.

function IconMin() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
function IconMax() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" rx="0.5" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="2.5" y1="2.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="7.5" y1="2.5" x2="2.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

Object.assign(window, { IconMin, IconMax, IconClose });
