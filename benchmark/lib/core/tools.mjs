// TOOL-CALL FAILURES (0.5.0, backlog B9): how often a host's tool calls failed, which tool, what each failure cost, and
// where in a sandbox's life a step failed -- read off what one run's room already keeps, never off what a host says of
// itself, and null with a reason in `unknown` (never 0) wherever the record that would say it does not exist.
//
//   calls     per tool: calls, failed, unanswered -- from the host's stream of every round: the controller's capture
//             when the round has a non-empty one (HOST_OBSERVED), else the runner's own copy (REPORTED). A call whose
//             result came back marked as an error is a failure; one whose result never came back is unanswered.
//   recovery  each failed call to the next call of its thread, in a later turn, that did not fail: the turns and the
//             reported tokens spent getting there, and the reported cost apportioned by those tokens (APPORTIONED).
//             Failed calls that share one next call are one episode; an episode with none was never got past.
//   relay     per relay subcommand (a QA round's relay.jsonl): requests, help probes the relay answered itself (0.5.0:
//             each under the subcommand it asked about, `--help` for the whole CLI), refusals by reason, non-zero exits.
//   sandbox   per sandbox step: attempts, failures, the class of each failure (SANDBOX_FAILURES), how many host calls
//             came after it before the host got past it (the task's next action that succeeded) or stopped, and
//             whether one never got past ended BLOCKED with its reason. A source or engineering run reads its
//             engineering task as the inspection read it back (task.json: its sandbox actions, and the receipt of its
//             release) and the runner store's sandboxes (sandbox.json: restore and the containers); a QA run reads its
//             engine store, whose sandbox the CONTROLLER set up -- no host call drove it, so none is counted against it.
//
//   runToolsOf(room, manifest, ending) -> { schema, rounds, basis, calls, recovery, relay, sandbox, unknown }
//   toolsMarkdown(facts) -> lines      SANDBOX_STEPS · OP_STEPS · SANDBOX_FAILURES · RELAY_REASONS · classOf(failure)
//   relayReasonOf(line) · roundsIn(room)
import { readdirSync } from "node:fs";
import { sandboxesOf } from "../../images/runner/inspect.mjs";
import { streamOf } from "./host.mjs";
import { hostOfRun } from "./rates.mjs";
import { docRead, readRegular } from "./room.mjs";

const MAX_STREAM = 80 * 1024 * 1024;

const textAt = (file, max = MAX_STREAM) => readRegular(file, max)?.toString("utf8") ?? null;

function safeList(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

export const roundsIn = (room) => safeList(room.at("rounds")).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);

const atRound = (room, k, ...parts) => room.at("rounds", String(k), ...parts);

const countBy = (xs) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// A sum of numbers every one of which is known -- else unknown, never a sum of what happened to be reported.
const sumKnown = (xs) => (xs.every((x) => typeof x === "number") ? sum(xs) : null);

// ---- the host's streams ---------------------------------------------------------------------------------------------------

// A round's host stream: the controller's capture when it holds anything (a runner from before 0.5.0 printed nothing on
// its stdout), with the moments its lines arrived; else the runner's own copy and its tail; else none.
function streamIn(room, k) {
  const captured = textAt(atRound(room, k, "host.stream.jsonl"));
  if (captured) return { k, basis: "HOST_OBSERVED", s: streamOf(captured), times: docRead(room, `rounds/${k}/host.stream.at.json`)?.lines ?? null };
  const own = textAt(atRound(room, k, "out", "host.jsonl"));
  return own === null ? null : { k, basis: "REPORTED", s: streamOf(`${own}\n${textAt(atRound(room, k, "out", "host-tail.jsonl"), 70 * 1024) ?? ""}`), times: null };
}

const basisOf = (streams) => ((b) => (b.size === 1 ? [...b][0] : b.size ? "MIXED" : null))(new Set(streams.map((p) => p.basis)));

// ---- calls, per tool ------------------------------------------------------------------------------------------------------

