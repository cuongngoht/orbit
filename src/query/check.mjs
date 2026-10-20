// `check`: every hard rule the map and the cases must satisfy, then the
// advisories, printed apart so a heuristic never makes `check` look broken.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { caseSchema, validate } from "../dsl/index.mjs";
import { placeFindings } from "../dsl/rules/place.mjs";
import { edgeKey, graphFindings } from "../graph/index.mjs";
import { planSchema } from "../qa/schema.mjs";
import { CASE_SCHEMA, PLAN_SCHEMA, SCHEMA_DIR, planFiles } from "../tests-tree.mjs";
import { out } from "./format.mjs";

// Everything that is a RULE, as findings -- shared with record-edge, which
// rolls an append back when this list is not empty.
export function checkFindings(ctx) {
  const cases = [...ctx.cases.flatMap((c) => validate(c, ctx.graph)), ...placeFindings(ctx.cases, ctx.project.screensDir)].map((f) => `case ${f}`);
  return [...(ctx.config.findings ?? []), ...graphFindings(ctx.graph), ...cases, ...schemaDrift(ctx)];
}

// The editor's schemas are generated; a stale copy on disk validates against a
// vocabulary the engine no longer has. A table, so the next generated schema is
// a row -- `when` is what stops a project that keeps no plans from being told
// about a schema it has never needed, and one whose test data nobody has written
// yet (1.8.9: a checkout whose store holds no seat) from being told about any.
const GENERATED = [
  { name: CASE_SCHEMA, of: caseSchema, from: "the DSL", when: (ctx) => existsSync(ctx.project.dataRoot ?? ctx.project.uiTests) },
  { name: PLAN_SCHEMA, of: planSchema, from: "the plan vocabulary", when: (ctx) => planFiles(ctx.project.screensDir).length > 0 },
];

const schemaDrift = (ctx) => GENERATED.filter((g) => g.when(ctx)).flatMap((g) => oneSchema(ctx, g));

function oneSchema(ctx, g) {
  const file = join(ctx.project.schemaDir, g.name);
  if (!existsSync(file)) return [`${SCHEMA_DIR}/${g.name} is missing — write it: node cli/schema.mjs --write`];
  const same = sameJson(readFileSync(file, "utf8"), JSON.stringify(g.of(), null, 2));
  return same ? [] : [`${SCHEMA_DIR}/${g.name} is out of date with ${g.from} — refresh it: node cli/schema.mjs --write`];
}

// Returns what it FOUND, so the command wrapping it can fail. Advisories are
// never counted: a heuristic must not be able to break somebody's build.
// The file on disk is a generated artefact, and git hands it back with the
// CHECKOUT's line endings -- CRLF on Windows, where a byte comparison against a
// freshly generated string always differed and every clone reported drift that
// was not there. It is the content that has to match.
const sameJson = (disk, want) => disk.replace(/\r\n/g, "\n").trim() === want.trim();

export function check(ctx) {
  const found = checkFindings(ctx);
  for (const f of found) out(f);
  out(`\n${ctx.graph.screens.size} screens, ${ctx.graph.edges.length} controls, ${ctx.graph.effects.length} traced effects, ${ctx.cases.length} cases${counted(found)}`);
  advisories(ctx);
  return { findings: found.length };
}

const counted = (found) => (found.length ? `, ${found.length} hard finding(s)` : "");

// A LIST rather than a call sequence, so the next advisory is an entry and not
// another line in a function that was already at the ceiling. Built at call
// time, which is also what lets it name arrows declared further down.
const ADVISORIES = () => [driftAdvisory, reportsAdvisory, identityAdvisory, partialAdvisory, coverage];

const advisories = (ctx) => ADVISORIES().forEach((a) => a(ctx));

