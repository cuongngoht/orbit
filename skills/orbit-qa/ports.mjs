// The two ports a GENERATED test's lifecycle is handed by its composition root (cli/autonomous-qa.mjs;
// doc §4.1 steps 3-8, PBI 11-13). src/investigation/ asks them and imports none of what they bind:
//
//   generation  what a design is held to while it becomes a case -- the ACCEPTED expectations its
//               obligation may rule on, what each step's answer carries by meaning (the adapter the
//               step will be answered by, or the capability's own outputs), the semantics an adapter
//               declared, the real validator with the project's own extensions -- and where its draft
//               is saved (src/investigation/generate.mjs)
//   dispatch    a frozen version made runnable in the task's ISOLATED sandbox: every logical ref
//               sealed by the host (src/runtime/sandbox/bindings.mjs), a grant minted for every effect
//               it would have (src/runtime/sandbox/test-grants.mjs), the run's inputs laid where the
//               worker reads them, the dispatch asked of the runtime, and what the worker left read
//               back -- its envelope, its run log and the files the HOST listed -- for the host to judge
//               (src/investigation/run-version.mjs)
//
// What a ref IS is read the way the binder reads it -- the frozen system graph, the design's own
// observation plan, the sandbox's topology and the catalog's service rows -- so the outputs a design
// was compiled against and the binding a run gets cannot be two stories. Nothing a design proposes
// says an address, a credential, an output's meaning or an effect: those are declarations' and
// receipts'. What cannot be read is null, and the engine says what it then cannot do.
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { operationFor } from "../../src/adapters/families.mjs";
import { opKeyOf, selectAdapter } from "../../src/adapters/select.mjs";
import { inputFindings } from "../../src/capability/invoke.mjs";
import { validate } from "../../src/dsl/validate.mjs";
import { canonicalJson, sha, short, shaBytes } from "../../src/hash.mjs";
import { planDigestOf } from "../../src/investigation/input.mjs";
import { modeOf } from "../../src/investigation/vocab.mjs";
import { shapeOf } from "../../src/qa/obligations/shapes.mjs";
import { capabilityLookup } from "../../src/run/run-case.mjs";
import { HOOK_PROTOCOLS, sealedBindings } from "../../src/runtime/sandbox/bindings.mjs";
import { declarationsFrom } from "../../src/runtime/sandbox/declarations.mjs";
import { mintGrant } from "../../src/runtime/sandbox/test-grants.mjs";
import { mutatingEffect } from "../../src/topology/vocab.mjs";
import { engineVersion } from "../../src/version.mjs";

// ── what a ref is, read once for both ports ────────────────────────────────

// in: { ctx, graph, topology, services, design, tenancy }
const resolver = (b) => ({ ctx: b.ctx, declarationOf: declarationsFrom({ graph: b.graph, design: b.design, tenancy: b.tenancy }), topology: b.topology ?? null, services: b.services ?? {}, lookup: capabilityLookup(b.ctx) });

const nodeNamed = (r, name) => (r.topology?.nodes ?? []).find((n) => n.name === name || n.key === name || n.alias === name) ?? null;

// The transport a ref's value will carry: a hooked kind's protocol, its declaration's own, or the first
// one the service its node runs speaks. Unknown is null -- never a guess.
function transportOf(r, kind, alias) {
  if (HOOK_PROTOCOLS[kind]) return HOOK_PROTOCOLS[kind];
  const decl = r.declarationOf(kind, alias);
  if (kind === "observer") return decl?.channel ? transportOf(r, "channel", decl.channel) : null;
  return decl?.transport ?? r.services[nodeNamed(r, decl?.node)?.service]?.transports?.[0]?.id ?? null;
}

// The adapter that will answer a family step: the one selection picks for the transport its first ref carries.
function adapterOf(r, step) {
  const row = step?.do === "call" ? operationFor(step.capability) : null;
  const transport = row?.selects ? transportOf(r, row.refs[0], step.input?.[`${row.refs[0]}Ref`]) : null;
  return transport ? selectAdapter(r.ctx.adapters, { family: row.family, op: row.op, transport }).adapter ?? null : null;
}

const declaredOp = (adapter, step) => adapter.operations[opKeyOf(adapter, operationFor(step.capability))] ?? null;