const toolRow = (uses) => ({ calls: uses.length, failed: uses.filter((u) => u.failed === true).length, unanswered: uses.filter((u) => u.failed === null).length });

const byTool = (uses) => Object.fromEntries([...new Set(uses.map((u) => u.name))].sort().map((n) => [n, toolRow(uses.filter((u) => u.name === n))]));

const callsOf = (streams) => ((uses) => ({ ...toolRow(uses), byTool: byTool(uses) }))(streams.flatMap((p) => p.s.uses));

// ---- recovery: what a failed call cost before the next useful one --------------------------------------------------------

const threadOf = (u) => u.parent ?? "main";

// The next call of a failed call's thread, in a later turn, that did not fail -- the host got past it there.
const nextUseful = (uses, f) => uses.find((u) => threadOf(u) === threadOf(f) && u.turn > f.turn && u.failed === false) ?? null;

const keyOf = (x) => x.next ?? `none:${threadOf(x.f)}`;

// Failed calls grouped by the call that got past them: one episode each, and per thread one that was never got past.
function episodesIn(s) {
  const keyed = s.uses.filter((u) => u.failed === true).map((f) => ({ f, next: nextUseful(s.uses, f) }));
  const groups = keyed.reduce((m, x) => m.set(keyOf(x), [...(m.get(keyOf(x)) ?? []), x]), new Map());
  return [...groups.values()].map((g) => episodeOf(s, g));
}

// The turns of its thread after the first failed call, up to and with the one that got past it.
function episodeOf(s, group) {
  const first = Math.min(...group.map((x) => x.f.turn));
  const next = group[0].next;
  const spent = s.turns.filter((t) => t.thread === threadOf(group[0].f) && t.turn > first && (!next || t.turn <= next.turn));
  return { failed: group.length, recovered: Boolean(next), turns: spent.length, tokens: sumKnown(spent.map((t) => t.tokens)), costUsd: shareOf(s, sumKnown(spent.map((t) => t.tokens))) };
}

const reportedCost = (s) => (typeof s.result?.total_cost_usd === "number" ? s.result.total_cost_usd : null);

// The reported cost, apportioned by the reported tokens of the turns spent -- unknown when either was not reported.
const shareOf = (s, tokens) => ((cost, all) => (cost === null || tokens === null || !all ? null : Math.round(((cost * tokens) / all) * 1e6) / 1e6))(reportedCost(s), sumKnown(s.turns.map((t) => t.tokens)));

function recoveryOf(streams) {
  const eps = streams.flatMap((p) => episodesIn(p.s));
  return { failed: sum(eps.map((e) => e.failed)), episodes: eps.length, recovered: eps.filter((e) => e.recovered).length, turns: sum(eps.map((e) => e.turns)), tokens: sumKnown(eps.map((e) => e.tokens)), costUsd: sumKnown(eps.map((e) => e.costUsd)), costBasis: "APPORTIONED" };
}

// ---- the relay, per subcommand ----------------------------------------------------------------------------------------

// Why the relay refused a request, by the sentence it wrote (lib/qa/relay.mjs `admitted`): one word per kind, so a metric
// counts reasons and never sentences. The first row that holds decides; the last always does. HELP is a `--help` the
// relay refused before it answered one (0.5.0, backlog B9): a room kept from then is still read, and says so.
export const RELAY_REASONS = [
  { reason: "NOT_A_REQUEST", says: /is not a request|is not a regular file/ },
  { reason: "NOT_RELAYED", says: /^the relay runs no / },
  { reason: "OTHER_INVESTIGATION", says: /names another investigation/ },
  { reason: "HELP", says: /(^|\s)--help\b/ },
  { reason: "STDIN", says: /reads nothing on stdin|larger than a decision is/ },
  { reason: "WORDS", says: /takes no words/ },
  { reason: "FLAG_VALUE", says: /takes no value|does not hold a value it may carry/ },
  { reason: "FLAG", says: /takes no --[a-z][a-z-]* here/ },
  { reason: "OTHER", says: /[\s\S]*/ },
];

