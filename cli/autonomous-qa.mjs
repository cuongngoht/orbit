#!/usr/bin/env node
// AUTONOMOUS QA: an investigation over a live application -- planned from what
// is known, executed inside approved gates, witnessed on every layer it can
// see, and reported with what it could not.
//
//   node autonomous-qa.mjs plan --objective="…" [--scope="…"] [--screen=<id,…>] [--plan=<plan-id>] [--snapshot=<rs-id,…>] [--input=<file,…> [--ref=<id>] [--revision=<r>] [--authority=accepted --human]] [--env=<id> | --sandbox=<env-id>] [--mode=observe] [--identity=<as>] [--dry] [--json]
//   node autonomous-qa.mjs draft-plan --investigation=<id> [--file=<plan.json>]     (the plan on stdin without --file)
//   node autonomous-qa.mjs derive --investigation=<id>                         the test obligations its accepted plans imply, read against the system graph frozen into it (JSON)
//   node autonomous-qa.mjs context --investigation=<id>                        where it stands: position, frontier, budget, stop (JSON; writes nothing)
//   node autonomous-qa.mjs step --investigation=<id> [--decision=<file>]       one decision, as JSON on stdin (the protocol: `protocol`)
//   node autonomous-qa.mjs checkpoint --investigation=<id>                     keep what each settled obligation came to (receipts) and project results into knowledge
//   node autonomous-qa.mjs finish --investigation=<id> [--why="…"]             checkpoint, stop for the reason the engine can justify, and write the report
//   node autonomous-qa.mjs resume --investigation=<id> [--why="…"]             go on with a paused investigation
//   node autonomous-qa.mjs answer --investigation=<id> --question=<qst-n> --says="…" --human
//   node autonomous-qa.mjs release --investigation=<id> --decision=<id> --why="…" --human   settle a step that never did, once a person looked at what it did
//   node autonomous-qa.mjs protocol                                           the decision protocol, printed from its tables (JSON)
//   node autonomous-qa.mjs explore [--investigation=<id> | --objective="…" --scope="…"] [--env=<id> | --sandbox=<env-id>] [--mode=…] [--json]
//   node autonomous-qa.mjs act --investigation=<id> (--goto=<path> | --click=<screen/via> | --fill=<screen/via> --value=TC-…) [--identity=<as>] [--json]
//   node autonomous-qa.mjs check-data --investigation=<id> --action=<act-n> (--query="SELECT …" | --via=<capability> --input='{…}') [--expect-rows=N] [--within=<s>] [--json]
//   node autonomous-qa.mjs security --investigation=<id> [--rows=1,2] [--json]
//   node autonomous-qa.mjs investigate --investigation=<id> [--json]
//   node autonomous-qa.mjs reproduce --investigation=<id> --finding=<fnd-n> [--json]
//   node autonomous-qa.mjs draft --investigation=<id> --finding=<fnd-n> [--json]
//   node autonomous-qa.mjs link-run --investigation=<id> --evidence=<run dir> [--draft] [--json]
//   node autonomous-qa.mjs report --investigation=<id> [--out=FILE] [--json] [--internal]
//   node autonomous-qa.mjs list [--json]
//   node autonomous-qa.mjs show --investigation=<id> [--json]
//   node autonomous-qa.mjs cancel --investigation=<id> [--why="…"] --human
//   node autonomous-qa.mjs settings [--json]
//   node autonomous-qa.mjs settings set <path>=<json value> [--revision=<r>] --human
//
// The agent (skills/orbit-qa) decides what to look at; this does it,
// inside the gates of src/investigation/gates.mjs, and keeps what it saw in the
// project's machine store. Settings are a PERSON's approvals: `settings set`
// and `cancel` need --human, which a session passes only to relay what a
// person asked for, and Orbit Control writes the same document.
//
// --sandbox=<env-id> is the sandbox a TASK owns in this checkout (runtime sandboxes): its origin, its source
// tree and its approved modes come from the runtime and a person's sandbox policy, never from a flag, and the
// browser is its own, blank. Every later command of the investigation finds it again from the journal. An
// ISOLATED sandbox (sandbox.isolation.mode required) has no origin on this machine: it is verified only by the
// generated versions its own worker runs (a `generate` then a `run-version` step), whose test hooks are reached
// with the token a person set in ORBIT_TEST_HOOKS_TOKEN for the component and for this command alike.
// Exit 0 = done, whatever was found -- a finding is never an exit code, and
// no investigation outcome is PASS or FAIL · 2 = refused (usage, a gate, a
// missing approval) · 3 = blocked (the machine: browser, store, deadline).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrafts } from "../src/draft/index.mjs";
import { loadCases } from "../src/dsl/load.mjs";
import { Refused } from "../src/errors.mjs";
import { addInput, analyse, answer, begin, cancel, checkpoint, release, checkData, contextFor, draftFor, explore, act, finish, inputModeOf, linkRun, modelOf, pbiInput, planAsInput, planFor, snapshotAsInput, protocolOf, readSettings, reproduce, resume, runMatrix, screenInput, setPath, step, summaries, worldFor, writeSettings } from "../src/investigation/index.mjs";
import { caseDigest } from "../src/dsl/digest.mjs";
import { findCase } from "../src/dsl/load.mjs";
import { draftPaths } from "../src/draft/store.mjs";
import { hostname } from "node:os";
import { scanRoots } from "../src/architecture/context.mjs";
import { trackedSet } from "../src/engineering/record.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { knowledgeContext } from "../src/knowledge/context.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { show as showSnapshot } from "../src/requirements/views/show.mjs";
import { draftPlans } from "../src/draft/plans.mjs";
import { errors } from "../src/qa/finding.mjs";
import { planFor as qaPlan } from "../src/qa/load.mjs";
import { planFindings } from "../src/qa/validate.mjs";
import { planWorld } from "../src/qa/world.mjs";
import { command } from "../src/project/command.mjs";
import { componentOn } from "../src/project/components.mjs";
import { investigationHtml, investigationJson } from "../src/report/investigation.mjs";
import { createContext } from "../src/run/context.mjs";
import { sandboxEnvironment, sandboxRuntime } from "../src/investigation/sandbox.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { REPORT_ROOMS } from "../src/tests-tree.mjs";
import { machineContext } from "../src/store/context.mjs";
import { bindSandbox, originAnswer, sandboxAnswer } from "../skills/orbit-runtime/bind.mjs";
import { dispatchPort, generationPort, keptEvidence } from "../skills/orbit-qa/ports.mjs";
import { derivedInto } from "../src/investigation/derive.mjs";
import { architectureContext } from "../src/architecture/context.mjs";
import { graphOf } from "../src/architecture/graph-view.mjs";
import { loadVocabulary } from "../src/topology/vocabulary.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { realIo } from "../src/store/io.mjs";
import { dispatchDirs } from "../src/runtime/sandbox/dispatch.mjs";
import { effectivePolicy } from "../src/runtime/sandbox/policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name) => args.includes(`--${name}`);
const needed = (name) => flag(name) ?? stop(`--${name}=… is required for ${cmd}`);
const stop = (why) => { throw new Refused(`${why}\n  node cli/autonomous-qa.mjs --help for the usage`); };
const shown = (value, human) => (has("json") ? console.log(JSON.stringify(value, null, 2)) : console.log(human(value)));

