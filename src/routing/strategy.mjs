// HOW MUCH ORBIT a prompt needs (0.5.0, B22, ADR 0050): ONE ordered table over facts the composition root hands in.
// The first row that matches decides and the last always does, like orbit-help's ROUTES (src/help/vocab.mjs). It
// answers ONE word -- NONE · DIRECT · COORDINATED · SATELLITE · RESUME -- with the row that chose it, a reason built
// from table words, requirement names and ids, and the ACTIVATION: the path the host takes (a skill, an agent, a
// coordinated workflow, a goal, a mission, a resume, or none), what it names, and the one way to invoke it.
//
// A LEAF: it imports nothing, and nothing here reads a disk, a clock or the prompt. src/routing/resolve.mjs `decide`
// hands it what the resolver chose and who coordinates here; the router subscriber hands it what the composition root
// (cli/router-hook.mjs) bound:
//
//   synthetic  the host adapter marked the prompt as the host's own envelope (a background task's notification)
//   asked      the classification (src/routing/classify.mjs): intent, matched, marks (opt-out · continue · halt),
//              shape counts, requirements
//   chosen     what the resolver chose that the session does not already have, in the order the request is about it:
//              { kind, id, key, ownership, requirement, via, gated } -- never an implicit provider or a built-in
//   doors      who opens a coordinated path here: { automation, goal } -> the usable skill that provides it, or null
//   workflow   automation's own `workflowOf` answer for the classification (src/automation/workflows.mjs), its id
//   host       the host's row (catalog/hosts.json): an agent is dispatched only where the host has native agents
//   work       this checkout's open work the prompt could mean (src/work/track/open.mjs): { named: [], current }, each
//              { id, open, owner: { what, id } | null }
//   settings   the automation settings: with `trigger.arbitraryPrompt` off the router never says COORDINATED
//   plugin     the namespace a host calls a component by, `<plugin>:<id>`
//
// It suggests; it never acts, and the host decides. SATELLITE is never inferred from words that merely sound
// complex: only Satellite's own signals choose mission.orchestration. RESUME needs an OPEN work an owner governs (a
// coordinated workflow, an engineering task, an investigation). COORDINATED needs a workflow that fits, the skill
// that opens it usable here, and a person who lets the router say so. A trivial edit answered DIRECT may be done with
// the host's own tools: DIRECT names the one specialist that fits, never a duty.

export const STRATEGY_WORDS = ["NONE", "DIRECT", "COORDINATED", "SATELLITE", "RESUME"];

export const ACTIVATION_PATHS = ["skill", "agent", "workflow", "goal", "mission", "resume", "none"];

// Who opens a coordinated path, by the capability the opening skill provides -- never by its name.
export const DOORS = { automation: "workflow.navigation", goal: "goal.orchestration" };

// A specification is a list this long, or carries the words of acceptance criteria (asked as goal.orchestration).
export const SPEC_ITEMS = 3;

// What a change spans to need several owners: a change, and a work item to settle or a verifier to prove it.
const CHANGE = ["development", "autonomous-engineering"];
const ITEM = ["requirements"];
const VERIFIER = ["investigation", "security"];

// A specification for a change, or for a work item: what the goal domain plans units from (orbit, design §5.3).
const SPECIFIES = ["development", "autonomous-engineering", "requirements"];

const COMMANDS = {
  automation: { path: "workflow", invoke: 'node <engine>/cli/automation.mjs start --for="<the task>"' },
  goal: { path: "goal", invoke: "node <engine>/cli/orbit.mjs goal start --stdin" },
};

const MISSION = "node <engine>/satellite/cli/satellite.mjs mission start --stdin";

// How each owner of an open work is picked up where it stands: reads that never un-pause and never resend a step.
export const RESUMES = {
  workflow: (id) => `node <engine>/cli/automation.mjs resume ${id}`,
  task: (id) => `node <engine>/cli/autonomous-engineering.mjs resume ${id}`,
  investigation: (id) => `node <engine>/cli/autonomous-qa.mjs context --investigation=${id}`,
};

const NONE = { path: "none", id: null, how: null, invoke: null };

// ---- facts, read -----------------------------------------------------------------------------------------

const marked = (f, mark) => (f.asked?.marks ?? []).includes(mark);

const chosen = (f) => f.chosen ?? [];

const matched = (f, ids) => ids.some((id) => (f.asked?.matched ?? []).includes(id));

const governed = (w) => Boolean(w?.open && RESUMES[w.owner?.what]);

const continued = (f) => (marked(f, "continue") && governed(f.work?.current) ? f.work.current : null);

const resumable = (f) => (f.work?.named ?? []).find(governed) ?? continued(f);

const mission = (f) => chosen(f).find((c) => c.requirement === "mission.orchestration") ?? null;