export const relayReasonOf = (line) => RELAY_REASONS.find((r) => r.says.test(String(line.refused ?? ""))).reason;

const lineOf = (l) => {
  try { return JSON.parse(l); }
  catch { return null; }
};

const relayLines = (room, k) => (textAt(atRound(room, k, "relay", "relay.jsonl"), 32 * 1024 * 1024) ?? "").split("\n").map(lineOf).filter((l) => l && typeof l === "object");

const subOf = (l) => (typeof l.sub === "string" ? l.sub : "(unreadable)");

const subRow = (lines) => ({ requests: lines.length, help: lines.filter((l) => l.help === true).length, refused: countBy(lines.filter((l) => l.refused).map(relayReasonOf)), nonZero: lines.filter((l) => !l.refused && !l.error && l.exit !== 0).length, errors: lines.filter((l) => l.error).length });

const relayOf = (lines) => Object.fromEntries([...new Set(lines.map(subOf))].sort().map((sub) => [sub, subRow(lines.filter((l) => subOf(l) === sub))]));

// ---- the sandbox, step by step -----------------------------------------------------------------------------------------

export const SANDBOX_STEPS = ["sandbox-prepare", "restore", "container-build", "sandbox-start", "readiness", "sandbox-release"];

// Which step an operation of runtime's journal belongs to (src/runtime/sandbox/operations.mjs KINDS). A `dispatch` is a
// generated test's run, never a step of the sandbox.
export const OP_STEPS = { prepare: "sandbox-prepare", restore: "restore", up: "container-build", build: "container-build", service: "container-build", network: "container-build", attest: "container-build", start: "sandbox-start", release: "sandbox-release", teardown: "sandbox-release" };

// An engineering task's own sandbox actions, as steps: what its HOST asked for, each a decision of its own.
const ACTION_STEPS = { "prepare-sandbox": "sandbox-prepare", "start-sandbox": "sandbox-start" };

