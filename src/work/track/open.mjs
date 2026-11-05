// WHICH OPEN WORK a prompt could mean (0.5.0, B22): what the prompt router's RESUME row reads, and all it reads.
//
//   named     the work each reference the prompt names was tracked under: by that reference's deterministic id
//             (ids.mjs `refWorkId`), and -- because a requirement kept for the item roots the item's work at the
//             REQUIREMENT's id (ids.mjs `itemWork`), the work an engineering task or a workflow started on it writes to --
//             any work this checkout tracked whose own first line recorded that reference. Never a title, and never the
//             newest work on the machine
//   current   this session's current work in this checkout (resolve.mjs `currentOf`), looked for only when the prompt
//             says to continue
//
// Both of the looks past an id scan the newest journals (resolve.mjs `scanOf`, bounded), once, and only when the prompt
// names a reference or says to continue: a prompt that does neither pays nothing for them.
//
// Each answers { id, open, owner }: open while nothing closed it, and its OWNER the coordinated workflow, the
// engineering task or the investigation that governs it -- the latest one linked, of the strongest kind. Never a
// title, an objective or a reference: which work, and who governs it, is everything a strategy needs. Pure over the
// work store handed in, and it writes nothing.
import { trackOf } from "./fold.mjs";
import { refOf, refWorkId } from "./ids.mjs";
import { currentOf, ownedBy, scanOf, trackedIn } from "./resolve.mjs";

// Who governs a work, strongest first: a coordinated workflow governs the task it started and the investigation it ran.
export const GOVERNORS = ["workflow", "task", "investigation"];

const latest = (fold, what) => fold.links.filter((l) => l.what === what).at(-1) ?? null;

const ownerOf = (fold) => ((l) => (l ? { what: l.what, id: l.target } : null))(GOVERNORS.map((what) => latest(fold, what)).find(Boolean));

const rowOf = (w) => ({ id: w.id, open: w.fold.closed === null, owner: ownerOf(w.fold) });

const foldedIn = (works) => (id) => ({ id, fold: trackOf(works.read(id) ?? []) });

// A reference as a work records it and as a prompt names it: one spelling, whatever the case.
const spelled = (ref) => refOf(ref ?? "").toLowerCase();

const recorded = (refs) => (w) => refs.has(spelled(w.fold.meta?.ref ?? w.fold.meta?.root?.id));

const byId = (works, ask) => [...new Set((ask.refs ?? []).map(refWorkId))].filter((id) => works.exists(id)).map(foldedIn(works));

const byRecord = (scan, ask) => (ask.refs?.length ? trackedIn(scan(), ask.checkout).filter(recorded(new Set(ask.refs.map(spelled)))) : []);

const once = (w, i, list) => list.findIndex((x) => x.id === w.id) === i;

// ask: { refs, continued, session (the task session mark), checkout }
const namedIn = (works, ask, scan) => [...byId(works, ask), ...byRecord(scan, ask)].filter(once).filter((w) => ownedBy(w.fold, ask.checkout)).map(rowOf);

const currentIn = (ask, scan) => ((c) => (c ? rowOf(c) : null))(ask.continued && ask.session ? currentOf(scan(), ask.session, ask.checkout) : null);

// The newest journals, folded at most once for both looks.
function scanned(works) {
  let scan = null;
  return () => (scan ??= scanOf(works));
}

export const openWorkOf = (works, ask) => ((scan) => ({ named: namedIn(works, ask, scan), current: currentIn(ask, scan) }))(scanned(works));
