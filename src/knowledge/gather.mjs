// A QUESTION, and everything it is answered from -- built once per command, so
// `claims`, `verify` and `why` cannot answer the same task from different
// piles.
//
// The question is tokens, never the task's text: `--for` is reduced by
// src/tokens.mjs and the text itself goes nowhere. The piles:
//
//   stored     this project's recorded claims
//   declared   an organisation's, read live from its room (src/knowledge/declared.mjs)
//   session    what a host's memory hinted THIS invocation -- never written
//
// Host memory steers as well as answers: the known concepts its hints point at
// join the question's subjects (`targets`), which is what makes a hint useful
// for targeted discovery without ever making it true.
import { Refused } from "../errors.mjs";
import { flag, words } from "../learn/args.mjs";
import { tokens } from "../tokens.mjs";
import { parseContext } from "./applies.mjs";
import { recalled, targets } from "./host-memory.mjs";
import { LIMIT } from "./query.mjs";

const listFlag = (args, name) => String(flag(args, name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function askOf(ctx, args) {
  const text = flag(args, "for") ?? words(args).join(" ");
  const context = parseContext(flag(args, "context") ?? "");
  if (context.findings.length) throw new Refused(context.findings.join("\n"));
  return { tokens: tokens(text), subjects: listFlag(args, "subject").map((s) => s.toLowerCase()), context: context.context, near: ctx.near?.() ?? [], changed: args.includes("--changed") ? ctx.changed?.() ?? [] : [], limit: LIMIT };
}

export function gathered(ctx, ask) {
  const stored = ctx.know.all();
  const declared = ctx.declared?.() ?? { claims: [], refused: [] };
  const recall = recalled(ctx.hostMemory?.() ?? [], ask, { tracked: ctx.tracked?.() ?? new Set() });
  const aim = targets(recall.hints, [...stored, ...declared.claims]);
  return { stored, declared, recall, targets: aim, claims: [...stored, ...declared.claims, ...recall.claims], ask: { ...ask, subjects: [...new Set([...ask.subjects, ...aim.subjects])] } };
}
