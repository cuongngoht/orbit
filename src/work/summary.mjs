// Where every work stands, in a line each -- read-only, and never a reason for anything else
// to fail.
//
// `listed` is what the discovery ladder asks ("is there a work already on this item?") and
// `workSummary` is what the navigator asks ("is anything in progress that needs a requirement
// settled first?"). Both read the journals and nothing else; a journal that cannot be read is
// a work that is left out, not an error. A newer journal format is not rewritten or guessed at
// here either: it is just not counted.
import { frontierOf, modelOf, statesOf } from "./model.mjs";
import { rootOf } from "./store.mjs";

function headOf(works, id) {
  const created = works.read(id)?.find((l) => l.kind === "created");
  return created ? { id, root: created.root ?? null, objective: created.objective ?? null } : null;
}

// The works kept here, with the identity of the item each one is about.
export function listed(works) {
  try {
    return works.list().map((id) => headOf(works, id)).filter(Boolean);
  } catch {
    return [];
  }
}

const count = (states, name) => states.filter((s) => s.state === name).length;

// A work that rests on a requirement is open until the requirement is complete. A TRACKED work with no requirement (1.8.8) rests
// on none, so it is never "a requirement not yet complete": counting it would send every `/orbit-help` to the requirements playbook.
const restsOnRequirement = (head) => head.root !== null;

function measured(head, model, snapshot) {
  const states = statesOf(model);
  return { ...head, snapshot: model.snapshot?.snapshot ?? null, clarity: snapshot?.clarity ?? null, authority: snapshot?.authority ?? null, open: restsOnRequirement(head) && snapshot?.clarity !== "complete", needs: states.length, frontier: frontierOf(model, snapshot).length, stale: count(states, "stale"), blocked: count(states, "blocked"), satisfied: count(states, "satisfied") };
}

function stood(works, head, snapshotOf) {
  try {
    const model = modelOf(works.read(head.id));
    return measured(head, model, snapshotOf(model.snapshot?.snapshot, rootOf(head.id)));
  } catch {
    return { ...head, snapshot: null, clarity: null, authority: null, open: restsOnRequirement(head), needs: null, frontier: null, stale: null, blocked: null, satisfied: null };
  }
}

// `open` is a work whose requirement is not yet complete -- or has no snapshot at all -- and
// `blocked` is one whose requirement has a question that stops it.
export function workSummary(works, snapshotOf = () => null) {
  const rows = listed(works).map((head) => stood(works, head, snapshotOf));
  return { open: rows.filter((r) => r.open).length, blocked: rows.filter((r) => r.clarity === "blocked").length, works: rows };
}
