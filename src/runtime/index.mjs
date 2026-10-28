// The runtime commands, as a TABLE -- the shape every other subsystem's commands take
// (src/requirements/index.mjs, src/work/index.mjs):
//
//   run(ctx, args)   answers with DATA, so `--json` and Orbit Control read the same thing
//   say(data)        puts it in words (src/runtime/views.mjs)
//   writes           what it touches: `nothing`, `store` (this machine's store), `repository`
//                    (the checkout's working tree) or `machine` (a process, a container)
//   needs            what the composition root binds: `checkout`, or `machine` for the one
//                    command that is about every project and no checkout in particular
//
// The writes column IS the governance table (src/runtime/governance.mjs) read as data,
// and a test asserts the two cannot disagree. Exactly one command writes the repository
// -- `adopt`, and only for `--human` -- and none of them is a test run, an API write, a
// seed or a reset.
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { parseCandidates, recordInferences } from "./record.mjs";
import { sayAdopt, sayCheck, sayConnectivity, sayDiscover, sayDoctor, sayForgotten, sayPrepare, sayProjects, sayProposal, sayRecord, saySettings, sayStart, sayStatus, sayStop, sayValidate } from "./views.mjs";
import { checkTarget, connectivityNow } from "./connectivity/check.mjs";
import { OPERATIONS } from "./governance.mjs";
import { designed, proposalFor, currentOf } from "./design-flow.mjs";
import { adopt as adoptProposal, refusedEarly } from "./writer.mjs";
import { doctor as doctorLifecycle, prepare as prepareLifecycle } from "./lifecycle/prepare.mjs";
import { deps } from "./lifecycle/deps.mjs";
import { start as startLifecycle } from "./lifecycle/start.mjs";
import { status as statusLifecycle } from "./lifecycle/status.mjs";
import { stop as stopLifecycle } from "./lifecycle/stop.mjs";
import { planned } from "./lifecycle/world.mjs";
import { providerOf } from "./providers/index.mjs";
import { validate as validateInstance } from "./validate.mjs";
import { ensure, look } from "./understanding.mjs";
import { summarize } from "./summarize.mjs";
import { SANDBOX_COMMANDS } from "./sandbox/commands.mjs";

const countBy = (items, key) => items.reduce((by, i) => ({ ...by, [i[key]]: (by[i[key]] ?? 0) + 1 }), {});

// ---- discover ------------------------------------------------------------------------------

async function discover(ctx, args) {
  const done = ensure(ctx, { dry: has(args, "dry"), rescan: has(args, "rescan") });
  if (done.decision.writes) summarize(ctx);
  const gaps = done.read?.gaps ?? [];
  const unknowns = done.read?.unknowns ?? [];
  return { decision: { name: done.decision.name, say: done.decision.say, scan: done.decision.scan, writes: done.decision.writes, dry: done.decision.dry }, state: done.state, facts: done.facts.length, byKind: countBy(done.facts, "kind"), gaps, notes: unknowns.filter((u) => !gaps.includes(u)) };
}

// ---- record: an agent's inferences, never trusted ------------------------------------------

async function record(ctx, args) {
  const rows = parseCandidates(ctx.read(words(args)[0]));
  const made = recordInferences(ctx, rows);
  summarize(ctx);
  return { recorded: made.length, ids: made.map((f) => f.id) };
}

// ---- status, settings ----------------------------------------------------------------------

const status = (ctx) => statusLifecycle(ctx);

const settings = (ctx) => ctx.readSettings();

// A person's settings, written against the revision they read: the one door `configure` and
// Orbit Control both go through, so a stale page and a stale terminal are refused the same way.
export function keepSettings(ctx, { next, revision }) {
  const kept = ctx.writeSettings({ next, revision, by: "person" });
  summarize(ctx);
  return kept;
}

function configure(ctx, args) {
  if (!has(args, "human")) throw new Refused("runtime settings are a person's choice — relay them with --human");
  const current = ctx.readSettings();
  return noted(ctx, keepSettings(ctx, { next: changed(current.settings, args), revision: current.revision }));
}

