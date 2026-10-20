// The ONE place in the engine that writes a terminal escape sequence. Everything a viewer shows comes from a
// journal some other process wrote, so no string from a journal may ever carry a sequence of its own to the
// terminal: every piece of data passes `clean` (src/printable.mjs, which removes every control character
// including ESC, and the reordering marks) BEFORE it is styled here, and the only sequences that leave Orbit are
// this file's: SGR colours (sixteen, or -- 0.0.1, ADR 0027 -- 256 or 24-bit with a background), cursor-up and
// clear-to-end for an in-place repaint, hiding the cursor, and -- for the full-screen viewer only -- the alternate
// screen, a cursor position, clearing one row and turning the terminal's line wrap off while it paints (so a row a
// terminal measures wider than we do is clipped, never wrapped onto the next).
//
// Whether to colour at all is the CALLER's decision (a TTY, NO_COLOR, TERM=dumb, the status line's host): a
// pure renderer is handed `colour: true | false` -- or, for a terminal with more colours, a PAINT
// `{ depth: "256" | "truecolor", band }` (theme.mjs) -- and never reads the environment.
import { printable } from "../../printable.mjs";
import { BANDS, LOOK, PALETTE } from "./theme.mjs";

const ESC = "\u001b[";

const SGR = Object.freeze({ bold: "1", dim: "2", reverse: "7", red: "31", green: "32", yellow: "33", blue: "34", magenta: "35", cyan: "36", gray: "90" });

// The orbit's tones in sixteen colours (0.0.3): the planet and the satellite in front of it in the brand's; behind it,
// grey -- and the badge's orbit (`pill:` before the tone) the same.
const ORBIT_TONES = Object.freeze({ "orbit:planet": "magenta", "orbit:near": "magenta", "orbit:far": "gray", "orbit:near:gentle": "gray", "orbit:far:gentle": "gray", "orbit:track": "gray" });

// A word's TONE as a colour; a tone not here is drawn plain.
export const TONES = Object.freeze({ success: "green", danger: "red", warning: "yellow", info: "cyan", brand: "magenta", subtle: "gray", label: "bold", match: "reverse", title: "magenta", chip: "magenta", key: "magenta", selected: "reverse", track: "gray", "pill:success": "green", "pill:danger": "red", "pill:warning": "yellow", "pill:info": "cyan", "pill:subtle": "gray", ...ORBIT_TONES, ...Object.fromEntries(Object.entries(ORBIT_TONES).map(([tone, c]) => [`pill:${tone}`, c])) });

export const style = (text, name, colour) => (colour && SGR[name] ? `${ESC}${SGR[name]}m${text}${ESC}0m` : text);

// A PAINT draws a tone from theme.mjs's LOOK at the terminal's depth, on the row's BAND when it has one: bold, the
// colour, then the tone's own background or the band's -- one SGR, so a segment on a band never drops to the
// terminal's own background between its pieces. Sixteen colours, or `true`, draw TONES as before.
const rich = (colour) => typeof colour === "object" && colour !== null && (colour.depth === "256" || colour.depth === "truecolor");

const LAYERS = { truecolor: (layer, name) => `${layer};2;${PALETTE[name].rgb.join(";")}`, 256: (layer, name) => `${layer};5;${PALETTE[name].xterm}` };

const layerOf = (depth, layer, name) => (name && PALETTE[name] ? LAYERS[depth](layer, name) : null);

const codesOf = (tone, paint) => ((l) => [l.bold ? "1" : null, l.reverse ? "7" : null, layerOf(paint.depth, "38", l.fg), layerOf(paint.depth, "48", l.bg ?? BANDS[paint.band])].filter(Boolean).join(";"))(LOOK[tone] ?? {});

const painted = (text, tone, paint) => ((codes) => (codes && text ? `${ESC}${codes}m${text}${ESC}0m` : text))(codesOf(tone, paint));

export const toned = (text, tone, colour) => (rich(colour) ? painted(text, tone, colour) : style(text, TONES[tone], colour));

// Blank cells on the row's band: the padding between a row's left and right, and after them.
export const blankOn = (n, colour) => (n > 0 ? toned(" ".repeat(n), null, colour) : "");

export const cursorUp = (n) => (n > 0 ? `${ESC}${n}A` : "");
export const clearDown = () => `${ESC}J`;
export const lineStart = () => "\r";
export const hideCursor = () => `${ESC}?25l`;
export const showCursor = () => `${ESC}?25h`;

// The full-screen viewer's frame: written by its terminal adapter (cli/live-tui.mjs), never inside a line a
// renderer returns, so a line still holds nothing but colour.
export const enterAlt = () => `${ESC}?1049h`;
export const leaveAlt = () => `${ESC}?1049l`;
export const wrapOff = () => `${ESC}?7l`;
export const wrapOn = () => `${ESC}?7h`;
export const cursorTo = (row, col) => `${ESC}${Math.max(1, Math.floor(row))};${Math.max(1, Math.floor(col))}H`;
export const clearLine = () => `${ESC}2K`;
export const clearScreen = () => `${ESC}2J`;
export const resetStyle = () => `${ESC}0m`;

// Every sequence this file can write, as a test reads a terminal's bytes back: SGR, the private modes above,
// a position, clearing a row or the screen, cursor-up.
export const OWN_SEQUENCE = /^\u001b\[((\d+(;\d+)*)?m|\?(1049|25|7)[hl]|\d+;\d+H|2K|2J|J|\d+A)$/;

// Data, made safe to show on ONE line: no control character, no reordering mark, no line break -- a break in a
// journal's text is shown as ⏎, so a value can never start a line that pretends to be the viewer's own.
export const clean = (value) => printable(String(value ?? "")).replace(/\r?\n/g, " ⏎ ").replace(/\t/g, " ");

// What a styled line would show, for measuring and for asserting that only this file's sequences are in it.
export const unstyled = (text) => String(text).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