// The context is bound ONCE, with the project's own extensions loaded -- the
// capabilities an investigation may ask are the ones the project registered,
// and a plan that listed none because nobody loaded them was a plan about a
// different project.
const BOUND = { ctx: null, runtime: null, sandbox: null, isolated: null, runtimeCommands: null };

function world(extra = {}) {
  const ctx = BOUND.ctx;
  const machine = machineContext(ctx);
  const on = componentOn({ kind: "skill", name: "orbit-qa-agent" }, process.env, "orbit");
  const w = worldFor({ ctx, machine, env: flag("env"), mode: flag("mode"), id: flag("investigation") ?? null, on, identity: flag("identity"), pace: 250, runtime: BOUND.runtime, environment: BOUND.sandbox?.environment, ...extra });
  return { ...w, machine, ...boundFor(ctx, machine), ...portsFor(ctx, machine, w) };
}

// The test hooks' token: the one variable a person sets for the component's hooks and for this command alike
// (orbit.scheduler/v1, orbit.clock/v1, orbit.workload/v1) -- read when a version is prepared, never kept.
const HOOKS_TOKEN_ENV = "ORBIT_TEST_HOOKS_TOKEN";

// The ports a generated test's lifecycle asks (skills/orbit-qa/ports.mjs), bound to this investigation, the system
// graph frozen into it, and -- when it was begun against one -- the task's isolated sandbox.
function portsFor(ctx, machine, w) {
  if (!w.id) return {};
  const b = { ctx, model: () => modelOf(w.store.read(w.id)), planOf: (id) => qaPlan(ctx, id), graph: () => frozenGraph(w), drafts: createDrafts(machine.store.root, machine.io), settings: w.settings, mode: w.mode, now: () => Date.now(), ...sandboxPorts(ctx, machine, w) };
  return { generation: generationPort(b), dispatch: dispatchPort(b) };
}

