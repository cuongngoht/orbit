// HOW each step is carried out: what the engine does itself through an owner's port (`ENGINE`), what it
// does before a host takes over (`BEFORE_HOST`: starting the engineering task a step hands on), and what it
// tells a host to do (`howOf`). Nothing here is a command line the engine runs: an engine step is an owner's
// own port, and a host step is a sentence and the Orbit command a host already runs for that skill.
//
// `execution.environment` (a person's setting) is passed on, never decided here: `sandbox` tells the host
// that the change must be run and investigated in the task's own sandbox.
import { READ_BACK } from "./evidence.mjs";
import { DOMAIN } from "./vocab.mjs";

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

// The child task a coordinator started for its engineering step: the latest `task:` receipt.
export const childOf = (view) => view.receipts.filter((r) => r.domain === DOMAIN.TASK).at(-1)?.ref ?? null;

// The sandbox environment the child holds, off the child's own journal (its latest `sandbox:` receipt).
const sandboxOf = (ports, child) => (child ? ports.child.view(child)?.receipts?.filter((r) => r.domain === "sandbox").at(-1)?.ref ?? null : null);

const fromChild = (ports, lw) => ((child) => (child ? READ_BACK[DOMAIN.TASK](ports, child, lw) : { verdict: "unreadable", receipt: null, because: "no engineering task was started by this workflow" }))(childOf(lw.view));

async function requirementRun(ports, lw) {
  const looked = await ports.requirements.look(lw.view.task.root);
  return looked?.latest ? READ_BACK[DOMAIN.REQUIREMENT](ports, looked.latest.id, lw) : { verdict: "unreadable", receipt: null, because: "the requirement has no frozen snapshot yet" };
}

// What the context amounts to is the context command's own word (src/context/status.mjs), carried as it is: never
// "understood" because sections came back. A context that could not be gathered on this machine at all (BLOCKED)
// fails the step; anything else is REPORTED with the word and what is still unknown, which is all a host is owed.
// A context command from before 1.8.9 says no word, and the count is all there is to report.
async function contextRun(ports, lw) {
  const got = await ports.context.gather(lw.view.task.objective);
  const blocked = got.status?.word === "BLOCKED";
  return { verdict: blocked ? "violated" : "reported", because: blocked ? clip(got.status.because) : undefined, receipt: null, summary: clip(got.status?.summary ?? `${got.sections?.length ?? 0} section(s) of project context, memory first`) };
}

// The same line autonomous engineering draws (src/orchestration/readiness.mjs NOT_UNDERSTOOD): a checkout is
// understood once discovery could read it -- with gaps (PARTIAL) included; only one nothing could read blocks.
const UNREAD = ["NOT_DISCOVERED", "UNKNOWN"];

async function runtimeRun(ports) {
  const r = await ports.runtime.readiness();
  return { verdict: UNREAD.includes(r.understanding) ? "blocked" : "satisfied", needs: "environment", because: UNREAD.includes(r.understanding) ? `nothing could read what this checkout needs to run (${r.understanding})` : undefined, receipt: { domain: DOMAIN.RUNTIME, ref: "understanding", outcome: r.understanding, summary: clip(`${r.components.length} component(s), ${r.startable.length} startable · checks: ${r.checks.map((c) => c.purpose).join(", ") || "none declared"}`) } };
}

// A registered playbook's receipt: REUSED is said in its summary (the version in place answered, nothing new was
// written), never as a word of its own -- the outcome is the status the playbook has.
const registeredSummary = (r) => clip(`${r.reused ? "reused: " : ""}verified and ${r.status}: ${r.summary}`);

async function registerRun(ports, lw, step) {
  const draft = draftOf(lw, step);
  if (!draft) return { verdict: "unreadable", receipt: null, because: "no draft playbook was proposed by this workflow" };
  const r = await ports.factory.register(draft, { task: lw.id });
  return { verdict: r.ok ? "satisfied" : "violated", because: r.ok ? undefined : clip(r.findings.map((f) => f.id).join(", ")), receipt: { domain: DOMAIN.SKILL, ref: r.ok ? r.pin : draft, outcome: r.ok ? r.status.toUpperCase() : "REFUSED", summary: r.ok ? registeredSummary(r) : clip(`refused: ${r.findings.map((f) => f.says).join("; ")}`) } };
}

export const ENGINE = {
  requirement: requirementRun,
  context: contextRun,
  runtime: runtimeRun,
  regression: async (ports, lw) => fromChild(ports, lw),
  review: async (ports, lw) => fromChild(ports, lw),
  "register-skill": registerRun,
};

// ---- before a host takes over ----------------------------------------------------------------------

// The engineering step starts (or picks up) the child task first, so the host is told which one to drive.
async function childStarted(ports, lw, budget) {
  const got = await ports.child.start({ ref: lw.ref ?? undefined, objective: lw.view.task.objective, minutes: budget.minutes ?? undefined, parent: lw.id });
  return { receipts: [{ domain: DOMAIN.TASK, ref: got.task, outcome: got.created ? "STARTED" : "RESUMED", summary: clip(`engineering task ${got.created ? "started" : "picked up"} for this workflow`) }] };
}

