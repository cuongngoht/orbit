// What the pack adds to the ONE extension lifecycle (cli/qc-tool.mjs) for a
// project's report parts: the scaffold a part starts from, and the checks a
// part must pass on top of the loader's before it is registered -- both handed
// to the lifecycle by its composition root, so src/extensions/ never learns
// what a report is.
//
//   scaffoldReport   a DRAFT extension of one part of the asked kind: manifest,
//                    reporting.json, the part from templates/ -- made for the
//                    need it was asked for, which it carries as provenance
//   checkReport      the autonomy boundary, a static look at each script, then
//                    the part RUN for real -- through the same runner a report
//                    uses -- on its own fixture, else on the project's latest
//                    snapshot, else on the pack's synthetic sample. A part that
//                    crashes, writes what it did not declare or answers nothing
//                    usable is refused, with what it said
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSION_API } from "../../src/extensions/contract.mjs";
import { kindOf } from "../../src/extensions/reporting-v1.mjs";
import { envelopeFor } from "../../src/project-report/envelope.mjs";
import { runPart } from "../../src/project-report/execute.mjs";
import { KIT_DIR, SHIM, standardParts } from "./pack.mjs";
import { githubSnapshot } from "./samples.mjs";

const TEMPLATES = join(KIT_DIR, "..", "templates");
export const REPORT_KINDS = ["metric", "section", "transform", "exporter", "collector", "workflow"];

// ---- scaffold --------------------------------------------------------------------

// Everything a kind's part row needs besides what every part has.
const SHAPES = {
  metric: (id) => ({ provides: [`report.metric.${id}.value`], needs: ["report.collection.pullRequests"], metrics: [{ id: `${id}.value`, version: "1", label: "WHAT this number is, in a product owner's words", unit: "count", definition: "HOW it is computed, from which collection, as of the cut-off" }], section: { id: `${id}.section`, title: "WHAT the section is called" } }),
  section: (id) => ({ provides: [`report.section.${id}.section`], needs: ["report.collection.pullRequests"], section: { id: `${id}.section`, title: "WHAT the section is called" } }),
  transform: (id) => ({ provides: [`report.derived.${id}.derived`], needs: ["report.collection.pullRequests"] }),
  exporter: () => ({ provides: [], needs: ["report.model"], formats: ["csv"] }),
  collector: (id) => ({ provides: [`report.collection.${id}.items`], needs: ["report.docs"] }),
  workflow: () => ({ provides: [], needs: [] }),
};

// The template each kind starts from, and the file it becomes: named after the
// extension, so the file a session then writes is the one the part names.
const TEMPLATE = { metric: "metric.py", section: "section.py", transform: "transform.py", exporter: "exporter.py", collector: "collector.py", workflow: "workflow.md" };
const fileOf = (id, kind) => (kind === "workflow" ? `${id}.md` : `${id.replace(/-/g, "_")}.py`);

export function scaffoldReport(dir, id, kind, need, io) {
  if (!SHAPES[kind]) throw new Error(`a report part is one of ${REPORT_KINDS.join(", ")}`);
  const files = { "extension.json": manifestOf(id, need), "reporting.json": `${JSON.stringify({ parts: [partOf(id, kind, need)] }, null, 2)}\n`, [fileOf(id, kind)]: templateOf(kind, id, need, io) };
  io.ensureDir(dir);
  for (const [name, text] of Object.entries(files)) io.write(join(dir, name), text);
  return { dir, id, files: Object.keys(files) };
}

const manifestOf = (id, need) => `${JSON.stringify({ id, version: "0.1.0", apiVersion: EXTENSION_API, engine: ">=0.0.1 <1", status: "draft", createdFor: need, note: `Made for: ${need}. What was tried first: the standard parts, the report settings' mapping, and the extensions already registered.`, reporting: "./reporting.json" }, null, 2)}\n`;

function partOf(id, kind, need) {
  const script = kind !== "workflow";
  return { id: `${id}.${kind}`, version: "0.1.0", kind, contract: "orbit.report.part/v1", ...(script ? { runtime: "python", requires: ">=3.11" } : {}), entry: `./${fileOf(id, kind)}`, doc: need, ...SHAPES[kind](id), timeoutSec: 60, basedOn: [need] };
}

function templateOf(kind, id, need, io) {
  const text = io.read(join(TEMPLATES, TEMPLATE[kind])) ?? "";
  return text.replaceAll("{{DOC}}", need).replaceAll("{{NEED}}", need).replaceAll("{{METRIC}}", `${id}.value`).replaceAll("{{NAME}}", `${id}.derived`).replaceAll("{{COLLECTION}}", `${id}.items`);
}

// ---- check ------------------------------------------------------------------------

// deps: { python (file), process, env, io, human, latest (a snapshot path or null) }
// -> findings: [] when it may be registered
export async function checkReport(dir, manifest, deps) {
  const rows = reportingRows(dir, manifest, deps.io);
  const bounded = rows.flatMap((p) => boundary(p, deps));
  return bounded.length ? bounded : scriptsChecked(rows.filter((p) => kindOf(p.kind)?.runs), dir, deps);
}

