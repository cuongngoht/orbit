// COMPLETION: what the journal must SHOW before a task may be completed -- a row each, with the
// sentence a host or a person is told when it does not hold.
//
// "The model says it is done" is not a row. A build that passed is not completion either: every
// check the change is HELD TO (src/orchestration/obligations.mjs -- what its impact reaches, never
// every check the checkout declares) must have passed since the code last changed, or failed exactly
// as it did on the base revision; at least one of them must have passed; nothing the change reaches may
// lack a declared check that verifies it; the change must have been reviewed against its plan; nothing
// may still be running, waiting or blocked; no verification may stand violated; live evidence the task
// took must be about the code it holds now; and an investigation linked to the task must have ended with
// no finding its OWN vocabulary calls a defect. Its outcome is never translated into a pass.
import { currentRuntimeEvidence } from "./evidence.mjs";
import { changed, lastAttempt, lastChange, lastOf, openActions, positionOf, receiptsOf, treeNow } from "./journal.mjs";
import { buildDone, planOf, testsDone, verifiedSome } from "./obligations.mjs";
import { sandboxOf } from "./sandbox.mjs";
import { DOMAIN, LIFE, STAGE } from "./vocab.mjs";

const HELD = [LIFE.PAUSED, LIFE.BLOCKED, LIFE.WAITING_APPROVAL, LIFE.CANCELLED, LIFE.COMPLETED, LIFE.FAILED];

const reviewedSince = (lw) => lastOf(lw, "review")?.state === "succeeded" && positionOf(lw, lastOf(lw, "review").id) > lastChange(lw);

const investigationSettled = (lw, ref) => ((o) => Boolean(o) && o.ended && o.defects === 0)(lw.investigations?.get(ref));

const investigationsSettled = (lw) => receiptsOf(lw, DOMAIN.INVESTIGATION).every((r) => investigationSettled(lw, r.ref));

const PROVEN_AGAINST = ["violated", "blocked"];

const noTrees = { live: null, recorded: null };

// What live evidence the task holds, about which tree: the same answer the context prints.
export const liveEvidenceOf = (lw) => ((sandbox) => currentRuntimeEvidence({ task: lw.id, taskTree: sandbox ? treeNow(lw) : noTrees, sandbox, investigation: lw.investigations?.get(receiptsOf(lw, DOMAIN.INVESTIGATION).at(-1)?.ref) ?? null }))(sandboxOf(lw));

// Live evidence the task TOOK -- an investigation it linked -- about code the workspace has left, or still
// being made, cannot stand for the change. A sandbox nobody investigated claims nothing.
const liveCurrent = (lw) => receiptsOf(lw, DOMAIN.INVESTIGATION).length === 0 || !["stale", "pending"].includes(liveEvidenceOf(lw).state);

export const COMPLETION = [
  { id: "REVIEWING", holds: (lw) => lw.view.stage === STAGE.REVIEWING, say: "the task has reached REVIEWING" },
  { id: "NOT_HELD", holds: (lw) => !HELD.includes(lw.view.lifecycle), say: "nothing holds it: not paused, blocked, waiting for a person or ended" },
  { id: "NO_OPEN_ACTION", holds: (lw) => openActions(lw).length === 0, say: "no action is still open" },
  { id: "CHANGED", holds: (lw) => changed(lw), say: "the workspace holds a recorded change" },
  { id: "BUILD", holds: (lw) => buildDone(lw), say: "every build and verify command the change is held to passed since the last change, or failed exactly as before it" },
  { id: "TESTS", holds: (lw) => testsDone(lw), say: "every test the change is held to passed since the last change, or failed exactly as before it" },
  { id: "VERIFIED", holds: (lw) => verifiedSome(lw), say: "at least one test or verify command the change is held to passed since the last change" },
  { id: "COVERED", holds: (lw) => planOf(lw).missing.length === 0, say: "everything the change reaches is verified by something the checkout declares: no changed path outside every component, no changed component nothing tests" },
  { id: "REVIEWED", holds: (lw) => reviewedSince(lw), say: "a review since the last change found nothing outside the plan's scope" },
  { id: "ATTEMPT", holds: (lw) => lastAttempt(lw)?.outcome === "succeeded", say: "the last attempt ended succeeded" },
  { id: "VERIFICATION", holds: (lw) => !lw.view.verification.some((v) => PROVEN_AGAINST.includes(v.state)), say: "no verification row stands violated or blocked" },
  { id: "INVESTIGATIONS", holds: (lw) => investigationsSettled(lw), say: "every linked investigation ended with no finding its own vocabulary calls a defect" },
  { id: "LIVE", holds: (lw) => liveCurrent(lw), say: "live evidence the task took is about the code it holds now, and settled" },
];

export const unmet = (lw) => COMPLETION.filter((row) => !row.holds(lw)).map((row) => ({ id: row.id, say: row.say }));

export const completable = (lw) => unmet(lw).length === 0;
