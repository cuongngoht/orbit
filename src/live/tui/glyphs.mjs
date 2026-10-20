// The full-screen viewer's glyphs in plain ASCII, for a terminal (or a font) that has none of the others: every
// glyph the live words use (src/live/words.mjs) and the few the viewer adds -- the bars, the rules, the row
// marks. A test holds every glyph of words.mjs to a row here, so `--ascii` never leaves one behind.
export const ASCII = Object.freeze({
  "◐": "/", "◓": "-", "◑": "\\", "◒": "|", "●": "*", "○": "o", "◌": ".", "✓": "ok", "✗": "x", "▶": ">",
  "◇": "<>", "⚠": "!", "⏸": "||", "■": "#", "📸": "[pic]", "👤": "[person]", "→": "->", "⏎": "|", "·": "-",
  "▓": "#", "░": ".", "═": "=", "─": "-", "…": "...", "›": ">", "▸": ">", "←": "<-", "↑": "^", "↓": "v",
  "−": "-", "—": "-", "▏": "|", "↻": "~>", "•": "o", "▲": "^",
  // A card's border (0.0.2): its corners a plus, its sides a bar.
  "╭": "+", "╮": "+", "╰": "+", "╯": "+", "│": "|", "━": "=",
  // The orbit's Braille cells (words.mjs ORBIT_GLYPHS): a cell holding the planet reads "o", the satellite ".".
  "⠶": "o", "⠷": "o", "⠿": "o", "⠾": "o", "⢶": "o", "⣶": "o", "⡶": "o", "⠀": " ",
  "⠊": ".", "⠈": ".", "⠁": ".", "⠑": ".", "⠰": ".", "⡠": ".", "⡀": ".", "⢀": ".", "⢄": ".", "⠆": ".",
});

const PATTERN = new RegExp(`[${Object.keys(ASCII).map((k) => k.replace(/[\\\]^-]/g, "\\$&")).join("")}]`, "gu");

// The text with every glyph of the table replaced, or the text as it was when the viewer draws Unicode.
export const glyph = (text, ascii) => (ascii ? String(text).replace(PATTERN, (ch) => ASCII[ch] ?? ch) : String(text));