// The graph the obligations were derived against, as it was frozen; none is a graph that holds nothing.
const frozenGraph = (w) => ((bound) => (bound ? w.store.readArtifact(w.id, "graphs", bound.digest) : null) ?? { nodes: [], relations: [] })(modelOf(w.store.read(w.id)).bindings.findLast((x) => x.type === "graph"));

function sandboxPorts(ctx, machine, w) {
  const s = BOUND.isolated;
  if (!s) return { topology: () => ({ needs: "environment", say: "this investigation is bound to no ISOLATED sandbox — a generated version runs only in one (begin with --sandbox=<env-id> on a sandbox whose isolation is required)" }) };
  return { sandbox: s.sandbox, topology: () => BOUND.runtimeCommands["sandbox-topology"].run(s.ctx, []), services: Object.fromEntries(s.ctx.catalog.services.map((x) => [x.id, x])), policy: policyOf(s.ctx), place: { case: s.ctx.catalog.isolation.worker.case, out: s.ctx.catalog.isolation.worker.out }, hooksToken: () => process.env[HOOKS_TOKEN_ENV] ?? null, runtime: { dirs: (run) => dispatchDirs(s.ctx, run), dispatch: (request) => dispatchedBy(ctx, s, request) }, project: { name: ctx.config.name, packs: ctx.config.packs, sql: ctx.config.sql, graphDir: ctx.project.graphDir }, keep: (dir, run) => keptEvidence(dir, join(w.store.evidenceDir(w.id), run), machine.store.root) };
}

// A person's standing write policy for this sandbox, at the revision it was read.
const policyOf = (sctx) => ((read) => ({ revision: read.revision, writes: effectivePolicy(read.settings).policy.qa.writes }))(sctx.readSettings());

// ONE dispatch, through the runtime's own command: its request -- sealed bindings and secrets -- on stdin, never in
// an argument, a file or a log line; the deadline the request carries, and room for the worker to be made and removed.
function dispatchedBy(ctx, s, request) {
  const ms = Number(request.limits?.deadlineMs) || 120000;
  const r = ctx.process.run(process.execPath, [join(HERE, "runtime.mjs"), "sandbox-dispatch", `--task=${s.sandbox.task}`, `--run=${request.runId}`, `--deadline-ms=${ms}`, "--json"], { input: JSON.stringify(request), timeoutMs: ms + 180000, cwd: whereOf().cwd });
  return r.ok ? { ok: true, answer: lastJson(r.out) } : { ok: false, why: String(r.error ?? "the dispatch did not answer").slice(0, 400) };
}

// What the loop may ask of this machine, bound HERE because only a composition
// root reads files and spawns: a plan by id (the checkout, then the drafts), a
// case by id and its digest, and a case RUN -- run-case by path, argv only, and
// its result triaged the way link-run is.
function boundFor(ctx, machine) {
  const caseOf = (id, draft) => (draft ? null : findCase(ctx.project.screensDir, id)) ?? findCase(draftPaths(machine.store.root).cases, id);
  const source = memo(() => createSourceTree(scanRoots(ctx)));
  return { planOf: (id) => qaPlan(ctx, id), findCase: caseOf, digestOf: (id) => (caseOf(id, false) ? caseDigest(caseOf(id, false)) : null), runCase: (id, opts) => ranCase(ctx, machine, id, opts), receipting: receiptingFor(ctx, caseOf, source), memoryFor: () => memoryFor(ctx, source) };
}

const memo = (fn) => {
  const box = {};
  return () => ("value" in box ? box.value : (box.value = fn()));
};

// What a receipt rests on, as tracked paths: a scenario's plan and its cases,
// or the map's effects and the source files an effect cites. Fingerprinted by
// the same source tree knowledge watches, and stamped with the session.
function receiptingFor(ctx, caseOf, source) {
  return { scopeOf: (o) => scopeOf(ctx, caseOf, o), fingerprints: (paths) => (paths.length ? source().fingerprints(paths) : {}), seen: { host: hostname(), ...(process.env.ORBIT_SESSION ? { session: process.env.ORBIT_SESSION } : {}) } };
}

