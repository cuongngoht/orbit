// What a FAILED check is about, and the one identity two runs of the same failure share.
//
//   classify(facts)    an ordered table over facts a caller can demonstrate -- did it start,
//                      did it finish, did the code change, how did the same command do at the
//                      baseline -- never over the text of an error message. `high` only with a
//                      baseline that passed; `low` routes nowhere. A class chooses what to look at
//                      next; it is never a verdict and never turns a failure into a pass.
//   signatureOf(run)   a 12-hex hash of what failed, normalised so that what changes between two
//                      runs of the SAME failure -- a timestamp, an absolute path, an id, a duration,
//                      the order lines arrive in -- does not move it, and a different failing test
//                      does. The task keeps the hash (`failureSignature`) and counts repeats of it.
//   excerptOf(run)     a bounded, scrubbed look at the output for the host, never for the journal.
//
// Generic words only: what a failing line looks like in any stack, never a product's own.
import { short } from "../hash.mjs";
import { scrub } from "../scrub.mjs";
import { EXCERPT_LINES } from "./vocab.mjs";

// A line that says something failed, in words no particular stack owns.
const FAILING = /\b(errors?|fail(s|ed|ing|ures?)?|exception|assert(ion)?|expected|panic(ked)?|fatal|traceback|not ok)\b|[✗✖×]/i;

const MAX_LINES = 32;

const WORKSPACE = "<workspace>";

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The workspace's path in either separator, whichever a tool printed.
const rootPattern = (root) => new RegExp(`[\\\\/]?${String(root).split(/[\\/]+/).filter(Boolean).map(escapeRe).join("[\\\\/]+")}`, "gi");

const withoutRoot = (line, root) => (root ? line.replace(rootPattern(root), WORKSPACE) : line);

// An ABSOLUTE path, after a boundary, down to its last segment. A relative path is already stable.
const ABSOLUTE = /(^|[\s'"(=,])((?:[A-Za-z]:)?(?:[\\/][^\s\\/:'"()[\]<>,]+)+[\\/])([^\s\\/:'"()[\]<>,]+)/g;

// Each transform takes one line to a form that two runs of one failure agree on.
const TRANSFORMS = [
  (l) => l.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ""),
  (l, root) => withoutRoot(l, root),
  (l) => l.replace(ABSOLUTE, "$1$3"),
  (l) => l.replace(/\b[0-9a-f]{8,}\b/gi, "[h]"),
  (l) => l.replace(/\d+/g, "#"),
  (l) => l.replace(/\s+/g, " ").trim(),
];

const normalized = (line, root) => TRANSFORMS.reduce((l, t) => t(l, root), String(line));

const failingLines = (lines) => (lines ?? []).filter((l) => FAILING.test(l));

function failures(run, root) {
  const kept = failingLines(run.lines).map((l) => normalized(l, root)).filter(Boolean);
  return [...new Set(kept)].sort().slice(0, MAX_LINES);
}

// -> 12 hex. `run`: { purpose, command, lines, status, timedOut }; `root`: the workspace path, removed.
export function signatureOf(run, root = null) {
  const failed = failures(run, root);
  const basis = failed.length ? failed : [`exit:${run.status ?? "none"}`];
  return short([run.purpose, run.command, ...basis, ...(run.timedOut ? ["timed-out"] : [])].join("\u0000"), 12);
}

// What a run SAID, nearly verbatim -- the identity a baseline comparison needs, which the signature (built
// to count NO_PROGRESS across edits) deliberately is not. Every output line, in any order, with only what
// moves between two runs of the very same failure taken out: escape codes, the workspace's path, an absolute
// timing in parentheses or a `duration_ms`, a timestamp. An absolute path outside the workspace stays as it
// is: two runs on one machine print it alike. Two failures that differ in ANY value, name or count -- an
// `actual:` line no failing word marks included -- differ here, so a new failure is never read as the old one.
// What it cannot tell apart reads as different: a regression, never a pass.
const DURATION = /\bduration_ms:?\s*\d+(\.\d+)?|\(\d+(\.\d+)?m?s\)/gi;

const STAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g;

