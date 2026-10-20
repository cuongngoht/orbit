// `engineering journal [<fact-id>]` and `engineering replay` -- the audit
// trail, read-only. `journal` answers "why does this fact say N sessions":
// every observation behind it, in order, with the session it came from (hashed)
// and what reconciliation decided. `replay` re-derives every fact from the
// journal and reports where the store disagrees. Neither writes anything.
import { compared } from "../replay.mjs";
import { out } from "../../query/format.mjs";
import { words } from "../../learn/args.mjs";

export function journal(ctx, args) {
  const [id] = words(args);
  const lines = ctx.eng.observations();
  if (!id) return summary(lines);
  listed(lines.filter((l) => l.factId === id), id);
}

function listed(mine, id) {
  if (!mine.length) return out(`no observation of "${id}" in the journal — no supporting journal entry is available`);
  for (const l of mine) out(`  ${String(l.at).slice(0, 19)}  ${l.outcome.padEnd(10)} ${who(l)}${l.human ? "  (human record)" : ""}  ${(l.candidate?.evidence ?? []).length} evidence path(s)`);
}

const who = (l) => `${l.seenBy?.session ?? `${l.seenBy?.host ?? "?"}@${String(l.seenBy?.at ?? "").slice(0, 10)}`}`.padEnd(34);

function summary(lines) {
  const ids = [...new Set(lines.map((l) => l.factId))];
  out(`${lines.length} observation(s) of ${ids.length} fact(s) — \`engineering journal <id>\` for one`);
  for (const id of ids) out(`  ${String(lines.filter((l) => l.factId === id).length).padStart(4)}  ${id}`);
}

export function replay(ctx) {
  const rows = compared(ctx.eng.all(), ctx.eng.observations());
  if (!rows.length) return out("nothing recorded and nothing journaled — nothing to replay");
  for (const r of rows) out(`  ${r.state.padEnd(14)} ${r.id}  ${r.say}`);
  const off = rows.filter((r) => r.state === "differs" || r.state === "missing").length;
  out(`\n${rows.length} fact(s) · ${off} disagree with their journal · nothing was written`);
}
