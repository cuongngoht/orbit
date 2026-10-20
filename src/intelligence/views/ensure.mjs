// `intelligence ensure`: decide, say why, do only that much -- and write only
// what the plan re-derived.
//
// The decision name is printed FIRST, always: a tool that decides silently
// whether to read somebody's repository cannot be audited.
import { Blocked } from "../../errors.mjs";
import { out } from "../../query/format.mjs";
import { decide } from "../ensure.mjs";
import { ensureFacts } from "../facts.mjs";
import { sortedUnique } from "../group.mjs";
import { MODEL_VERSION } from "../model.mjs";
import { registryPrint } from "../registry.mjs";
import { scan } from "../scan.mjs";

export function ensure(ctx, args = []) {
  const facts = ensureFacts(ctx, args);
  const decision = decide(facts, { dry: args.includes("--dry") });
  out(`INTELLIGENCE ${decision.name}\n`);
  out(`  ${decision.say}\n`);
  return carried(ctx, facts, decision);
}

function carried(ctx, facts, decision) {
  if (decision.stops) throw new Blocked(decision.say);
  if (decision.skipped.length) out(`  skipped: ${decision.skipped.join(", ")} moved, and nothing the task asked about lives there — not re-read\n`);
  if (!decision.plan.manifests && decision.plan.usage === "none") return void out("scan:\n  skipped — the snapshot answers this");
  performed(ctx, facts, decision);
}

function performed(ctx, facts, decision) {
  const done = scan(ctx, decision.plan, facts.facts);
  out(`scan:\n  ${[decision.plan.manifests ? "manifests" : null, done.mode !== "none" ? `usage (${done.mode === "all" ? "every usage" : "moved scopes"})` : null].filter(Boolean).join(" + ")} · ${done.read} read(s) · ${done.facts.length} fact(s) re-derived · ${done.kept.length} kept`);
  for (const u of done.unknowns.slice(0, 6)) out(`  could not tell: ${u}`);
  written(ctx, facts, decision, done);
}

function written(ctx, facts, decision, done) {
  if (!decision.writes) return void out(`\n--dry: ${done.facts.length} fact(s) would be recorded and ${done.removed.length} replaced — nothing written`);
  for (const id of done.removed) ctx.intel.remove(id);
  for (const f of done.facts) ctx.intel.save(f);
  ctx.intel.setModel(nextModel(ctx, facts, done));
  out(`\n${done.facts.length} fact(s) recorded · \`intelligence technologies\` shows what they add up to`);
}

// What the NEXT decision compares against. A directory that is gone is dropped
// from the swept list, or it would read as moved forever.
function nextModel(ctx, facts, done) {
  const was = facts.model ?? ctx.intel.emptyModel(ctx.now());
  const gone = new Set(Object.entries(facts.scopes).filter(([, v]) => !v.hash).map(([s]) => s));
  return { ...was, v: MODEL_VERSION, at: ctx.now(), commit: ctx.source.commit(), registry: registryPrint(ctx.registry), scopes: { ...was.scopes, ...done.scopes }, manifests: done.manifests ?? was.manifests ?? [], sweeps: done.sweeps ?? was.sweeps ?? [], swept: sortedUnique([...(was.swept ?? []).filter((s) => !gone.has(s)), ...done.swept]) };
}
