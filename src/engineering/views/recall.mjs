// `engineering recall [--for="…"] [--json]`: the facts that bear on a task, each
// with the tier that says how far it may steer the work. Reads only -- it
// neither measures freshness nor stamps anything; `engineering ensure` is the
// command that brings `status` up to date first.
import { flag, words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { recall } from "../recall.mjs";
import { tokens } from "../../tokens.mjs";

export function recallView(ctx, args) {
  const asked = tokens(flag(args, "for") ?? words(args).join(" "));
  const near = ctx.near?.() ?? [];
  const rows = recall(ctx.eng.all(), { asked, near });
  if (args.includes("--json")) return out(JSON.stringify({ asked, near, facts: rows.map(jsonRow) }, null, 2));
  printed(rows, asked, near);
}

const jsonRow = (r) => ({ tier: r.route.tier, binding: r.route.binding, says: r.route.says, score: r.score, id: r.fact.id, kind: r.fact.kind, statement: r.fact.statement, confidence: r.fact.confidence, strength: r.fact.strength, status: r.fact.status });

function printed(rows, asked, near) {
  out(`ENGINEERING RECALL${asked.length ? `  for: ${asked.join(", ")}` : "  (no task — binding facts only)"}${near.length ? `  near: ${near.slice(0, 4).join(", ")}` : ""}\n`);
  if (!rows.length) return out("  nothing recorded bears on this — `engineering ensure --for=…` says whether it is worth observing");
  for (const r of rows) line(r);
  out("\nA HINT is one session's observation and never a rule; `engineering why <id>` shows the evidence behind any line.");
}

function line(r) {
  out(`  ${r.route.tier.padEnd(12)} ${r.fact.confidence.toUpperCase()} · ${r.fact.strength.toUpperCase()}${r.fact.status === "fresh" ? "" : ` · ${r.fact.status.toUpperCase()}`}`);
  out(`               ${r.fact.statement}`);
  out(`               ${r.route.says} — ${r.fact.id}`);
}