// What a step's answer carries, by meaning: the adapter's declaration of that operation, or the capability's own.
function outputsOf(r, step) {
  const adapter = adapterOf(r, step);
  if (adapter) return declaredOp(adapter, step)?.outputs ?? null;
  return step?.do === "call" ? r.lookup(step.capability)?.outputs ?? null : null;
}

const semanticsOf = (r, step) => adapterOf(r, step)?.semantics ?? null;

// How an observer of the design's plan would watch: the semantics of the adapter that arms one on its channel.
const observerSemantics = (r, ref) => ((t) => (t ? selectAdapter(r.ctx.adapters, { family: "messaging", op: "observe", transport: t }).adapter?.semantics ?? null : null))(transportOf(r, "observer", ref));

// The effects a call would really have: what its answering adapter declares for that operation, or the capability's.
function effectsOf(r, step) {
  const adapter = adapterOf(r, step);
  return { adapter, effects: (adapter ? declaredOp(adapter, step)?.effects : null) ?? r.lookup(step.capability)?.effects ?? [] };
}

// ── generation ─────────────────────────────────────────────────────────────

// in: { ctx, model(), planOf(ref), graph(), topology()?, services, drafts }
export function generationPort(b) {
  return { contextFor: (obligation, a) => generationContext(b, obligation, a), saveDraft: (c) => b.drafts.save(c), versions: versionsOf(b.ctx) };
}

function generationContext(b, obligation, a) {
  const r = resolver({ ...b, graph: b.graph(), topology: quietly(() => b.topology?.()), design: a.design });
  const steps = a.design?.skeleton?.steps ?? [];
  return { expectations: expectationsOf(b, obligation), expected: obligation.expected ?? [], outputsOf: (i) => outputsOf(r, steps[i - 1]), semanticsOf: (i) => semanticsOf(r, steps[i - 1]), observerSemantics: (ref) => observerSemantics(r, ref), shape: shapeOf(obligation.shape), caseId: caseIdOf(obligation, a.design), title: titleOf(obligation), validate: (c) => validate(c, b.ctx.graph, b.ctx.dsl, b.ctx.validators, r.lookup), inputFindings: (s) => inputFindings(r.lookup(s.capability), s.input), dsl: b.ctx.dsl, pageOf: (id) => r.lookup(id)?.page };
}

// A topology that cannot be composed is no topology: what it would have said is then unknown.
const quietly = (fn) => ((t) => (t?.nodes ? t : null))(topologyNow(fn));

function topologyNow(fn) {
  try { return fn?.() ?? null; }
  catch (e) { return { needs: "environment", say: e.message }; }
}

// The expectations an obligation's design may rule on: what its ACCEPTED plan bindings state, read back now and held
// to the digest they were bound at -- a plan that moved since states nothing here, and a draft states nothing at all.
// Every accepted criterion of those plans may rule (a permission's positive control is another criterion's), and the
// generator holds the design to ruling on each slot of the obligation's OWN criterion (`expected`).
function expectationsOf(b, obligation) {
  const bound = b.model().bindings.filter((x) => x.type === "plan" && x.authority === "accepted" && (obligation.bindings ?? []).includes(x.binding));
  return new Map(bound.flatMap((x) => expectsOf(b.planOf(x.ref), x)));
}

const expectsOf = (plan, binding) => (plan && planDigestOf(plan) === binding.digest ? (plan.criteria ?? []).flatMap((c) => (c.expects ?? []).map((e) => [`${c.id}/${e.id}`, e])) : []);

const caseIdOf = (obligation, design) => `gen-${String(obligation.obligation).slice(4, 12)}-${short(canonicalJson(design ?? null), 8)}`;

const titleOf = (o) => `${o.shape}${o.target ? ` — ${o.target}` : ""}`.slice(0, 120);

// What a version was made with: the engine, the vocabulary in effect and the extensions loaded, by digest.
const versionsOf = (ctx) => ({ engineVersion: engineVersion() ?? "unknown", validatorVersion: (ctx.extensions?.loaded ?? []).length ? "core+extensions" : "core", dslDigest: sha(canonicalJson({ verbs: [...ctx.dsl.verbNames()].sort(), fields: [...ctx.dsl.fieldNames()].sort() })), extensionsDigest: sha(canonicalJson((ctx.extensions?.loaded ?? []).map((e) => ({ id: e.id, from: e.from, version: e.version, apiVersion: e.apiVersion })).sort((x, y) => (x.id < y.id ? -1 : 1)))) });

