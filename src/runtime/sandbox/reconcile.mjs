// RECONCILING after a crash: what a preparation that died in the middle left, and what is safe to say about it.
//
// Preparing writes an operation BEFORE it acts (src/runtime/sandbox/operations.mjs), so a process that died
// leaves an operation that never settled, on a document still PREPARING. There is no pid to ask whether it is
// alive, so the judgement is by AGE, and it is conservative both ways: an operation younger than the longest
// thing a preparation does is assumed to be running and is left alone, and an older one is assumed dead.
//
// What is done about a dead one is never "do it again": a restore that died may have half-run, and what a
// dependency install leaves is not something to guess at -- so it is AMBIGUOUS, which a person settles by
// releasing the sandbox. Everything else a dead operation leaves is safe to try again (a container's `up` and a
// whole preparation are idempotent), so those are settled as failed and the sandbox stays PREPARING.
import { moved } from "../instances.mjs";
import { ISOLATION_PROVIDERS, isolationOf } from "../isolation/index.mjs";
import { stoppedNode } from "./network.mjs";
import { operationsRoom, sandboxLiveRoom } from "../rooms.mjs";
import { createOperations } from "./operations.mjs";

// Longer than the slowest step a preparation has (a restore's deadline is 15 minutes, a container's 20).
export const STILL_RUNNING_MS = 25 * 60 * 1000;

const OPEN = ["PREPARING", "AMBIGUOUS"];

// Ordered; the first row that matches decides; the last always matches. `facts`: { doc, open (ops never settled,
// oldest first), age (ms of the oldest) }.
export const RECONCILE = [
  { name: "SETTLED", when: (f) => !OPEN.includes(f.doc.state), outcome: "NOTHING", moves: null, say: () => "nothing was in the middle of anything" },
  { name: "STILL_RUNNING", when: (f) => f.open.length > 0 && f.age < STILL_RUNNING_MS, outcome: "RUNNING", moves: null, say: () => "a preparation started a short while ago and has not settled: it may still be running, so it is left alone" },
  { name: "RESTORE_DIED", when: (f) => f.open.some((o) => o.kind === "restore"), outcome: "AMBIGUOUS", moves: "AMBIGUOUS", say: () => "a restore of dependencies died before it settled and may have half-run: it is never run again by itself — a person releases this sandbox, and a new one starts clean" },
  { name: "DISPATCH_DIED", when: (f) => f.open.some((o) => o.kind === "dispatch"), outcome: "INTERRUPTED", moves: null, ends: ["worker"], say: () => "a dispatch died before it settled: its worker is ended by its receipt, and the run is INTERRUPTED — never resent by itself; the next attempt is a new run" },
  { name: "OPERATION_DIED", when: (f) => f.open.length > 0, outcome: "RETRYABLE", moves: null, say: () => "a preparation died before it settled; what it was doing can be done again, so preparing again is safe" },
  { name: "WAITING", when: (f) => Boolean(f.doc.blocked), outcome: "BLOCKED", moves: null, say: (f) => `it is waiting on ${f.doc.blocked.needs}: ${f.doc.blocked.because}` },
  { name: "NOTHING_OPEN", when: () => true, outcome: "RETRYABLE", moves: null, say: () => "nothing is open on it: preparing it again starts from the beginning" },
];

const opsOf = (ctx) => createOperations(operationsRoom(sandboxLiveRoom(ctx.rooms.live, ctx.envId)), ctx.io, ctx.now);

const factsOf = (ctx, ops) => ((open) => ({ doc: ctx.sandboxDoc(), open, age: open.length ? Date.parse(ctx.now()) - Date.parse(open[0].at) : 0 }))(ops.open());

// -> { outcome, say, state }; with `apply`, the dead operations are settled and an AMBIGUOUS one is written.
export function reconciled(ctx, { apply = false } = {}) {
  const ops = opsOf(ctx);
  const facts = factsOf(ctx, ops);
  const row = RECONCILE.find((r) => r.when(facts));
  if (apply && row.outcome !== "RUNNING") settledAll(ctx, ops, facts, row);
  return { outcome: row.outcome, say: row.say(facts), rule: row.name, state: row.moves ?? facts.doc.state };
}

function settledAll(ctx, ops, facts, row) {
  for (const op of facts.open) ops.settle(op, "FAILED", "it never settled: the process that ran it died");
  if (row.moves) ctx.sandboxes.write(moved(facts.doc, row.moves, ctx.now()));
  for (const s of endedOf(ctx, row.ends ?? [])) stoppedNode(ctx, isolationOf(s.container.provider, ctx.isolation ?? ISOLATION_PROVIDERS), s, ctx.depsOf?.() ?? { process: ctx.process, env: ctx.env ?? {}, isolation: ctx.isolation });
}

// The containers of the kinds a row ends, by their receipts: only what ownership proves is ever stopped.
const endedOf = (ctx, kinds) => (kinds.length ? ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && kinds.includes(s.kind) && ["RUNNING", "STARTING"].includes(s.state)) : []);
