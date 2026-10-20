// The SANDBOX, as the orchestrator knows it: an environment the task owns, where the change it made
// RUNS, kept by the runtime subject and asked through one port (`ports.sandbox`). Nothing here starts,
// stops or prepares anything itself -- it asks, reads the answer, and turns it into a result the loop
// settles into the task's journal.
//
//   PREPARED / STARTED   ordered tables over what runtime answered: first row that holds says what the
//                        action came to. A blocked answer is DATA from runtime, and becomes an `error`
//                        that names who must act; an application that stopped by itself is a `failed`
//                        action with a failure signature, so the same exit is the same signature.
//   envReceipt           the ONE receipt of the sandbox itself (environment + the source tree it was
//                        prepared at), rewritten as it moves; a session's receipt names the same two
//                        things, so every piece of live evidence says WHICH tree it ran
//   sandboxOf            what the journal says of the sandbox and whether the workspace has moved since
//
// The journal keeps ids, words and counts: never a path, a port, a URL, a command line or a line of
// output. What a host needs to SEE (endpoints, the exited application's last lines) goes back to it as
// `data`, and the log of an exit is kept in the task's room, bounded and scrubbed.
import { classify, excerptOf, signatureOf } from "./failure.mjs";
import { changed, kindOf, sandboxReceipt, sandboxSessions, startableNow, treeNow, workspaceProblem } from "./journal.mjs";
import { error, failed, ok } from "./results.mjs";
import { COMPONENT_KEY, DOMAIN, EXCERPT_LINES, SANDBOX_STATE, SESSION_WORD } from "./vocab.mjs";
import { scrub } from "../scrub.mjs";

const listOf = (x) => (Array.isArray(x) ? x : [x].filter(Boolean));

const short = (tree) => String(tree ?? "").slice(0, 12) || "no tree";

// The log of a sandbox's exit is `sbx-<n>`, after the action that ran it: act-7 is sbx-7.
export const sbxOf = (action) => `sbx-${String(action.id).slice("act-".length)}`;

// ---- the receipts --------------------------------------------------------------------------------

export const envReceipt = (s, outcome, say) => ({ domain: DOMAIN.SANDBOX, ref: s.environment, outcome, summary: say, environment: s.environment, sourceTree: s.tree ?? undefined });

export const sessionReceipt = (s, row, outcome, say, tree = s.tree) => ({ domain: DOMAIN.RUNTIME, ref: row.session, outcome, summary: say, environment: s.environment, sourceTree: tree ?? undefined });

// A sandbox that has no environment yet has no receipt: there is nothing to name.
const envReceipts = (s, outcome, say) => (s.environment ? [envReceipt(s, outcome, say)] : []);

// ---- prepare ---------------------------------------------------------------------------------------

const blockedAt = (p) => p.blocked ?? {};

const preparedSay = (p) => `${p.environment} ${String(p.state).toLowerCase()} at ${short(p.tree)}${p.reused ? ", reused" : ""}`;

export const PREPARED = [
  { id: "BLOCKED", when: (p) => p.state === SANDBOX_STATE.BLOCKED, then: (p) => error(blockedAt(p).because ?? "the sandbox cannot be prepared here", { needs: blockedAt(p).needs ?? "environment", because: blockedAt(p).because, receipts: envReceipts(p, SANDBOX_STATE.BLOCKED, "it cannot be prepared here") }) },
  { id: "AMBIGUOUS", when: (p) => p.state === SANDBOX_STATE.AMBIGUOUS, then: (p) => error("a preparation of this sandbox was interrupted and runtime cannot say how far it got — a person settles it in Orbit Control", { needs: "person", receipts: envReceipts(p, SANDBOX_STATE.AMBIGUOUS, "an interrupted preparation, waiting for a person") }) },
  { id: "PREPARED", when: () => true, then: (p) => ok(preparedSay(p), { receipts: [envReceipt(p, p.state, preparedSay(p))], data: { sandbox: p } }) },
];

export async function sandboxPrepared(ports, lw) {
  const p = await ports.sandbox.prepare({ task: lw.id });
  return PREPARED.find((row) => row.when(p)).then(p);
}

// ---- start -----------------------------------------------------------------------------------------

