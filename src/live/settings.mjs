// How a person wants Orbit Live to LOOK: how many lines the status line may use, how often it is refreshed, when
// a task counts as idle and how long a finished one stays on show, how many rows a terminal keeps and whether
// it shows QA and the sandbox's output, and how wide a viewer beside the AI CLI is and who keeps the keyboard. One document per machine (<storeBase>/control/live/settings.json),
// revisioned like every person-edited document (src/store/revisioned.mjs): a write names the revision it read.
//
// Whether Live is ON for a host is not here: that is a host switch (`live`, src/host/config.mjs), next to
// every other switch a host has. Nothing here is a command, a path or a secret -- each field is a number, a
// boolean or one of a few words, in a declared range, and a value outside it is refused, never clamped.
//
//   readLive(io, file) -> { settings, revision, exists }
//   writeLive(io, file, changes, { revision, by }) -> { settings, revision, exists }
import { Refused } from "../errors.mjs";
import { readState, writeState } from "../store/control.mjs";
import { checkRevision, contentOf, revisionFor } from "../store/revisioned.mjs";

export const LIVE_SETTINGS_SCHEMA = 1;

// One row per field: where it sits, what it is, its range and its default.
export const FIELDS = [
  { path: ["statusLine", "lines"], type: "integer", min: 1, max: 3, default: 2, say: "lines the status line may use" },
  { path: ["statusLine", "refreshInterval"], type: "integer", min: 1, max: 60, default: 1, say: "seconds between status line refreshes" },
  { path: ["idleAfterSec"], type: "integer", min: 10, max: 3600, default: 120, say: "seconds with no new line before a task shows IDLE" },
  { path: ["finishedForSec"], type: "integer", min: 0, max: 86400, default: 600, say: "seconds a finished task stays on show" },
  { path: ["terminal", "maxRows"], type: "integer", min: 5, max: 1000, default: 200, say: "timeline rows a terminal keeps" },
  { path: ["terminal", "showQa"], type: "boolean", default: true, say: "show QA activity in a terminal" },
  { path: ["terminal", "showLogs"], type: "boolean", default: false, say: "open the sandbox console in a terminal" },
  { path: ["pane", "widthPercent"], type: "integer", min: 20, max: 60, default: 36, say: "share of the terminal's width a viewer asks for beside the AI CLI (a docked pane, a split pane)" },
  { path: ["pane", "focusCli"], type: "boolean", default: true, say: "give the keyboard back to the AI CLI once a viewer opened beside it" },
  { path: ["pane", "animation"], type: "enum", values: ["auto", "off"], default: "auto", say: "auto: the orbit turns while the viewer is open and the ORBITING indicator pulses as evidence arrives (motion, never progress) · off: neither moves (reduced motion)" },
  { path: ["pane", "orbitSpeed"], type: "enum", values: ["slow", "normal", "fast"], default: "normal", say: "how long the orbit takes to go round once: slow (6 s), normal (3 s), fast (1.5 s)" },
  { path: ["pane", "timelineRows"], type: "integer", min: 10, max: 80, default: 30, say: "events the pane's timeline keeps, newest last" },
  { path: ["attendedHosts"], type: "hosts", default: [], say: "hosts used interactively here that cannot say so themselves: /orbit and /orbit-help open a viewer beside them (a headless run of one on this machine opens one too)" },
];

const at = (doc, path) => path.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), doc);
const put = (doc, [head, ...rest], value) => ({ ...doc, [head]: rest.length ? put(doc?.[head] ?? {}, rest, value) : value });
const filled = (doc, f) => put(doc, f.path, at(doc, f.path) ?? f.default);

export const defaultsOf = () => FIELDS.reduce((doc, f) => put(doc, f.path, f.default), {});

const HOST_ID = /^[a-z][a-z0-9-]{0,39}$/;

const TYPES = {
  hosts: (f, v) => Array.isArray(v) && v.length <= 8 && v.every((h) => typeof h === "string" && HOST_ID.test(h)),
  integer: (f, v) => Number.isInteger(v) && v >= f.min && v <= f.max,
  boolean: (f, v) => typeof v === "boolean",
  enum: (f, v) => f.values.includes(v),
};

const RANGES = { hosts: () => "a list of at most 8 host ids (lowercase words)", integer: (f) => `a whole number from ${f.min} to ${f.max}`, boolean: () => "true or false", enum: (f) => `one of ${f.values.join(", ")}` };

const rangeOf = (f) => RANGES[f.type](f);
const problemOf = (doc, f) => (at(doc, f.path) === undefined || TYPES[f.type](f, at(doc, f.path)) ? null : `${f.path.join(".")} is ${rangeOf(f)} (${f.say})`);

const KNOWN = new Set(FIELDS.map((f) => f.path.join(".")));
const leaves = (doc, prefix = []) => Object.entries(doc ?? {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? leaves(v, [...prefix, k]) : [[...prefix, k].join(".")]));

export function settingsProblems(doc) {
  const unknown = leaves(doc).filter((p) => !KNOWN.has(p)).map((p) => `${p} is not a live setting`);
  return [...unknown, ...FIELDS.map((f) => problemOf(doc, f)).filter(Boolean)];
}

const STAMPED = ["revision", "updatedAt", "updatedBy", "schema", "unreadable"];

export function readLive(io, file) {
  const kept = readState(io, file, {}, LIVE_SETTINGS_SCHEMA);
  const content = contentOf(kept, STAMPED);
  const exists = io.read(file) !== null && !kept.unreadable;
  return { settings: FIELDS.reduce(filled, content), revision: exists ? revisionFor(content) : null, exists, unreadable: kept.unreadable ?? null };
}

export function writeLive(io, file, changes, writer) {
  const kept = readLive(io, file);
  checkRevision(kept, writer, "live settings");
  const next = mergedChanges(kept.settings, changes);
  writeState(io, file, { ...next, updatedAt: writer.at, updatedBy: writer.by ?? "person" }, LIVE_SETTINGS_SCHEMA);
  return readLive(io, file);
}

function mergedChanges(settings, changes) {
  const problems = settingsProblems(changes);
  if (problems.length) throw Object.assign(new Refused(`live settings not changed: ${problems.join("; ")}`), { code: "LIVE_SETTINGS_INVALID" });
  return leaves(changes).reduce((doc, p) => put(doc, p.split("."), at(changes, p.split("."))), settings);
}