// A reach target required by a key no component of this checkout has gates nothing -- a typo, or a
// component not discovered yet. Kept, because a component may come, and SAID. Nothing is said when
// the checkout has not been understood: there is nothing to hold a key against.
function noted(ctx, kept) {
  const known = new Set(look(ctx).view?.components.map((c) => c.key) ?? []);
  const strays = known.size ? Object.entries(kept.settings.connectivity.targets).flatMap(([id, t]) => t.requiredBy.filter((k) => !known.has(k)).map((k) => `${id} is required by ${k}, which is not a component of this checkout: it gates nothing for it`)) : [];
  const notes = [...strays, ...ungated(kept.settings.connectivity.targets)];
  return notes.length ? { ...kept, notes } : kept;
}

// Checked before a start of WHAT requires it: with nothing requiring it, the gate gates nothing yet.
const ungated = (targets) => Object.entries(targets).filter(([, t]) => t.beforeStart && !t.requiredBy.length).map(([id]) => `${id} is checked before a start, and no component requires it: it gates nothing until one does (--required-by)`);

// This machine's block with what the flags say, and nothing else touched: a component
// is set field by field, and `--clear` removes its settings; a connectivity target the same
// way under `--reach=<id>`, and `--remove-reach` removes it.
function changed(block, args) {
  const top = given(BLOCK_FLAGS, args);
  return { ...block, ...top, components: componentsChanged(block.components, args), connectivity: connectivityChanged(block.connectivity, args) };
}

// What a table of flag readers found on the command line, and only what it found.
const given = (table, args) => Object.fromEntries(Object.entries(table).map(([k, read]) => [k, read(args)]).filter(([, v]) => v !== undefined));

const intFlag = (a, name) => (flag(a, name) === undefined ? undefined : Number(flag(a, name)));
const boolFlag = (a, name) => (flag(a, name) === undefined ? undefined : flag(a, name) === "true");
const listFlag = (a, name) => flag(a, name)?.split(",").map((s) => s.trim()).filter(Boolean);

// The retry policy: the block's, or -- with --reach=<id> -- that target's own.
const RETRY_FLAGS = { attempts: (a) => intFlag(a, "retry-attempts"), intervalMs: (a) => intFlag(a, "retry-interval-ms"), timeoutMs: (a) => intFlag(a, "retry-timeout-ms") };

// A target's server is `--address`: `--host` and `--protocol` select the HOST on every Orbit command
// (skills/orbit-learn/hosts/settings.mjs), before any command sees its arguments.
const REACH_FLAGS = { label: (a) => flag(a, "label"), host: (a) => flag(a, "address"), port: (a) => intFlag(a, "port"), requiredBy: (a) => listFlag(a, "required-by"), checkFrom: (a) => listFlag(a, "check-from"), beforeStart: (a) => boolFlag(a, "before-start"), note: (a) => flag(a, "note") };

function connectivityChanged(c, args) {
  const id = flag(args, "reach");
  if (!id) return { ...c, retry: { ...c.retry, ...given(RETRY_FLAGS, args) } };
  if (has(args, "remove-reach")) return { ...c, targets: Object.fromEntries(Object.entries(c.targets).filter(([k]) => k !== id)) };
  return { ...c, targets: { ...c.targets, [id]: reachChanged(c.targets[id], args) } };
}

function reachChanged(was, args) {
  const retry = given(RETRY_FLAGS, args);
  const next = { ...(was ?? {}), ...given(REACH_FLAGS, args) };
  return Object.keys(retry).length ? { ...next, retry: { ...(was?.retry ?? {}), ...retry } } : next;
}

const BLOCK_FLAGS = { strategy: (a) => flag(a, "strategy"), reuseExternal: (a) => (flag(a, "reuse-external") === undefined ? undefined : flag(a, "reuse-external") === "true") };

function componentsChanged(components, args) {
  const key = flag(args, "component");
  if (!key) return components;
  if (has(args, "clear")) return Object.fromEntries(Object.entries(components).filter(([k]) => k !== key));
  return { ...components, [key]: componentChange(components[key] ?? {}, args) };
}

const FIELDS = { provider: (a) => flag(a, "provider"), command: (a) => flag(a, "command"), env: (a) => flag(a, "env")?.split(",").filter(Boolean), readiness: (a) => readinessOf(a) };