// ── dispatch ───────────────────────────────────────────────────────────────

// in: { ctx, model(), graph(), topology(), services, sandbox: {id, task, tree, currentTree, isolated}, mode, settings,
//       policy: {revision, writes}, place: {in, out}, hooksToken(), now(),
//       runtime: {dirs(run), dispatch(request), worker(run)}, project: {name, packs, sql, graphDir}, keep(dir, run) }
export function dispatchPort(b) {
  return { prepare: (x) => prepared(b, x), run: (x) => ran(b, x), readBack: (execution) => readBackOf(b, execution), keep: (r) => (r.evidence ? b.keep(r.evidence, r.envelope.runId) : null), provedBy: (s) => b.ctx.dsl.provedBy(s), canStop: (s) => typeof b.ctx.executors?.resolve?.(s.do)?.stops === "function" };
}

function prepared(b, x) {
  const topology = topologyNow(b.topology);
  if (!topology?.nodes) return { gaps: [{ kind: "sandbox", alias: b.sandbox?.id ?? "none", why: topology?.say ?? "no isolated sandbox is bound to this investigation" }] };
  const r = resolver({ ...b, graph: b.graph(), topology, design: x.design });
  const sealed = sealedBindings({ refs: refsOf(r, x.frozen.case), declarationOf: r.declarationOf, topology, services: b.services, namespace: namespaceOf(x.execution), adapterFor: (t) => observingAdapter(r, t), minted: { hooksToken: b.hooksToken() ?? null } });
  return withGrants(b, r, x, sealed);
}

// A run's NAMESPACE: what everything it owns is named inside, so two runs never share one.
const namespaceOf = (execution) => `o${short(execution, 10)}`;

// Every logical ref the frozen case names, by the kind its capability binds it as.
const refsOf = (r, c) => (c.steps ?? []).filter((s) => s.do === "call").flatMap((s) => Object.entries(r.lookup(s.capability)?.inputSchema ?? {}).filter(([k, row]) => row?.bind && s.input?.[k] !== undefined).map(([k, row]) => ({ kind: row.bind, alias: String(s.input[k]) })));

// The adapter that names an observer of its own on a transport: the first, by id, whose declaration says how.
const observingAdapter = (r, transport) => (r.ctx.adapters?.list?.() ?? []).filter((a) => a.transports.includes(transport) && a.bind?.observer).sort((x, y) => (x.id < y.id ? -1 : 1))[0] ?? null;

function withGrants(b, r, x, sealed) {
  const fixture = { namespace: namespaceOf(x.execution), resources: boundAliases(sealed) };
  const minted = mintedInOrder(b, r, x, fixture);
  return { ...sealed, gaps: [...sealed.gaps, ...unarmedGaps(x)], grants: minted.flatMap((m) => (m.grant ? [m.grant] : [])), refused: minted.flatMap((m) => m.refused), fixture, sandbox: b.sandbox.id, tree: b.sandbox.tree, place: placeOf(b, x.frozen.case), deadlineMs: deadlineOf(b) };
}

// Where the worker finds the frozen case -- beside its project in its inputs, named by its id, as a case file is -- and
// where it writes what it leaves.
function placeOf(b, frozenCase) {
  return { case: `${b.place.in}/${frozenCase.id}.json`, out: b.place.out };
}

// What this run's fixture holds: every resource the host bound for it inside the task's own sandbox. An identity and a
// schema are who it acts as and what it is held to, never something it changes.
const boundAliases = (sealed) => Object.entries(sealed.bindings).filter(([kind]) => !["identity", "schema"].includes(kind)).flatMap(([, byAlias]) => Object.keys(byAlias)).sort();

// An observer the design's plan names and no step of the test arms is armed by nothing in this release: said before
// anything runs, never discovered as an await on nothing.
const unarmedGaps = (x) => (x.design?.observationPlan ?? []).filter((o) => !armedByStep(x.frozen.case, o.observerRef)).map((o) => ({ kind: "observer", alias: o.observerRef, why: "the observation plan names it to be armed before the trigger, and in this release an observer is armed only by a step of the test (orbit.messaging.observe) — none arms it" }));

