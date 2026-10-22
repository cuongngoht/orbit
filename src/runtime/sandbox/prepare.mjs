// PREPARING a sandbox: the ordered steps that turn a task's workspace into somewhere its application can run.
//
// Each step is a row, and the first one that cannot go on says WHO has to act (a person, the environment, or
// something nobody has yet provided) -- never "failed": a sandbox that waits on a person's trust is not broken,
// it is waiting, and the orchestrator reads exactly that word (`needs`) to decide what to say next. Nothing here
// decides a verdict about the change; it makes a place, and says whether the place is there.
//
//   OWNERSHIP      the workspace is the task's, and there
//   TREE           git can name the source the sandbox would be built from
//   UNDERSTANDING  what the workspace needs to run, read from the workspace (memory first), and how each
//                  component would run: the ordinary resolver, over a sandbox's own world
//   PLACEMENTS     which components can start here, and on which provider each runs
//   FINGERPRINT    everything this sandbox would be built from, as one print: if it is READY at that print
//                  there is nothing to do and nothing runs again. Otherwise it is PREPARING from here on --
//                  written BEFORE anything is done, so a crash is recognised as one
//   RESTORE        dependencies fetched, only what a person trusted, only in the workspace
//   LEASES         a port each component that can be told one is given, and a held fixed port is named
//   BACKING        a dev container, when a component is placed on one, only a definition a person trusted
//   CONNECTIVITY   the servers a person said a start needs, asked from where each component will run
//   READY          the document says what it was built from, where, and on which ports
import { Blocked } from "../../errors.mjs";
import { canonicalJson, sha, short } from "../../hash.mjs";
import { gated, heldBy, owners } from "../lifecycle/start.mjs";
import { planned } from "../lifecycle/world.mjs";
import { conflicts } from "../ports.mjs";
import { providerOf } from "../providers/index.mjs";
import { portsOpenedBy } from "../readiness.mjs";
import { createdSandbox, moved } from "../instances.mjs";
import { operationsRoom, sandboxLiveRoom } from "../rooms.mjs";
import { ensure, look } from "../understanding.mjs";
import { blockedWithout, filesOn } from "../validate.mjs";
import { bindingOf, portModeOf } from "./binding.mjs";
import { leasesOf } from "./held.mjs";
import { createOperations } from "./operations.mjs";
import { effectivePolicy } from "./policy.mjs";
import { fingerprintOf, planOf, restore, trustOf } from "./restore.mjs";
import { definitionFingerprint, definitionTrust } from "./trust.mjs";
import { isolatedSteps } from "./isolated-prepare.mjs";

const go = (patch = {}) => ({ ok: true, patch });

const halt = (needs, because) => ({ ok: false, needs, because });

const ready = (x) => x.state === "ready";

const policyOf = (state) => effectivePolicy(state.settings).policy;

const attempted = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Blocked ? e.message : String(e?.message ?? e);
  }
};

// ---- the steps -----------------------------------------------------------------------------------

// A person's switches, before anything is read, written or run: sandboxes may be turned off for this checkout on
// this machine, and only so many may be active at once. A refusal here is a person's to lift, in Orbit Control.
const ACTIVE_STATES = ["ALLOCATED", "PREPARING", "READY", "STALE", "AMBIGUOUS", "QUARANTINED"];

const othersActive = (c) => c.ctx.sandboxes.list().filter((d) => d.kind === "sandbox" && d.id !== c.ctx.envId && ACTIVE_STATES.includes(d.state)).length;

const POLICY = [
  { fails: (c, policy) => !policy.enabled, say: () => "sandboxes are turned off for this checkout on this machine: a person turns them on in Orbit Control (Runtime → Sandbox policy)" },
  { fails: (c) => c.ctx.sandboxDoc().state === "AMBIGUOUS", say: () => "a restore of dependencies died before it settled and may have half-run, so nothing is prepared on top of it: a person releases this sandbox in Orbit Control, and the next one starts clean" },
  { fails: (c) => c.ctx.sandboxDoc().state === "QUARANTINED", say: () => "this sandbox's teardown could not be proven, so it is quarantined and nothing is prepared on top of it: a person looks at what was left and releases it in Orbit Control" },
  { fails: (c, policy) => othersActive(c) >= policy.limits.active, say: (c, policy) => `${policy.limits.active} sandboxes are active already, which is the most this machine allows: release one, or a person raises the limit in Orbit Control` },
]; // guards, not a decision: the first that holds stops the preparation, and none holding lets it go on