// The class of a step's failure: ordered, the first row that holds decides, the last always does. A row reads the step
// and -- where runtime keeps no word of its own for a cause -- the SENTENCE its owner recorded (an operation's `because`,
// an action's reason): Orbit's own words, never a host's, at fragments test/benchmark-tools.test.mjs pins to the
// engine's source. A class says where a failure came from; it decides nothing about a run.
export const SANDBOX_FAILURES = [
  { id: "DOCKER_DOWN", says: "Docker absent, or not answering", when: (f) => /no isolation provider answers|docker daemon|cannot connect to the docker|docker: not found/i.test(f.because) },
  { id: "IMAGE_PULL", says: "an image pull refused or rate-limited", when: (f) => /toomanyrequests|rate.?limit|\b429\b|pull access denied|manifest unknown|a sandbox never pulls/i.test(f.because) },
  { id: "PORT_HELD", says: "a port already held", when: (f) => /cannot give it another port|is free to lease|address already in use|eaddrinuse|holds a lease on it/i.test(f.because) },
  { id: "RESTORE_FAILED", says: "a dependency restore failed", when: (f) => f.step === "restore" || /^restoring /i.test(f.because) },
  { id: "READINESS", says: "readiness never answered", when: (f) => f.step === "readiness" || /not ready on the task's network|not answering yet/i.test(f.because) },
  { id: "TEARDOWN_UNPROVEN", says: "a teardown that could not be proven", when: (f) => f.step === "sandbox-release" || /could not be proven|quarantined|not released/i.test(f.because) },
  { id: "UNCLASSIFIED", says: "none of the above, as its owner recorded it", when: () => true },
];

export const classOf = (f) => SANDBOX_FAILURES.find((r) => r.when({ ...f, because: String(f.because ?? "") })).id;

const OK_OF = { DONE: true, FAILED: false, succeeded: true, failed: false, error: false };

const okOf = (state) => (Object.hasOwn(OK_OF, state) ? OK_OF[state] : null);

const opEvents = (sandboxes) => sandboxes.flatMap((x) => x.operations ?? []).filter((o) => OP_STEPS[o.kind]).map((o) => ({ step: OP_STEPS[o.kind], ok: okOf(o.state), endedAt: o.settledAt, because: o.because }));

const actionEvent = (a, step) => ({ step, ok: okOf(a.state), endedAt: a.endedAt, because: a.reason ?? a.summary });

// Readiness is asked of every application a start brought up: a start that said one was not answering yet failed it;
// a preparation that halted on a server not ready on the task's network failed it too.
const NOT_READY = /not answering yet|not ready on the task's network/;

const readinessEvents = (actions) => actions.filter((a) => (a.type === "start-sandbox" && a.state === "succeeded") || NOT_READY.test(String(a.reason ?? ""))).map((a) => ({ ...actionEvent(a, "readiness"), ok: !NOT_READY.test(`${a.summary ?? ""} ${a.reason ?? ""}`) }));

// The release of a task's sandbox, as the task's own receipt says it when the task ended (src/orchestration/loop.mjs):
// RELEASED, or REFUSED -- what it held could not be proven its own, so it was not let go.
const RELEASE_WORDS = { RELEASED: true, REFUSED: false };

const releaseEvents = (receipts) => receipts.filter((r) => r.domain === "sandbox" && Object.hasOwn(RELEASE_WORDS, r.outcome)).map((r) => ({ step: "sandbox-release", ok: RELEASE_WORDS[r.outcome], endedAt: r.at, because: r.summary }));

const taskEvents = (task) => [...(task.actions ?? []).filter((a) => ACTION_STEPS[a.type]).map((a) => actionEvent(a, ACTION_STEPS[a.type])), ...readinessEvents(task.actions ?? []), ...releaseEvents(task.receipts ?? [])];

// ---- what a sandbox failure cost the host ----------------------------------------------------------------------------

// The moment a line arrived: the first chunk past it, by the capture's index -- a last line with no newline, the last.
function msOf(times, line) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) [lo, hi] = times[(lo + hi) >> 1][0] > line ? [lo, (lo + hi) >> 1] : [((lo + hi) >> 1) + 1, hi];
  return (times[lo] ?? times.at(-1))?.[1] ?? null;
}

// Every host call, at the moment the controller saw it -- or null when a round was not captured with its moments.
const timelineOf = (streams) => (streams.length && streams.every((p) => p.times?.length) ? streams.flatMap((p) => p.s.uses.map((u) => msOf(p.times, u.line))).filter((ms) => typeof ms === "number") : null);

// When the host got past a failure: the start of its task's next action that succeeded.
const pastOf = (actions, end) => actions.filter((a) => a.state === "succeeded" && Date.parse(a.startedAt) > end).map((a) => Date.parse(a.startedAt)).sort((a, b) => a - b)[0] ?? null;

// How many host calls came after a failure ended, up to the start of what got past it -- or to the end of the stream.
function costOf(f, w) {
  const end = Date.parse(f.endedAt ?? "");
  if (!w.timeline || !Number.isFinite(end)) return { calls: null, past: Number.isFinite(end) ? pastOf(w.actions, end) !== null : null };
  const past = pastOf(w.actions, end);
  return { calls: w.timeline.filter((ms) => ms > end && (past === null || ms < past)).length, past: past !== null };
}

// A failure the host never got past ended BLOCKED with its reason -- or it did not: the engineering task's own word, or
// for a controller's step (which nothing gets past: a setup that failed stops the run) the run's.
const blockedOf = (w) => (w.blocked?.because ? { ended: true, because: String(w.blocked.because).slice(0, 300) } : { ended: false, because: null });

const settledBy = (w, c) => (c.past === false || w.by === "controller" ? blockedOf(w) : null);