const blocksOf = (s) => listOf(s.blocked);

const aliveOf = (s) => listOf(s.started).length + listOf(s.reused).length;

const needsOf = (s) => blocksOf(s).find((b) => b.needs)?.needs ?? "environment";

const becauseOf = (s) => blocksOf(s).map((b) => (b.component ? `${b.component}: ${b.because}` : b.because)).filter(Boolean).join("; ").slice(0, 200) || "runtime says the sandbox cannot start here";

// The tree a session the task already holds ran from: a session that was replaced keeps the tree it
// ran, never the one that replaced it.
const ranFrom = (c, session) => sandboxSessions(c?.lw ?? { view: { receipts: [] } }).find((r) => r.ref === session)?.sourceTree ?? undefined;

// Everything the answer says is held in the sandbox, whatever else it came to: a session that is
// running is owed a stop, so it is receipted even when the step as a whole could not go on.
const tracked = (s, word, c) => [...envReceipts(s, word, `${s.environment} at ${short(s.tree)}`), ...listOf(s.replaced).map((x) => sessionReceipt(s, x, SESSION_WORD.STOPPED, `${x.component} replaced: the workspace moved`, ranFrom(c, x.session))), ...listOf(s.started).map((x) => sessionReceipt(s, x, SESSION_WORD.RUNNING, `${x.component} started in the sandbox`)), ...listOf(s.exited).map((x) => sessionReceipt(s, x, SESSION_WORD.EXITED, `${x.component} stopped by itself`))];

const startedSay = (s) => `${listOf(s.started).length} started, ${listOf(s.reused).length} already running, ${listOf(s.replaced).length} replaced${listOf(s.notReady).length ? `, ${listOf(s.notReady).length} not answering yet` : ""}`;

const linesOf = (x) => listOf(x.lines).map(String);

// An application that came up from the changed code and stopped by itself: what it is ABOUT is the
// engine's, from facts it can demonstrate -- never from the text of what it printed.
function exitFailure(lw, x, lines) {
  const signature = signatureOf({ purpose: "run", command: x.component, lines, status: x.status ?? null }, lw.workspace?.path ?? null);
  return { signature, ...classify({ purpose: "run", started: true, timedOut: false, changed: changed(lw), signature, baseline: null }) };
}

// The log of an exit stays in the task's room, bounded and scrubbed -- never in the journal.
function exitKept(c, x, lines, failure) {
  c.ports.room.keep(sbxOf(c.act), scrub(lines.join("\n")));
  c.ports.room.write(`checks/${sbxOf(c.act)}`, { command: x.component, purpose: "run", class: failure.class, confidence: failure.confidence, signature: failure.signature, status: x.status ?? null });
}

function exitedResult(s, c) {
  const x = listOf(s.exited)[0];
  const lines = linesOf(x).slice(-EXCERPT_LINES);
  const failure = exitFailure(c.lw, x, lines);
  exitKept(c, x, lines, failure);
  return failed(`${x.component} started from the changed code and stopped by itself (exit ${x.status ?? "unknown"})`, { receipts: tracked(s, SANDBOX_STATE.READY, c), failure, data: { sandbox: s, check: sbxOf(c.act), failure, excerpt: excerptOf({ lines }, c.lw.workspace?.path ?? null) } });
}

export const STARTED = [
  { id: "BLOCKED", when: (s) => s.state === SANDBOX_STATE.BLOCKED || blocksOf(s).some((b) => b.needs) || (blocksOf(s).length > 0 && aliveOf(s) === 0), then: (s, c) => error(becauseOf(s), { needs: needsOf(s), because: becauseOf(s), receipts: tracked(s, SANDBOX_STATE.BLOCKED, c), data: { sandbox: s } }) },
  { id: "EXITED", when: (s) => listOf(s.exited).length > 0, then: exitedResult },
  { id: "NOTHING", when: (s) => aliveOf(s) === 0, then: (s, c) => error("nothing was started: the sandbox found nothing it could bring up here", { needs: "environment", receipts: tracked(s, SANDBOX_STATE.READY, c), data: { sandbox: s } }) },
  { id: "STARTED", when: () => true, then: (s, c) => ok(startedSay(s), { receipts: tracked(s, SANDBOX_STATE.READY, c), data: { sandbox: s } }) },
];