function scopeOf(ctx, caseOf, o) {
  const files = o.kind === "scenario-layer" ? [qaPlan(ctx, o.plan)?._file, ...(o.cases ?? []).map((id) => caseOf(id, false)?._file)] : [join(ctx.project.graphDir, "effects.json"), ...citedSources(ctx, o)];
  return [...new Set(files.filter(Boolean).map((f) => repoPath(ctx, f)).filter(Boolean))];
}

// "x.ts:1 → y.cs:2": the files a map effect says its code lives in.
const citedSources = (ctx, o) => String(ctx.graph.effectOn.get(o.oracle?.ref)?.src ?? "").split(/\s*→\s*/).map((s) => s.replace(/:\d+$/, "").trim()).filter(Boolean).map((p) => join(ctx.project.repoRoot ?? ctx.project.root, p));

function repoPath(ctx, file) {
  const rel = relative(ctx.project.repoRoot ?? ctx.project.root, file);
  return rel.startsWith("..") ? null : rel.split(sep).join("/");
}

// The project's knowledge room -- the recipe cli/knowledge.mjs binds -- asked
// only by the commands that write to it.
function memoryFor(ctx, source) {
  const knowledge = knowledgeContext(ctx, process.env, { source: source() });
  return { knowledge: { ...knowledge, now: () => new Date().toISOString() }, tracked: trackedSet(source().files() ?? []) };
}

function ranCase(ctx, machine, id, opts) {
  const argv = [join(HERE, "run-case.mjs"), id, ...(opts.draft ? ["--draft"] : []), "--report", "--json", ...Object.entries(opts.params ?? {}).map(([k, v]) => `${k}=${v}`)];
  const said = lastJson(ctx.process.run(process.execPath, argv, { timeoutMs: 30 * 60000 }).out);
  return said?.evidence ? triaged(ctx, machine, said.evidence) : { case: id, status: said?.status ?? "BLOCKED", proved: null, cause: null, confidence: null, evidence: null, case_digest: null };
}

// The run's cause, from the engine's own triage -- one reader of run-log.jsonl.
function triaged(ctx, machine, evidence) {
  const said = lastJson(ctx.process.run(process.execPath, [join(HERE, "query.mjs"), "triage", evidence, "--json"], { timeoutMs: 120000 }).out) ?? {};
  return { case: said.case, status: said.status, proved: said.proved, cause: said.type, confidence: said.confidence, evidence: relative(machine.store.root, said.evidence ?? evidence), case_digest: said.case_digest ?? null };
}

