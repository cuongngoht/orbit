// A snapshot, with the words: read from the room, and CHECKED against what was frozen.
//
// A snapshot holds no text, only which facts at which revisions and what each hashed to.
// Showing it reads each fact where it lives -- the standing file when that is still the
// revision, the version kept aside when it is not -- and refuses to show anything that
// no longer matches: a snapshot whose own digest does not hold, a fact that is missing,
// a fact whose words are not what was frozen. A view that quietly showed a different
// requirement than the one downstream work used would be worse than no view.
//
// Read-only. It writes nothing, and nothing it reads is changed.
import { Refused } from "../../errors.mjs";
import { digestOf } from "../snapshot.mjs";
import { factDigest } from "../model.mjs";

// What a snapshot froze, without what identifies or dates the freezing.
const contentOf = ({ v, id, digest, at, engine, ...content }) => content;

// Where to look for a snapshot by its own id: the requirement the caller named, or every
// requirement kept here.
const byId = (ctx, ref, opts) => (opts.root ? [opts.root] : ctx.requirements.roots()).map((r) => ({ root: r, snapshot: ctx.requirements.open(r).snapshot(ref) })).find((x) => x.snapshot) ?? null;

// A requirement that has journaled nothing was never kept here.
function latestOf(ctx, ref) {
  const port = ctx.requirements.open(ref);
  const last = port.state().lastSnapshot;
  if (!last && port.journalLines().length === 0) throw new Refused(`no requirement ${ref} is kept here`);
  return last ? { root: ref, snapshot: port.snapshot(last) } : null;
}

// A snapshot by its own id, or a requirement's latest.
export function findSnapshot(ctx, ref, opts = {}) {
  if (/^rs-[0-9a-f]{12}$/.test(ref)) return byId(ctx, ref, opts);
  if (!/^req-[0-9a-f]{12}$/.test(ref)) throw new Refused(`${ref} is neither a snapshot (rs-…) nor a requirement (req-…)`);
  return latestOf(ctx, ref);
}

// The fact as it stood at the revision the snapshot froze.
function stoodAt(port, entry) {
  const now = port.fact(entry.id);
  const doc = now?.revision === entry.revision ? now : port.versions(entry.id).find((v) => v.revision === entry.revision);
  if (!doc) throw new Refused(`fact ${entry.id} at revision ${entry.revision} is not in the room any more — the snapshot cannot be shown as it was`);
  if (factDigest(doc) !== entry.digest) throw new Refused(`fact ${entry.id} at revision ${entry.revision} no longer says what it did when it was frozen — the snapshot is not shown`);
  return doc;
}

function verified(snapshot) {
  if (digestOf(contentOf(snapshot)) !== snapshot.digest) throw new Refused(`snapshot ${snapshot.id} does not hold: what it says no longer hashes to its digest, so it has been altered`);
  return snapshot;
}

const factView = (doc, entry) => ({ id: doc.id, subject: doc.subject, aspect: doc.aspect, revision: entry.revision, status: entry.status, says: doc.says, sources: doc.sources, ...(doc.decision ? { decision: doc.decision } : {}), ...(doc.derivedFrom ? { derivedFrom: doc.derivedFrom } : {}) });

const questionView = (q, id) => (q ? { id, asks: q.asks, blocking: q.blocking, slots: q.slots, state: q.state } : { id, state: "missing" });

const headOf = (s) => ({ id: s.id, root: s.root, ...(s.identity ? { identity: s.identity } : {}), clarity: s.clarity, authority: s.authority, at: s.at, digest: s.digest });

function shown(port, snapshot) {
  const facts = snapshot.facts.map((entry) => factView(stoodAt(port, entry), entry));
  return { snapshot: headOf(snapshot), sources: snapshot.sources, facts, decisions: snapshot.decisions, open: snapshot.open.map((id) => questionView(port.question(id), id)) };
}

export function show(ctx, ref, opts = {}) {
  const found = findSnapshot(ctx, ref, opts);
  if (!found) throw new Refused(`no snapshot for ${ref}`);
  return shown(ctx.requirements.open(found.root), verified(found.snapshot));
}
