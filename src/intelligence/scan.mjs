// Running the stages a PLAN names, and saying exactly which stored facts the
// result replaces.
//
// Nothing here decides WHETHER to scan -- that is ensure.mjs, and keeping the
// two apart is what stops a scan from quietly justifying itself. What this
// decides is the one thing only a scan can know: which old facts its new ones
// supersede. The stage column on each kind's row is that rule:
//
//   manifests  re-reading them replaces every manifests-stage fact;
//   usage      re-reading a directory replaces the usage facts scoped to it,
//              and a fact whose scope is still fresh -- or one this plan did
//              not cover -- is KEPT, untouched;
//   derived    recomputed from whatever usage facts survive, every time, since
//              it reads nothing and cannot be stale in a way the rest is not.
//
// One rule that is easy to miss: if re-reading the manifests changed WHICH
// technologies are declared, every usage has to be looked at again. An analyser
// gated on a client nobody used to declare never read the files that now
// matter, however fresh their directories are.
import { attempt } from "./attempt.mjs";
import { discover } from "./manifests/discover.mjs";
import { manifestFacts } from "./manifests/facts.mjs";
import { technologyFacts } from "./technology/match.mjs";
import { usagePass } from "./usage/run.mjs";
import { integrationFacts } from "./integration/derive.mjs";
import { dirOf, sortedUnique, underAny } from "./group.mjs";
import { makeFact } from "./model.mjs";
import { sha } from "../hash.mjs";
import { stageOf } from "./vocab.mjs";

export const NOT_A_CHECKOUT = "nothing could be listed — this is not a readable git checkout";

export function scan(ctx, plan, previous) {
  const files = ctx.source.files();
  if (files === null) return { facts: [], removed: [], kept: previous, scopes: {}, manifests: null, sweeps: null, swept: [], unknowns: [NOT_A_CHECKOUT], read: 0, analysers: [], mode: "none" };
  const input = counted(ctx, files, plan);
  const manifests = manifestsOf(ctx, input, plan, previous);
  return finished(ctx, input, previous, manifests, usageOf(ctx, input, plan, previous, manifests));
}

// Every read and every search is counted, because "this ensure read nothing"
// is the promise and a count is the only honest way to keep it.
function counted(ctx, files, plan) {
  const tally = { n: 0 };
  return { files, tally, budget: plan.budget, read: (p) => (tally.n++, ctx.source.read(p)), search: (p) => (tally.n++, ctx.source.search(p)) };
}

function manifestsOf(ctx, input, plan, previous) {
  if (!plan.manifests) return { ran: false, facts: previous.filter((f) => stageOf(f.kind) === "manifests"), paths: null, sweeps: null, unknowns: [] };
  const read = discover(input, ctx.registry.ecosystems);
  const found = attempt(() => technologyFacts(read, ctx.registry.descriptors.list()));
  return { ran: true, facts: [...manifestFacts(read), ...(found.value ?? [])], paths: read.map((m) => m.path), sweeps: sweepsOf(read, ctx.registry), unknowns: found.error ? [`which technologies are declared — matching failed: ${found.error}`] : [] };
}

// The directories of every unit an analyser could apply to. A new file in one
// of them is what the NEXT decision must notice, so their hashes are recorded
// even when nothing in them has been read yet.
function sweepsOf(read, registry) {
  const analysed = new Set(registry.analyzers.list().map((a) => a.ecosystem));
  return sortedUnique(read.filter((m) => m.unit && !m.unreadable && analysed.has(m.ecosystem)).map((m) => dirOf(m.path)));
}

function usageOf(ctx, input, plan, previous, manifests) {
  const kept = previous.filter((f) => stageOf(f.kind) === "usage");
  const mode = manifests.ran && signature(previous) !== signature(manifests.facts) ? "all" : plan.usage;
  if (mode === "none") return { kept, facts: [], read: [], unknowns: [], analysers: [], mode, covered: [] };
  const scoped = mode === "all" ? { scopes: null, fresh: [] } : rereading(kept, plan);
  return { ...usagePass(input, ctx.registry.analyzers.list(), knownOf(ctx, manifests.facts), scoped), kept: mode === "all" ? [] : kept.filter((f) => survives(f, plan)), mode, covered: scoped.scopes ?? [] };
}

// A fact that is being replaced is re-derived from ALL of its files, not only
// the one that moved -- otherwise a directory with two files, one edited, would
// come back knowing only the edited one.
function rereading(kept, plan) {
  const replaced = sortedUnique(kept.filter((f) => !survives(f, plan)).flatMap((f) => f.scope));
  return { scopes: sortedUnique([...plan.scopes, ...replaced]), fresh: plan.fresh.filter((s) => !replaced.includes(s)) };
}

// Which technologies and ecosystems a checkout declares, as one comparable
// string: what gates which analysers run where.
const signature = (facts) => facts.filter((f) => f.kind === "technology" || f.kind === "ecosystem").map((f) => `${f.key}:${f.units ?? ""}`).sort().join("\n");

const knownOf = (ctx, facts) => ({ technologies: facts.filter((f) => f.kind === "technology"), ecosystems: facts.filter((f) => f.kind === "ecosystem"), descriptors: new Set(ctx.registry.descriptors.ids()) });

// Kept when every scope is still fresh, or when this plan never covered it --
// a scope a targeted run walked past is stale AND kept, and says so.
const survives = (f, plan) => f.scope.every((s) => plan.fresh.includes(s)) || !f.scope.some((s) => underAny(s, plan.scopes));

function finished(ctx, input, previous, manifests, usage) {
  const derived = integrationFacts([...usage.kept, ...usage.facts]);
  const kept = [...(manifests.ran ? [] : manifests.facts), ...usage.kept];
  const stamped = stampAll([...(manifests.ran ? manifests.facts : []), ...usage.facts, ...derived], [...(manifests.sweeps ?? []), ...usage.read, ...usage.covered], ctx);
  return { facts: stamped.facts, kept, removed: previous.filter((f) => !kept.includes(f)).map((f) => f.id), scopes: stamped.scopes, manifests: manifests.paths, sweeps: manifests.sweeps, swept: sortedUnique(usage.read), unknowns: [...manifests.unknowns, ...usage.unknowns], read: input.tally.n, analysers: usage.analysers, mode: usage.mode };
}

// ONE fingerprint call for every scope the new facts name plus the directories
// the next decision will watch. A fact is fresh only when every scope it names
// hashed CLEAN: recorded over an uncommitted edit, it is `unknown`.
export function stampAll(raw, extra, ctx) {
  const scopes = sortedUnique([...raw.flatMap((f) => f.scope), ...extra]);
  const now = (scopes.length ? ctx.source.fingerprints(scopes) : null) ?? {};
  const commit = ctx.source.commit() ?? undefined;
  return { facts: raw.map((f) => stamp(f, now, commit, ctx.now)), scopes: Object.fromEntries(scopes.filter((s) => now[s]?.hash).map((s) => [s, { hash: now[s].hash }])) };
}

function stamp(f, now, commit, clock) {
  const hashes = f.scope.map((s) => now[s] ?? null);
  const clean = hashes.every((h) => h?.hash && !h.dirty);
  return makeFact(f, { commit, fingerprint: hashes.every((h) => h?.hash) ? sha(hashes.map((h) => h.hash).join("\n")).slice(0, 16) : undefined, status: clean ? "fresh" : "unknown", now: clock });
}