const EXACT = [TRANSFORMS[0], TRANSFORMS[1], (l) => l.replace(STAMP, "[t]").replace(DURATION, "[d]"), TRANSFORMS[5]];

const exactLine = (line, root) => EXACT.reduce((l, t) => t(l, root), String(line));

// -> 16 hex over the whole output, order-free; null when only part of it was kept, so a failure that differs
// only in what the tail lost is never read as the same one.
export function exactOf(run, root = null) {
  if (run.cut === true) return null;
  const kept = [...new Set((run.lines ?? []).map((l) => exactLine(l, root)).filter(Boolean))].sort();
  return short([run.purpose, run.command, `exit:${run.status ?? "none"}`, ...kept, ...(run.timedOut ? ["timed-out"] : [])].join("\u0000"), 16);
}

// The failing lines first, then the end of the output: scrubbed by shape, the workspace's path
// replaced, bounded. What a host reads to diagnose, and nothing a journal keeps.
export function excerptOf(run, root = null) {
  const lines = (run.lines ?? []).map((l) => scrub(withoutRoot(TRANSFORMS[0](l), root)));
  const picked = [...failingLines(lines).slice(0, EXCERPT_LINES / 2), ...lines.slice(-EXCERPT_LINES / 2)];
  return [...new Set(picked)].slice(0, EXCERPT_LINES);
}

// ---- what a failure is about ---------------------------------------------------------------------

const sameAtBaseline = (f) => f.baseline?.state === "failed" && f.baseline.signature === f.signature;

const passedAtBaseline = (f) => f.baseline?.state === "succeeded";

const failedDifferently = (f) => f.baseline?.state === "failed" && f.baseline.signature !== f.signature;

// A check that did not start says nothing about the change. One that ran past its time does not
// either -- unless the same command passed before the change, which makes the change the thing that
// moved.
export const CLASSES = [
  { id: "ENVIRONMENT", confidence: "high", when: (f) => f.started === false, because: () => "it could not be started here" },
  { id: "ENVIRONMENT", confidence: "low", when: (f) => sameAtBaseline(f), because: () => "it failed the same way before any change was made" },
  { id: "CODE", confidence: "high", when: (f) => f.purpose === "build" && f.changed && passedAtBaseline(f), because: () => "the build passed before the change and fails after it" },
  { id: "TEST", confidence: "high", when: (f) => f.purpose === "test" && f.changed && passedAtBaseline(f), because: () => "this test passed before the change and fails after it" },
  { id: "ENVIRONMENT", confidence: "low", when: (f) => f.timedOut === true, because: () => "it did not finish in the time a check is given; nothing shows whether the change or the machine is why" },
  { id: "CODE", confidence: "low", when: (f) => f.purpose === "build" && f.changed, because: (f) => (failedDifferently(f) ? "the build fails after the change, and failed differently before it" : "the build fails after the change; nothing shows how it did before") },
  { id: "TEST", confidence: "low", when: (f) => f.purpose === "test" && f.changed, because: (f) => (failedDifferently(f) ? "this test fails after the change, and failed differently before it" : "this test fails after the change; nothing shows how it did before") },
  { id: "CODE", confidence: "low", when: (f) => f.purpose === "run" && f.started && f.changed, because: () => "the application started from the changed code and stopped by itself" },
  { id: "SCOPE", confidence: "high", when: (f) => f.purpose === "review" && f.unexpected > 0, because: (f) => `${f.unexpected} changed path(s) lie outside what the plan said it would change` },
  { id: "CAPABILITY", confidence: "high", when: (f) => f.purpose === "review" && f.missing > 0, because: (f) => `${f.missing} thing(s) the change reaches have no declared check that verifies them` },
  { id: "UNKNOWN", confidence: "low", when: () => true, because: () => "nothing shown is enough to say what it is about" },
];

// facts: { purpose, started, timedOut, changed, signature, baseline: { state, signature } | null, unexpected?, missing? }
export function classify(facts) {
  const row = CLASSES.find((c) => c.when(facts));
  return { class: row.id, confidence: row.confidence, because: row.because(facts) };
}