async function scriptsChecked(scripts, dir, deps) {
  if (scripts.length && !deps.python) return ["no Python 3.11 or newer is available to verify this part on; install it in Orbit Control → Tools → Python"];
  const statics = await staticFindings(scripts, dir, deps);
  return statics.length ? statics : behaviour(scripts, dir, deps);
}

function reportingRows(dir, manifest, io) {
  if (!manifest.reporting) return [];
  try { return JSON.parse(io.read(join(dir, manifest.reporting.replace(/^\.\//, ""))) ?? "{}").parts ?? []; }
  catch { return []; }
}

// What Orbit may register on its own: never a replacement of a standard part --
// that is a person's call, relayed with --human. (The part contract already
// refuses packages, a collector that would need the source's credential, and a
// part outside its extension's namespace.)
function boundary(part, deps) {
  if (part.replaces && !deps.human) return [`${part.id} replaces ${part.replaces}; a replacement is registered by a person (--human), never by Orbit on its own`];
  return [];
}

async function staticFindings(scripts, dir, deps) {
  const read = await Promise.all(scripts.map((p) => deps.process.runAsync(deps.python, ["-I", "-S", "-B", "-X", "utf8", join(KIT_DIR, "check_part.py"), join(dir, p.entry.replace(/^\.\//, ""))], { timeoutMs: 30000, env: minimal(deps.env) })));
  return read.flatMap((r, i) => problemsOf(r, scripts[i]));
}

function problemsOf(answer, part) {
  try { return JSON.parse(String(answer.out)).problems.map((p) => `${part.id}: ${p}`); }
  catch { return [`${part.id}: its script could not be checked (${answer.error ?? `exit ${answer.status}`})`]; }
}

const minimal = (env) => Object.fromEntries(["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG"].filter((k) => env?.[k]).map((k) => [k, env[k]]));

// The part RUN, the way a report runs it. A metric that needs the standard
// model gets it, computed on the same snapshot first.
async function behaviour(scripts, dir, deps) {
  const work = mkdtempSync(join(tmpdir(), "orbit-verify-part-"));
  try { return (await Promise.all(scripts.map((p) => tried(p, dir, work, deps)))).flat(); }
  finally { rmSync(work, { recursive: true, force: true }); }
}

// The part's own fixture first; else the project's latest snapshot; else the
// synthetic sample. The first snapshot it computes something on proves it.
async function tried(part, dir, work, deps) {
  const outcomes = [];
  for (const snapshot of snapshotsFor(part, dir, work, deps)) outcomes.push(await onSnapshot(part, dir, snapshot, work, deps));
  const good = outcomes.find((o) => o.ok);
  return good ? [] : [`${part.id}: ${outcomes.find((o) => o.kind === "extension")?.error ?? `it had nothing to compute on (${outcomes.map((o) => (o.missing ?? []).join(", ") || o.status).join("; ")}) — give it a fixture snapshot that holds what it needs`}`];
}

function snapshotsFor(part, dir, work, deps) {
  const own = part.fixture ? [join(dir, part.fixture.replace(/^\.\//, ""))] : [];
  const sample = join(work, "sample-snapshot.json");
  writeFileSync(sample, JSON.stringify(githubSnapshot()));
  return [...own, ...(deps.latest ? [deps.latest] : []), sample];
}

async function onSnapshot(part, dir, snapshotFile, work, deps) {
  const snapshot = JSON.parse(deps.io.read(snapshotFile) ?? "null");
  if (!snapshot?.window) return { ok: false, kind: "data", status: "unreadable", missing: [snapshotFile] };
  const model = (part.needs ?? []).includes("report.model") ? await standardModel(snapshot, snapshotFile, work, deps) : null;
  const out = join(work, `${part.id}-${Math.random().toString(36).slice(2, 8)}`);
  return runPart({ part, envelope: envelopeFor({ part, entry: join(dir, part.entry.replace(/^\.\//, "")), runId: snapshot.run.id, window: snapshot.window, calendar: snapshot.calendar, seed: 1, inputs: { snapshot: snapshotFile, ...(model ? { model } : {}), metrics: [], derived: [], roots: [dir] }, outputDir: out, settings: {} }), dir: out }, partDeps(deps));
}

async function standardModel(snapshot, snapshotFile, work, deps) {
  const metrics = standardParts().find((p) => p.id === "orbit.report.metrics");
  const out = join(work, `standard-${Math.random().toString(36).slice(2, 8)}`);
  const done = await runPart({ part: metrics, envelope: envelopeFor({ part: metrics, entry: metrics.file, runId: snapshot.run.id, window: snapshot.window, calendar: snapshot.calendar, seed: 1, inputs: { snapshot: snapshotFile }, outputDir: out, settings: {} }), dir: out }, partDeps(deps));
  return done.ok ? join(out, done.files.model) : null;
}

const partDeps = (deps) => ({ process: deps.process, python: deps.python, shim: SHIM, env: deps.env ?? {}, io: deps.io, secrets: [], nowMs: Date.now });