// A report is written to the store unless `reports` says otherwise, and it is
// SELF-CONTAINED: every screenshot it shows is embedded in it as base64. That
// makes it the thing to send -- and it makes one inside a working tree worse
// than the loose PNGs it replaced, because a single `git add -A` publishes the
// pictures of a real tenant as text, in a history the team pushes. A .gitignore
// line does not fix that, it only makes the file invisible.
//
// Advice rather than a finding, on purpose: where a project writes the artefact
// meant for a person is the project's call, and a preference must not be able to
// break its build.
function reportsAdvisory(ctx) {
  if (!inside(ctx.project.root, ctx.config.reports)) return;
  out(`\nreports are written to ${ctx.config.reports}, inside the repository`);
  out("  each one embeds the screenshots of whatever tenant the run drove");
  out('  set "reports" in project.json to a path outside the checkout — ~ and ${VAR} both expand');
}

// Asked of a declared path, so "nothing declared" is answered here rather than
// by relative(), which resolves "" against the CWD and would make the answer
// depend on where the command was run from.
export function inside(root, dir) {
  if (!dir) return false;
  const rel = relative(root, String(dir));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

// The map is memory, and memory that never says how old it is gets trusted for
// longer than it has earned. `verify` has known how to date it all along, but
// nothing ran `verify`; `check` is the command every playbook already runs, so
// this is the one line that says the map may have expired and where to look.
// Silent when there is no frontend checkout to compare against -- an undated
// map is a different problem, and `verify` is the one that says so.
function driftAdvisory(ctx) {
  const head = ctx.frontend?.commit();
  if (!drifted(ctx.graph.meta?.fe_commit, head)) return;
  out(`\nthe map was captured at frontend ${ctx.graph.meta.fe_commit}, the working copy is at ${head}`);
  out("  run `query verify` — it names the records citing a file that has changed since");
}

// An UNDATED map does not drift: with no fe_commit, or no readable checkout to
// compare against, there is nothing to say here and `verify` is the command
// that explains why. Silence beats a warning nobody can act on.
export const drifted = (captured, head) => Boolean(captured && head && captured !== head);

// A case with no identity runs as whoever happens to be signed in -- fine for a
// smoke test, fatal for anything whose verdict depends on permissions.
function identityAdvisory(ctx) {
  const none = ctx.cases.filter((c) => !c.identity && !c.identities);
  if (!none.length) return;
  out(`\n${none.length} case(s) declare no identity — they run as whoever is signed in:`);
  for (const c of none) out(`  ${c.id}`);
  out('  harmless for a smoke case; for anything about permissions add {"as":"…","roles":[…]}');
}

function partialAdvisory(ctx) {
  const partial = ctx.graph.effects.filter((f) => f.partial).length;
  if (partial) out(`${partial} effect(s) marked partial — their gaps belong in the sheet's Open questions`);
}

// Effect coverage on the controls whose LABEL reads like a mutation. A guess
// from a label, so it prints as advice: a control that writes to SQL with no
// effect record produces a run that can only say "the toast appeared".
const MUTATES = /\b(save|create|add|new|delete|remove|update|edit|submit|apply|finish|confirm|provision|archive|restore|assign|invite|import|export|sync|enable|disable|activate)\b/i;

function coverage(ctx) {
  const mutating = ctx.graph.edges.filter((e) => MUTATES.test(e.via));
  const gaps = mutating.map((e) => gapOf(ctx, e)).filter(Boolean);
  out(`\neffect coverage on the ${mutating.length} control(s) whose label reads like a mutation:`);
  out(`  ${mutating.length - gaps.length} fully traced, ${gaps.length} not`);
  listGaps(gaps);
}

function listGaps(gaps) {
  for (const [e, why] of gaps) out(`  ? ${edgeKey(e)}  —  ${why}`);
  if (gaps.length) out(`  a run touching these can report the UI only. Trace one while you are on its screen:\n  query effect <screen>  shows what is already known.`);
}

function gapOf(ctx, e) {
  const f = ctx.graph.effectOn.get(edgeKey(e));
  if (!f) return [e, "no effect record"];
  if (!Object.keys(f.layers ?? {}).length && f.backend !== "none") return [e, "effect has no layers traced"];
  return f.seen === "src" ? [e, "effect read from source, never observed live"] : null;
}
