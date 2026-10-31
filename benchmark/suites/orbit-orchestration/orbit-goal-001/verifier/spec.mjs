// THE SPEC of ORBIT-GOAL-001: a goal moves on past a unit whose task ENDED. One work unit is planned per kind, each
// waiting for the one before it (skills/orbit/SKILL.md); stepping the goal starts the next unit's coordinated workflow
// and links its task, and resuming the goal settles every unit whose task has ended -- the task views spell a
// lifecycle COMPLETED, FAILED or CANCELLED (src/task/model.mjs) -- so the next unit becomes what may start
// (src/goal/execute.mjs, src/goal/resume.mjs). Written from that contract, never from the code; kept beside the probe
// and handed to no runner, and it never imports the subject.
//
// Every check is a goal and a script -- step the goal, end a unit's task with a lifecycle, resume the goal -- played by
// the probe through the subject's own commands over a real goal store, and an expectation over what the goal's journal
// then says: `unit:<kind>:<state>` for each unit, `frontier:<kind>` for what may start next, `life:<lifecycle>` for the
// goal. A cancelled task's unit is held only to what the contract says of it: it is neither running nor completed,
// and nothing after it starts.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-GOAL-001";

export const GROUPS = {
  "completed-advances": "resuming a goal settles a unit whose task COMPLETED, and the next unit becomes what may start",
  "failed-stops": "resuming a goal settles a unit whose task FAILED as failed, and nothing after it starts",
  "cancelled-stops": "resuming a goal settles a unit whose task was CANCELLED: neither running nor completed, and nothing after it starts",
  "still-running": "a unit whose task has not ended -- running, paused, blocked or waiting for a person -- stays running, and nothing after it starts",
  "unread": "a task that ended changes nothing until the goal is resumed",
  "repeated-resume": "resuming the goal again changes nothing more",
  "whole-chain": "a goal whose units' tasks all completed, each settled on resume, has nothing left to start and is verifying",
  "seeded-chain": "random goals and endings of their units' tasks: every unit's state, what may start next and the goal's lifecycle",
};

// The work kinds, in the engine's own order; a procedure is left out (it would need a capability to name).
export const KINDS = ["analyze", "change", "investigate", "verify"];

const STATES = ["ready", "planned", "running", "completed", "failed"];

const LIVES = ["ready", "running", "blocked", "verifying", "waiting-input"];

// ---- the reference model: the contract, as a simulation ------------------------------------------------------------

const initial = (kinds) => ({ units: KINDS.filter((k) => kinds.includes(k)).map((kind, i) => ({ kind, state: i ? "planned" : "ready", task: null, cancelled: false })), tasks: {}, started: 0 });

const isDone = (u) => u.state === "completed";

// What may start next: a unit not yet started whose unit before it completed.
export const frontierIndex = (w) => w.units.findIndex((u, i) => ["ready", "planned"].includes(u.state) && (i === 0 || isDone(w.units[i - 1])));

const ENDED_BADLY = ["FAILED", "CANCELLED"];

// A unit, once the goal reads its task's lifecycle: completed when the task completed, failed when it failed or was
// cancelled while the unit ran, as it was otherwise.
const settledRef = (u, lifecycle) => (lifecycle === "COMPLETED" && !isDone(u) ? { ...u, state: "completed" } : ENDED_BADLY.includes(lifecycle) && u.state === "running" ? { ...u, state: "failed", cancelled: lifecycle === "CANCELLED" } : u);

const started = (w, i, n) => ({ ...w, started: n, tasks: { ...w.tasks, [n]: "EXECUTING" }, units: w.units.map((u, j) => (j === i ? { ...u, state: "running", task: n } : u)) });

const SIM = {
  step: (w) => started(w, frontierIndex(w), w.started + 1),
  end: (w, op) => ({ ...w, tasks: { ...w.tasks, [op.task]: op.lifecycle } }),
  resume: (w) => ({ ...w, units: w.units.map((u) => (u.task ? settledRef(u, w.tasks[u.task]) : u)) }),
};

export const playRef = (kinds, ops) => ops.reduce((w, op) => SIM[op.op](w, op), initial(kinds));

const LIFE = [
  { name: "running", when: (w) => w.units.some((u) => u.state === "running") },
  { name: "blocked", when: (w) => w.units.some((u) => u.state === "failed") },
  { name: "verifying", when: (w) => w.units.every(isDone) },
  { name: "ready", when: () => true },
];

export const lifeRef = (w) => LIFE.find((r) => r.when(w)).name;

const unitHas = (u) => (u.cancelled ? [] : [`unit:${u.kind}:${u.state}`]);

const unitLacks = (u) => STATES.filter((s) => (u.cancelled ? s !== "failed" : s !== u.state)).map((s) => `unit:${u.kind}:${s}`);

const frontierOf = (w) => (frontierIndex(w) === -1 ? [] : [w.units[frontierIndex(w)].kind]);

const lifeHas = (w) => (w.units.some((u) => u.cancelled) ? [] : [`life:${lifeRef(w)}`]);

const lifeLacks = (w) => (w.units.some((u) => u.cancelled) ? ["life:running"] : LIVES.filter((l) => l !== lifeRef(w)).map((l) => `life:${l}`));