const failureOf = (e, w) => ((c) => ({ step: e.step, class: classOf(e), because: e.because ? String(e.because).slice(0, 300) : null, at: e.endedAt ?? null, calls: c.calls, past: c.past, blocked: settledBy(w, c) }))(w.by === "host" ? costOf(e, w) : { calls: null, past: null });

const stepRow = (events, failures, by) => ({ by, attempts: events.length, failures: failures.length, unsettled: events.filter((e) => e.ok === null).length, classes: countBy(failures.map((f) => f.class)), calls: by === "host" ? { counted: failures.filter((f) => f.calls !== null).length, total: sum(failures.filter((f) => f.calls !== null).map((f) => f.calls)), unknown: failures.filter((f) => f.calls === null).length } : null, gotPast: failures.filter((f) => f.past === true).length, stopped: failures.filter((f) => f.past === false).length, endedBlocked: failures.filter((f) => f.blocked?.ended === true).length });

function stepsOf(events, w, known) {
  const failures = events.filter((e) => e.ok === false).map((e) => failureOf(e, w));
  const rows = Object.fromEntries(SANDBOX_STEPS.filter((s) => known.includes(s)).map((s) => [s, stepRow(events.filter((e) => e.step === s), failures.filter((f) => f.step === s), w.by)]));
  return { by: w.by, steps: rows, failures };
}

// What a host's run reads off runtime's own operations, beside its task's record: the steps inside a preparation.
const RUNTIME_STEPS = ["restore", "container-build"];

const UNSEEN_OPS = "the inspection did not read the runner store's sandboxes back (a room from before 0.5.0)";

const latestInspection = (room) => roundsIn(room).reverse().map((k) => ({ task: docRead(room, `rounds/${k}/inspect/task.json`)?.json ?? null, sandbox: docRead(room, `rounds/${k}/inspect/sandbox.json`)?.json ?? null })).find((x) => x.task) ?? null;

// A source or engineering run: its host drove the engineering task's sandbox, so each failure is placed in the host's
// calls. Preparing and starting are the task's own actions -- one per decision, though runtime prepares again inside a
// start -- and the release its own receipt; restore and the containers are runtime's operations, which the inspection
// read back.
const runtimeEvents = (ins) => opEvents(ins.sandbox?.sandboxes ?? []).filter((e) => RUNTIME_STEPS.includes(e.step));

function hostSandbox(ins, streams) {
  const actions = ins.task.actions ?? [];
  const w = { by: "host", actions, timeline: timelineOf(streams), blocked: ins.task.lifecycle === "BLOCKED" ? ins.task.blocked : null };
  const known = ["sandbox-prepare", "sandbox-start", "readiness", "sandbox-release", ...(ins.sandbox ? RUNTIME_STEPS : [])];
  return { ...stepsOf([...taskEvents(ins.task), ...runtimeEvents(ins)], w, known), unknown: ins.sandbox ? {} : Object.fromEntries(RUNTIME_STEPS.map((s) => [s, UNSEEN_OPS])) };
}

// A QA run: the controller set the sandbox up and released it through Orbit's own engine; only runtime's operations say
// what each step came to. A start and a component's readiness are not operations runtime journals.
const QA_UNSEEN = "a sandbox's start and its components' readiness are not operations runtime journals; the QA setup keeps them only as a sentence";

function controllerSandbox(room, ending) {
  const sandboxes = sandboxesOf(room.at("engine")).json.sandboxes;
  const w = { by: "controller", actions: [], timeline: null, blocked: ending?.outcome === "BLOCKED" ? { because: ending.summary } : null };
  return { ...stepsOf(opEvents(sandboxes), w, ["sandbox-prepare", "restore", "container-build", "sandbox-release"]), unknown: { "sandbox-start": QA_UNSEEN, readiness: QA_UNSEEN } };
}

const NO_SANDBOX = "no host round ran, so no sandbox of a task was asked for";

// The kinds whose host reaches the engine only through the relay, and whose sandboxes the controller sets up: a QA run's
// one session, and a sessions run's two (0.5.0, ADR 0054).
const RELAYED = ["qa", "sessions"];

