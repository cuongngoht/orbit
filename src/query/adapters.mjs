// What adapters this context may select from, which were refused and why, and -- with --matrix --
// what each operation's SUPPORT is, computed from conformance receipts (src/adapters/matrix.mjs).
// Read-only: it prints what the loader decided and what the receipts show.
import { supportMatrix } from "../adapters/matrix.mjs";
import { fingerprintOf } from "../adapters/dispatch.mjs";
import { out } from "./format.mjs";

export function adapters(ctx, args = []) {
  const listed = ctx.adapters?.list?.() ?? [];
  const matrix = args.includes("--matrix") ? supportMatrix(listed, ctx.adapterReceipts?.() ?? [], { codeOf: ctx.adapterCode }) : undefined;
  if (args.includes("--json")) return said(JSON.stringify({ adapters: listed.map(shortOf), refused: ctx.adapters?.refused?.() ?? [], matrix }, null, 2));
  printed(listed, ctx.adapters?.refused?.() ?? [], matrix);
  return { findings: 0 };
}

const shortOf = (a) => ({ id: a.id, version: a.version, family: a.family, transports: a.transports, operations: Object.keys(a.operations ?? {}), from: a.from, fingerprint: fingerprintOf(a), undeclared: a.undeclared ?? [] });

function said(text) {
  out(text);
  return { findings: 0 };
}

function printed(listed, refused, matrix) {
  out(`${listed.length} adapter(s), ${refused.length} refused\n`);
  for (const a of listed) out(`  ${a.id.padEnd(22)} ${a.version.padEnd(8)} ${a.family.padEnd(10)} ${a.transports.join(",").padEnd(20)} (${a.from})`);
  for (const r of refused) out(`  REFUSED ${r.id ?? "?"} (${r.from}): ${r.problems.join("; ")}`);
  if (matrix) matrixPrinted(matrix);
}

function matrixPrinted(rows) {
  out(`\nsupport, computed from conformance receipts -- never declared:\n`);
  for (const r of rows) out(`  ${r.level.padEnd(12)} ${`${r.adapter} ${r.op}`.padEnd(36)} ${r.why}`);
}
