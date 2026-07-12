// Color-chip / emoji-chip row for the Patterns inspector. Switches
// shape based on the active pattern type — `emoji` renders the emoji
// chip row + picker, everything else renders the colour chip row. The
// emoji picker popover state lives here so the click-outside +
// escape-to-close behaviour is colocated with the trigger.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MAX_COLORS, MIN_COLORS, type PatternType } from '../lib/patterns';
import { PlusIcon, XIcon } from './Icons';

// Lazy: the picker only mounts while its popover is open, and its chunk
// carries the full grouped emoji table (~50 KB of data in
// lib/emojiCategories.json) — code-splitting it keeps all of that off
// the startup path.
const EmojiPicker = lazy(() => import('./EmojiPicker'));

interface PaletteEditorProps {
  type: PatternType;
  colors: string[];
  emojis: string[];
  onColorChange: (i: number, color: string) => void;
  onAddColor: () => void;
  onRemoveColor: (i: number) => void;
  onAddEmoji: (emoji: string) => void;
  onReplaceEmoji: (i: number, emoji: string) => void;
  onRemoveEmoji: (i: number) => void;
}

export default function PaletteEditor({
  type,
  colors,
  emojis,
  onColorChange,
  onAddColor,
  onRemoveColor,
  onAddEmoji,
  onReplaceEmoji,
  onRemoveEmoji,
}: PaletteEditorProps) {
  // Emoji picker popover state. The wrap ref scopes the click-outside
  // handler — any click NOT inside the emoji row (chips, "+", popover)
  // closes the picker. Escape also closes.
  //
  // `editIndex` is the target of the next pick: null means the "+" was
  // the trigger (append a new emoji), a number means that emoji chip was
  // clicked (replace that slot in place).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Open the picker aimed at `index` (null = append via the "+").
  // Re-clicking the same trigger toggles it shut.
  function openPicker(index: number | null) {
    setPickerOpen((open) => !(open && editIndex === index));
    setEditIndex(index);
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // The picker is portaled to <body>, so it's not a DOM descendant
      // of wrapRef — match it by class instead, otherwise clicking
      // inside the popover (scrolling, category headers) would read as
      // "outside" and close it.
      if (!wrapRef.current?.contains(target) && !target.closest?.('.emoji-picker')) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  if (type === 'emoji') {
    return (
      <div className="emoji-row" ref={wrapRef}>
        {emojis.map((emoji, i) => (
          <div key={`${emoji}-${i}`} className="emoji-chip">
            <button
              type="button"
              className="emoji-chip-glyph"
              onClick={() => openPicker(i)}
              aria-label={`Change emoji ${emoji}`}
              aria-expanded={pickerOpen && editIndex === i}
              title="Click to change"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
            {emojis.length > 1 && (
              <button
                type="button"
                onClick={() => onRemoveEmoji(i)}
                className="chip-remove"
                aria-label={`Remove emoji ${emoji}`}
                title="Remove"
              >
                <XIcon size={11} />
              </button>
            )}
          </div>
        ))}
        <div className="emoji-picker-wrap">
          <button
            type="button"
            className="add-emoji"
            aria-label="Add emoji"
            aria-expanded={pickerOpen && editIndex === null}
            onClick={() => openPicker(null)}
          >
            +
          </button>
          {pickerOpen && (
            <Suspense fallback={null}>
              <EmojiPicker
                onPick={(emoji) => {
                  if (editIndex === null) onAddEmoji(emoji);
                  else onReplaceEmoji(editIndex, emoji);
                  setPickerOpen(false);
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="colors-row">
      {colors.map((c, i) => (
        <div key={i} className="color-chip">
          <input
            type="color"
            value={c}
            onChange={(e) => onColorChange(i, e.target.value)}
            aria-label={`color ${i + 1}`}
          />
          {/* `colors` here is the foreground slice (config.colors minus
              the background chip), so the shared whole-palette limits
              shift down by one. */}
          {colors.length > MIN_COLORS - 1 && (
            <button
              onClick={() => onRemoveColor(i)}
              className="chip-remove"
              aria-label="remove color"
              title="Remove color"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
      ))}
      {colors.length < MAX_COLORS - 1 && (
        <button
          onClick={onAddColor}
          className="add-color"
          aria-label="Add color"
          title="Add color"
        >
          <PlusIcon size={14} />
        </button>
      )}
    </div>
  );
}
