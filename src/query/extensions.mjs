// What this project taught the engine, and what it tried to and could not.
//
// The second half is the reason this view exists at all. An extension that
// failed to load is the likeliest cause of the next confusing error -- "no
// capability postgres.query is registered" reads like a typo in a case and is
// usually a manifest three lines from being right -- and until there was
// somewhere to print the refusal, the only way to find it was to guess.
//
// Read-only, and it re-judges nothing: it prints what the loader decided.
import { out } from "./format.mjs";

export function extensions(ctx) {
  const state = ctx.extensions ?? { loaded: [], refused: [], room: null };
  said(state);
  for (const e of state.loaded) loaded(e);
  for (const r of state.refused) refused(r);
  return { findings: 0 };
}

function said(state) {
  if (state.room) out(`(${state.room})\n`);
  out(`${state.loaded.length} loaded, ${state.refused.length} refused\n`);
}

function loaded(e) {
  out(`ok    ${e.id}  ${e.version}  ${e.apiVersion}  [${e.status}]${e.mutates ? "  MUTATES" : ""}`);
  for (const line of offers(e)) out(`        ${line}`);
}

// Only what it actually brought. An extension that adds one capability should
// read as one line, not as four empty headings.
const offers = (e) =>
  [["capabilities", e.capabilities], ["verbs", e.verbs], ["fields", e.fields], ["validators", e.validators], ["relations", e.relations], ["interpreters", e.interpreters], ["report parts", e.reportParts], ["needs", e.tools]]
    .filter(([, list]) => list?.length)
    .map(([what, list]) => `${what}: ${list.join(", ")}`);

function refused(r) {
  out(`REFUSED  ${r.id}${r.status ? `  [${r.status}]` : ""}`);
  out(`        ${r.why}`);
}

export function capabilities(ctx) {
  const all = ctx.capabilities.list();
  if (!all.length) return none(ctx);
  out(`${all.length} capability(ies) this project can ask:\n`);
  for (const c of all) out(`  ${c.id.padEnd(28)} ${c.doc}${tail(c)}`);
  return { findings: 0 };
}

const tail = (c) => `${c.mutates ? "  MUTATES" : ""}${c.tools?.length ? `  needs ${c.tools.join(", ")}` : ""}  (${c.from})`;

// A project with none is the normal state, not a fault. Saying where they would
// come from is the only useful thing to print.
function none(ctx) {
  out("this project has registered no capabilities.\n");
  for (const line of WHERE_THEY_COME_FROM) out(line);
  return { findings: 0 };
}

const WHERE_THEY_COME_FROM = [
  "A capability is how a case reaches something the engine does not know about — a",
  "second database, a vendor SDK, a queue. They live in this project's own store, not",
  "in the plugin, so upgrading the engine does not remove them. `orbit-qc-builder`",
  "builds the smallest one a verification actually needs; `query extensions` says what",
  "is there and what failed to load.",
];

export function capability(ctx, [id]) {
  if (!id) return capabilities(ctx);
  const cap = ctx.capabilities.list().find((c) => c.id === id);
  if (!cap) return missing(ctx, id);
  describe(cap);
  return { findings: 0 };
}

function describe(cap) {
  out(`${cap.id}   ${cap.apiVersion}   from ${cap.from}`);
  out(`  ${cap.doc}\n`);
  for (const line of contract(cap)) out(line);
  out(`\nIn a case:\n  {"do":"call","capability":"${cap.id}","input":{${example(cap)}},"proves":"sql","expect":"…"}`);
}

const contract = (cap) => [...inputs(cap), ...needs(cap)];

function inputs(cap) {
  const schema = cap.inputSchema ?? {};
  const names = Object.keys(schema);
  if (!names.length) return ["  input: (it accepts nothing)"];
  return ["  input:", ...names.map((n) => `    ${n.padEnd(14)} ${shape(schema[n])}${(cap.required ?? []).includes(n) ? "  REQUIRED" : ""}  ${schema[n].doc ?? ""}`)];
}

const shape = (row) => (row.enum ? row.enum.join("|") : row.type ?? "any");

const needs = (cap) => [
  `  changes external state: ${cap.mutates ? "YES — the case must declare \"destructive\": true" : "no"}`,
  `  needs on PATH: ${cap.tools?.length ? cap.tools.join(", ") : "nothing"}`,
];

const example = (cap) => Object.keys(cap.inputSchema ?? {}).slice(0, 1).map((n) => `"${n}":"…"`).join("");

function missing(ctx, id) {
  out(`no capability "${id}" is registered here.`);
  out(`this project offers: ${ctx.capabilities.ids().join(", ") || "(none)"}`);
  out("`query extensions` says whether one failed to load.");
  return { findings: 0 };
}