// The capability a draft step is for: its own (1.8.6), else -- a plan an earlier release made -- its plan's one
// playbook step's.
const draftFor = (lw, step) => step.for;

// A propose-skill step scaffolds the draft the host is asked to write -- with the provided capabilities the plan
// says it composes as its needs, which the host may change -- and says the draft's shape.
async function draftScaffolded(ports, lw, budget, step) {
  const got = await ports.factory.scaffold({ provides: draftFor(lw, step), task: lw.id, ...(step.needs?.length ? { needs: step.needs } : {}) });
  return { shape: got.shape ?? null, receipts: [{ domain: DOMAIN.SKILL, ref: got.id, outcome: "DRAFT", summary: clip(`draft playbook ${got.id} scaffolded for ${got.provides}${got.shape ? ` (${got.shape})` : ""}`) }] };
}

export const BEFORE_HOST = { engineering: childStarted, "propose-skill": draftScaffolded };

// ---- what the host is told ---------------------------------------------------------------------------

const ENGINE_CLI = "node <engine>/cli";

const envNote = (values) => (values.execution.environment === "sandbox" ? " — a person requires the change to run in the task's own sandbox" : "");

const INVOKE = {
  engineering: (c) => (c.mode === "agent" ? `dispatch the ${c.provider.id} agent with: resume ${c.child} — run every Orbit command from this checkout and return the task id${envNote(c.values)}` : `drive the engineering task ${c.child} here, one step at a time: ${ENGINE_CLI}/autonomous-engineering.mjs context ${c.child}, then step it until it completes or stops${envNote(c.values)}`),
  qa: (c) => `${c.mode === "agent" ? `dispatch the ${c.provider.id} agent to investigate` : `run the ${c.provider.id} skill on`} the change of ${c.child ?? "this workflow"}${c.sandbox ? ` in its sandbox ${c.sandbox} (autonomous-qa plan --sandbox=${c.sandbox})` : ""}, against the objective${envNote(c.values)}`,
  requirement: (c) => `run the ${c.provider.id} skill on ${c.ref ?? "the requirement"}: settle it and freeze one snapshot`,
  "propose-skill": (c) => `write the draft playbook ${c.draft}: an instruction-only SKILL.md that uses only what is provided here${c.shape ? ` — a ${c.shape} playbook: ${SHAPE_SAY[c.shape] ?? SHAPE_SAY.procedure}` : ""}; it serves every task that needs it, so where a record goes it writes <task> or <work>, never this task's id, then ${ENGINE_CLI}/skill-factory.mjs put ${c.draft} <file>`,
  playbook: (c) => (c.mode === "playbook" ? `read the project playbook with ${ENGINE_CLI}/skill-factory.mjs show ${c.pin} and follow it, in this session` : `run the ${c.provider.id} skill on the objective`),
};

// What a host is told a drafted playbook must be, by its shape (src/skill-factory/gap.mjs SHAPES) -- the
// sentence the contract it is registered against holds it to.
const SHAPE_SAY = {
  verification: "every check names the record a listed Orbit command reads back, and it ends with each check as checked, failed or needs a person",
  composition: "it composes the provided capabilities it needs, in order, and says which one each step used and what it answered",
  procedure: "a procedure over what is provided here, step by step, ending with what still needs a person",
};

const expectsOf = (kind) => kind.domains.map((d) => `${d}:<id>`);

// The draft a step of this workflow scaffolded: a skill receipt that names an id, not a pinned version, linked by
// the draft step for the same capability (a plan may draft for several); with none, the latest one.
const draftStepOf = (lw, step) => lw.states?.find((s) => s.kind === "propose-skill" && (s.for === step.for)) ?? null;

const drafts = (view) => view.receipts.filter((r) => r.domain === DOMAIN.SKILL && !r.ref.includes(":"));

const draftOf = (lw, step) => ((p) => drafts(lw.view).filter((r) => !p?.action || r.action === p.action).at(-1)?.ref ?? null)(draftStepOf(lw, step));

const pinOf = (view, provider) => view.receipts.filter((r) => r.domain === DOMAIN.SKILL && r.ref.startsWith(`${provider.id}:`)).at(-1)?.ref ?? provider.pin ?? provider.id;

export function howOf(ports, lw, step, kind, dispatch, values, extra = {}) {
  const child = childOf(lw.view);
  const c = { ...dispatch, child, values, ref: lw.ref, sandbox: kind.id === "qa" ? sandboxOf(ports, child) : null, draft: draftOf(lw, step), shape: extra.shape ?? null, pin: dispatch.mode === "playbook" ? pinOf(lw.view, dispatch.provider) : null };
  return { mode: dispatch.mode, provider: dispatch.provider, invoke: (INVOKE[kind.id] ?? INVOKE.playbook)(c), expects: expectsOf(kind), settle: `${ENGINE_CLI}/automation.mjs settle ${lw.id} with the evidence it names` };
}
