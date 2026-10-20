// THE LAUNCHER of the viewer Orbit opens by itself (ADR 0020): one for `/orbit-help` (`live ensure`) and for a
// workflow's start (`live ensure --entry=workflow`, which `automation start` runs detached). It decides with
// src/live/ensure.mjs's tables, keeps the session's lease with src/live/lease.mjs, opens through cli/live-open.mjs's
// openers, and WAITS -- a bounded time -- for the viewer itself to say it is ready: an opener that exited 0 has only
// accepted a request, so that alone is STARTING, never OPENED.
//
//   ensureViewer(world, { entry, task }) -> answer          src/live/ensure.mjs answerOf: { status, opened, say, … }
//
// `world` is what cli/live.mjs binds (or a test hands in): the store's io and clock, the live room and this machine's
// name, the host, the session mark, the checkout (its id even when Orbit never wrote for it), the effective
// `live.open` / `live.display`, the Live switch, whether a person is at the session (the host's own mark), the
// opener, how to start it, the viewer's command, process identity (alive, startedAtOf), a token and a sleep.
//
// It never fails the work it was asked for: every way a viewer cannot be had is an answer with the command a person
// can run in a second terminal, and the caller exits 0 on it.
import { answerOf, leaseRule, policyRefusal } from "../src/live/ensure.mjs";
import { failing, launching, leaseKey, leaseWhere, livenessOf, noting, readLease, selecting, updateLease } from "../src/live/lease.mjs";

export const READY_WAIT_MS = 6000;
export const READY_POLL_MS = 100;

export async function ensureViewer(w, req) {
  const facts = factsOf(w);
  const refused = policyRefusal(facts);
  if (refused) return fallback(w, facts, req, refused);
  const d = decided(w, facts, { ...req, opener: facts.opener, prints: w.opener.prints === true, where: w.opener.prints ? w.opener.where : null });
  return ACTS[d.rule.act](w, req, d, facts);
}

// What each lease rule comes to: a viewer opened, nothing here that could open one, or the answer about the one there.
const kept = (w, req, d) => noted(w, d, answerOf(d.rule.status, { task: req.task ?? null, lease: briefOf(d.after) }));

const ACTS = {
  open: (w, req, d) => launchedFor(w, req, d),
  refuse: (w, req, d, facts) => fallback(w, facts, req, { status: d.rule.status, why: d.rule.why }),
  keep: kept,
  select: kept,
};

const factsOf = (w) => ({ live: w.live, settings: w.settings(), attended: w.attended, checkout: w.place?.checkout ?? null, key: leaseKey({ host: w.host, session: w.session, checkout: w.place?.checkout }), opener: w.opener.id });

const whereOf = (w, facts) => leaseWhere(w.liveRoom, w.machine, facts.key);

const commandFor = (w, req) => w.typed(w.viewer({ task: req.task ?? null, lease: null }));

// Nothing opens by itself: the reason, and what a person can run instead. The session's lease, when there is one,
// keeps the answer for `live doctor`.
function fallback(w, facts, req, refused) {
  const answer = answerOf(refused.status, { why: refused.why, task: req.task ?? null, command: commandFor(w, req) });
  if (facts.key && readLease(w.io, whereOf(w, facts))) quietly(() => updateLease(w.io, whereOf(w, facts), (current) => noting(current, lastOf(w, answer))));
  return answer;
}

// ---- deciding, under the lease room's lock ------------------------------------------------------------------

function decided(w, facts, req) {
  const box = { where: whereOf(w, facts) };
  box.after = updateLease(w.io, box.where, (current) => chosen(w, facts, req, current, box));
  return box;
}

function chosen(w, facts, req, current, box) {
  const live = livenessOf(current, { nowMs: w.nowMs(), alive: w.alive, startedAtOf: w.startedAtOf });
  Object.assign(box, { live, rule: leaseRule(live, req, current), owner: w.token() });
  return WRITES[box.rule.act](current, { key: facts.key, host: w.host, session: w.session, checkout: facts.checkout, project: w.place?.project ?? null, machine: w.machine, opener: facts.opener, owner: box.owner, at: w.nowIso(), task: req.task ?? null, entry: req.entry });
}

const WRITES = {
  keep: () => null,
  refuse: () => null,
  select: (current, r) => (r.task ? selecting(current, r) : null),
  open: (current, r) => launching(current, r),
};

// ---- opening -------------------------------------------------------------------------------------------------

async function launchedFor(w, req, d) {
  const plan = w.plan(w.viewer({ task: req.task ?? null, lease: `${d.where.key}.${d.owner}` }));
  if (!w.launch(plan)) return launchFailed(w, req, d);
  const ready = await readyWithin(w, d, w.waitMs ?? READY_WAIT_MS);
  return noted(w, d, answerOf(ready ? d.rule.status : "STARTING", { task: req.task ?? null, opener: plan.id, lease: briefOf(readLease(w.io, d.where)) }));
}

function launchFailed(w, req, d) {
  quietly(() => updateLease(w.io, d.where, (current) => failing(current, d.owner, { at: w.nowIso(), why: "the opener did not open a pane or a window" })));
  return noted(w, d, answerOf("LAUNCH_FAILED", { why: "the pane or window could not be opened from here (a sandbox, or no display)", task: req.task ?? null, command: commandFor(w, req) }));
}

const isReady = (lease, owner) => lease?.owner === owner && lease.state === "ready";

async function readyWithin(w, d, waitMs) {
  const until = w.nowMs() + waitMs;
  while (w.nowMs() < until && !isReady(readLease(w.io, d.where), d.owner)) await w.sleep(READY_POLL_MS);
  return isReady(readLease(w.io, d.where), d.owner);
}

// ---- what is kept of an answer, and what is said of the lease ---------------------------------------------------

const lastOf = (w, answer) => ({ status: answer.status, at: w.nowIso(), why: answer.why ?? null });

function noted(w, d, answer) {
  quietly(() => updateLease(w.io, d.where, (current) => noting(current, lastOf(w, answer))));
  return answer;
}

const briefOf = (l) => (l ? { key: l.key, state: l.state, generation: l.generation, opener: l.opener, shows: l.shows ?? null, picked: l.picked === true, requestedAt: l.requestedAt ?? null, readyAt: l.readyAt ?? null } : null);

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}
