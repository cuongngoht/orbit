// WHICH OPEN WORK a prompt could mean (0.5.0, B22): what the prompt router's RESUME row reads, and all it reads.
//
//   named     the work each reference the prompt names was tracked under, by that reference's deterministic id
//             (ids.mjs `refWorkId`) -- never a title, and never the newest work on the machine
//   current   this session's current work in this checkout (resolve.mjs `currentOf`), looked for only when the prompt
//             says to continue: it scans the newest journals, so a prompt that does not ask pays nothing for it
//
// Each answers { id, open, owner }: open while nothing closed it, and its OWNER the coordinated workflow, the
// engineering task or the investigation that governs it -- the latest one linked, of the strongest kind. Never a
// title, an objective or a reference: which work, and who governs it, is everything a strategy needs. Pure over the
// work store handed in, and it writes nothing.
import { trackOf } from "./fold.mjs";
import { refWorkId } from "./ids.mjs";
import { currentOf, ownedBy, scanOf } from "./resolve.mjs";

// Who governs a work, strongest first: a coordinated workflow governs the task it started and the investigation it ran.
export const GOVERNORS = ["workflow", "task", "investigation"];

const latest = (fold, what) => fold.links.filter((l) => l.what === what).at(-1) ?? null;

const ownerOf = (fold) => ((l) => (l ? { what: l.what, id: l.target } : null))(GOVERNORS.map((what) => latest(fold, what)).find(Boolean));

const rowOf = (w) => ({ id: w.id, open: w.fold.closed === null, owner: ownerOf(w.fold) });

const foldedIn = (works) => (id) => ({ id, fold: trackOf(works.read(id) ?? []) });

// ask: { refs, continued, session (the task session mark), checkout }
const namedIn = (works, ask) => [...new Set((ask.refs ?? []).map(refWorkId))].filter((id) => works.exists(id)).map(foldedIn(works)).filter((w) => ownedBy(w.fold, ask.checkout)).map(rowOf);

const currentIn = (works, ask) => ((c) => (c ? rowOf(c) : null))(ask.continued && ask.session ? currentOf(scanOf(works), ask.session, ask.checkout) : null);

export const openWorkOf = (works, ask) => ({ named: namedIn(works, ask), current: currentIn(works, ask) });