function sandboxOf(room, manifest, streams, ending) {
  if (RELAYED.includes(manifest.benchmark?.kind)) return { sandbox: controllerSandbox(room, ending), why: null };
  const ins = latestInspection(room);
  return ins ? { sandbox: hostSandbox(ins, streams), why: null } : { sandbox: null, why: roundsIn(room).length ? "no round's inspection read the engineering task back" : NO_SANDBOX };
}

// ---- one run ---------------------------------------------------------------------------------------------------------

const NO_STREAM = "no round left a host stream (no host ran, or every round was cut before it said anything)";

const relaySaid = (room) => roundsIn(room).flatMap((k) => relayLines(room, k));

function hostFacts(room, manifest) {
  const streams = roundsIn(room).map((k) => streamIn(room, k)).filter(Boolean);
  const lines = relaySaid(room);
  return { streams, lines, relay: lines.length ? relayOf(lines) : null, relayWhy: lines.length ? null : RELAYED.includes(manifest.benchmark?.kind) ? "no relay request was logged (a scripted host asks in the controller's own process)" : "only a QA round's host reaches the engine through the relay" };
}

export function runToolsOf(room, manifest, ending = null) {
  const h = hostFacts(room, manifest);
  const sb = sandboxOf(room, manifest, h.streams, ending);
  const unknown = { ...(h.streams.length ? {} : { calls: NO_STREAM, recovery: NO_STREAM }), ...(h.relay ? {} : { relay: h.relayWhy }), ...(sb.sandbox ? sb.sandbox.unknown : { sandbox: sb.why }) };
  return { schema: 1, rounds: roundsIn(room).length, basis: basisOf(h.streams), calls: h.streams.length ? callsOf(h.streams) : null, recovery: h.streams.length ? recoveryOf(h.streams) : null, relay: h.relay, sandbox: sb.sandbox ? { by: sb.sandbox.by, steps: sb.sandbox.steps, failures: sb.sandbox.failures } : null, unknown };
}

// ---- in words, for a run's report -------------------------------------------------------------------------------------

const rateOf = (n, of) => (of ? `${n}/${of} (${Math.round((n / of) * 100)}%)` : "0/0");

const toolLine = ([name, r]) => `${name} ${rateOf(r.failed, r.calls)}${r.unanswered ? `, ${r.unanswered} unanswered` : ""}`;

const callsLines = (t) => (t.calls ? [`- calls: ${t.calls.calls}, failed ${rateOf(t.calls.failed, t.calls.calls)} (${t.basis}) — ${Object.entries(t.calls.byTool).map(toolLine).join("; ") || "none"}`, `- recovery: ${t.recovery.episodes} episode(s) of ${t.recovery.failed} failed call(s), ${t.recovery.recovered} got past; ${t.recovery.turns} turn(s), ${t.recovery.tokens ?? "unknown"} token(s), ${t.recovery.costUsd ?? "unknown"} USD (${t.recovery.costBasis}) spent before the next useful call`] : [`- calls: unknown — ${t.unknown.calls}`]);

const reasonsSaid = (refused) => Object.entries(refused).map(([k, n]) => `${k} ${n}`).join(", ");

const relayLinesOf = (t) => (t.relay ? Object.entries(t.relay).map(([sub, r]) => `- relay \`${sub}\`: ${r.requests} request(s)${r.help ? `, ${r.help} help probe(s) answered` : ""}${Object.keys(r.refused).length ? `, refused ${reasonsSaid(r.refused)}` : ""}${r.nonZero ? `, ${r.nonZero} non-zero exit(s)` : ""}`) : [`- relay: ${t.unknown.relay}`]);

const stepLine = ([step, r]) => `- sandbox \`${step}\` (${r.by}): ${r.failures}/${r.attempts} failed${Object.keys(r.classes).length ? ` — ${reasonsSaid(r.classes)}` : ""}${r.calls?.counted ? `; ${r.calls.total} host call(s) after ${r.calls.counted} failure(s)` : ""}${r.stopped ? `; ${r.stopped} never got past, ${r.endedBlocked} ended BLOCKED with a reason` : ""}`;