function permitted(c) {
  const { policy } = effectivePolicy(c.ctx.readSettings().settings);
  const refused = POLICY.find((r) => r.fails(c, policy));
  return refused ? halt("person", refused.say(c, policy)) : go();
}

function owned(c) {
  const found = c.ctx.workspaces.found(c.ctx.task);
  return found && found.id === c.ctx.workspace.id ? go() : halt("environment", "the task's workspace is not there any more: prepare-workspace comes first");
}

function treed(c) {
  const tree = c.ctx.workspaces.tree(c.ctx.task);
  return tree ? go({ tree }) : halt("environment", "git could not name the workspace's source tree, so nothing can be built from it");
}

const worldOfTheWorkspace = (ctx, settings) => ((understanding) => ({ view: understanding.view, ...planned(ctx, understanding, settings, { probe: true }) }))(look(ctx));

function understood(c) {
  const settings = c.ctx.readSettings().settings;
  const said = attempted(() => ensure(c.ctx));
  return said ? halt("environment", said) : go({ settings, ...worldOfTheWorkspace(c.ctx, settings) });
}

const sayBlocked = (plan) => plan.components.filter((x) => !["ready", "not-startable"].includes(x.state)).map((x) => `${x.key}: ${x.because}${x.blocking.length ? ` — ${x.blocking.join("; ")}` : ""}`).join("\n");

// Why nothing is placed, ordered: nothing to start at all, or something that could not be made to.
const NOT_PLACED = [
  { name: "NOTHING_TO_START", when: (plan) => plan.overall === "EMPTY", needs: "capability", say: () => "this workspace declares nothing to start: a library or a command-line tool has no application to run and verify live" },
  { name: "NONE_READY", when: (plan) => !plan.components.some(ready), needs: "environment", say: (plan) => `nothing in this workspace can be started here:\n${sayBlocked(plan)}` },
];

const placementsOf = (plan) => Object.fromEntries(plan.components.filter(ready).map((x) => [x.key, x.execution]));

function placed(c) {
  if (isolatedMode(c)) return isolatedSteps.placed(c, { go, halt });
  const row = NOT_PLACED.find((r) => r.when(c.state.plan));
  return row ? halt(row.needs, row.say(c.state.plan)) : go({ placements: placementsOf(c.state.plan) });
}

// Whether this sandbox runs ISOLATED (ADR 0038): every component and service in a container on the task's own network.
export const isolatedMode = (c) => policyOf(c.state).isolation.mode === "required";

// A restore is run for the components placed on THIS machine; a container restores in its own lifecycle.
function restoresOf(c) {
  const plans = c.state.view.components.filter((v) => c.state.placements[v.key] === "native").map(planOf).filter(Boolean);
  const printed = plans.map((plan) => ({ plan, fingerprint: fingerprintOf(plan, c.ctx.source) }));
  return printed.filter((r, i) => r.fingerprint === null || printed.findIndex((o) => o.fingerprint === r.fingerprint) === i);
}

const definitionOf = (c) => (Object.values(c.state.placements).includes("devcontainer") ? definitionFingerprint(filesOn(c.ctx)) : null);

const printOf = (c, restores, definition) => short(sha(canonicalJson({ task: c.ctx.task, workspace: c.ctx.workspace.id, tree: c.state.tree, policy: { sandbox: c.state.settings.sandbox, strategy: c.state.settings.strategy, components: c.state.settings.components }, placements: c.state.placements, definition, restore: restores.map((r) => r.fingerprint) })), 16);

const unchanged = (doc, fingerprint, c) => !isolatedMode(c) && doc.state === "READY" && doc.fingerprint === fingerprint;

// From here on the sandbox is being prepared, and says so BEFORE anything is done: a crash is then a PREPARING
// document with an operation that never settled, which `reconcile` recognises.
const entered = (c) => c.ctx.sandboxes.write(moved(c.ctx.sandboxDoc(), "PREPARING", c.ctx.now(), { blocked: null, fingerprint: null, placements: c.state.placements }));

function fingerprinted(c) {
  const restores = restoresOf(c);
  const fingerprint = printOf(c, restores, definitionOf(c));
  if (unchanged(c.ctx.sandboxDoc(), fingerprint, c)) return { ok: true, done: true, reused: true, patch: { fingerprint } };
  entered(c);
  return go({ restores, fingerprint });
}

const envNamesOf = (ctx, key) => ctx.readSettings().settings.components?.[key]?.env ?? [];

