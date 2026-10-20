// What orbit-help gathers before it recommends anything: a bounded, read-only
// read of what architecture, the map, the QA plans and the lessons already
// hold. It never scans, never validates a plan it has not already been asked
// to check, and it adds nothing to any store.
import { createArchitecture } from "../architecture/store.mjs";
import { statusOf } from "../context/status.mjs";
import { knownCheckout } from "../project/repository.mjs";
import { createEngineering } from "../engineering/store.mjs";
import { errors } from "../qa/finding.mjs";
import { planFindings } from "../qa/validate.mjs";
import { loadPlans, plansDir } from "../qa/load.mjs";
import { planWorld } from "../qa/world.mjs";
import { capabilitiesOf } from "../qa/capability.mjs";
import { createWorkingSet } from "../engineering/working-set/store.mjs";
import { fold } from "../engineering/working-set/fold.mjs";
import { workingSetDir } from "../project/runtime.mjs";
import { createRequirements } from "../requirements/store.mjs";
import { classify } from "../routing/classify.mjs";
import { snapshotIn } from "../work/requirement.mjs";
import { createWorks } from "../work/store.mjs";
import { workSummary } from "../work/summary.mjs";

// The working set is recorded by the hooks now (src/lifecycle/): what a
// session read, changed and ran. Until one has been recorded in this checkout
// -- the hooks are off, or nobody has worked here since -- a caller is told
// UNKNOWN instead of getting a guess.
export const NO_WORKING_SET = "working set — no hook has recorded what a session read or changed in this checkout yet";

export const unknownOf = (state) => (state.workingSet.sessions ? [] : [NO_WORKING_SET]);

// `ctx.automation` is what cli/help.mjs read of the automation settings and whether a coordinated workflow
// fits the task -- handed in, so this navigator reads no automation room itself and imports no coordinator.
export function gatherState(ctx, task = null) {
  const state = { architecture: architectureState(ctx), map: mapState(ctx), qa: qaState(ctx), learn: learnState(ctx), engineering: engineeringState(ctx), workingSet: workingSetState(ctx), work: workState(ctx), task: taskState(task), automation: task ? ctx.automation ?? null : null };
  return { ...state, status: contextStatus(ctx, state) };
}

// How much of what this navigator read rests on evidence, in the context command's own words (src/context/status.mjs):
// over what it read itself -- architecture, engineering memory and the working set -- never a count of sections.
const contextStatus = (ctx, s) => statusOf({ bound: knownCheckout(ctx.project), sections: [{ id: "architecture", known: s.architecture.total > 0 || s.architecture.scanned }, { id: "engineering", known: s.engineering.total > 0 }, { id: "working-set", known: s.workingSet.sessions > 0 }], architecture: s.architecture, blocked: ctx.seat?.status === "blocked" ? ctx.seat.because : null });

// What a named task is ABOUT, as the prompt router's table classifies it -- an
// intent word and a confidence, never the task's text, which is dropped here.
function taskState(task) {
  if (!task) return null;
  const { intent } = classify(task);
  return { intent: intent.id, confidence: intent.confidence };
}

// Read-only: how many pieces of work are in progress here, and how many rest on a requirement
// that is not yet complete -- from each work's own journal and the snapshot it adopted. A work
// nobody can read is counted open and not opened, and nothing here writes.
function workState(ctx) {
  const requirements = createRequirements(ctx.store.root, ctx.io);
  const summary = workSummary(createWorks(ctx.store.root, ctx.io), (id, root) => snapshotIn({ requirements }, id, root));
  return { total: summary.works.length, open: summary.open, blocked: summary.blocked };
}

export const taskArg = (args) => args.find((a) => a.startsWith("--for="))?.slice(6).trim() || null;

// Read-only: the number of sessions kept here and what the newest one touched.
function workingSetState(ctx) {
  const ws = createWorkingSet(workingSetDir(ctx.project), ctx.io);
  const latest = fold(ws.latest());
  return { sessions: ctx.io.list(ws.dir).filter((n) => n.endsWith(".jsonl")).length, read: latest.read.length, changed: latest.changed.length, commands: latest.commands.length, scopes: latest.scopes.slice(0, 12) };
}

function engineeringState(ctx) {
  const all = createEngineering(ctx.store.root, ctx.io).all();
  return { total: all.length, enforced: count(all, "strength", "enforced"), adopted: count(all, "strength", "adopted"), stale: count(all, "status", "stale") };
}

// `scanned`: whether the repository was ever read (a snapshot is kept), so a checkout read once that held nothing a
// fact could stand on is not sent to read it again, and again.
function architectureState(ctx) {
  const arch = createArchitecture(ctx.store.root, ctx.io);
  const all = arch.all();
  return { total: all.length, fresh: count(all, "status", "fresh"), stale: count(all, "status", "stale"), unknown: count(all, "status", "unknown"), scanned: Boolean(arch.model().model) };
}

function mapState(ctx) {
  return { screens: ctx.graph.screens.size, edges: ctx.graph.edges.length };
}

function qaState(ctx) {
  const found = loadPlans(plansDir(ctx.project));
  if (!found.length) return { plans: 0, clean: 0, errors: 0 };
  const bad = found.filter((p) => errors(planFindings(p, planWorld(ctx))).length).length;
  return { plans: found.length, clean: found.length - bad, errors: bad };
}

function learnState(ctx) {
  const all = ctx.learn.all();
  return { total: all.length, validated: count(all, "state", "validated"), candidate: count(all, "state", "candidate") };
}

const count = (all, key, value) => all.filter((x) => x[key] === value).length;

export function blockersOf(ctx) {
  const caps = Object.entries(capabilitiesOf(ctx.config));
  return [...seatBlocker(ctx.seat), ...caps.filter(([, v]) => !v.can).map(([layer, v]) => `${layer} — ${v.because}`)];
}

// A seat the store refused (cli/help.mjs): said as a blocker, with the store's own sentence, never hidden.
const seatBlocker = (seat) => (seat?.status === "blocked" ? [`store — ${seat.because}: nothing was seated, and this checkout is read as it is`] : []);