const sandboxLines = (t) => (t.sandbox ? [...Object.entries(t.sandbox.steps).map(stepLine), ...Object.entries(t.unknown).filter(([k]) => SANDBOX_STEPS.includes(k)).map(([k, why]) => `- sandbox \`${k}\`: unknown — ${why}`)] : [`- sandbox: ${t.unknown.sandbox}`]);

// The report's "Tool calls" section: counts and words of Orbit's, never a command, a prompt or an output.
export const toolsMarkdown = (t) => ["## Tool calls", "", ...callsLines(t), ...relayLinesOf(t), ...sandboxLines(t), ""];

// ---- many runs: the fold a metric reads (`metrics`, `reliability`) ------------------------------------------------------
//
// Over runs (metrics.mjs facts, each with the `tools` its report kept), kept apart by host basis and then grouped per
// suite and per model at its effort (`<model>@<effort>`, or the model alone at its own default -- rates.mjs hostOfRun):
// every count a numerator over a denominator, `unknown` with nothing under it, and the runs whose report kept no tool
// facts (one from before 0.5.0 -- `report <bnr-…>` writes them) counted as `unread`, never as zero.
//
//   toolsFoldOf(fs) -> { [basis]: { runs, unread, suites: { [suite]: fold }, models: { [model@effort]: fold } } }
const UNKNOWN = "unknown";

const PASSES = ["PASS", "REPAIRED_VERIFIED"];

const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : UNKNOWN });

const groupedBy = (xs, keyOf) => [...xs.reduce((m, x) => m.set(keyOf(x), [...(m.get(keyOf(x)) ?? []), x]), new Map()).entries()];

const sumOf = (xs) => xs.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);

// Counts by key, summed over rows that each count by key (refusals by reason, failures by class).
const added = (rows) => Object.fromEntries([...new Set(rows.flatMap((r) => Object.keys(r ?? {})))].sort().map((k) => [k, sumOf(rows.map((r) => r?.[k]))]));

const toolSum = (rows) => ((calls, failed) => ({ calls, failed, rate: ratio(failed, calls).value }))(sumOf(rows.map((r) => r.calls)), sumOf(rows.map((r) => r.failed)));

const toolsFolded = (byTools) => Object.fromEntries([...new Set(byTools.flatMap((b) => Object.keys(b)))].sort().map((name) => [name, toolSum(byTools.map((b) => b[name]).filter(Boolean))]));

function callsFold(t) {
  const known = t.filter((f) => f.tools.calls).map((f) => f.tools.calls);
  const failed = sumOf(known.map((c) => c.failed));
  return { runs: known.length, unknown: t.length - known.length, calls: sumOf(known.map((c) => c.calls)), failed, unanswered: sumOf(known.map((c) => c.unanswered)), rate: ratio(failed, sumOf(known.map((c) => c.calls))).value, byTool: toolsFolded(known.map((c) => c.byTool)) };
}

const relayRow = (rows) => ({ requests: sumOf(rows.map((r) => r.requests)), help: sumOf(rows.map((r) => r.help)), refused: added(rows.map((r) => r.refused)), nonZero: sumOf(rows.map((r) => r.nonZero)), errors: sumOf(rows.map((r) => r.errors)) });

const relayFold = (t) => Object.fromEntries([...new Set(t.flatMap((f) => Object.keys(f.tools.relay ?? {})))].sort().map((sub) => [sub, relayRow(t.map((f) => f.tools.relay?.[sub]).filter(Boolean))]));

// A run whose outcome a rate may count: one that came to an ending -- never blocked, invalid, inconclusive, held or
// unfinished (`excluded`), and never cut by a restart (`interrupted`, nobody's miss: ADR 0049) -- as rates.mjs counts it.
// The calls of every run still count; only "did it pass" is asked of these alone.
const countable = (f) => !f.excluded && !f.interrupted;