function componentChange(was, args) {
  const given = Object.fromEntries(Object.entries(FIELDS).map(([name, read]) => [name, read(args)]).filter(([, v]) => v !== undefined));
  return { ...was, ...given };
}

function readinessOf(args) {
  const kind = flag(args, "probe");
  if (!kind) return undefined;
  const target = flag(args, "target");
  return { kind, target: kind === "tcp" ? Number(target) : target, ...(flag(args, "expect") ? { expect: Number(flag(args, "expect")) } : {}) };
}

// ---- design, proposal, adopt ---------------------------------------------------------------

async function design(ctx) {
  const understanding = requireUnderstanding(ctx, "the environment it designs rests on what the files say now");
  const kept = keep(ctx, proposalFor(ctx, understanding, designed(ctx, understanding)));
  summarize(ctx);
  return kept;
}

// The same design is the same proposal: asking twice keeps one -- while it is OPEN. A proposal that
// has been adopted is spent, and the same design asked for again means the files it wrote are gone
// (a person removed them): the design is made open again, which is what lets it be adopted again, and
// not left as an adopted proposal that says there is nothing to do.
function keep(ctx, proposal) {
  const existing = ctx.proposals.read(proposal.id);
  if (existing?.status === "open") return { proposal: existing, created: false };
  ctx.proposals.write(proposal);
  return { proposal, created: true };
}

function discovered(ctx) {
  const understanding = look(ctx);
  if (understanding.state === "NOT_DISCOVERED") throw new Refused("nothing has read this checkout's runtime yet: run `runtime discover` first");
  return understanding;
}

function proposalOf(ctx, args) {
  const id = words(args)[0];
  const found = id ? ctx.proposals.read(id) : ctx.proposals.list().find((p) => p.status === "open");
  if (!found) throw new Refused(id ? `no proposal ${id} is kept for this checkout` : "no proposal is open: `runtime design` makes one");
  return found;
}

const proposal = (ctx, args) => proposalOf(ctx, args);

// What an adopt rests on: understanding that is not behind the files, and the proposal named.
function adoptable(ctx, args) {
  requireUnderstanding(ctx, "what is adopted rests on what the files say now");
  return proposalOf(ctx, args);
}

// Adopting writes the developer's own checkout: the PRIMARY_CHECKOUT_WRITE protected boundary (src/protected/), which
// only a person's own act crosses -- through Orbit Control's door (`ctx.door`, set by Control after its token). No
// terminal and no agent crosses it, `--human` or not; it is refused before anything is read.
async function adopt(ctx, args) {
  refusedEarly({ door: ctx.door ?? "terminal" }, words(args)[0]);
  const found = adoptable(ctx, args);
  const done = adoptProposal(ctx, found, { actor: { door: ctx.door }, now: currentOf(ctx, found, look(ctx)) });
  summarize(ctx);
  return done;
}

// ---- doctor, validate, prepare -------------------------------------------------------------

async function doctor(ctx) {
  const done = doctorLifecycle(ctx);
  summarize(ctx);
  return done;
}

// Bringing an environment up runs what its definition says to run -- `initializeCommand` on THIS machine, not in the
// container -- and it is AUTONOMOUS (0.2.0): building a local environment is ordinary development, never a protected
// boundary. `--human` is still accepted, and asks nothing more.
async function validate(ctx) {
  const { world } = planned(ctx, look(ctx), ctx.readSettings().settings, { probe: true });
  const done = validateInstance(ctx, providerOf("devcontainer", ctx.providers), world, deps(ctx));
  summarize(ctx);
  return done;
}

// A plan is free; acting on it is the same act as validating -- autonomous too.
async function prepare(ctx, args) {
  return prepareLifecycle(ctx, { apply: has(args, "apply") });
}

// ---- start, stop ---------------------------------------------------------------------------

// A start, a design and an adopt rest on what is kept, so each refuses to rest on nothing or on
// something that moved: the command a start would launch, the environment a design would propose and
// the file an adopt would write are all derived from facts that may be a commit old.
function requireUnderstanding(ctx, rests = "the command it starts is the one the files say now") {
  const understanding = discovered(ctx);
  if (understanding.state === "STALE") throw new Refused(`what is kept about this checkout's runtime is STALE: run \`runtime discover\` first, so ${rests}`);
  return understanding;
}

