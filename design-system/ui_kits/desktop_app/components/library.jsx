// Library tab — Apply / Delete from a grid of saved wallpapers.
// Thumbnails are rendered live with the same canvas engine as Patterns.

function ThumbCanvas({ entry }) {
  const ref = React.useRef(null);
  const [emojiImgs, setEmojiImgs] = React.useState([]);

  React.useEffect(() => {
    if (entry.type !== 'emoji') return;
    let cancelled = false;
    Promise.all((entry.emojis || window.DEFAULT_EMOJIS).map(window.loadEmojiImg)).then((imgs) => {
      if (!cancelled) setEmojiImgs(imgs.filter(Boolean));
    });
    return () => { cancelled = true; };
  }, [entry.type]);

  React.useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width = c.offsetWidth * 2;
    const h = c.height = c.offsetHeight * 2;
    const cfg = {
      type: entry.type || 'mesh',
      colors: entry.colors,
      density: entry.density || 40,
      size: entry.size || 60,
      randomness: entry.randomness ?? 0.5,
      emojis: entry.emojis || window.DEFAULT_EMOJIS,
      seed: entry.seed || 1,
    };
    window.renderPattern(ctx, w, h, cfg, emojiImgs);
  }, [entry, emojiImgs]);

  return <canvas ref={ref} style={{ width: '100%', aspectRatio: '16/10', display: 'block' }} />;
}

function Library({ library, onApply, onDelete, applyingStatus }) {
  return (
    <div className="library">
      <header className="settings-header">
        <h1>Library</h1>
        {applyingStatus && <span className="status">{applyingStatus}</span>}
      </header>
      <div className="library-grid">
        {library.length === 0 && (
          <div className="empty">
            Empty library. Generate one from <em>Patterns</em>, pull from a curated{' '}
            <em>Source</em>, or prompt an AI in <em>Generate</em> — anything you apply
            lands here for re-use.
          </div>
        )}
        {library.map((w) => (
          <div key={w.id} className="card">
            <div className="thumb-wrap">
              <ThumbCanvas entry={w} />
              <div className="card-actions-overlay">
                <button onClick={() => onApply(w)}>Apply</button>
                <button onClick={() => onDelete(w)} className="danger">Delete</button>
              </div>
            </div>
            <div className="card-meta">{w.source}{w.title ? ' · ' + w.title.slice(0, 40) : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.Library = Library;