const armedByStep = (c, ref) => (c.steps ?? []).some((s) => s.capability === "orbit.messaging.observe" && s.input?.observerRef === ref);

// A call that repeats an earlier one exactly -- the same capability, effect and input -- is a DUPLICATE. It is minted a
// grant of its own, naming the grant of the call it duplicates (test-grants.mjs `duplicateOf`), and only when the
// design says it sends one on purpose; one it does not declare is refused, never quietly covered by the first's grant.
function mintedInOrder(b, r, x, fixture) {
  const first = new Map();
  return mutatingCalls(r, x.frozen.case).map((m) => mintedOne(b, r, x, fixture, first, m));
}

function mintedOne(b, r, x, fixture, first, m) {
  const key = `${m.cap.id}|${m.cls}|${canonicalJson(m.step.input ?? {})}`;
  if (first.has(key) && !hasDuplicateControl(x.design)) return unintended(m);
  const out = mintGrant(grantWorld(b, r, x, { ...m, duplicateOf: first.get(key) ?? null }, fixture));
  if (!first.has(key) && out.grant) first.set(key, out.grant.id);
  return out;
}

const hasDuplicateControl = (design) => (design?.controls ?? []).some((c) => c.role === "duplicate");

const unintended = (m) => ({ grant: null, refused: [{ id: "DUPLICATE", say: `${m.cap.id} is asked again with exactly the same input, and the design declares no duplicate control — a second effect is minted only on purpose` }] });

// One grant per mutating effect a call would have: a call is covered only when EVERY effect it may have is.
const mutatingCalls = (r, c) => (c.steps ?? []).filter((s) => s.do === "call").flatMap((step) => ((e) => e.effects.filter(mutatingEffect).map((cls, _, classes) => ({ step, cls, classes, adapter: e.adapter, cap: r.lookup(step.capability) ?? { id: step.capability } })))(effectsOf(r, step)));

// The world a grant is minted from: owners' records only -- the sandbox's view, a person's policy and settings, the
// design the version was frozen from, the input it will send -- never a field a proposal carried.
const grantWorld = (b, r, x, m, fixture) => ({ task: b.sandbox.task, run: x.execution, attempt: x.attempt, sandbox: { owner: { kind: "task", id: b.sandbox.task }, tree: b.sandbox.tree, currentTree: b.sandbox.currentTree, isolated: b.sandbox.isolated === true }, mode: { id: b.mode, mutates: modeOf(b.mode)?.mutates === true }, capability: { id: m.cap.id, version: m.adapter?.version ?? m.cap.version ?? null, from: m.cap.from ?? null, mutatingEffects: m.classes }, operation: { class: m.cls, selectors: selectorsOf(m.cap, m.step) }, fixture, requested: { resources: resourcesOf(m.cap, m.step), indirect: [], inputDigest: sha(canonicalJson(m.step.input ?? {})) }, sinks: [], design: { oracleRef: x.obligation?.bindings?.[0] ?? null, designRef: x.design?.id ?? null, operations: designedOperations(r, x.design) }, budget: { uses: b.settings?.limits?.writes ?? 0 }, policy: { revision: b.policy.revision, allows: b.policy.writes }, principal: principalOf(m.cap, m.step), nowMs: b.now(), ttlMs: deadlineOf(b) + 60000, ...(m.duplicateOf ? { bounds: { duplicateOf: m.duplicateOf } } : {}) });

// A call's own scalar parameters -- a method, a path -- are what its grant is minted for, beside its refs and its input.
const selectorsOf = (cap, step) => Object.fromEntries(Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => !row?.bind && (row?.enum || row?.pattern) && typeof step.input?.[k] === "string").map(([k]) => [k, step.input[k]]));

const resourcesOf = (cap, step) => Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => row?.bind && !["identity", "schema"].includes(row.bind) && step.input?.[k] !== undefined).map(([k]) => String(step.input[k]));

const principalOf = (cap, step) => Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => row?.bind === "identity" && step.input?.[k] !== undefined).map(([k]) => String(step.input[k]))[0] ?? null;

