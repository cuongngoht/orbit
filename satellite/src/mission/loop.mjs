// THE MISSION LOOP, the engine's half. The host's model decides one step at a time; this keeps the state that makes
// every decision checkable and every step safe, in the mission's own journal.
//
//   start     the goal kept once, the mission created, its budget narrowed from Orbit's limits and Satellite's policy
//   step      one decision: judged, then carried through the execution gateway (src/execution/gateway.mjs). An
//             owner asked OUTSIDE the lock (a spawned Orbit command) holds a lease while it works; the result is
//             written only if that lease is still its own (FENCED otherwise)
//
// Locks are never held across a provider call, and a step answers the revision the mission is at after it.
import { Blocked, Refused } from "../../../src/errors.mjs";
import { admitted, intended, proposed, recorded } from "../execution/gateway.mjs";
import { noteSession } from "../hosts/sessions.mjs";
import { claimLease, fencedUnlessHeld, releaseLease } from "../recovery/lease.mjs";
import { missionIdOf } from "../store/ids.mjs";
import { missionDirOf } from "../store/rooms.mjs";
import { clip, refused } from "../store/text.mjs";
import { ACTIONS } from "./actions.mjs";
import { againOf, judgeForm, judgeFresh } from "./decision.mjs";
import { goalRecord, objectiveOf, writeGoal } from "./goal.mjs";
import { lifecycleOf } from "./state.mjs";
import { MISSION_SCHEMA } from "./vocab.mjs";
import { budgetOf, journalOf, locked } from "./world.mjs";

// ---- start ----------------------------------------------------------------------------------------------------

function created(ports, goal, id) {
  const journal = journalOf(ports, id);
  if (journal.exists()) throw refused(Refused, "MISSION_EXISTS", `${id} was started for this very goal at this very instant; start it again`);
  writeGoal(ports.io, missionDirOf(ports.rooms, id), goal);
  journal.begin("mission.created", { id, project: ports.project.key, checkout: ports.project.checkout, objective: objectiveOf(goal.body), goalDigest: goal.digest, bytes: goal.bytes, budget: budgetOf(ports), session: ports.session ?? undefined, host: ports.hostId, schema: MISSION_SCHEMA });
  return id;
}

export function start(ports, spec) {
  const goal = goalRecord(spec.goal);
  const id = missionIdOf({ project: ports.project.key, checkout: ports.project.checkout, goalDigest: goal.digest, at: ports.now() });
  journalOf(ports, id).transact(() => created(ports, goal, id));
  noteSession(ports.io, ports.rooms, { session: ports.session, mission: id, runs: [], at: ports.now() });
  return { mission: id, created: true, goalDigest: goal.digest };
}

// ---- step -----------------------------------------------------------------------------------------------------

const isAsync = (x) => Boolean(x.row.call) && (x.row.async ? x.row.async(x.plan) : true);

const openOf = (x, r) => ({ action: x.shape.id, outcome: r.outcome, open: true, ...(r.result ? { result: r.result } : {}) });

const finished = (lw, x, r) => ((out) => (r.ended ? (lw.append("agentrun.ended", r.ended), out) : out))(recorded(lw, x, r));

function ranNow(ports, lw, x) {
  intended(ports, lw, x, null);
  const r = x.row.run(ports, lw, x.a, x.plan, x);
  return r.open ? openOf(x, r) : finished(lw, x, r);
}

function pendingOf(ports, lw, x) {
  const lease = claimLease(ports, lw.id, x.shape.id);
  intended(ports, lw, x, lease);
  x.before = x.row.before ? x.row.before(ports, lw, x.a, x.plan, x) : null;
  return { pending: { x, token: lease.token } };
}

const carried = (ports, lw, x) => (isAsync(x) ? pendingOf(ports, lw, x) : ranNow(ports, lw, x));

const answered = (lw, out) => (out.pending ? out : { mission: lw.id, ...out, revision: lw.m.position, lifecycle: lifecycleOf(lw.m) });

function firstPhase(ports, lw, d) {
  const replay = againOf(lw, d);
  if (replay) return answered(lw, replay);
  judgeFresh(lw, d);
  const x = proposed(ports, lw, d, ACTIONS[d.action.kind]);
  return answered(lw, admitted(ports, lw, x) ?? carried(ports, lw, x));
}

// The provider, asked with no lock held. Whatever it throws is its answer, never this process's crash.
async function providerCall(ports, pending) {
  try { return await pending.x.row.call(ports, pending.x.a, pending.x.plan, pending.x.before); }
  catch (e) { return { error: clip(e?.message ?? String(e)) }; }
}

function settledPhase(ports, lw, pending, answer) {
  fencedUnlessHeld(ports, lw.id, pending.x.shape.id, pending.token);
  lw.action = pending.x.shape.id;
  const r = pending.x.row.settle(ports, lw, pending.x.a, pending.x.plan, answer);
  releaseLease(ports, lw.id, pending.x.shape.id, pending.token);
  return answered(lw, r.open ? openOf(pending.x, r) : finished(lw, pending.x, r));
}

export async function step(ports, id, raw) {
  const d = judgeForm(raw);
  const first = locked(ports, id, (lw) => firstPhase(ports, lw, d));
  if (!first.pending) return first;
  const answer = await providerCall(ports, first.pending);
  return locked(ports, id, (lw) => settledPhase(ports, lw, first.pending, answer));
}

export const ERRORS = { Blocked, Refused };
