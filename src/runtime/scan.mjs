// Reading the evidence, and recording only what came back.
//
// Nothing here decides WHETHER to read -- that is ensure.mjs, and keeping the two
// apart is what stops a scan from quietly justifying itself. A scan is the whole
// of discovery over the whole of the evidence: it is bounded by how many manifests
// and build files a checkout has, not by how large it is, so there is no
// "incremental" read to get wrong. What is incremental is that NOTHING is read
// when no evidence moved.
//
// Every fact is stamped by `makeFact` (src/runtime/model.mjs) with the fingerprint
// of its OWN scope, the commit it was read at, and the checkout it is about -- so
// a candidate cannot claim any of them. A fact that is no longer derived is
// REMOVED: understanding is what the evidence says now, not what it once said. An
// INFERENCE -- something an agent concluded from prose and recorded with its
// reasons -- is not derived by a read, so a read never removes one; a person does.
import { unmarked } from "../ecosystems/registry.mjs";
import { discover } from "./discover/index.mjs";
import { measure } from "../freshness.mjs";
import { makeFact } from "./model.mjs";

// A checkout whose evidence yields more than this is not being understood, it is
// being listed; the rest is dropped and said.
export const MAX_FACTS = 1000;
export const MAX_UNKNOWNS = 50;

export function scan(ctx) {
  const found = discover({ files: ctx.source.files() ?? [], read: (p) => bare(ctx.source.read(p)), ecosystems: ctx.ecosystems, catalog: ctx.catalog, name: ctx.name });
  const dropped = found.facts.length - MAX_FACTS;
  const over = dropped > 0 ? [`${dropped} fact(s) past the ${MAX_FACTS} a checkout keeps were dropped`] : [];
  return { ...found, facts: stampAll(found.facts.slice(0, MAX_FACTS), ctx), unknowns: [...found.unknowns, ...over].slice(0, MAX_UNKNOWNS), gaps: [...found.gaps, ...over].slice(0, MAX_UNKNOWNS) };
}

// What a file says, without the mark that says what encoding it is in: every reader here reads text,
// and a byte-order mark at the head of a Dockerfile or a compose file is as much in the way as it is
// in a manifest.
const bare = (text) => (text === null ? null : unmarked(text));

// Each fact is stamped with the fingerprint of its own scope; at the moment of a
// read every scope it just read IS fresh by definition, so the only other answer
// is `unknown`, for a scope the tree could not fingerprint at all.
function stampAll(raw, ctx) {
  const scopes = measure(raw, null, ctx.source);
  const commit = ctx.source.commit();
  return raw.map((f) => stamped(f, scopes, commit, ctx));
}

function stamped(raw, scopes, commit, ctx) {
  const hashes = raw.scope.map((s) => scopes[s]?.hash);
  const status = hashes.length && hashes.every(Boolean) ? "fresh" : "unknown";
  return makeFact(raw, { commit, fingerprint: hashes.find(Boolean) ?? undefined, status, now: ctx.now, checkout: ctx.checkout });
}

// Record a scan: the facts, the removal of what is no longer derived, and the
// state the NEXT decision compares against -- one hash per evidence file, the
// listing of them, what read them, and what could not be settled.
export function record(ctx, done) {
  const keep = new Set(done.facts.map((f) => f.id));
  done.facts.forEach((f) => ctx.store.save(f));
  ctx.store.all().filter((f) => f.source !== "inference" && !keep.has(f.id)).forEach((f) => ctx.store.remove(f.id));
  ctx.store.setModel(modelOf(ctx, done));
}

function modelOf(ctx, done) {
  const was = ctx.store.model().model ?? ctx.store.emptyModel(ctx.now());
  const scopes = measure(done.inventory.map((p) => ({ scope: [p] })), null, ctx.source);
  return { ...was, at: ctx.now(), commit: ctx.source.commit(), branch: ctx.source.branch(), scopes: Object.fromEntries(Object.entries(scopes).filter(([, v]) => v.hash).map(([k, v]) => [k, { hash: v.hash }])), inventory: done.inventory, unreadable: done.unreadable ?? [], readers: done.readers, unknowns: done.unknowns, gaps: done.gaps, scans: (was.scans ?? 0) + 1 };
}