// The operations the DESIGN declared, by proposing the steps that have them -- what a frozen case may not exceed.
const designedOperations = (r, design) => [...new Set((design?.skeleton?.steps ?? []).filter((s) => s.do === "call").flatMap((s) => effectsOf(r, s).effects.filter(mutatingEffect)))];

const deadlineOf = (b) => (b.settings?.limits?.caseSeconds ?? 120) * 1000;

// ── running it, and reading back what it left ──────────────────────────────

function ran(b, x) {
  const dirs = b.runtime.dirs(x.request.runId);
  laidIn(b, dirs.in, x.frozen.case);
  const answer = b.runtime.dispatch(x.request);
  const back = readBack(dirs.out);
  return back.envelope ? back : { why: answer.why ?? back.why };
}

// The run's inputs: the frozen case where the request says it is, and the project it runs as -- its name, the packs
// it opted into, how it reads its data, and its UI map -- never a secret, a store or anything of this machine's.
function laidIn(b, dir, frozenCase) {
  mkdirSync(join(dir, "ui-tests", "graph"), { recursive: true });
  writeFileSync(join(dir, `${frozenCase.id}.json`), `${JSON.stringify(frozenCase, null, 2)}\n`);
  writeFileSync(join(dir, "ui-tests", "project.json"), `${JSON.stringify(projectOf(b.project), null, 2)}\n`);
  for (const name of jsonFilesIn(b.project.graphDir)) copyFileSync(join(b.project.graphDir, name), join(dir, "ui-tests", "graph", name));
}

const projectOf = (p) => Object.fromEntries(Object.entries({ name: p.name, packs: p.packs, sql: p.sql }).filter(([, v]) => v !== undefined && v !== null));

function jsonFilesIn(dir) {
  try { return dir ? readdirSync(dir).filter((n) => n.endsWith(".json") && lstatSync(join(dir, n)).isFile()) : []; }
  catch { return []; }
}

// What a dispatch whose end nobody recorded left (src/investigation/reconcile-runs.mjs): its room, read exactly as a
// live run's is, and what the runtime says became of its worker -- read, never sent again.
const readBackOf = (b, execution) => ({ ...readBack(b.runtime.dirs(execution).out), worker: b.runtime.worker?.(execution) ?? null });

// What the worker left, as the HOST finds it: its envelope, and -- only inside its own output -- the run log and the
// files under the evidence it names, each listed by the host and digested, a link or a directory never followed. The
// evidence is kept in the investigation's own room only once the host believed the envelope (`keep`).
function readBack(out) {
  const envelope = jsonOf(readable(join(out, "envelope.json")));
  if (!envelope) return { why: "the worker left no envelope" };
  const evidence = typeof envelope.evidence === "string" ? inside(out, envelope.evidence) : null;
  return { envelope, records: evidence ? recordsIn(evidence) : [], listed: evidence ? listedIn(out, evidence) : new Map(), evidence };
}

const inside = (root, rel) => ((full) => (full.startsWith(`${resolve(root)}${sep}`) ? full : null))(resolve(root, rel));

const recordsIn = (dir) => String(readable(join(dir, "run-log.jsonl")) ?? "").split("\n").filter(Boolean).map(jsonOf).filter(Boolean);

function listedIn(out, dir) {
  const files = regularFilesIn(dir);
  return new Map(files.map((p) => [relative(out, p).split(sep).join("/"), { sha256: shaBytes(readFileSync(p)), bytes: lstatSync(p).size }]));
}

export function regularFilesIn(dir) {
  try { return readdirSync(dir, { recursive: true }).map((n) => join(dir, String(n))).filter((p) => lstatSync(p).isFile()); }
  catch { return []; }
}

// Copies the evidence a worker left into the investigation's own evidence room, and says where -- relative to the
// machine store, as a run's evidence always is.
export function keptEvidence(from, to, storeRoot) {
  for (const file of regularFilesIn(from)) copied(file, join(to, relative(from, file)));
  return relative(storeRoot, to).split(sep).join("/");
}

function copied(file, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(file, dest);
}

function readable(file) {
  try { return readFileSync(file, "utf8"); }
  catch { return null; }
}

function jsonOf(text) {
  try { return JSON.parse(String(text ?? "")); }
  catch { return null; }
}