const fits = (f) => Boolean(f.workflow) && f.workflow !== "none" && f.settings?.trigger?.arbitraryPrompt === true;

const opens = (f, how) => fits(f) && Boolean(f.doors?.[how]);

const specified = (f) => ((f.asked?.requirements ?? []).includes(DOORS.goal) || (f.asked?.shape?.items ?? 0) >= SPEC_ITEMS) && SPECIFIES.includes(f.asked?.intent?.id);

const spans = (f) => matched(f, CHANGE) && (matched(f, ITEM) || (f.asked?.shape?.refs ?? 0) > 0 || matched(f, VERIFIER));

const component = (c) => c.kind === "skill" || c.kind === "agent";

// The component the request is most about: the first one chosen, in the order the classification put its needs.
const topOf = (f) => chosen(f).find(component) ?? null;

const dispatchable = (f, c) => c?.kind === "agent" && !(c.via ?? []).length && f.host?.capabilities?.nativeAgents === true;

const agentOf = (f) => (dispatchable(f, topOf(f)) ? topOf(f) : null);

const skillOf = (f) => chosen(f).find((c) => c.kind === "skill") ?? null;

// ---- answers ---------------------------------------------------------------------------------------------

const ns = (f) => f.plugin ?? "orbit";

// A project's generated playbook is never a native skill: it is printed and followed (src/skill-factory/).
const invokeSkill = (f, s) => (s.ownership === "project" ? `node <engine>/cli/skill-factory.mjs show ${s.id}` : `Skill ${ns(f)}:${s.id}`);

const skillPath = (f) => ((s) => (s ? { path: "skill", id: s.id, how: null, invoke: invokeSkill(f, s) } : NONE))(skillOf(f));

const agentPath = (f) => ((a) => ({ path: "agent", id: a.id, how: null, invoke: `Agent ${ns(f)}:${a.id}` }))(agentOf(f));

const coordinated = (how) => (f) => ({ path: COMMANDS[how].path, id: f.doors[how], how, invoke: COMMANDS[how].invoke });

const resumed = (f) => ((w) => ({ path: "resume", id: w.id, how: w.owner.what, invoke: RESUMES[w.owner.what](w.owner.id) }))(resumable(f));

const spanned = (f) => [...CHANGE, ...ITEM, ...VERIFIER].filter((id) => matched(f, [id])).join(", ");

const oneSkill = (f) => (skillOf(f) ? `one specialist provides ${skillOf(f).requirement}` : "no Orbit skill or agent is needed, and what is listed below may help");

export const STRATEGY = [
  { row: "envelope", word: "NONE", when: (f) => f.synthetic === true, because: () => "the host wrote this prompt itself, so nobody asked for anything" },
  { row: "opted-out", word: "NONE", when: (f) => marked(f, "opt-out"), because: () => "the prompt asks to work without Orbit" },
  { row: "resume", word: "RESUME", when: (f) => Boolean(resumable(f)), because: (f) => `open work ${resumable(f).id} is governed by ${resumable(f).owner.what} ${resumable(f).owner.id}`, activation: resumed },
  { row: "conversational", word: "NONE", when: (f) => !chosen(f).length, because: () => "nothing here needs what the session does not already have" },
  { row: "mission", word: "SATELLITE", when: (f) => Boolean(mission(f)), because: () => "a mission was asked for, in Satellite's own words", activation: (f) => ({ path: "mission", id: mission(f).id, how: null, invoke: MISSION }) },
  { row: "specification", word: "COORDINATED", when: (f) => opens(f, "goal") && specified(f), because: (f) => `a specification of a change: ${f.doors.goal} keeps it and plans its units`, activation: coordinated("goal") },
  { row: "several-owners", word: "COORDINATED", when: (f) => opens(f, "automation") && spans(f), because: (f) => `a change several owners take in turn (${spanned(f)}): ${f.doors.automation} starts the workflow`, activation: coordinated("automation") },
  { row: "one-agent", word: "DIRECT", when: (f) => Boolean(agentOf(f)), because: (f) => `one bounded job, ${agentOf(f).requirement}, for an agent of its own`, activation: agentPath },
  { row: "one-skill", word: "DIRECT", when: (f) => chosen(f).length > 0, because: oneSkill, activation: skillPath },
  { row: "nothing", word: "NONE", when: () => true, because: () => "nothing was chosen" },
];

// facts -> { strategy: { word, row, because }, activation: { path, id, how, invoke } }
export function strategyOf(facts) {
  const row = STRATEGY.find((r) => r.when(facts ?? {}));
  return { strategy: { word: row.word, row: row.row, because: row.because(facts ?? {}) }, activation: (row.activation ?? (() => NONE))(facts ?? {}) };
}
