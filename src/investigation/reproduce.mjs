// REPRODUCE one finding: replay exactly the chain of actions that showed it
// (src/investigation/model.mjs chainOf), re-run the data checks the original
// took, and derive findings over the NEW actions only.
//
// The result is a `reproduction` record beside the original -- never an edit
// of it. A reproduction that passes does not erase the failure it follows; the
// finding's `reproduced` says "0 of 1", and a confirmation that did not repeat
// is downgraded by src/investigation/findings.mjs, both observations kept.
//
// A fill is replayed with a FRESH synthetic value, so a data check counts what
// the reproduction wrote and not what the original left behind. The replay goes
// through the same gates: reproducing a write needs explore-write, as the
// original did.
import { Refused } from "../errors.mjs";
import { act, current, withJournal } from "./act.mjs";
import { checkData, fillTc } from "./data.mjs";
import { deriveFindings } from "./findings.mjs";
import { actionOf, chainOf, checksOf, nextId } from "./model.mjs";
import { outcomeRank } from "./vocab.mjs";

export function reproduce(w, findingId) {
  const model = current(w);
  const finding = model.history.find((f) => f.id === findingId);
  if (!finding) throw new Refused(`${findingId} is not a finding of ${w.id}`);
  if (!finding.action) throw new Refused(`a ${finding.family} finding has no action to replay — re-run the ${finding.family === "security" ? "security matrix" : "case"} instead`);
  return replayed(w, model, finding);
}

// Every check it will re-run is filled against the ORIGINAL chain first: one
// that cannot be (a bare ${TC} over two typed values) refuses here, before the
// replay writes anything, rather than after the writes with nothing recorded.
function replayed(w, model, finding) {
  const checks = checksOf(model, finding.action).filter((c) => c.layer === "data");
  checks.flatMap(templatesOf).forEach((t) => fillTc(t, model, actionOf(model, finding.action)));
  const ids = chainOf(model, finding.action).map((a, i) => act(w, specOf(w, a, i)).action.id);
  checks.forEach((c) => checkData(w, { action: ids.at(-1), query: c.query, via: c.via, input: c.input, expect: c.expect, within: c.within }));
  return recorded(w, finding, ids.at(-1), deriveFindings(current(w), w, ids).find((f) => f.key === finding.key && outcomeRank(f.outcome) <= outcomeRank("SUSPECTED_DEFECT")));
}

// Every text a check fills ${TC} into: its query, or its capability's input.
const templatesOf = (c) => [c.query, ...Object.values(c.input ?? {})].filter((t) => typeof t === "string");

const specOf = (w, a, i) => (a.do === "goto" ? { kind: "goto", url: a.target, surface: a.surface, reproduces: a.id } : { kind: a.do, on: a.on, value: a.do === "fill" ? `TC-${w.id.slice(-4)}-r${Math.floor(w.ctx.now()).toString(36).slice(-4)}${i}` : undefined, reproduces: a.id });

function recorded(w, finding, action, again) {
  return withJournal(w, () => appendedRep(w, finding, action, again));
}

function appendedRep(w, finding, action, again) {
  const rep = { id: nextId(current(w), "reproduction"), finding: finding.id, action, reproduced: Boolean(again), why: again ? again.actual ?? again.say : "the same finding did not appear on the replay" };
  w.store.append(w.id, "reproduction", rep);
  return rep;
}