function lastJson(text) {
  try { return JSON.parse(String(text ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "null"); }
  catch { return null; }
}

// What was asked, as the engine will keep it: the objective, the screens and
// plans named (their screens join the scope), and requirement snapshots read now.
function question(w) {
  const inputs = inputsOf(w);
  const scope = [flag("scope") ?? "", ...inputs.map((i) => (i.type === "screen" ? i.ref : i.screen)).filter(Boolean)].join(" ").trim();
  return { objective: flag("objective") ?? flag("goal") ?? "", scope, cases: loadCases(w.ctx.project.screensDir), revision: headOf(w), inputs };
}

const listOf = (name) => (flag(name) ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const inputsOf = (w) => [...listOf("screen").map((id) => screenInput(w.ctx.graph, id)), ...(flag("plan") ? [planAsInput(qaPlan(w.ctx, flag("plan")), flag("plan"))] : []), ...listOf("snapshot").map((id) => snapshotInput(w, id)), ...listOf("input").map((file) => pbiInput({ file, ref: flag("ref"), revision: flag("revision"), accepted: accepted() }, readable(file), w.io.now()))];

// A frozen requirement snapshot, read from the requirements room -- never fetched, and checked
// against what was frozen. One that is not there, or does not hold, is an input that could not be
// read; the investigation carries on with what it has.
function snapshotInput(w, id) {
  const promoted = accepted();
  try { return snapshotAsInput(showSnapshot(requirementsContext(w.ctx, process.env), id).snapshot, w.io.now(), { ref: id, accepted: promoted }); }
  catch (e) { return snapshotAsInput(null, w.io.now(), { ref: id, why: e.message }); }
}

// A requirement is the team's ACCEPTED contract only on a person's word.
const accepted = () => flag("authority") === "accepted" && (has("human") || stop("--authority=accepted is a person's word about the requirement — relay it with --human"));

function readable(file) {
  try { return readFileSync(file, "utf8"); }
  catch { return null; }
}

function headOf(w) {
  try { return w.ctx.frontend.commit() ?? null; }
  catch { return null; }
}

// ---------------------------------------------------------------- commands
// A task's sandbox is verified in a browser of its own, which nothing opens by itself: this says how, once, with the directory
// that browser lives in and the address it opens -- printed, never kept in a journal. The directory is the one the bound
// browser itself answers (`browser.dir()`), never the project's run directory: a sandbox's browser lives under
// <runDir>/sandbox/<env>, and a browser opened anywhere else is one no investigation step will ever find.
const browserLine = () => (BOUND.sandbox?.environment.isolated ? `\nsandbox ${BOUND.sandbox.environment.id} is isolated: nothing on this machine reaches inside it -- generate a version, then run-version` : BOUND.sandbox ? `\nbrowser: blank, its own session -- open it once:\n  node ${join(dirname(HERE), "skills", "orbit-browser", "open.mjs")} --blank --url ${BOUND.sandbox.environment.origin} --run-dir ${BOUND.ctx.browser.dir()}` : "");

function planCmd() {
  const w = world();
  const q = question(w);
  if (has("dry")) return shown({ ...planFor(w, q), inputs: q.inputs, inputMode: inputModeOf(q.inputs) }, (p) => planText(p) + browserLine());
  const { id, plan } = begin(w, q);
  return shown({ id, plan: { ...plan, inputs: q.inputs, inputMode: inputModeOf(q.inputs) } }, (v) => `investigation ${v.id}\n${planText(v.plan)}${browserLine()}`);
}

// An agent's plan, written from a requirement it read: held to the plan rules,
// kept in the machine store's drafts room, recorded as an input of this
// investigation. Never written into the checkout -- promoting it is a person's
// request (cli/draft.mjs promote), and promoting is not accepting.
function draftPlanCmd() {
  const w = investigating();
  const plan = parsedJson(flag("file") ? readable(flag("file")) : readFileSync(0, "utf8"), "the draft plan");
  checkedDraft(w, plan);
  const file = draftPlans(w.machine.store.root, w.machine.io).save(plan);
  return shown(addInput(w, planAsInput({ ...plan, _draft: true }, plan.id)), (v) => `draft plan ${plan.id} kept at ${file} and recorded as ${v.id}`);
}

function checkedDraft(w, plan) {
  const wrong = errors(planFindings(plan, planWorld(w.ctx, { drafts: true })));
  if (wrong.length) stop(`the draft plan does not check — ${wrong.slice(0, 3).map((f) => f.say).join("; ")}`);
}

// The obligations an investigation's accepted plans imply, read against the system graph as it is NOW -- frozen into
// the investigation first, so what each rests on is kept as it was (src/investigation/derive.mjs).
function deriveCmd() {
  const w = investigating();
  return said(derivedInto(w, { planOf: (id) => qaPlan(w.ctx, id), graph: systemGraph(w.ctx) }));
}

// The system graph as `architecture graph` projects it: the recorded node and relation facts, read in the layered
// words of the plugin, the organisation and the project, joined to the UI map's screens.
function systemGraph(ctx) {
  const arch = architectureContext(ctx);
  const vocab = loadVocabulary({ pluginRoot: dirname(HERE), storeBase: storeBase(process.env), storeRoot: arch.store.root, io: realIo() });
  return graphOf(arch.arch.all(), vocab, [{ id: "ui-map", roles: ["interface"], ids: [...(ctx.graph?.screens?.keys?.() ?? [])] }]);
}

function exploreCmd() {
  const w0 = world();
  const id = w0.id ?? begin(w0, question(w0)).id;
  const w = { ...w0, id };
  const out = explore(w, modelOf(w.store.read(id)).plan);
  return shown({ id, ...out, ...analyse(w) }, (v) => `investigation ${v.id}: ${v.actions.length} action(s)${v.stopped ? `, stopped at ${v.stopped.at} — ${v.stopped.kind}: ${v.stopped.why}` : ""}\n${findingsText(v.findings)}`);
}

const ACT_KINDS = [["goto", "url"], ["click", "on"], ["fill", "on"]];

function actCmd() {
  const w = investigating();
  const [kind, key] = ACT_KINDS.find(([k]) => flag(k)) ?? stop("act needs --goto=<path>, --click=<screen/via> or --fill=<screen/via>");
  const done = act(w, { kind, [key]: flag(kind), value: flag("value"), identity: flag("identity") });
  return shown(done, (v) => `${v.action.id} ${v.action.do} ${v.action.on ?? v.action.target ?? ""}: ${v.action.state}${v.action.why ? ` — ${v.action.why}` : ""}\n${v.observations.map((o) => `  ${o.layer.padEnd(8)} ${o.state}${o.why ? ` — ${o.why}` : ""}`).join("\n")}`);
}

function investigating() {
  const w = world();
  if (!w.id) stop(`${cmd} needs --investigation=<id> (node cli/autonomous-qa.mjs list)`);
  return w;
}

function checkCmd() {
  const w = investigating();
  const within = flag("within") === undefined ? undefined : Number.parseInt(flag("within"), 10);
  const c = checkData(w, { action: needed("action"), ...readOf(), expect: flag("expect-rows") === undefined ? null : Number.parseInt(flag("expect-rows"), 10), within });
  return shown(c, (v) => `${v.id} on ${v.action}: ${v.state}${v.why ? ` — ${v.why}` : ""} · rows ${v.rows ?? "—"} after ${v.attempts} read(s) · ${v.via ? `via ${v.via}` : `tables ${v.tables.join(", ")}`} (${v.provenance})`);
}

// A SQL query, or a registered read-only capability and the input it is asked.
const readOf = () => (flag("via") ? { via: flag("via"), input: jsonFlag("input") } : { query: needed("query") });

function jsonFlag(name) {
  try { return JSON.parse(flag(name) ?? "{}"); }
  catch (e) { return stop(`--${name} is not valid JSON — ${e.message}`); }
}

function securityCmd() {
  const w = investigating();
  const rows = flag("rows") ? flag("rows").split(",").map((n) => Number.parseInt(n, 10)) : null;
  return shown(runMatrix({ ...w, mode: "security-test" }, rows), (v) => v.map((r) => `row ${r.row} ${r.identity ?? ""} ${r.operation} ${r.resource ?? ""} ${r.channel ?? ""}: ${r.state}${r.status ? ` ${r.status}` : ""}${r.why ? ` — ${r.why}` : ""}`).join("\n"));
}

function investigateCmd() {
  const w = investigating();
  return shown(analyse(w), (v) => `${v.added} new or changed finding(s)\n${findingsText(v.findings)}`);
}

function reproduceCmd() {
  const w = investigating();
  return shown(reproduce(w, needed("finding")), (v) => `${v.id}: ${v.finding} ${v.reproduced ? "REPRODUCED" : "did not reproduce"} on ${v.action} — ${v.why}`);
}

function draftCmd() {
  const w = investigating();
  const drafts = createDrafts(w.machine.store.root, w.machine.io);
  return shown(draftFor(w, needed("finding"), drafts), (v) => `${v.id}: ${v.case ? `draft case ${v.case}` : "no draft"} — ${v.why}`);
}

// The run's cause comes from the engine's own triage, asked as the CLI any
// person would ask it -- one reader of run-log.jsonl, never a second.
function linkCmd() {
  const w = investigating();
  const facts = triaged(w.ctx, w.machine, needed("evidence"));
  return shown(linkRun(w, { ...facts, authority: has("draft") ? "draft" : "accepted" }), (v) => `${v.id}: ${v.case} ${v.status} (${v.cause ?? "?"}, ${v.confidence ?? "?"}) recorded as execution`);
}

// ------------------------------------------------------------------ the loop
// JSON always: these speak to the host's model, which reads the fields.
const said = (value) => console.log(JSON.stringify(value, null, 2));

function contextCmd() {
  return said(contextFor(investigating()));
}

function stepCmd() {
  const w = investigating();
  return said(step(w, parsedJson(flag("decision") ? readable(flag("decision")) : readFileSync(0, "utf8"), "the decision")));
}

function checkpointCmd() {
  const w = remembering();
  return said(checkpoint(w));
}

// A finish is a checkpoint first: every stop leaves its receipts and its memory said.
function finishCmd() {
  const w = remembering();
  const kept = checkpoint(w);
  const done = finish(w, flag("why"));
  return said({ ...done, checkpoint: kept, report: relative(process.cwd(), published(w, investigationHtml(modelOf(w.store.read(w.id)), reportOpts(w)))) });
}

// The investigation world with its knowledge room bound -- only for the
// commands that project into it.
function remembering() {
  const w = investigating();
  return { ...w, memory: w.memoryFor() };
}

function resumeCmd() {
  const w = investigating();
  return said(resume(w, flag("why")));
}

function answerCmd() {
  if (!has("human")) stop("an answer is a person's word — relay it with --human");
  return said(answer(investigating(), needed("question"), needed("says")));
}

function releaseCmd() {
  if (!has("human")) stop("releasing a step that never settled is a person's word that they looked at what it did — relay it with --human");
  return said(release(investigating(), needed("decision"), flag("why")));
}

const protocolCmd = () => said(protocolOf());

function parsedJson(text, what) {
  try { return JSON.parse(text ?? ""); }
  catch (e) { return stop(`${what} is not valid JSON — ${e.message}`); }
}

function reportCmd() {
  const w = investigating();
  const model = modelOf(w.store.read(w.id));
  const opts = reportOpts(w);
  if (has("json")) return console.log(JSON.stringify(investigationJson(model, opts), null, 2));
  return console.log(`report: ${relative(process.cwd(), published(w, investigationHtml(model, opts)))}`);
}

function published(w, html) {
  const file = written(flag("out") ?? join(w.ctx.config.reports, REPORT_ROOMS.investigations, `investigation-${w.id}.html`), html);

  return file;
}

// Unredacted only where a person allowed it, and never by default.
function reportOpts(w) {
  const internal = has("internal") && (w.settings.reports.internal || stop("an unredacted report needs settings reports.internal, set by a person"));
  return { internal, project: w.ctx.config.name, generated: w.io.now(), evidenceDir: w.store.evidenceDir(w.id), bytes: (p) => w.io.bytes?.(p) ?? null };
}

function written(file, html) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  return file;
}

function listCmd() {
  const w = world();
  return shown(summaries(w.store), (v) => (v.length ? v.map((s) => `${s.id}  ${s.mode ?? "?"}  ${s.environment ?? "?"}  ${s.actions} action(s)  ${Object.entries(s.findings).map(([k, n]) => `${k} ${n}`).join(" · ") || "no findings"}${s.cancelled ? "  CANCELLED" : ""}  ${s.objective}`).join("\n") : "no investigations yet"));
}

function showCmd() {
  const w = investigating();
  return shown(investigationJson(modelOf(w.store.read(w.id)), { project: w.ctx.config.name }), (v) => `${v.overview.id} — ${v.overview.objective}\n${v.callout}\n${findingsText(v.findings)}`);
}

function cancelCmd() {
  if (!has("human")) stop("cancel is a person's act — relay it with --human");
  const w = investigating();
  cancel(w, flag("why"));
  return console.log(`${w.id} cancelled`);
}

function settingsCmd() {
  const w = world();
  const { settings, revision, exists } = readSettings(w.store.paths, w.io);
  if (args[0] !== "set") return shown({ settings, revision, exists, file: w.store.paths.settings }, (v) => `${v.file}${v.exists ? ` (revision ${v.revision})` : " (not written yet: defaults)"}\n${JSON.stringify(v.settings, null, 2)}`);
  return shown(settingsSet(w, settings, revision), (v) => `saved (revision ${v.revision})`);
}

function settingsSet(w, settings, revision) {
  if (!has("human")) stop("settings are a person's approval — relay them with --human, or change them in Orbit Control");
  const [path, ...value] = String(args[1] ?? "").split("=");
  return writeSettings(w.store.paths, w.io, { next: setPath(settings, path, value.join("=")), revision: flag("revision") ?? revision, by: "person", now: w.io.now() });
}

// ---------------------------------------------------------------- printing
function planText(p) {
  const lines = [`input: ${p.inputMode ?? "screen"}${(p.inputs ?? []).map((i) => `  ·  ${i.type} ${i.ref}${i.revision ? ` rev ${i.revision}` : ""}${i.authority ? ` (${i.authority})` : ""}${i.state === "unavailable" ? ` — UNAVAILABLE: ${i.why}` : ""}`).join("")}`, `goals: ${p.goals.join(", ")}`, `surfaces: ${p.surfaces.map((s) => `${s.id}${s.cases.length ? ` (${s.cases.length} case(s))` : ""}`).join(", ") || "none matched the scope"}`, `planned: ${p.actions.planned.map((a) => a.on).join(", ") || "nothing"}${p.actions.beyondBudget ? ` (+${p.actions.beyondBudget} beyond the budget)` : ""}`];
  return [...lines, ...p.actions.skipped.map((s) => `  skipped ${s.on}: ${s.why}`), `layers: ${Object.entries(p.layers).map(([k, v]) => `${k} ${v.state}`).join(" · ")}`, ...p.blockers.map((b) => `  BLOCKER ${b.id}: ${b.say}`), ...p.unknowns.map((u) => `  unknown: ${u}`)].join("\n");
}

const findingsText = (fs) => (fs.length ? fs.map((f) => `  ${f.id} ${f.outcome} (${f.confidence}) ${f.say}${f.reproduced && f.reproduced !== "not attempted" ? ` · reproduced ${f.reproduced}` : ""}`).join("\n") : "  no findings");

// The usage is this file's own leading comment, so it cannot drift from it.
function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exitCode = cmd && cmd !== "--help" ? 2 : 0;
}