const doneOf = (doc, fingerprint) => (doc.restore?.receipts?.[fingerprint]?.ok ? fingerprint : null);

const judgedRestore = (c, r) => ({ ...r, ...{ row: trustOf({ plan: r.plan, fingerprint: r.fingerprint, policy: policyOf(c.state), done: doneOf(c.ctx.sandboxDoc(), r.fingerprint) }) } });

function ranOne(c, r) {
  const op = c.ops.begin("restore", { fingerprint: r.fingerprint });
  const out = restore(c.ctx, r.plan, envNamesOf(c.ctx, r.plan.component));
  c.ctx.io.write(c.ops.logFile(op), out.log);
  c.ops.settle(op, out.ok ? "DONE" : "FAILED", out.ok ? null : `exit ${out.status ?? "none"}`);
  return { ok: out.ok, receipt: { at: c.ctx.now(), ok: out.ok, status: out.status, durationMs: out.durationMs }, because: `restoring ${r.plan.component} (${r.plan.argv.join(" ")}) ${out.ok ? "finished" : `failed with ${out.status === null ? "no exit status" : `exit ${out.status}`}`}` };
}

// Trust was judged on the fingerprint of the files as the index held them a while ago. What runs is what the workspace
// holds NOW, so the workspace is staged again and the fingerprint taken again, immediately before: a lock file edited
// in between is a different print, and a different print is not what a person trusted.
const unchangedSince = (c, r) => (c.ctx.workspaces.tree(c.ctx.task), fingerprintOf(r.plan, c.ctx.source) === r.fingerprint);

const MOVED_UNDER_TRUST = (r) => `the files restoring ${r.plan.component} depends on changed after trust was checked, so it is not run: prepare again, and what a person trusted is judged on what is there`;

async function ranAll(c, rows) {
  const receipts = { ...(c.ctx.sandboxDoc().restore?.receipts ?? {}) };
  for (const r of rows) {
    if (!unchangedSince(c, r)) return halt("environment", MOVED_UNDER_TRUST(r));
    const done = ranOne(c, r);
    receipts[r.fingerprint] = done.receipt;
    if (!done.ok) return halt("environment", `${done.because}; what it printed is in the sandbox's operations room`);
  }
  return go({ receipts });
}

function restored(c) {
  const rows = c.state.restores.map((r) => judgedRestore(c, r));
  const stuck = rows.filter((r) => r.row.needs);
  if (stuck.length) return halt(stuck.some((r) => r.row.needs === "environment") ? "environment" : "person", stuck.map((r) => r.row.say(r)).join("; "));
  return ranAll(c, rows.filter((r) => r.row.run)).then((done) => ({ ...done, notes: rows.filter((r) => !r.row.run && r.row.name === "MANUAL").map((r) => r.row.say(r)) }));
}

// ---- leases and ports --------------------------------------------------------------------------------

// What kind of thing answers at a component's endpoint, ordered; the last always matches.
const ENDPOINT_KIND = [
  { when: (x) => x.readiness?.kind === "http", kind: "http" },
  { when: (x) => ["web", "api"].includes(x.kind), kind: "http" },
  { when: () => true, kind: "tcp" },
];

const kindOf = (x) => ENDPOINT_KIND.find((r) => r.when(x)).kind;

const viewOf = (c, key) => c.state.view.components.find((v) => v.key === key);

const commandOf = (c, x) => viewOf(c, x.key).commands.find((cmd) => cmd.declaredAs === x.command?.declaredAs) ?? null;

const lease = async (c, x, ports) => {
  const held = leasesOf(c.ctx);
  const mine = held.list().find((l) => l.env === c.ctx.envId && l.component === x.key);
  if (mine) return { lease: mine };
  const { policy } = effectivePolicy(c.state.settings);
  return held.acquire({ owner: c.ctx.owner, env: c.ctx.envId, checkout: c.ctx.checkout, project: c.ctx.project.storeKey, component: x.key, from: policy.ports.from, to: policy.ports.to, host: c.ctx.host }, { probe: c.ctx.probe });
};

const strangers = async (c, ports, key) => (await conflicts(ports.map((port) => ({ component: key, port })), { probe: c.ctx.probe, ownerOf: owners(c.ctx) })).filter((h) => h.owner?.owner?.id !== c.ctx.owner.id);

const FIXED_HELD = (held) => `${held.map(heldBy).join("; ")}. A sandbox cannot give it another port: nothing says how this component is told one (a person sets how, in Orbit Control), and what holds it is not stopped`;

