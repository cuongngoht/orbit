// The one place a work reaches into the requirements room -- to READ it.
//
// A work rests on a requirement snapshot and asks the requirements room three questions: which
// requirement does this ref name, what is that snapshot, and what is the newest one. It never
// writes there, and it never reads a fact's words: a need depends on facts by id, and the
// words stay where they are kept.
import { Refused } from "../errors.mjs";
import { findSnapshot } from "../requirements/views/show.mjs";

const ROOT = /^req-[0-9a-f]{12}$/;
const SNAPSHOT = /^rs-[0-9a-f]{12}$/;

function identified(ctx, root) {
  const identity = ctx.requirements.open(root).state().identity;
  if (!identity) throw new Refused(`no requirement ${root} is kept here — acquire its source first with requirements acquire`);
  return { root, identity };
}

// By the bare id of the item, which is how a person says it. The same number in two systems
// is two requirements, and is asked about, never guessed at.
function byItemId(ctx, ref) {
  const found = ctx.requirements.roots().filter((root) => ctx.requirements.open(root).state().identity?.id === ref);
  if (found.length > 1) throw new Refused(`${ref} is the id of more than one requirement here (${found.join(", ")}) — name one by its req- id`);
  if (!found.length) throw new Refused(`no requirement is kept for ${ref} — acquire it first with requirements acquire`);
  return identified(ctx, found[0]);
}

function ofSnapshot(ctx, ref) {
  const found = findSnapshot(ctx, ref);
  if (!found) throw new Refused(`no snapshot ${ref} is kept here`);
  return identified(ctx, found.root);
}

// The requirement a ref names: its own root id, a snapshot's, or the bare id of its item.
export function requirementOf(ctx, ref) {
  const text = String(ref ?? "").trim();
  if (ROOT.test(text)) return identified(ctx, text);
  if (SNAPSHOT.test(text)) return ofSnapshot(ctx, text);
  return byItemId(ctx, text);
}

// A snapshot by id, or nothing: a work reads what it adopted, and a snapshot that is gone or
// unreadable is not a reason for a view to fail.
export function snapshotIn(ctx, id, root) {
  if (!id || !SNAPSHOT.test(id) || !ROOT.test(root ?? "")) return null;
  try { return ctx.requirements.open(root).snapshot(id) ?? null; }
  catch { return null; }
}

// The newest snapshot of a requirement, or nothing when none was frozen.
export function latestIn(ctx, root) {
  try {
    const port = ctx.requirements.open(root);
    const last = port.state().lastSnapshot;
    return last ? port.snapshot(last) ?? null : null;
  } catch {
    return null;
  }
}
