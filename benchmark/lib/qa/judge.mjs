// THE QA JUDGE: what an investigation came to, read off the engine's own journal -- each test shape's latest
// verification, which the engine decided from its own check of the worker's envelope and the accepted criterion,
// never from what a host or a worker said -- held to the case's ground truth. A contradiction counts as a defect FOUND
// only when the very design that contradicted the planted application is SATISFIED by the clean one: a test that fails
// whatever it runs on is a false alarm, never a detection.
//
//   shapesOf(lines) -> { [obligation]: shape }          outcomesOf(lines) -> { [shape]: { obligation, outcome, version } }
//   designOf(lines, obligation, version) -> the design the host sent for it
//   creditOf(row) -> word                               judgedQa(truth, planted, clean, o) -> { verdict, rows, … }
//   refusalsOf(lines, repeats) -> { repeats, refused, repeated, uncorrected }      CORRECTABLE
//   An outcome the environment blocked is BLOCKED: never coverage, never a miss -- a run whose planted defect's test the
//   environment kept from running ends BLOCKED.
//
// A case that plants calls the relay refuses (0.5.0, backlog B9: `refusals`) is held besides to how its host met them,
// read off the relay's log -- the controller's own record of every request, never what a host said: no refused call sent
// again past the case's bound, and every call refused for how it was written corrected by a later request of its
// subcommand the relay admitted.
import { relayReasonOf } from "../core/tools.mjs";

export const CONTRADICTED = "CONTRADICTED";

const of = (lines, kind) => lines.filter((l) => l.kind === kind);

export const shapesOf = (lines) => Object.fromEntries(of(lines, "obligation").map((l) => [l.obligation, l.shape]));

// The version an evaluation ran: its execution is named by the version's digest.
const versionRun = (lines, e) => of(lines, "version").find((v) => String(e.execution ?? "").startsWith(`exe-${String(v.version).split("@")[1]}-`))?.version ?? null;

// Each shape's LATEST evaluation, with the obligation it settled and the version that settled it.
export function outcomesOf(lines) {
  const shape = shapesOf(lines);
  const latest = of(lines, "evaluated").reduce((m, e) => ({ ...m, [e.obligation]: e }), {});
  return Object.fromEntries(Object.values(latest).filter((e) => shape[e.obligation]).map((e) => [shape[e.obligation], { obligation: e.obligation, outcome: e.outcome, cause: e.cause ?? null, version: versionRun(lines, e) }]));
}

// The design a host sent for an obligation: the generate decision just before the version it froze was written.
export function designOf(lines, obligation, version) {
  const at = lines.findIndex((l) => l.kind === "version" && l.version === version);
  const before = at < 0 ? lines : lines.slice(0, at);
  return before.filter((l) => l.kind === "decision" && l.action?.kind === "generate" && l.action?.obligation === obligation).at(-1)?.action?.design ?? null;
}

// What a verification came to when the ENVIRONMENT kept the test from running -- the sandbox, its hooks, a deadline --
// rather than the product answering: never a test that ran, never a defect missed.
export const BLOCKED_OUTCOMES = ["ENVIRONMENT_BLOCKED"];

// One shape's credit, as an ordered table over what was seen on the planted application and on the clean one.
const CREDIT = [
  { id: "BLOCKED", when: (r) => BLOCKED_OUTCOMES.includes(r.got) },
  { id: "FALSE_ALARM", when: (r) => r.got === CONTRADICTED && (r.cleanIsPlanted || r.clean === CONTRADICTED) },
  { id: "DETECTED", when: (r) => r.got === CONTRADICTED && r.clean === "SATISFIED" },
  { id: "UNCONFIRMED", when: (r) => r.got === CONTRADICTED },
  { id: "MISSED", when: (r) => r.expected === CONTRADICTED },
  { id: "NOT_TESTED", when: (r) => r.got === "NOT_TESTED" },
  { id: "TESTED", when: () => true },
];

export const creditOf = (r) => CREDIT.find((c) => c.when(r)).id;

const rowOf = (truth, planted, clean, o, shape) => ((r) => ({ ...r, credit: creditOf(r) }))({ shape, expected: truth.expect?.[shape] ?? truth.default, got: planted[shape]?.outcome ?? "NOT_TESTED", clean: clean?.[shape]?.outcome ?? null, cleanIsPlanted: o.cleanIsPlanted === true });

const count = (rows, credit) => rows.filter((r) => r.credit === credit).length;

// ---- refused calls ------------------------------------------------------------------------------------------------------

// Why a request was refused, if it was: the relay's own sentence, or the engine's first line when it refused it (exit 2)
// -- never what the environment blocked (exit 3: waiting a block out is no failure to read), never a help probe.
const refusedFor = (l) => (l.refused ? l.refused : l.exit === 2 && l.help !== true && typeof l.why === "string" ? l.why : null);