// A component that declares no port but can be TOLD one (a person said how, or its files did) is given one: it
// listens somewhere, and "where" is the sandbox's to say. One that declares none and cannot be told has no endpoint.
async function endpointOf(c, x) {
  const ports = portsOpenedBy(viewOf(c, x.key), x.command);
  const { binding } = bindingOf({ settings: c.state.settings.components?.[x.key], command: commandOf(c, x) });
  if (!ports.length && !binding) return {};
  if (portModeOf({ execution: x.execution, policy: policyOf(c.state), binding, ports: ports.length }) === "lease") return leasedEndpoint(c, x, ports);
  return ports.length ? fixedEndpoint(c, x, ports) : {};
}

async function leasedEndpoint(c, x, ports) {
  const got = await lease(c, x, ports);
  return got.lease ? { endpoint: { component: x.key, kind: kindOf(x), port: got.lease.port, source: "lease" } } : { blocked: got.because };
}

async function fixedEndpoint(c, x, ports) {
  const held = await strangers(c, ports, x.key);
  return held.length ? { blocked: FIXED_HELD(held) } : { endpoint: { component: x.key, kind: kindOf(x), port: ports[0], source: "fixed" } };
}

async function leased(c) {
  if (isolatedMode(c)) return go({ endpoints: [] });
  const found = [];
  for (const x of c.state.plan.components.filter(ready)) found.push(await endpointOf(c, x));
  const stuck = found.find((f) => f.blocked);
  return stuck ? halt("person", stuck.blocked) : go({ endpoints: found.flatMap((f) => (f.endpoint ? [f.endpoint] : [])) });
}

// ---- the container ----------------------------------------------------------------------------------------

const rebuilt = (doc, files) => canonicalJson(doc.backing?.devcontainer?.files ?? {}) !== canonicalJson(files);

function up(c, files, fingerprint) {
  const provider = providerOf("devcontainer", c.ctx.providers);
  const op = c.ops.begin("up", { fingerprint });
  const result = provider.validate({ ...c.state.world, rebuild: rebuilt(c.ctx.sandboxDoc(), files) }, c.deps);
  c.ops.settle(op, result.ok ? "DONE" : "FAILED", result.because);
  return result.ok ? go({ backing: { devcontainer: { state: "VALIDATED", files, validation: { at: c.ctx.now(), because: result.because, receipt: result.receipt } } } }) : halt("environment", `the dev container did not come up: ${result.because}`);
}

// What stands between a definition and its container being brought up: a person's trust in exactly these files, then
// a machine that can do it at all. -> { needs, say } | null
function containerGate(c, files) {
  const fingerprint = definitionFingerprint(files);
  const row = definitionTrust({ fingerprint, policy: policyOf(c.state) });
  if (!row.trusted) return { needs: row.needs, say: row.say({ fingerprint }) };
  const lacking = attempted(() => blockedWithout(providerOf("devcontainer", c.ctx.providers), c.state.world));
  return lacking ? { needs: "environment", say: lacking } : null;
}

function backed(c) {
  if (!Object.values(c.state.placements).includes("devcontainer")) return go({ backing: { devcontainer: null } });
  const files = filesOn(c.ctx);
  const gate = containerGate(c, files);
  return gate ? halt(gate.needs, gate.say) : up(c, files, definitionFingerprint(files));
}

async function reached(c) {
  if (isolatedMode(c)) return isolatedSteps.reached(c, { go, halt });
  const gate = await gated(c.ctx, c.state.plan.components.filter(ready), c.state.world);
  return gate.blocked.length ? halt("person", gate.blocked.map((b) => `${b.component}: ${b.blocking.join("; ")}`).join("\n")) : go();
}

// ---- done ---------------------------------------------------------------------------------------------------

const restoreKept = (doc, s) => ({ plans: (s.restores ?? []).map((r) => ({ component: r.plan.component, fingerprint: r.fingerprint, argv: r.plan.argv, cwd: r.plan.cwd })), receipts: s.receipts ?? doc.restore?.receipts ?? {} });

function readied(c) {
  const doc = c.ctx.sandboxDoc();
  const now = c.ctx.now();
  const next = moved(doc, "READY", now, { source: { baseRevision: doc.source.baseRevision, tree: c.state.tree }, placements: c.state.placements, endpoints: c.state.endpoints, backing: c.state.backing, restore: restoreKept(doc, c.state), fingerprint: c.state.fingerprint, policy: { revision: c.ctx.readSettings().revision }, isolation: c.state.isolation ?? null, lastActiveAt: now, blocked: null });
  c.ctx.sandboxes.write(next);
  return go();
}