export function expectOf(kinds, ops) {
  const w = playRef(kinds, ops);
  const front = frontierOf(w);
  return { has: [...w.units.flatMap(unitHas), ...front.map((k) => `frontier:${k}`), ...lifeHas(w)], lacks: [...w.units.flatMap(unitLacks), ...w.units.filter((u) => !front.includes(u.kind)).map((u) => `frontier:${u.kind}`), ...lifeLacks(w)] };
}

// ---- the scripts ------------------------------------------------------------------------------------------------------

const step = { op: "step" };
const resume = { op: "resume" };
const end = (task, lifecycle) => ({ op: "end", task, lifecycle });

const goal = (group, workKinds, ops) => ({ group, input: { call: "goal", workKinds, ops }, expect: expectOf(workKinds, ops) });

const PAIR = ["change", "verify"];
const CHAIN = ["analyze", "change", "verify"];

const FIXED = [
  goal("completed-advances", PAIR, [step, end(1, "COMPLETED"), resume]),
  goal("completed-advances", ["investigate", "verify"], [step, end(1, "COMPLETED"), resume]),
  goal("completed-advances", CHAIN, [step, end(1, "COMPLETED"), resume, step, end(2, "COMPLETED"), resume]),
  goal("failed-stops", PAIR, [step, end(1, "FAILED"), resume]),
  goal("failed-stops", CHAIN, [step, end(1, "COMPLETED"), resume, step, end(2, "FAILED"), resume]),
  goal("cancelled-stops", PAIR, [step, end(1, "CANCELLED"), resume]),
  goal("cancelled-stops", CHAIN, [step, end(1, "COMPLETED"), resume, step, end(2, "CANCELLED"), resume]),
  goal("still-running", PAIR, [step, resume]),
  goal("still-running", PAIR, [step, end(1, "PAUSED"), resume]),
  goal("still-running", PAIR, [step, end(1, "BLOCKED"), resume]),
  goal("still-running", PAIR, [step, end(1, "WAITING_APPROVAL"), resume]),
  goal("unread", PAIR, [step, end(1, "COMPLETED")]),
  goal("unread", PAIR, [step, resume, end(1, "COMPLETED"), resume]),
  goal("repeated-resume", PAIR, [step, end(1, "COMPLETED"), resume, resume, resume]),
  goal("repeated-resume", PAIR, [step, end(1, "FAILED"), resume, resume]),
  goal("whole-chain", ["verify"], [step, end(1, "COMPLETED"), resume]),
  goal("whole-chain", CHAIN, [step, end(1, "COMPLETED"), resume, step, end(2, "COMPLETED"), resume, step, end(3, "COMPLETED"), resume]),
];

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const FATES = ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "FAILED", "CANCELLED", "EXECUTING", "PAUSED", "BLOCKED"];

const fateOps = (r, task, fate) => [...(fate === "EXECUTING" ? [] : [end(task, fate)]), ...(r() < 0.85 ? [resume] : []), ...(r() < 0.2 ? [resume] : [])];

// A unit's task is started, and ends some way; the goal goes on only past one that completed and was read.
function seededOps(r, n, i = 0) {
  if (i >= n || (i > 0 && r() < 0.1)) return [];
  const fate = pick(r, FATES);
  const ops = [step, ...fateOps(r, i + 1, fate)];
  return fate === "COMPLETED" && ops.includes(resume) ? [...ops, ...seededOps(r, n, i + 1)] : ops;
}

const seededKinds = (r) => ((kinds) => (kinds.length > 1 ? kinds : ["change", "verify"]))(KINDS.filter(() => r() < 0.6));

const seeded = (r) => ((kinds) => goal("seeded-chain", kinds, seededOps(r, kinds.length)))(seededKinds(r));

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(8, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const unitsSay = (w) => w.units.map((u) => `${u.kind}:${u.state}`).join(" ");

const HAND = [
  ["a change whose task completed, read on resume", PAIR, [step, end(1, "COMPLETED"), resume], "change:completed verify:planned", ["verify"], "ready"],
  ["a change whose task failed", PAIR, [step, end(1, "FAILED"), resume], "change:failed verify:planned", [], "blocked"],
  ["a change whose task still runs", PAIR, [step, resume], "change:running verify:planned", [], "running"],
  ["a change whose task completed, never read", PAIR, [step, end(1, "COMPLETED")], "change:running verify:planned", [], "running"],
  ["a whole chain completed", CHAIN, [step, end(1, "COMPLETED"), resume, step, end(2, "COMPLETED"), resume, step, end(3, "COMPLETED"), resume], "analyze:completed change:completed verify:completed", [], "verifying"],
  ["a goal nobody stepped", PAIR, [], "change:ready verify:planned", ["change"], "ready"],
];

export const selfTest = () => HAND.filter(([, kinds, ops, units, front, life]) => ((w) => unitsSay(w) !== units || JSON.stringify(frontierOf(w)) !== JSON.stringify(front) || lifeRef(w) !== life)(playRef(kinds, ops))).map(([say]) => `the reference model disagrees with the contract on: ${say}`);
