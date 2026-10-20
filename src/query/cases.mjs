import { relative } from "node:path";
import { selectorOf, waitOf } from "../dsl/index.mjs";
import { out } from "./format.mjs";

export function listCases(ctx) {
  if (!ctx.cases.length) out("no cases yet — add screens/<screen>/cases/<id>.json");
  for (const c of ctx.cases) out(`${c.id.padEnd(24)} ${c.name}  [${c.seen}${c.fe_commit ? ` @ ${c.fe_commit}` : ""}]${c.destructive ? "  DESTRUCTIVE" : ""}${c.creates ? `  creates: ${c.creates}` : ""}`);
  out("\nrun one:  run-case <id> NAME=TC-…   (--dry to read it first)");
}

export function showCase(ctx, [id]) {
  const c = ctx.cases.find((x) => x.id === id);
  if (!c) return out(`no case ${id} — try: query cases`);
  header(c);
  (c.steps ?? []).forEach((st, i) => step(ctx, st, i));
  out(`\nrun it:  run-case ${c.id} ${(c.params ?? []).filter((p) => p.required).map((p) => `${p.n}=…`).join(" ")} --dry`);
}

function header(c) {
  out(`${c.name}  [${c.seen}${c.fe_commit ? ` @ ${c.fe_commit}` : ""}]  ${relative(process.cwd(), c._file)}`);
  if (c.creates) out(`  creates: ${c.creates}`);
  if (c.destructive) out("  DESTRUCTIVE");
  if (c.note) out(`  ! ${c.note}`);
  params(c);
}

function params(c) {
  for (const p of c.params ?? []) out(`  param ${p.n}${p.required ? " (required)" : ` = ${JSON.stringify(p.default ?? "")}`}`);
  out("");
}

function step(ctx, st, i) {
  const sel = selectorOf(st, ctx.graph) ?? "";
  out(`  ${String(i + 1).padStart(2)}. ${st.do.padEnd(10)} ${st.on ?? st.screen ?? st.key ?? st.file ?? ""}${sel ? `  ${sel}` : ""}`);
  if (st.value) out(`      value: ${st.value}`);
  if (waitOf(st)) out(`      wait:  ${waitOf(st)}${st.tries ? `  (x${st.tries})` : ""}`);
}
