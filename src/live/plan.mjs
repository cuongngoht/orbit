// What a viewer reads of a coordinated workflow's PLAN (1.8.6, ADR 0022): each step with where it stands, how much of
// the plan is DONE on its own contract, every revision and why, and what the skill factory is doing for each
// capability it drafts. Pure: the plan is the projection its source made (src/automation/source.mjs, handed in by a
// composition root), where each step stands is the step's own receipt in the task's journal, and nothing here reads
// a file. With no projection -- a task from before 1.8.6, an artifact gone -- the steps and the revisions are read off
// the receipts the coordinator wrote, and what those cannot say is said to be unknown.
//
//   stepsOf(plan, view) -> [{ id, kind, after, for, because, strict, outcome, action, summary, at }]
//   progressOf(steps) -> { done, verified, reported, total } | null     done on each step's own contract
//   replansOf(plan, view) -> [{ n, trigger, response, step, summary }]
//   skillsOf(plan, view) -> [{ capability, drafted, checked, registered, followed, pin, reused, summary }]
const receiptsOf = (view, domain) => (view?.receipts ?? []).filter((r) => r.domain === domain);

const stepReceipt = (view, id) => receiptsOf(view, "step").find((r) => r.ref === id) ?? null;

const PLAN = /(\d+) step\(s\): (.+)$/;

// A step a receipt names when the plan cannot be read: its id is all that is known.
const fromReceipts = (view) => ((m) => [...new Set([...(m ? m[2].split(",").map((s) => s.trim().replace(/…$/, "")).filter(Boolean) : []), ...receiptsOf(view, "step").map((r) => r.ref)])].map((id) => ({ id, kind: id.split(".")[0], after: [], for: null, because: null, strict: null })))(PLAN.exec(receiptsOf(view, "plan").filter((r) => r.outcome === "ACTIVE").at(-1)?.summary ?? ""));

const withState = (view) => (s) => ((r) => ({ ...s, outcome: r?.outcome ?? "PENDING", action: r?.action ?? null, summary: r?.summary ?? null, at: r?.at ?? null }))(stepReceipt(view, s.id));

export const stepsOf = (plan, view) => (plan?.steps?.length ? plan.steps : fromReceipts(view)).map(withState(view));

// Done on its own contract (src/automation/plan.mjs doneFor): succeeded or skipped, or -- for a step whose kind may
// stand on a report -- reported. A strict step that succeeded was VERIFIED on its owner's record.
export const doneOn = (s) => ["SUCCEEDED", "SKIPPED"].includes(s.outcome) || (s.outcome === "REPORTED" && s.strict === false);

export const progressOf = (steps) => (steps.length ? { done: steps.filter(doneOn).length, verified: steps.filter((s) => s.strict === true && s.outcome === "SUCCEEDED").length, reported: steps.filter((s) => s.outcome === "REPORTED").length, total: steps.length } : null);

// ---- revisions ---------------------------------------------------------------------------------------------

const REVISED = /^plan-(\d+) \([^,)]+(?:, after ([A-Z_]+) at ([^)]+))?\)/;

const fromSummary = (r) => ((m) => (m && Number(m[1]) > 1 ? { n: Number(m[1]), trigger: m[2] ?? null, response: null, step: m[3] ?? null, summary: null } : null))(REVISED.exec(r.summary ?? ""));

export const replansOf = (plan, view) => (plan ? plan.replans ?? [] : receiptsOf(view, "plan").map(fromSummary).filter(Boolean));

// ---- the skill factory, per capability a draft is planned for ---------------------------------------------------

const ofKind = (steps, kind, capability) => steps.find((s) => s.kind === kind && (s.for ?? null) === capability) ?? null;

// The skill receipt an action of this workflow linked: the draft a draft step wrote, the version a register step
// registered -- matched by the action, so two capabilities' drafts are never confused.
const skillBy = (view, action) => (action ? receiptsOf(view, "skill").filter((r) => r.action === action).at(-1) ?? null : null);

