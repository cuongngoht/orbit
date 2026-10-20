// `verify`: has the code moved underneath the map? Every cited file:line is
// resolved on disk, and the recorded frontend commit is compared with the
// checkout, so a stale map announces itself instead of misdirecting QC.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { out } from "./format.mjs";

const REF = /([\w./\- ]+\.(?:cs|ts|tsx|sql)):(\d+)/g;

export function verify(ctx) {
  const cited = citations(ctx.graph);
  const roots = searchRoots(ctx);
  const ok = cited.filter(([who, file, line]) => resolves(roots, who, file, line)).length;
  out(`\n${ok}/${cited.length} cited file:line refs resolve`);
  drift(ctx, cited);
}

// Only `src` fields are machine-consumed; bare filenames in a `note` are prose.
function citations(g) {
  return g.rows.flatMap((r) => srcsOf(r).flatMap((s) => [...s.matchAll(REF)].map((m) => [r.on ?? r.id ?? `${r.from}/${r.via}`, m[1].trim(), +m[2]])));
}

const srcsOf = (r) => [r.src, ...Object.values(r.layers ?? {}).flat().map((i) => i.src)].filter(Boolean);

function searchRoots(ctx) {
  const fe = ctx.frontend.root;
  const src = fe && ctx.config.frontend.srcDir ? join(fe, ctx.config.frontend.srcDir) : fe;
  return [src, ctx.project.root].filter(Boolean);
}

function resolves(roots, who, file, line) {
  const hit = resolveRef(roots, file);
  if (!hit) return out(`missing file: ${file}  (cited by ${who})`), false;
  const n = readFileSync(hit, "utf8").split("\n").length;
  if (line > n) return out(`line ${line} > ${n} lines: ${file}  (cited by ${who})`), false;
  return true;
}

// Paths may contain a space (`Release 2.10/Add_….sql`), so the pattern also
// swallows a preceding prose word. Drop leading words until it resolves.
function resolveRef(roots, file) {
  for (let candidate = file; ; candidate = candidate.slice(candidate.indexOf(" ") + 1)) {
    const hit = roots.map((r) => join(r, candidate)).find((p) => existsSync(p));
    if (hit) return hit;
    if (!candidate.includes(" ")) return null;
  }
}

function drift(ctx, cited) {
  if (!ctx.graph.meta?.fe_commit) return out("no fe_commit in graph/meta.json — cannot check drift");
  const head = ctx.frontend.commit();
  if (!head) return out("frontend working copy not readable — drift unchecked");
  caseDrift(ctx, head);
  mapDrift(ctx, cited, head);
}

// A case cites no file:line, so its expiry date is its own fe_commit.
function caseDrift(ctx, head) {
  const stale = ctx.cases.filter((c) => c.fe_commit && c.fe_commit !== head);
  if (!stale.length) return;
  out(`\n${stale.length} case(s) recorded against an older frontend — re-run before trusting:`);
  for (const c of stale) out(`  ${c.id}  (recorded @ ${c.fe_commit})`);
}

function mapDrift(ctx, cited, head) {
  if (head === ctx.graph.meta.fe_commit) return out(`frontend at ${head} — matches the graph, no drift`);
  out(`\nfrontend has moved: graph captured ${ctx.graph.meta.fe_commit}, working copy is ${head}`);
  const moved = changedFiles(ctx);
  if (!moved) return out("cannot diff that range — is the recorded commit still present?");
  touched(ctx, cited, moved);
}

// Through the port, not through a second `git diff` of its own. This file used
// to spawn git itself, which meant two places knew how to ask a checkout what
// had moved -- and only one of them could be given a fake.
function changedFiles(ctx) {
  const moved = ctx.frontend.changed(ctx.graph.meta.fe_commit);
  return moved ? new Set(moved) : null;
}

function touched(ctx, cited, moved) {
  const prefix = ctx.config.frontend.srcDir ? `${ctx.config.frontend.srcDir}/` : "";
  const hit = [...new Set(cited.filter(([, f]) => moved.has(prefix + f)).map(([who, f]) => `${who}  ->  ${f}`))];
  if (!hit.length) return out("...but no file this graph cites was touched. Records stand.");
  out(`${hit.length} record(s) cite a file that changed — re-verify these before trusting them:`);
  for (const h of hit) out(`  ${h}`);
}
