// Reading a requirement's source -- the item, and a bounded neighbourhood of it --
// and keeping what it WAS, never what it said.
//
// One reader, chosen by the ladder (or by the identity a caller already holds),
// reads the root item, then the items around it a step at a time: parent, children,
// related. A pull request or a commit linked from an item is recorded as CONTEXT and
// never read; it can say what was built for the requirement and can never say what
// the requirement is. The walk is bounded (depth, and a count of items) and cannot
// loop (an item is visited once), and an item that cannot be read is recorded as
// such while the rest carry on (ADR 0007).
//
// What is stored is a record per source -- ref, revision, a digest, whose word it is,
// when it was read, its state -- and what comes back to the caller is an ENVELOPE of
// the text, once, marked as another system's data. Reading again asks nothing of the
// system when the record is already there (`refresh` does), and the same revision with
// different content is an anomaly, said out loud, never quietly taken as either.
import { resolve } from "node:path";
import { Blocked, Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";
import { authorityBearing } from "./contract-v1.mjs";
import { envelopeOf } from "./envelope.mjs";
import { contextRecord, rootId, sameSource, sourceId, sourceRecord, unavailableRecord, workitemText } from "./model.mjs";
import { providerFor, resolveSource } from "./resolve.mjs";

export const MAX_DEPTH = 2;
export const MAX_ITEMS = 24;

const READ = ["read", "anomaly"];

// Reading fails as the request (Refused) or the machine (Blocked); anything else is a
// bug, and is allowed to be one.
async function attempt(fn) {
  try { return { value: await fn() }; }
  catch (e) { if (e instanceof Refused || e instanceof Blocked) return { error: e }; throw e; }
}

function decided(w, opts) {
  if (opts.identity) return { identity: opts.identity, provider: providerFor(opts.identity, w), resolution: null };
  const r = resolveSource(opts.ref, w);
  return { identity: r.identity, provider: r.provider, resolution: r };
}

function readerOf(w, provider) {
  const reader = provider ? w.readers.find((r) => r.key === provider.key) : null;
  if (provider && !reader) throw new Blocked(`${provider.key} is the provider for this, and no reader is bound for it here`);
  return reader;
}

const provenanceOf = (a, capability) => ({ key: a.reader.key, kind: a.reader.kind, capability, at: a.w.now() });

// The part of an item a reader gave separately, asked only when the item did not
// already carry it and the reader can answer -- and a failure there is a note, never
// the loss of the item.
async function enriched(a, identity, item, capability, present) {
  if (present(item) || !a.reader.provides.includes(capability)) return item;
  const got = await attempt(() => a.reader.read(identity, capability));
  if (got.error) a.notes.push(`${capability}: ${got.error.message.slice(0, 160)}`);
  return got.error ? item : { ...item, ...got.value };
}

const hasRelations = (item) => item.parent !== undefined || item.children !== undefined || item.related !== undefined;

async function fetched(a, identity, root) {
  const item = await a.reader.read(identity, "workitem.read");
  const related = await enriched(a, identity, item, "workitem.relations.read", hasRelations);
  return root ? enriched(a, identity, related, "workitem.comments.read", (i) => i.comments !== undefined) : related;
}

// ---- one item ------------------------------------------------------------------------

const noted = (a, id, status, extra = {}) => (a.items.push({ id, status, ...extra }), a.items.at(-1));

function reused(a, existing) {
  noted(a, existing.id, "unchanged", { reused: true });
  a.records.push(existing);
  return existing;
}

// What a person is told: the stop's own sentence and, when the stop knows it (a sign-in that is needed says which command
// signs in), the one thing to do about it.
const reasonOf = (error) => (error.next ? `${error.message} -- ${error.next}` : error.message);

// A source that cannot be read: recorded so, unless a record of it that WAS read is
// already there -- a failed refresh does not throw away what the last good read knew.
function unavailable(a, identity, existing, error) {
  const rec = existing && READ.includes(existing.state) ? existing : unavailableRecord(identity, "workitem", identity.id, reasonOf(error), a.w.now());
  if (rec !== existing) a.w.sources.saveRecord(rec);
  noted(a, rec.id, "unavailable", { why: reasonOf(error).slice(0, 200) });
  a.records.push(rec);
  return rec;
}

const finding = (a, kind, rec, say) => a.w.sources.addFinding({ kind, source: rec.id, revision: rec.revision, say });

// What a moved source does to whose word it is: a revision a person accepted is not
// the revision now, so the acceptance does not carry -- and it is said.
function moved(a, existing, rec) {
  if (existing?.authority === "accepted") finding(a, "source-reaccept", rec, `${rec.ref} moved from revision ${existing.revision} to ${rec.revision}, and a person accepted the earlier one — accept it again if the new one is the team's contract`);
  return rec;
}

function anomalous(a, existing, rec) {
  finding(a, "source-anomaly", rec, `${rec.ref} kept revision ${rec.revision} but its content is not what was read before — the system did not say it changed, and the content says it did`);
  return { ...rec, state: "anomaly", authority: existing.authority, ...(existing.acceptedBy ? { acceptedBy: existing.acceptedBy } : {}) };
}

// What to keep, by what reading it again meant.
const KEEP = { changed: moved, anomaly: anomalous, unchanged: (_a, existing) => existing };

const fresh = (a, identity, item) => sourceRecord({ identity, kind: "workitem", ref: identity.id, url: item.url, revision: item.revision, text: workitemText(item), authority: "draft", now: a.w.now(), relations: item, provenance: provenanceOf(a, "workitem.read") });

function keep(a, { existing, kept, verdict, item }) {
  if (kept !== existing) a.w.sources.saveRecord(kept);
  noted(a, kept.id, existing ? verdict : "new");
  a.contents[kept.id] = item;
  a.records.push(kept);
  return kept;
}

function settled(a, identity, existing, item) {
  const rec = fresh(a, identity, item);
  const verdict = sameSource(existing, rec);
  const kept = KEEP[verdict](a, existing, rec);
  return keep(a, { existing, kept, verdict, item });
}

async function readOne(a, identity, depth) {
  const existing = a.w.sources.record(sourceId(identity, "workitem"));
  if (!a.opts.refresh && existing && READ.includes(existing.state)) return reused(a, existing);
  const got = await attempt(() => fetched(a, identity, depth === 0));
  return got.error ? unavailable(a, identity, existing, got.error) : settled(a, identity, existing, got.value);
}

// ---- the neighbourhood ---------------------------------------------------------------

const related = (rec) => [...(rec.relations.parent ? [{ ref: rec.relations.parent, kind: "workitem" }] : []), ...rec.relations.children.map((ref) => ({ ref, kind: "workitem" })), ...rec.relations.related.map((r) => ({ ref: r.ref, kind: r.kind }))];

// Context is recorded once, and never read.
function contextOf(a, identity, rel) {
  const at = { ...identity, id: rel.ref };
  const rec = contextRecord(at, rel.kind, rel.ref, provenanceOf(a, "workitem.relations.read"), a.w.now());
  if (!a.w.sources.record(rec.id)) a.w.sources.saveRecord(rec);
  noted(a, rec.id, "context");
  a.records.push(a.w.sources.record(rec.id) ?? rec);
}

// The next items to read, and the context to record. Only requirement-world kinds are
// followed; an item already visited is not visited again.
function neighbours(a, at, rec) {
  const rels = related(rec).filter((r) => !a.seen.has(`${r.kind}:${r.ref}`));
  for (const r of rels) a.seen.add(`${r.kind}:${r.ref}`);
  for (const r of rels.filter((x) => !authorityBearing(x.kind))) contextOf(a, at.identity, r);
  return at.depth < a.maxDepth ? rels.filter((r) => authorityBearing(r.kind)).map((r) => ({ identity: { ...at.identity, id: r.ref }, depth: at.depth + 1 })) : [];
}

async function walked(a) {
  const queue = [{ identity: a.identity, depth: 0 }];
  a.seen.add(`workitem:${a.identity.id}`);
  while (queue.length) {
    const at = queue.shift();
    if (a.items.filter((i) => i.status !== "context").length >= MAX_ITEMS) { a.skipped.push(at.identity.id); continue; }
    queue.push(...neighbours(a, at, await readOne(a, at.identity, at.depth)));
  }
}

// ---- what is remembered, and what is handed back ---------------------------------------

const targetOf = (i) => ({ provider: i.provider, organization: i.organization, ...(i.project ? { project: i.project } : {}) });

// After a first successful read, and only if nobody bound a system: the engine's own
// guess, which a person's binding always outranks (it refuses to replace one).
function remembered(a) {
  const current = a.w.sources.bindings();
  if (current.doc.default !== null) return null;
  const done = attempt(() => a.w.sources.setBinding((d) => ({ ...d, default: targetOf(a.identity) }), { by: "engine", revision: current.revision, now: a.w.now() }));
  return done.then((r) => (r.error ? null : "engine"));
}

function written(w, out, envelope) {
  if (!w.runtimeDir) throw new Refused("fetched text may only be written into this session's runtime directory, and none is bound here");
  const file = contained(w.runtimeDir, resolve(w.runtimeDir, out));
  w.io.write(file, `${JSON.stringify(envelope, null, 2)}\n`);
  return file;
}

const rootFailed = (a) => a.items[0]?.status === "unavailable";

function beginning(w, opts, found) {
  const reader = readerOf(w, found.provider);
  if (!found.identity || !reader) return null;
  return { w, opts, reader, identity: found.identity, maxDepth: Math.min(opts.depth ?? MAX_DEPTH, MAX_DEPTH), seen: new Set(), items: [], records: [], contents: {}, notes: [], skipped: [] };
}

// opts: { ref | identity, refresh, depth, out }
// w: the ladder's world, plus { readers, sources (the room), io, runtimeDir, now }
export async function acquire(w, opts = {}) {
  const found = decided(w, opts);
  const a = beginning(w, opts, found);
  if (!a) return { root: null, resolution: found.resolution, sources: [], items: [], envelope: null };
  await walked(a);
  return finished(a, found, rootFailed(a) ? null : await remembered(a));
}

function finished(a, found, binding) {
  const envelope = envelopeOf(a.records, a.contents);
  const file = a.opts.out ? written(a.w, a.opts.out, envelope) : null;
  return { root: rootId(a.identity), source: sourceId(a.identity, "workitem"), resolution: found.resolution, identity: a.identity, provider: found.provider.key, sources: a.records, items: a.items, notes: a.notes, skipped: a.skipped, truncated: a.skipped.length > 0, binding, envelope, file };
}
