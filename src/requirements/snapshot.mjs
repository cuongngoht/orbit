// FREEZING a requirement: the immutable thing downstream work rests on.
//
// A snapshot says exactly which state of the requirement was used -- which sources at
// which revisions, which facts at which revisions and digests, which decisions, which
// questions were still open, how clear it was and whose word it was at its weakest. It
// never holds the text of a fact or a source: `show` reads the words from the room, and
// checks them against what was frozen.
//
// The id is a function of the state. Freezing the same state twice is the same snapshot
// and writes nothing; anything that changes what it says -- a new revision, a decision, a
// source accepted -- is a different one, and the first stays exactly as it was. That is
// what lets a Work say which requirement it used, and lets a later one prove it moved.
//
// Whose word it is is derived NOW, at the moment of freezing, from the sources as they
// are: a source a person accepted yesterday makes today's snapshot stronger and leaves
// last week's alone.
import { Refused } from "../errors.mjs";
import { sha, short } from "../hash.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { engineVersion } from "../version.mjs";
import { recover } from "./ingest.mjs";
import { SNAPSHOT_VERSION, authorityOf, citesOf, factDigest } from "./model.mjs";
import { clarityOf, isCurrent, isOpen } from "./vocab.mjs";

const sourceInfo = (ctx, sid) => ctx.world?.source?.(sid) ?? null;

// Each source a standing fact cites, at the revision it cites it. The digest is known
// only for the revision the requirement last read the source at; an older one has none.
function sourcesOf(facts, state, ctx) {
  const cites = facts.flatMap((f) => citesOf(f.sources));
  const unique = cites.filter((c, at) => cites.findIndex((x) => x.sid === c.sid && x.revision === c.revision) === at);
  return unique.sort((a, b) => a.sid.localeCompare(b.sid) || a.revision.localeCompare(b.revision)).map((c) => entryOf(c, state, sourceInfo(ctx, c.sid)));
}

function entryOf(cite, state, info) {
  const known = state.sources?.[cite.sid];
  const digest = known?.revision === cite.revision ? known.digest : null;
  return { id: cite.sid, revision: cite.revision, kind: info?.kind ?? null, authority: info?.authority ?? "draft", ...(digest ? { digest } : {}) };
}

export const factEntry = (f) => ({ id: f.id, revision: f.revision, status: f.status, digest: factDigest(f) });

// The standing facts, in the one order every digest of them is taken in. A clarification round
// reads the same pieces (roundtable/digest.mjs), so there is one answer to "what does this
// requirement say right now" and two views of it cannot drift.
export const standingFacts = (port) => port.facts().filter((f) => isCurrent(f.status)).sort((a, b) => a.id.localeCompare(b.id));

export const decisionsOf = (facts) => [...new Set(facts.map((f) => f.decision).filter(Boolean))].sort();

// Whose word the standing facts are, from what they rest on NOW.
function authorityNow(facts, ctx) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return authorityOf(facts, { sourceAuthority: (sid) => sourceInfo(ctx, sid)?.authority, fact: (id) => byId.get(id) ?? null });
}

// The state a snapshot freezes, and nothing about when or by whom.
function contentOf(port, ctx, root) {
  const facts = standingFacts(port);
  const questions = port.questions();
  const state = port.state();
  const decisions = decisionsOf(facts);
  return { root, ...(state.identity ? { identity: state.identity } : {}), sources: sourcesOf(facts, state, ctx), facts: facts.map(factEntry), decisions, open: questions.filter(isOpen).map((q) => q.id).sort(), clarity: clarityOf(facts, questions), authority: authorityNow(facts, ctx) };
}

export const digestOf = (content) => sha(canonical(content));

export function snapshotOf(content, at, engine) {
  const digest = digestOf(content);
  return { v: SNAPSHOT_VERSION, id: `rs-${short(digest, 12)}`, ...content, digest, at, engine };
}

// The identity of the root source: a root is a hash of it, and a hash cannot be turned
// back into what it names, so it is kept here once and never changed.
export function identify(ctx, root, identity) {
  const port = ctx.requirements.open(root);
  return port.transact(() => {
    const state = port.state();
    if (state.identity && canonical(state.identity) !== canonical(identity)) throw new Refused(`${root} is already the requirement of another item — an identity is fixed once it is set`);
    if (!state.identity) port.setState({ ...state, identity });
    return port.state().identity;
  });
}

function frozen(ctx, port, root) {
  if (!ctx.world?.source) throw new Refused("whose word a requirement is depends on its sources, and none is bound here");
  recover(port);
  const snapshot = snapshotOf(contentOf(port, ctx, root), ctx.now(), ctx.engine ?? engineVersion());
  const existing = port.snapshot(snapshot.id);
  return existing ? { snapshot: existing, created: false } : written(port, snapshot);
}

// Journal first, then the file, then where the room says it stands.
function written(port, snapshot) {
  port.journal({ kind: "snapshot", snapshotId: snapshot.id, digest: snapshot.digest, clarity: snapshot.clarity, authority: snapshot.authority });
  port.saveSnapshot(snapshot);
  port.setState({ ...port.state(), lastSnapshot: snapshot.id, position: port.journalLines().at(-1)?.sequence ?? 0 });
  return { snapshot, created: true };
}

// ctx: { requirements, now(), world: { source(sid) -> { kind, authority } | null }, engine? }
export function freeze(ctx, root) {
  const port = ctx.requirements.open(root);
  return port.transact(() => frozen(ctx, port, root));
}