const COMMANDS = { plan: planCmd, "draft-plan": draftPlanCmd, derive: deriveCmd, context: contextCmd, step: stepCmd, checkpoint: checkpointCmd, finish: finishCmd, resume: resumeCmd, answer: answerCmd, release: releaseCmd, protocol: protocolCmd, explore: exploreCmd, act: actCmd, "check-data": checkCmd, security: securityCmd, investigate: investigateCmd, reproduce: reproduceCmd, draft: draftCmd, "link-run": linkCmd, report: reportCmd, list: listCmd, show: showCmd, cancel: cancelCmd, settings: settingsCmd };

// The commands that stand in front of an approved environment -- a plan, an action, a check --
// are the ones that ask what this checkout's own runtime says about it. Silence is an answer:
// an origin that is not on this machine, or that no component declares, is nobody's news here.
const GATED = new Set(["plan", "explore", "act", "check-data", "security", "investigate", "reproduce", "step"]);

const whereOf = () => ({ pluginRoot: dirname(HERE), env: process.env, cwd: BOUND.ctx.project.repoRoot ?? process.cwd() });

// What this checkout's runtime says about the approved environment -- or, for a task's sandbox, what the
// sandbox says about itself, asked afresh on EVERY gated command so a change recorded between two steps
// blocks the next one (RUNTIME_STALE).
async function runtimeFor() {
  if (BOUND.sandbox) return BOUND.sandbox.runtime;
  const environment = world().environment;
  return environment ? originAnswer(whereOf(), environment.origin) : null;
}