export async function sandboxStarted(ports, lw, a, act) {
  const s = await ports.sandbox.start({ task: lw.id, ...(a.component ? { component: a.component } : {}) });
  return STARTED.find((row) => row.when(s)).then(s, { ports, lw, act });
}

// ---- what must hold before a start ---------------------------------------------------------------

const PROBLEMS = [
  { when: (a, lw) => workspaceProblem(lw) !== null, say: (a, lw) => workspaceProblem(lw) },
  { when: (a, lw) => startableNow(lw).length === 0, say: () => "this checkout declares nothing a sandbox could start — there is no application to run" },
  { when: (a) => a.component !== undefined && !(typeof a.component === "string" && COMPONENT_KEY.test(a.component)), say: () => "component is the key of a component understanding found, such as the context lists" },
];

export const needsSandbox = (a, lw) => PROBLEMS.find((p) => p.when(a, lw))?.say(a, lw) ?? null;

// ---- reading an interrupted action back ------------------------------------------------------------

const ACTIVE = ["RUNNING", "STARTING", "AMBIGUOUS"];

const sinceOf = (sessions, act) => sessions.filter((s) => s.requestedAt >= act.startedAt && ACTIVE.includes(s.state));

const readSession = (view, s) => sessionReceipt({ environment: view.environment, tree: view.tree }, { session: s.id }, s.state, `${s.component}, read back after an interrupted step`);

const READ_BACK = [
  { id: "SESSIONS", when: (view, since) => since.length > 0, then: (view, since) => ok(`${since.length} session(s) read back`, { receipts: [envReceipt(view, SANDBOX_STATE.READY, `${view.environment} read back`), ...since.map((s) => readSession(view, s))] }) },
  { id: "PREPARED", when: (view, since, act) => kindOf(act) === "prepare-sandbox" && [SANDBOX_STATE.READY, SANDBOX_STATE.STALE].includes(view.state), then: (view) => ok(`${view.environment} read back as ${String(view.state).toLowerCase()}`, { receipts: [envReceipt(view, view.state, `${view.environment} read back`)] }) },
  { id: "NOTHING", when: () => true, then: () => error("nothing it may have started or prepared is on runtime's books — it is not done again by itself") },
];

// What runtime recorded after the action began: its receipt is written BEFORE a launch, so a step
// whose answer was lost is still on runtime's books.
export async function sandboxReadBack(ports, lw, act) {
  const view = await ports.sandbox.status({ task: lw.id });
  const since = sinceOf(await ports.sandbox.sessions({ task: lw.id }), act);
  return READ_BACK.find((row) => row.when(view, since, act)).then(view, since);
}

// ---- what the journal says of the sandbox ---------------------------------------------------------

// First row that holds: a sandbox is whatever its receipt says, except that a READY one prepared at a
// tree the workspace has left is STALE -- derived on every read, so nothing is stored to go stale.
const STATES = [
  { when: (r) => [SANDBOX_STATE.BLOCKED, SANDBOX_STATE.AMBIGUOUS, SANDBOX_STATE.RELEASED, SANDBOX_STATE.REFUSED].includes(r.outcome), state: (r) => r.outcome },
  { when: (r, live) => (r.sourceTree ?? null) !== live, state: () => SANDBOX_STATE.STALE },
  { when: () => true, state: (r) => r.outcome },
];

const runningOf = (lw, live) => sandboxSessions(lw).filter((r) => r.outcome === SESSION_WORD.RUNNING).map((r) => ({ ref: r.ref, tree: r.sourceTree ?? null, current: (r.sourceTree ?? null) === live }));

// -> null when the task has no sandbox; else { environment, outcome, state, tree, stale, running }.
export function sandboxOf(lw) {
  const r = sandboxReceipt(lw);
  if (!r) return null;
  const live = treeNow(lw).live;
  const state = STATES.find((row) => row.when(r, live)).state(r);
  return { environment: r.environment ?? r.ref, outcome: r.outcome, state, tree: r.sourceTree ?? null, currentTree: live, stale: state === SANDBOX_STATE.STALE, running: runningOf(lw, live) };
}