// Failed calls per PASS: the failed calls of the runs that passed, over those runs.
const perPass = (t) => ((p) => ratio(sumOf(p.map((f) => f.tools.calls.failed)), p.length))(t.filter((f) => f.tools.calls && countable(f) && PASSES.includes(f.outcome)));

// What getting past failed calls took, per episode; and of the runs that hit a failed call and came to an ending a rate
// may count, how many still passed.
function recoveryFold(t) {
  const known = t.filter((f) => f.tools.recovery);
  const episodes = sumOf(known.map((f) => f.tools.recovery.episodes));
  const hit = known.filter((f) => f.tools.recovery.failed > 0 && countable(f));
  return { episodes, recovered: ratio(sumOf(known.map((f) => f.tools.recovery.recovered)), episodes), turnsPerEpisode: ratio(sumOf(known.map((f) => f.tools.recovery.turns)), episodes), costUsd: costFold(known), runsRecovered: ratio(hit.filter((f) => PASSES.includes(f.outcome)).length, hit.length) };
}

// The apportioned cost of getting past failed calls, per run where it was known.
const costFold = (known) => ((c) => ({ ...ratio(sumOf(c.map((f) => f.tools.recovery.costUsd)), c.length), unknown: known.length - c.length, basis: "APPORTIONED" }))(known.filter((f) => typeof f.tools.recovery.costUsd === "number"));

// One sandbox step over many runs: its failure rate, the classes of its failures, the host calls a failure cost on
// average where they could be placed, and of the failures nothing got past, how many ended BLOCKED with a reason.
const stepFold = (rows) => ({ runs: rows.length, attempts: sumOf(rows.map((r) => r.attempts)), failures: sumOf(rows.map((r) => r.failures)), rate: ratio(sumOf(rows.map((r) => r.failures)), sumOf(rows.map((r) => r.attempts))).value, classes: added(rows.map((r) => r.classes)), callsAfter: ratio(sumOf(rows.map((r) => r.calls?.total)), sumOf(rows.map((r) => r.calls?.counted))), callsUnknown: sumOf(rows.map((r) => r.calls?.unknown)), stopped: sumOf(rows.map((r) => r.stopped)), endedBlocked: ratio(sumOf(rows.map((r) => r.endedBlocked)), sumOf(rows.map((r) => r.stopped))) });

function sandboxFold(t) {
  const steps = SANDBOX_STEPS.map((s) => [s, t.map((f) => f.tools.sandbox?.steps?.[s]).filter(Boolean)]);
  const unknown = Object.fromEntries(SANDBOX_STEPS.map((s) => [s, t.filter((f) => f.tools.unknown?.[s] || f.tools.unknown?.sandbox).length]));
  return { steps: Object.fromEntries(steps.filter(([, rows]) => rows.length).map(([s, rows]) => [s, stepFold(rows)])), unknown };
}

function foldOf(g) {
  const t = g.filter((f) => f.tools);
  return { runs: t.length, unread: g.length - t.length, calls: callsFold(t), relay: relayFold(t), failedPerPass: perPass(t), recovery: recoveryFold(t), sandbox: sandboxFold(t) };
}

const foldsBy = (fs, keyOf) => Object.fromEntries(groupedBy(fs, keyOf).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([k, g]) => [k, foldOf(g)]));

const basisFold = (fs) => ({ runs: fs.filter((f) => f.tools).length, unread: fs.filter((f) => !f.tools).length, suites: foldsBy(fs, (f) => f.suite ?? "-"), models: foldsBy(fs, (f) => hostOfRun({ ...f, modelSaid: f.modelSaid ?? "unknown" })) });

export const toolsFoldOf = (fs) => Object.fromEntries(groupedBy(fs, (f) => f.basis).sort(([a], [b]) => a.localeCompare(b)).map(([b, g]) => [b, basisFold(g)]));