// The sandbox the investigation was begun against, as its journal recorded it.
function recordedSandbox() {
  const w = flag("investigation") ? world() : null;
  return w?.id ? { id: w.id, environment: modelOf(w.store.read(w.id)).meta?.runtime?.environment ?? null } : null;
}

// The sandbox this command is about: the one named, or the one the investigation was begun against.
function sandboxId() {
  const named = flag("sandbox");
  const recorded = recordedSandbox();
  if (named && flag("env")) stop("--sandbox and --env name two different environments: use one");
  if (named && recorded?.environment && named !== recorded.environment) stop(`${recorded.id} was begun against sandbox ${recorded.environment}, not ${named}`);
  return named ?? recorded?.environment ?? null;
}

async function sandboxFor() {
  const id = sandboxId();
  const found = id ? await sandboxAnswer(whereOf(), id) : null;
  return found && { environment: sandboxEnvironment(found.view), runtime: sandboxRuntime(found.view, found.served) };
}

// A sandbox's browser is its own: a run directory of its own in the checkout's runtime room, so its own
// session by name, its own driving lock and no profile -- a blank browser that shares nothing with anybody's.
const sandboxContext = (ctx, id) => withExtensions(createContext({ project: ctx.project, runDir: join(ctx.config.runDir, "sandbox", id) }));

