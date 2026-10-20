// ORBIT LIVE'S LOOK (0.0.1, ADR 0027): what each TONE is drawn as where a terminal has more than sixteen colours -- a
// soft peach accent on dark panels, the status words in their own colours -- and the BANDS a pane's header, tabs,
// cards and footer sit on. Pure data: ansi.mjs is still the one file that turns it into an escape sequence, and the
// CALLER decides the depth (cli/live.mjs reads COLORTERM and TERM) and whether bands are drawn at all (never on a
// terminal that says its background is light, where a dark band reads as a smear).
//
//   PALETTE: name -> { rgb, xterm }        a colour as 24-bit RGB and as its nearest xterm-256 index
//   LOOK:    tone -> { fg?, bg?, bold?, reverse? }      the colours are PALETTE names
//   BANDS:   band -> PALETTE name                       a row's background across its whole width
export const PALETTE = Object.freeze({
  peach: { rgb: [242, 139, 102], xterm: 209 },
  text: { rgb: [226, 232, 240], xterm: 254 },
  muted: { rgb: [125, 133, 148], xterm: 245 },
  green: { rgb: [74, 222, 128], xterm: 77 },
  red: { rgb: [248, 113, 113], xterm: 203 },
  yellow: { rgb: [250, 204, 21], xterm: 220 },
  cyan: { rgb: [56, 189, 248], xterm: 75 },
  ink: { rgb: [13, 14, 16], xterm: 233 },
  elevated: { rgb: [30, 33, 39], xterm: 235 },
  track: { rgb: [42, 46, 56], xterm: 237 },
  header: { rgb: [23, 25, 32], xterm: 234 },
  tabs: { rgb: [18, 20, 24], xterm: 233 },
  card: { rgb: [19, 21, 27], xterm: 234 },
  footer: { rgb: [20, 22, 27], xterm: 234 },
  // The orbit's (0.0.3, ADR 0029): its satellite bright in front of the planet and darker behind it, the ring it runs
  // on dimmer still, and two greys for a satellite that turns while the task does not move.
  peachLight: { rgb: [255, 163, 130], xterm: 216 },
  peachDark: { rgb: [217, 110, 72], xterm: 173 },
  orbitTrack: { rgb: [64, 69, 82], xterm: 238 },
  faint: { rgb: [88, 94, 108], xterm: 240 },
});

// The orbit (src/live/orbit.mjs, 0.0.3, ADR 0029): the planet always the brand's; the satellite near (in front) and far
// (behind) in peach while the task moves and in grey otherwise -- motion never reads as ORBITING; the track darker. Its
// depth is colour alone, never bold: a terminal that draws a Braille cell bold may fall back to a font that draws every
// one of the cell's eight dots, the empty ones as rings, and the satellite reads as a cluster.
const ORBIT_LOOK = Object.freeze({
  "orbit:planet": { fg: "peach" },
  "orbit:near": { fg: "peachLight" },
  "orbit:far": { fg: "peachDark" },
  "orbit:near:gentle": { fg: "muted" },
  "orbit:far:gentle": { fg: "faint" },
  "orbit:track": { fg: "orbitTrack" },
});

// The badge's orbit sits on the badge's chip: every orbit tone again, on the chip's colour (tui/sections/top.mjs).
const onChip = (looks) => Object.fromEntries(Object.entries(looks).map(([tone, look]) => [`pill:${tone}`, { ...look, bg: "elevated" }]));

export const LOOK = Object.freeze({
  success: { fg: "green" },
  danger: { fg: "red" },
  warning: { fg: "yellow" },
  info: { fg: "cyan" },
  brand: { fg: "peach", bold: true },
  subtle: { fg: "muted" },
  label: { fg: "text", bold: true },
  match: { reverse: true },
  title: { fg: "peach", bold: true },
  chip: { fg: "peach", bg: "elevated", bold: true },
  key: { fg: "peach" },
  selected: { fg: "ink", bg: "peach", bold: true },
  track: { fg: "track" },
  // The header's pill (tui/sections/top.mjs): the indicator's own tone on a chip.
  "pill:success": { fg: "green", bg: "elevated", bold: true },
  "pill:danger": { fg: "red", bg: "elevated", bold: true },
  "pill:warning": { fg: "yellow", bg: "elevated", bold: true },
  "pill:info": { fg: "cyan", bg: "elevated", bold: true },
  "pill:subtle": { fg: "muted", bg: "elevated" },
  ...ORBIT_LOOK,
  ...onChip(ORBIT_LOOK),
});

export const BANDS = Object.freeze({ header: "header", tabs: "tabs", card: "card", footer: "footer" });

// The depths a terminal may be drawn at; anything else is sixteen colours, as before 0.0.1.
export const DEPTHS = Object.freeze(["16", "256", "truecolor"]);

// How many colours a terminal says it draws, from the environment its CALLER hands in (cli/live.mjs; nothing here reads
// one): 24-bit where COLORTERM says so or Windows Terminal is the host, 256 where TERM says so, else sixteen -- the first
// row that holds. Bands only where there are more than sixteen and the terminal does not say its background is light
// (COLORFGBG ending in 7 or 15).
export const DEPTH_OF = Object.freeze([
  { depth: "truecolor", when: (env) => /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "") || Boolean(env.WT_SESSION) },
  { depth: "256", when: (env) => /256color/i.test(env.TERM ?? "") },
  { depth: "16", when: () => true },
]);

export const depthOf = (env) => DEPTH_OF.find((d) => d.when(env ?? {})).depth;

const lightBackground = (env) => /(^|;)(7|15)$/.test(String(env?.COLORFGBG ?? ""));

export const bandsOf = (env) => depthOf(env) !== "16" && !lightBackground(env);
