// THE ORBIT (0.0.3, ADR 0029; ADR 0027 drew the first): the planet every viewer's header opens with and its satellite
// going round it -- the whole time a viewer is open, in every state of the task, on the viewer's OWN clock: the terminal
// hands in `orbitMs`, a monotonic time that is never the view model's `nowMs`. Motion is the viewer's and the word is
// the task's: the indicator (indicator.mjs, ADR 0022) says ORBITING only on evidence, and nothing here reads evidence or
// moves the indicator, a lifecycle, a count or a freshness. What the indicator's state changes is the satellite's TONE
// (MOTION): peach while the task moves, grey otherwise -- the same speed, so a state that changes never makes it jump.
// It stands still for a person who asked for no motion (`pane.animation: off`), and is PARKED where there is no clock --
// a docked pane's answer (`clock: false`), whose orbit the pane turns on its own clock from `orbitTrackOf`.
//
//   orbitFrameAt(timeMs, options) -> { rows: [[seg]], k, n, size }    pure: one moment, one frame
//     options: size (mini | compact | expanded), ascii, variant (bright | gentle), speed (SPEEDS), motion, phase, track
//   orbitOf(indicator, options) -> { rows, moving, variant, parked }    what a header or a waiting viewer draws
//   orbitTrackOf(indicator, options) -> { moving, revMs, variant, rings: [{ size, parked, frames: [[seg]] }] }
//   motionOf(indicator) -> the MOTION row that holds · movingOf(settings, clock?) -> whether it turns at all
//   trackFor(viewer) -> whether the ring it runs on is drawn (colour beyond sixteen)
import { indexAt, sizeOf } from "./orbit/geometry.mjs";
import { framesOf, textOf } from "./orbit/raster.mjs";

// One revolution, in milliseconds, by `pane.orbitSpeed`.
export const SPEEDS = Object.freeze({ slow: 6_000, normal: 3_000, fast: 1_500 });

// The header's two orbits, the one it opens with and the one in its badge: one angle, two sizes.
export const HEADER_SIZES = Object.freeze(["compact", "mini"]);

// How the orbit is toned by the indicator: ordered, the last row always answering. Only ACTIVE is bright.
export const MOTION = Object.freeze([
  Object.freeze({ variant: "bright", parkedTone: "brand", when: (i) => i?.state === "ACTIVE" }),
  Object.freeze({ variant: "gentle", parkedTone: "subtle", when: () => true }),
]);

export const motionOf = (indicator) => MOTION.find((r) => r.when(indicator));

export const movingOf = (settings, clock = true) => clock !== false && settings?.pane?.animation !== "off";

export const trackFor = (viewer) => viewer?.colour === true && (viewer.depth === "256" || viewer.depth === "truecolor");

const revOf = (speed) => SPEEDS[speed] ?? SPEEDS.normal;

export function orbitFrameAt(timeMs, { size = "compact", ascii = false, variant = "bright", speed = "normal", motion = true, phase = 0, track = false } = {}) {
  const s = sizeOf(size);
  const frames = framesOf(s, { ascii, variant, track });
  const k = indexAt(frames.length, motion ? timeMs : 0, revOf(speed), phase);
  return { rows: frames[k], k, n: frames.length, size: s.name };
}

// The still picture of a size, row by row: its first frame, with no track.
const parkedOf = (s, ascii) => framesOf(s, { ascii }).at(0).map(textOf);

const parkedRows = (s, ascii, tone) => parkedOf(s, ascii).map((text) => [{ text, tone }]);

const turning = (indicator, o) => orbitFrameAt(o.orbitMs, { size: o.size, ascii: o.ascii, variant: motionOf(indicator).variant, speed: o.settings?.pane?.orbitSpeed, motion: movingOf(o.settings), track: o.track }).rows;

// What a header or a waiting viewer draws: this moment's frame as segments, or -- with no clock -- the parked picture
// as ONE segment per row, whose text a docked pane finds and replaces by the frame it turns itself.
export function orbitOf(indicator, { size = "compact", ascii = false, orbitMs = 0, clock = true, settings = null, track = false } = {}) {
  const s = sizeOf(size);
  const rows = clock === false ? parkedRows(s, ascii, motionOf(indicator).parkedTone) : turning(indicator, { size, ascii, orbitMs, settings, track });
  return { rows, moving: movingOf(settings, clock), variant: motionOf(indicator).variant, parked: parkedOf(s, ascii)[0] };
}

const ringAnswer = (name, o) => ((s) => ({ size: s.name, parked: parkedOf(s, o.ascii)[0], frames: framesOf(s, o).map((frame) => frame[0]) }))(sizeOf(name));

// What a docked pane needs to turn the header's orbits itself: whether they turn, one revolution's length, and for each
// header size the parked text it stands in for and every frame of its one row.
export const orbitTrackOf = (indicator, { ascii = false, settings = null, track = false } = {}) => ((v) => ({ moving: movingOf(settings), revMs: revOf(settings?.pane?.orbitSpeed), variant: v, rings: HEADER_SIZES.map((name) => ringAnswer(name, { ascii, variant: v, track })) }))(motionOf(indicator).variant);