// One capability's generation, in the order it moves: the draft written, held to the contract, registered (or the
// version in place reused), followed. A word the journal has not said yet stays null -- never filled in.
const capabilityRow = (steps, view) => (p) => {
  const reg = ofKind(steps, "register-skill", p.for ?? null);
  const play = ofKind(steps, "playbook", p.for ?? null) ?? steps.find((s) => s.kind === "playbook") ?? null;
  const draft = skillBy(view, p.action);
  const version = skillBy(view, reg?.action);
  return { capability: p.for ?? play?.for ?? play?.provides ?? null, drafted: p.outcome, checked: draft?.outcome ?? null, registered: version?.outcome ?? reg?.outcome ?? "PENDING", followed: play?.outcome ?? null, pin: version?.ref?.includes(":") ? version.ref : null, reused: /^reused: /.test(version?.summary ?? ""), summary: version?.summary ?? draft?.summary ?? null };
};

export const skillsOf = (plan, view) => ((steps) => steps.filter((s) => s.kind === "propose-skill").slice(0, 10).map(capabilityRow(steps, view)))(stepsOf(plan, view));

// ---- a declared playbook's runs (0.0.4) ----------------------------------------------------------------------------
//
// Every run a playbook step carried: its pinned version, where it stands, and each step of its workflow as the task's
// own receipts say -- the word its `skillstep` receipt carries, the action it started (when, for how long, through
// which tool), the provider its calls went through, how often it was asked again, the approval it waits for, the
// verification its owner's record linked, and the receipts it rests on. The workflow's own shape (what each step asks,
// what it waits for) is the projection the skill source made from the PINNED version; without it the steps are the
// ones the receipts name, and the run says its workflow could not be read. Nothing is filled in: a step nothing
// recorded is PENDING, and a run is VERIFIED only on the word its own receipt carries.
//
//   skillRunsOf(plan, view, events, skills) -> [{ run, pin, step, word, state, unread, steps, calls, at }]
//     step: { id, capability, tool, required, evidence, approval, word, because, provider, action, startedAt, endedAt,
//             calls, retries, waiting, verification, receipt, invocation }

const lines = (events, domain) => (events ?? []).filter((e) => e.kind === "receipt" && e.domain === domain);

const actionOf = (view, id) => (view?.actions ?? []).find((a) => a.id === id) ?? null;

// The plan step a run belongs to: the step whose receipt names the run's action, else the step its action is labelled for.
const ownerOf = (plan, view, r) => stepsOf(plan, view).find((s) => s.action && s.action === r.action)?.id ?? (String(actionOf(view, r.action)?.label ?? "").split(":")[0] || null);

const projectedSteps = (skills, pin) => skills?.[pin]?.steps ?? null;

const namedSteps = (view, run) => [...new Set(receiptsOf(view, "skillstep").filter((r) => r.ref.startsWith(`${run}.`)).map((r) => r.ref.slice(run.length + 1)))].map((id) => ({ id, capability: null, tool: null, required: null, evidence: null, approval: null }));

const callsOf = (events, ref) => lines(events, "invocation").filter((e) => e.ref.startsWith(`${ref}.`));

const attemptsOf = (events, ref) => (events ?? []).filter((e) => e.kind === "action-started" && e.type === "skill.step" && String(e.label ?? "").startsWith(`${ref}:`)).length;

const providerOf = (events, ref) => [...lines(events, "skillstep").filter((e) => e.ref === ref), ...callsOf(events, ref)].filter((e) => e.providerKey).at(-1)?.providerKey ?? null;

const waitingOf = (view, id) => (view?.approvals ?? []).find((a) => a.open && String(a.reason ?? "").startsWith(`${id} of `))?.id ?? null;

const verificationOf = (view, ref) => ((v) => (v ? { state: v.state, evidence: v.evidence ?? null } : null))((view?.verification ?? []).find((v) => v.subject === `skillstep:${ref}`));

function runStep(view, events, run) {
  return (s) => {
    const ref = `${run}.${s.id}`;
    const r = receiptsOf(view, "skillstep").find((x) => x.ref === ref) ?? null;
    const a = ((x) => (x?.type === "skill.step" ? x : null))(actionOf(view, r?.action));
    return { ...s, word: r?.outcome ?? "PENDING", because: r?.summary ?? null, provider: providerOf(events, ref), action: a?.id ?? null, tool: s.tool ?? a?.tool ?? null, startedAt: a?.startedAt ?? null, endedAt: a?.endedAt ?? null, calls: callsOf(events, ref).length, retries: Math.max(0, callsOf(events, ref).length - attemptsOf(events, ref)), waiting: waitingOf(view, s.id), verification: verificationOf(view, ref), receipt: r ? `skillstep:${ref}` : null, invocation: ((c) => (c ? `invocation:${c.ref}` : null))(callsOf(events, ref).at(-1)) };
  };
}