export const PREPARE_STEPS = [
  { name: "POLICY", run: permitted },
  { name: "OWNERSHIP", run: owned },
  { name: "TREE", run: treed },
  { name: "UNDERSTANDING", run: understood },
  { name: "PLACEMENTS", run: placed },
  { name: "FINGERPRINT", run: fingerprinted },
  { name: "RESTORE", run: restored },
  { name: "LEASES", run: leased },
  { name: "BACKING", run: backed },
  { name: "CONNECTIVITY", run: reached },
  { name: "TOPOLOGY", run: (c) => (isolatedMode(c) ? isolatedSteps.topology(c, { go, halt }) : go()) },
  { name: "NETWORK", run: (c) => (isolatedMode(c) ? isolatedSteps.network(c, { go, halt }) : go()) },
  { name: "SERVICES", run: (c) => (isolatedMode(c) ? isolatedSteps.services(c, { go, halt }) : go()) },
  { name: "READINESS", run: (c) => (isolatedMode(c) ? isolatedSteps.readiness(c, { go, halt }) : go()) },
  { name: "ATTEST", run: (c) => (isolatedMode(c) ? isolatedSteps.attest(c, { go, halt }) : go()) },
  { name: "READY", run: readied },
];

const opsOf = (ctx) => createOperations(operationsRoom(sandboxLiveRoom(ctx.rooms.live, ctx.envId)), ctx.io, ctx.now);

// What a person or the orchestrator is told: the sandbox as it stands, and -- when it cannot go on -- who has to act.
function answerOf(c, outcome) {
  const doc = c.ctx.sandboxDoc();
  const blocked = outcome.ok ? null : { needs: outcome.needs, because: outcome.because };
  return { environment: c.ctx.envId, state: outcome.ok ? "READY" : "BLOCKED", tree: c.state.tree ?? doc.source?.tree ?? null, reused: outcome.reused === true, placements: c.state.placements ?? doc.placements ?? {}, endpoints: c.state.endpoints ?? doc.endpoints ?? [], blocked, ...(c.notes.length ? { notes: c.notes } : {}) };
}

// A sandbox that cannot go on keeps WHY on its own document, so whoever looks at it later is told, and a person
// who acts finds it still there to prepare again.
function blockedOn(c, outcome) {
  const doc = c.ctx.sandboxDoc();
  if (!outcome.ok) c.ctx.sandboxes.write({ ...doc, blocked: { needs: outcome.needs, because: outcome.because, at: c.ctx.now() }, updatedAt: c.ctx.now() });
  return outcome;
}

// -> { environment, state: READY | BLOCKED, tree, reused, placements, endpoints, blocked }. Idempotent: a sandbox
// that is READY at the print of what it would be built from is the answer, and nothing runs again.
export async function prepared(ctx, deps, opts = {}) {
  const c = { ctx, deps, state: {}, ops: opsOf(ctx), notes: [], closure: opts.closure ?? null };
  const op = begun(c);
  const outcome = blockedOn(c, await stepped(c));
  c.ops.settle(op, outcome.ok ? "DONE" : "FAILED", outcome.ok ? null : outcome.because);
  return answerOf(c, outcome);
}

// The sandbox exists from the moment it is asked for (ALLOCATED, so a task's receipt always names a document that is
// there to read), and the operation that is about to prepare it is on record before it does.
function begun(c) {
  c.ctx.sandboxes.write(afresh(c.ctx));
  return c.ops.begin("prepare");
}

// A released sandbox is never revived (nothing leaves RELEASED); asking for one again, after a release, is a NEW
// allocation, under the same deterministic id: its understanding is remembered, and nothing else is.
const afresh = (ctx) => (ctx.sandboxDoc().state === "RELEASED" ? createdSandbox({ checkout: ctx.checkout, task: ctx.task, workspace: ctx.workspace.id, baseRevision: ctx.workspace.baseRevision }, ctx.now()) : ctx.sandboxDoc());

async function stepped(c) {
  for (const step of PREPARE_STEPS) {
    const result = await step.run(c);
    c.state = { ...c.state, ...(result.patch ?? {}) };
    c.notes.push(...(result.notes ?? []));
    if (!result.ok || result.done) return result;
  }
  return { ok: true };
}