// The same refused call is one subcommand refused for one reason.
const callOf = (l) => JSON.stringify([l.sub ?? null, refusedFor(l)]);

const tally = (lines) => lines.filter(refusedFor).reduce((m, l) => m.set(callOf(l), (m.get(callOf(l)) ?? 0) + 1), new Map());

// Each refused call sent more than once and the case's bound of sends again: the call, why, and how often it was sent.
const repeatedOf = (lines, repeats) => [...tally(lines)].filter(([, n]) => n > repeats + 1).map(([key, n]) => ((k) => ({ call: k[0], why: k[1], sent: n }))(JSON.parse(key)));

// What a relay refusal says can be put right by writing the call again: a flag, its value, a word, stdin, another
// investigation (core/tools.mjs RELAY_REASONS) -- never a subcommand the relay does not carry, or no request at all.
export const CORRECTABLE = ["OTHER_INVESTIGATION", "STDIN", "WORDS", "FLAG_VALUE", "FLAG"];

const admittedLater = (lines, i, sub) => lines.slice(i + 1).some((x) => x.sub === sub && !x.refused && !x.error && x.help !== true);

const correctable = (l) => Boolean(l.refused) && CORRECTABLE.includes(relayReasonOf(l));

// Each subcommand the relay refused for how it was written that no later request the relay admitted asked again -- once,
// with the first reason it was refused for.
const uncorrectedOf = (lines) => [...new Map(lines.map((l, i) => [l, i]).filter(([l, i]) => correctable(l) && !admittedLater(lines, i, l.sub)).reverse().map(([l]) => [l.sub ?? null, { call: l.sub ?? null, why: l.refused }])).values()].reverse();

export const refusalsOf = (lines, repeats) => ({ repeats, refused: lines.filter(refusedFor).length, repeated: repeatedOf(lines, repeats), uncorrected: uncorrectedOf(lines) });

const NONE = { repeated: [], uncorrected: [] };

// The verdict, as an ordered table whose last row always matches.
const VERDICT = [
  { id: "BLOCKED", why: "the environment kept a planted defect's test from running: nothing about the product was observed there", when: (s) => s.blockedPlanted > 0 },
  { id: "FAIL", why: "a test contradicted the clean application too: a false alarm, never a found defect", when: (s) => s.falseAlarms > 0 },
  { id: "FAIL", why: "a planted defect was not found", when: (s) => s.missed > 0 },
  { id: "FAIL", why: "too little of what the accepted plan owes was tested", when: (s) => s.coverage < s.minCoverage },
  { id: "FAIL", why: "a refused call was sent again past the case's bound: its host did not read why it was refused", when: (s) => (s.refusals ?? NONE).repeated.length > 0 },
  { id: "FAIL", why: "a call the relay refused for how it was written was never corrected: no later request of its subcommand was admitted", when: (s) => (s.refusals ?? NONE).uncorrected.length > 0 },
  { id: "INCONCLUSIVE", why: "a contradiction could not be confirmed on the clean application", when: (s) => s.unconfirmed > 0 },
  { id: "PASS", why: "every planted defect was found, each by a test the clean application passes, and nothing else was contradicted", when: () => true },
];

// `o.refusals`, for a case that plants refusals: { repeats, lines } -- its bound, and the relay's log of the host's round.
const refusalFacts = (r) => ({ refusals: r ? refusalsOf(r.lines, r.repeats) : null });

export function judgedQa(truth, planted, clean, o = {}) {
  const rows = truth.shapes.map((shape) => rowOf(truth, planted, clean, o, shape));
  const plantedShapes = rows.filter((r) => r.expected === CONTRADICTED);
  const s = { rows, planted: plantedShapes.length, detected: count(rows, "DETECTED"), found: plantedShapes.filter((r) => r.credit === "DETECTED").length, missed: count(rows, "MISSED"), falseAlarms: count(rows, "FALSE_ALARM"), unconfirmed: count(rows, "UNCONFIRMED"), blocked: count(rows, "BLOCKED"), blockedPlanted: plantedShapes.filter((r) => r.credit === "BLOCKED").length, coverage: rows.filter((r) => r.got !== "NOT_TESTED" && r.credit !== "BLOCKED").length / rows.length, minCoverage: o.minCoverage ?? 0, ...refusalFacts(o.refusals) };
  const v = VERDICT.find((x) => x.when(s));
  return { ...s, verdict: v.id, why: v.why, beyondTruth: rows.filter((r) => r.credit === "DETECTED" && r.expected !== CONTRADICTED).map((r) => r.shape) };
}

// The shapes the clean application must be asked about: every contradiction, unless the planted application IS it.
export const toConfirm = (planted, cleanIsPlanted) => (cleanIsPlanted ? [] : Object.entries(planted).filter(([, x]) => x.outcome === CONTRADICTED).map(([shape, x]) => ({ shape, ...x })));