const SETTLED = ["VERIFIED", "CONTRACT_MET", "VERIFY_FAILED", "FAILED", "REFUSED", "BLOCKED", "SKIPPED", "INTERRUPTED", "AMBIGUOUS"];

// Where a run stands, from its own word and its steps': a run still open is BINDING before any step said anything,
// RUNNING while one runs, VERIFYING once every step settled and before the run did; a run that settled says its word.
const RUN_STATE = [
  { when: (r) => r.word !== "RUNNING", state: (r) => r.word },
  { when: (r) => r.steps.some((s) => s.word === "RUNNING"), state: () => "RUNNING" },
  { when: (r) => r.steps.every((s) => s.word === "PENDING"), state: () => "BINDING" },
  { when: (r) => r.steps.every((s) => SETTLED.includes(s.word)), state: () => "VERIFYING" },
  { when: () => true, state: () => "RUNNING" },
];

const runOf = (plan, view, events, skills) => (r) => ((steps) => ((run) => ({ ...run, state: RUN_STATE.find((x) => x.when(run)).state(run) }))({ run: r.ref, pin: r.pin ?? null, step: ownerOf(plan, view, r), word: r.outcome ?? "RUNNING", unread: !projectedSteps(skills, r.pin), steps, calls: steps.reduce((n, s) => n + s.calls, 0), at: r.at ?? null, summary: r.summary ?? null }))((projectedSteps(skills, r.pin) ?? namedSteps(view, r.ref)).map(runStep(view, events, r.ref)));

export const skillRunsOf = (plan, view, events, skills) => receiptsOf(view, "skillrun").slice(0, 8).map(runOf(plan, view, events, skills));

// ---- the plan as every viewer reads it (0.0.4) -------------------------------------------------------------------

// A step's state, in a word its evidence earns: a strict step SUCCEEDED was VERIFIED on its owner's record; one that
// may stand on a report and did is DONE, or REPORTED when that is all it has. The words every viewer shows, one table.
export const STEP_STATE_WORDS = [
  { when: (s) => s.outcome === "SUCCEEDED" && s.strict === true, word: "VERIFIED" },
  { when: (s) => s.outcome === "SUCCEEDED", word: "DONE" },
  { when: (s) => s.outcome === "REPORTED", word: "REPORTED" },
  { when: (s) => s.outcome === "RUNNING", word: "RUNNING" },
  { when: (s) => s.outcome === "FAILED", word: "FAILED" },
  { when: (s) => s.outcome === "BLOCKED", word: "BLOCKED" },
  { when: (s) => s.outcome === "SKIPPED", word: "SKIPPED" },
  { when: () => true, word: "PENDING" },
];

export const stepWordOf = (s) => STEP_STATE_WORDS.find((r) => r.when(s)).word;

// The goal and unit a workflow was started for, as its own `goal:` receipt names them.
export const goalOf = (view) => ((r) => (r ? { goal: r.ref.split(":")[0], unit: r.ref.split(":")[1] ?? null } : null))(receiptsOf(view, "goal").at(-1));

const shownStep = (s) => ({ id: s.id, kind: s.kind, after: s.after, for: s.for ?? null, because: s.because ?? null, state: stepWordOf(s), summary: s.summary ?? null, at: s.at ?? null });

// The ONE projection of a workflow's plan a page, a pane and a terminal share: its steps in their words, its progress,
// its revisions, the factory's work, every declared run and the goal it serves -- `readable: false` when the plan
// artifact could not be read and the steps are the ones its receipts name.
export const planViewOf = (plan, view, events, skills) => ((steps) => ({ ref: plan?.ref ?? null, n: plan?.n ?? null, workflow: plan?.workflow ?? null, readable: Boolean(plan), goal: goalOf(view), steps: steps.map(shownStep), progress: progressOf(steps), replans: replansOf(plan, view), skills: skillsOf(plan, view), runs: skillRunsOf(plan, view, events, skills) }))(stepsOf(plan, view));
