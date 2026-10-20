// One plan, read back: what it commits to, per scenario, and where each one has
// got to on all four axes -- never one word standing in for the four.
import { commitments, gaps } from "../commit.mjs";
import { DRAFT_NOTE, planFor } from "../load.mjs";
import { noPlan, out } from "../format.mjs";
import { scoreOf } from "../risk.mjs";
import { buildOf, designOf, executionOf, freshnessOf } from "../states.mjs";
import { checksOf, criteriaOf, scenariosOf } from "../rules/common.mjs";
import { planWorld } from "../world.mjs";

export function show(ctx, [ref]) {
  const p = ref ? planFor(ctx, ref) : null;
  return p ? body(ctx, p) : noPlan(ref ?? "");
}

function body(ctx, p) {
  const world = planWorld(ctx, { drafts: Boolean(p._draft) });
  header(p);
  scenariosOf(p).forEach((s) => scenario(p, s, world));
  tail(p);
}

function header(p) {
  out(`${p.title ?? p.id}${p.revision ? `  rev ${p.revision}` : ""}${p.at ? `  (${p.at})` : ""}${p._draft ? `  — ${DRAFT_NOTE}` : ""}`);
  out(`  ${criteriaOf(p).length} criteria · ${scenariosOf(p).length} scenarios · ${checksOf(p).length} manual check(s)`);
  for (const c of criteriaOf(p)) out(`  ${c.id.padEnd(6)} ${c.says}`);
}

function scenario(p, s, world) {
  const build = buildOf(s, world);
  const run = executionOf(s, world);
  out(`\n${s.id} — ${s.name ?? ""}  [${s.priority ?? "?"}${s.must ? " MUST" : ""}]  ${s.technique ?? ""}`);
  out(`  covers ${(s.covers ?? []).join(", ") || "—"} · design ${designOf(s).name} · build ${build.state} · run ${run.status ?? "never"} · evidence ${fresh(p, run, world)}`);
  detail(s, world);
}

const fresh = (p, run, world) => freshnessOf(run.cases[0]?.run, p, world).state;

function detail(s, world) {
  for (const c of commitments(s)) out(`  proves ${c.layer.padEnd(4)} ${c.says}`);
  for (const g of gaps(s)) out(`  gap    ${g.layer.padEnd(4)} ${g.because}`);
  for (const b of s.blockers ?? []) out(`  block  ${b.kind.padEnd(4)} ${b.says}`);
  risk(s);
}

function risk(s) {
  const score = scoreOf(s.risk);
  if (!score.given.length) return;
  out(`  risk   ${score.total}/${score.of} from ${score.given.join(", ")}${score.missing.length ? `, not scored: ${score.missing.join(", ")}` : ""}`);
}

function tail(p) {
  for (const q of p.questions ?? []) out(`\nopen   ${q.id} ${q.asks}  (${q.owner ?? "unassigned"})`);
  for (const m of checksOf(p)) out(`manual ${m.id} ${m.name ?? ""}  (${m.owner ?? "unassigned"}${m.state ? `, ${m.state}` : ""})`);
}