async function start(ctx, args) {
  const understanding = requireUnderstanding(ctx);
  const plannedNow = planned(ctx, understanding, ctx.readSettings().settings, { probe: true });
  const done = await startLifecycle(ctx, plannedNow, { component: flag(args, "component"), wait: Number(flag(args, "wait") ?? 0) });
  summarize(ctx);
  return done;
}

async function stop(ctx, args) {
  const done = await stopLifecycle(ctx, { component: flag(args, "component"), session: flag(args, "session"), release: flag(args, "release"), environment: has(args, "environment"), human: has(args, "human") });
  summarize(ctx);
  return done;
}

// ---- connectivity: the servers it needs that are not its own -------------------------------

const connectivity = (ctx) => connectivityNow(ctx);

const fromOf = (args) => flag(args, "from")?.split(",").map((s) => s.trim()).filter(Boolean);

const check = (ctx, args) => checkTarget(ctx, words(args)[0], { providers: fromOf(args), mode: "check" });

const retry = (ctx, args) => checkTarget(ctx, words(args)[0], { providers: fromOf(args), mode: "retry" });

const projects = (ctx) => ctx.registry.list();

// A checkout whose directory is gone comes off this machine's list, named by the directory `projects` prints or by its
// id (twelve characters of it are enough). Store bookkeeping, and autonomous: what Orbit kept about it stays.
async function forget(ctx, args) {
  const found = checkoutNamed(ctx.registry.list(), words(args)[0]);
  ctx.registry.forget(found.project.key, found.checkout.id);
  return found;
}

function checkoutNamed(list_, ref) {
  const hits = list_.flatMap((project) => project.checkouts.filter((c) => named(c, ref)).map((checkout) => ({ project, checkout })));
  if (hits.length === 1) return hits[0];
  throw new Refused(hits.length ? `${ref} names more than one checkout — give more of its id` : `no checkout ${ref ?? "(none named)"} is known on this machine — \`runtime projects\` lists them`);
}

const named = (c, ref) => typeof ref === "string" && (c.root === ref || c.id === ref || (ref.length >= 12 && c.id.startsWith(ref)));

export const COMMANDS = {
  projects: { run: projects, say: sayProjects, writes: "nothing", needs: "machine" },
  forget: { run: forget, say: sayForgotten, writes: "store", needs: "machine" },
  status: { run: status, say: sayStatus, writes: "nothing", needs: "checkout" },
  proposal: { run: proposal, say: sayProposal, writes: "nothing", needs: "checkout" },
  settings: { run: settings, say: saySettings, writes: "nothing", needs: "checkout" },
  discover: { run: discover, say: sayDiscover, writes: "store", needs: "checkout" },
  record: { run: record, say: sayRecord, writes: "store", needs: "checkout" },
  design: { run: async (ctx, args) => (await design(ctx, args)).proposal, say: sayProposal, writes: "store", needs: "checkout" },
  adopt: { run: adopt, say: sayAdopt, writes: "repository", needs: "checkout" },
  doctor: { run: doctor, say: sayDoctor, writes: "store", needs: "checkout" },
  validate: { run: validate, say: sayValidate, writes: "machine", needs: "checkout" },
  prepare: { run: prepare, say: sayPrepare, writes: "machine", needs: "checkout" },
  start: { run: start, say: sayStart, writes: "machine", needs: "checkout" },
  stop: { run: stop, say: sayStop, writes: "machine", needs: "checkout" },
  configure: { run: configure, say: (r) => saySettings(r), writes: "store", needs: "checkout" },
  connectivity: { run: connectivity, say: sayConnectivity, writes: "nothing", needs: "checkout" },
  check: { run: check, say: sayCheck, writes: "store", needs: "checkout" },
  retry: { run: retry, say: sayCheck, writes: "store", needs: "checkout" },
  ...SANDBOX_COMMANDS,
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

// The governance table says where each command may write; the command table must
// agree. Asked by a test, so the two cannot drift.
export const governed = () => OPERATIONS.flatMap((o) => o.commands.map((c) => ({ command: c, mutates: o.mutates })));
