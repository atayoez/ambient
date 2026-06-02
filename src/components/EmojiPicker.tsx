// Curated emoji picker for the Patterns tab. Six themed categories,
// ~16 emojis each, no search / no recents / no skin-tone variants —
// just a popover grid sized to feel like an inspector accessory rather
// than a full app feature. One pick per open: the consumer closes the
// picker after onPick fires (and also on click-outside / Escape).
//
// Deliberately not a third-party emoji picker — `emoji-picker-react`
// and `emoji-mart` add 70-200 KB to the bundle for capabilities Ambient
// doesn't need (categories, search, recents, skin tones, locale).

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

const CATEGORIES: { name: string; emojis: string[] }[] = [
  {
    name: 'Cosmic',
    emojis: [
      '✨',
      '⭐',
      '🌟',
      '🌠',
      '💫',
      '🌙',
      '🌛',
      '🌜',
      '🌌',
      '🪐',
      '☄️',
      '🌍',
      '🌎',
      '🌏',
      '☀️',
      '🔥',
    ],
  },
  {
    name: 'Nature',
    emojis: [
      '🌸',
      '🌺',
      '🌻',
      '🌷',
      '🌹',
      '🌼',
      '💐',
      '🍀',
      '🌿',
      '🌱',
      '🌳',
      '🌲',
      '🌴',
      '🍂',
      '🍁',
      '🍃',
    ],
  },
  {
    name: 'Animals',
    emojis: [
      '🐶',
      '🐱',
      '🦊',
      '🐻',
      '🐼',
      '🐯',
      '🦁',
      '🐸',
      '🐙',
      '🐳',
      '🐬',
      '🦋',
      '🐝',
      '🐞',
      '🦄',
      '🐢',
    ],
  },
  {
    name: 'Faces',
    emojis: [
      '😀',
      '😊',
      '😎',
      '🥰',
      '😍',
      '🤩',
      '😇',
      '🥺',
      '😴',
      '😪',
      '🤔',
      '🤗',
      '😋',
      '🤤',
      '😜',
      '🤪',
    ],
  },
  {
    name: 'Food',
    emojis: [
      '🍕',
      '🍔',
      '🍟',
      '🍿',
      '🍩',
      '🍪',
      '🍰',
      '🧁',
      '🍫',
      '🍓',
      '🍎',
      '🍌',
      '🍇',
      '🍉',
      '🍑',
      '🍒',
    ],
  },
  {
    name: 'Objects',
    emojis: [
      '🎨',
      '🎮',
      '🎸',
      '🎁',
      '🎈',
      '🎉',
      '💎',
      '⚡',
      '💧',
      '❄️',
      '🌈',
      '☘️',
      '🍄',
      '🎵',
      '🎶',
      '🔮',
    ],
  },
];

export default function EmojiPicker({ onPick }: EmojiPickerProps) {
  return (
    <div className="emoji-picker" role="dialog" aria-label="Emoji picker">
      {CATEGORIES.map((cat) => (
        <div key={cat.name} className="emoji-picker-cat">
          <h4 className="emoji-picker-cat-title">{cat.name}</h4>
          <div className="emoji-picker-grid">
            {cat.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-picker-item"
                onClick={() => onPick(emoji)}
                aria-label={`Add ${emoji}`}
                title={`Add ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
