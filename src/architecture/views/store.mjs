// The questions about the snapshot itself: where it is, what it can do, and
// what has moved under it.
//
// `where` prints every candidate the resolution considered, including the ones
// that lost and why -- the same reasoning `learn where` follows. A memory tool
// that will not say where it keeps things, or quietly writes somewhere other
// than you expect, is one nobody can audit.
import { capabilitiesOf } from "../../qa/capability.mjs";
import { factState, measure } from "../../freshness.mjs";
import { layerFacts } from "../capability.mjs";
import { out } from "../../query/format.mjs";
import { verifiedAgainstSource } from "../model.mjs";

export function where(ctx) {
  const found = ctx.store;
  out(`store      ${ctx.arch.paths.root}   (${found.source})`);
  out(`  why      ${found.why}`);
  said(ctx, found);
}

function said(ctx, found) {
  out(`  key      ${found.key}   (${found.layout === 3 ? "Git repository identity" : "explicit data directory identity"})`);
  out("  note     ORBIT_LEARN_DIR relocates this whole machine store, not only the lessons — one store, one variable");
  out("considered");
  for (const c of found.considered) out(`  ${c.source.padEnd(8)} ${String(c.dir ?? "—").padEnd(52)} ${c.verdict}: ${c.why}`);
  roots(ctx);
}

function roots(ctx) {
  out(`source     ${ctx.source.root ?? "(no readable checkout)"}`);
  out(`  commit   ${ctx.source.commit() ?? "unknown — nothing here can be dated"}`);
  out("  nothing this command writes ever lands in the repository it reads");
}

// What the project can be held to, engine-side and project-side in one table:
// a layer with a verb but no tool is a gap, and a capability somebody asked
// about is recorded whether the answer was yes or no.
export function capabilities(ctx) {
  const stored = ctx.arch.all().filter((f) => f.kind === "capability");
  const layers = layerFacts(capabilitiesOf(ctx.config), "ui-tests/project.json");
  out("capabilities — what this project can be held to\n");
  for (const f of merged(stored, layers)) out(`  ${verdictOf(f).padEnd(10)} ${String(f.capability).padEnd(22)} ${f.statement}`);
  gaps(merged(stored, layers));
}

// A stored answer wins over the derived one: somebody asked and it was recorded
// against evidence, which is more than a config read can say.
const merged = (stored, layers) => [...stored, ...layers.filter((l) => !stored.some((s) => s.key === l.key))];

const verdictOf = (f) => (f.confidence === "unknown" ? "MISSING" : f.confidence === "certain" ? "yes" : "maybe");

function gaps(all) {
  const missing = all.filter((f) => verdictOf(f) === "MISSING");
  if (!missing.length) return out("\nno capability anybody has asked about is missing here.");
  out(`\n${missing.length} gap(s) — a plan needing one of these records it as a blocker, never drops the layer:`);
  for (const m of missing) for (const u of m.unknowns ?? []) out(`  ${m.capability}: ${u}`);
}

// What has moved under the snapshot, without changing it. The read-only form of
// what `ensure` would act on.
export function diff(ctx) {
  const all = ctx.arch.all();
  if (!all.length) return out("nothing has scanned this project yet — `architecture ensure` builds a snapshot");
  const scopes = measure(all, ctx.arch.model().model, ctx.source);
  out(`snapshot at ${ctx.arch.model().model?.commit ?? "an unrecorded commit"} · source now at ${ctx.source.commit() ?? "unknown"}\n`);
  listed(all, scopes);
}

function listed(all, scopes) {
  for (const [s, v] of Object.entries(scopes)) out(`  ${v.state.padEnd(7)} ${s.padEnd(34)} ${v.say}`);
  const moved = all.filter((f) => factState(f, scopes) !== "fresh");
  out(`\n${all.length - moved.length} of ${all.length} fact(s) still describe this tree`);
  unverified(all);
  if (moved.length) out("  `architecture ensure` re-reads only what moved");
}

// Said out loud rather than filtered: a fact nobody checked against the code is
// still worth having, and hiding it guarantees nobody ever checks it.
function unverified(all) {
  const memory = all.filter((f) => !verifiedAgainstSource(f));
  if (memory.length) out(`  ${memory.length} of them came from memory and were never checked against the code`);
}
