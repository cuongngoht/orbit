// How wide a line LOOKS in a terminal, and cutting one to fit. A combining mark takes no column, a wide East
// Asian character or an emoji drawn as one (Emoji_Presentation -- 0.0.1: a text symbol such as ▶ ⚠ ⏸ is one cell,
// as terminals draw it, so a right-hand column and a band end where they should) takes two, and a cut never splits a
// character: the status line shares its row with the host's own notifications, so a line that overflows is truncated
// by somebody who does not know where a word ends.
//
//   drawn(segments, cols, colour) -> string     segments: [{ text, tone }]; cut by what they SHOW, then styled
import { clean, toned } from "./ansi.mjs";

const ZERO = /[\p{Mn}\p{Me}\u200b-\u200d\ufe0e\ufe0f]/u;
const WIDE = /[\p{Emoji_Presentation}ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

export const charWidth = (ch) => (ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1);

export const displayWidth = (text) => [...String(text)].reduce((w, ch) => w + charWidth(ch), 0);

const ELLIPSIS = "…";

// The longest prefix within `room` columns, stopping at the first character that does not fit.
const prefixWithin = (text, room) => [...String(text)].reduce((acc, ch) => (acc.full || acc.width + charWidth(ch) > room ? { ...acc, full: true } : { width: acc.width + charWidth(ch), text: acc.text + ch, full: false }), { width: 0, text: "", full: false }).text;

export function fit(text, cols) {
  if (displayWidth(text) <= cols) return String(text);
  return cols <= 0 ? "" : `${prefixWithin(text, cols - 1)}${ELLIPSIS}`;
}

// Segments of DATA and their tones, made safe (clean), cut to `cols` as one line, then coloured: the cut is
// made on what a person sees, and the only sequences in the result are the styler's.
export function drawn(segments, cols, colour) {
  const pieces = segments.filter((s) => s && s.text !== null && s.text !== undefined && s.text !== "").map((s) => ({ text: clean(s.text), tone: s.tone }));
  const whole = fit(pieces.map((p) => p.text).join(""), cols);
  return cut(pieces, whole).map((p) => toned(p.text, p.tone, colour)).join("");
}

// The pieces again, over exactly the characters `whole` kept (and its … on the last one).
function cut(pieces, whole) {
  const state = { left: [...whole], out: [] };
  for (const p of pieces) state.out.push({ text: state.left.splice(0, [...p.text].length).join(""), tone: p.tone });
  if (state.left.length) state.out.push({ text: state.left.join(""), tone: undefined });
  return state.out.filter((p) => p.text.length > 0);
}