async function main() {
  BOUND.ctx = COMMANDS[cmd] ? await withExtensions(createContext()) : null;
  BOUND.sandbox = GATED.has(cmd) ? await sandboxFor() : null;
  if (BOUND.sandbox) await sandboxBound(BOUND.sandbox);
  BOUND.runtime = GATED.has(cmd) ? await runtimeFor() : null;
  return (COMMANDS[cmd] ?? help)();
}

async function sandboxBound(sb) {
  BOUND.ctx = await sandboxContext(BOUND.ctx, sb.environment.id);
  BOUND.isolated = sb.environment.isolated ? await isolatedBinding(sb) : null;
}

// An isolated sandbox, bound once for what a generated version needs of it: the task's own runtime context (its
// topology, its rooms, its policy) and the runtime's commands, read lazily so nothing else pays for them.
async function isolatedBinding(sb) {
  const ctx = bindSandbox({ pluginRoot: dirname(HERE), env: process.env, cwd: whereOf().cwd, task: sb.runtime.task });
  BOUND.runtimeCommands = (await import("../src/runtime/index.mjs")).COMMANDS;
  return { ctx, sandbox: { id: sb.environment.id, task: sb.runtime.task, tree: sb.runtime.sourceTree, currentTree: sb.runtime.taskTree, isolated: sb.runtime.isolated === true } };
}

command(main);
