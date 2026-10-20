// `intelligence resolve <intent>`: reuse, build, unknown or blocked -- and
// every step of how it got there.
//
// What the resolver reasons over is handed IN: the capabilities this project
// registered and the binding engineering conventions come from the composition
// root as data, so nothing here reads the extension store or engineering
// memory, and the answer can be reproduced from what is printed.
import { Refused } from "../../errors.mjs";
import { words } from "../../learn/args.mjs";
import { out } from "../../query/format.mjs";
import { resolve } from "../resolution/resolve.mjs";
import { notKnown } from "./facts.mjs";

export function resolveView(ctx, args) {
  const intent = words(args).join(" ").trim();
  if (!intent) throw new Refused("resolve what? — `intelligence resolve read-acme-ledger-entries`, or any sentence naming a system and what to do with it");
  const answer = resolve(intent, worldOf(ctx));
  if (args.includes("--json")) return out(JSON.stringify(answer, null, 2));
  printed(answer);
}

export const worldOf = (ctx) => ({ facts: ctx.intel.all(), descriptors: ctx.registry.descriptors.list(), operations: ctx.registry.analyzers.list().flatMap((a) => a.operations ?? []), capabilities: ctx.capabilities?.() ?? [], conventions: ctx.conventions?.() ?? [], snapshot: ctx.intel.model().model !== null });

function printed(a) {
  out(`RESOLVE  ${a.decision}\n`);
  out(`  intent       ${a.intent}`);
  out(`  system       ${a.integration ?? "—"}${a.operation ? ` · operation ${a.operation}` : ""}`);
  out(`  capability   ${a.capability ?? "none registered for it"}\n  technology   ${a.technology ?? "not settled"}${a.options ? `   (could be: ${a.options.join(", ")})` : ""}\n  reason       ${a.reason}`);
  trail(a);
}

function trail(a) {
  out("\nconsidered");
  for (const c of a.considered) out(`  ${c.step.padEnd(15)} ${c.verdict.padEnd(10)} ${c.says}`);
  out(`\nevidence\n${(a.evidence.length ? a.evidence : ["nothing — the decision rests on what was NOT found, listed above"]).map((e) => `  ${e}`).join("\n")}`);
  notKnown(a.unknowns);
  out(`\nnext  ${a.next}`);
}
