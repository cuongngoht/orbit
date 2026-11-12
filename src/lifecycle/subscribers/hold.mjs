// THE STOP HOLD (0.5.0, B22 M3, ADR 0050): the one place Orbit keeps the model going -- when the session stops while
// its OWN coordinated workflow or goal is still running with a step ready, the turn is held open once, with a reason
// that names the ready step(s) and the one command that says how to take the next, or asks the model to say why it
// stops. No hook can make the model call a tool; a hold only says what the owner's journal already says is next.
//
// It holds only when EVERY row of HOLD lets it, in order, cheapest first -- so a turn that ran no workflow command costs
// a bounded read of the trail and nothing else, and a session that ran none of Orbit at all costs less:
//
//   the host can hold a turn at all (only an adapter with `formatHold`: Claude Code's)
//   the turn is not one a Stop hook already kept going (`held`: Claude Code's stop_hook_active)
//   the trail can count this prompt's holds -- trace on, this prompt's own event found, and no earlier Stop of it that
//     was not held: a Stop the trail cannot place is never held
//   fewer than MAX_HOLDS holds this prompt
//   the prompt carried no halt cue (its MARKS, src/routing/intents.mjs: stop, wait, pause, dừng …)
//   this turn ran one of a workflow's own commands (WORKFLOW_COMMANDS) -- a turn that only answered a question never is
//   a person kept `trigger.holdOnStop` on (an automation setting, machine then project, written only in Orbit Control)
//   the session holds a workflow or a goal of its OWN (src/live/association.mjs, `created.session`)
//   it is running: never PAUSED, CANCELLED, WAITING for a person's approval or answer, BLOCKED, stopping or ended
//   its own fold has a step ready
//
// What it writes is one `turn.held` (the trail, through `world.held`) and nothing else; it grants, approves, resumes
// and starts nothing, and a person's interrupt never reaches it (Claude Code runs no Stop hook on one). Every fact is a
// port the composition root (cli/follow-hook.mjs) binds, read only when its row is reached; a port that fails answers
// null, and a row that cannot tell never holds.
import { holdReason } from "../owners.mjs";

export const MAX_HOLDS = 2;

// A Stop's end of turn (written by the async Stop hook beside this one) and its hold land within a moment of each
// other: an end with no hold this close to it is a Stop that was not held -- the turn ended, and a Stop after it belongs
// to a prompt the trail never heard of.
export const PAIRED_MS = 10_000;

// What a turn ran that a workflow's own loop runs (trail `command.ran`): its start, a step, a settle.
export const WORKFLOW_COMMANDS = [
  { orbit: "cli/automation", subs: ["start", "step", "settle"] },
  { orbit: "cli/orbit", subs: ["goal"], ops: ["start", "step", "settle"] },
];

// Where a governed work stands, when it is not running (cli/governed.mjs STATES): never held past any of these.
export const NOT_RUNNING = ["paused", "cancelled", "waiting", "blocked", "stopping", "ended"];

const commandOf = (e) => e.type === "command.ran" && WORKFLOW_COMMANDS.some((c) => c.orbit === e.data?.orbit && c.subs.includes(e.data?.sub) && (!c.ops || c.ops.includes(e.data?.op)));

const near = (a, b) => Math.abs(Date.parse(a.at) - Date.parse(b.at)) <= PAIRED_MS;

// An end of this turn that is not this Stop's own (older than a moment) and that no hold answered.
const unheldEnd = (t, nowMs) => t.events.some((e) => (e.type === "session.ended" || (e.type === "turn.ended" && nowMs - Date.parse(e.at) > PAIRED_MS && !t.events.some((h) => h.type === "turn.held" && near(h, e)))));

// The trail's word on this turn: { holds, marks, ran, events } -- or null when nobody can say which turn this Stop ends.
const turnOf = (t, nowMs) => (t?.prompt && !unheldEnd(t, nowMs) ? { holds: t.events.filter((e) => e.type === "turn.held").length, marks: t.prompt.data?.marks ?? [], ran: t.events.some(commandOf), events: t.events } : null);

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = fn()));
}

// The facts a row may ask for, each read only when a row reaches it. Shared with the owed hold (owed.mjs), which reads
// the same turn through the same rows.
export const factsOf = (event, world) => ({ event, world, turn: once(() => turnOf(world.turn?.() ?? null, world.nowMs())), settings: once(() => world.settings?.() ?? null), owner: once(() => world.governed?.() ?? null) });

// The rows EVERY Stop hold is held to first, whatever it holds for (0.6.0: this one and owed.mjs): the host can hold,
// the turn is not one a Stop hook already kept going, the trail can count this prompt's holds, fewer than MAX_HOLDS of
// them, and no halt cue.
export const GUARDS = [
  { row: "host-cannot-hold", when: (f) => typeof f.world.host?.formatHold !== "function" },
  { row: "held-already", when: (f) => f.event.held === true },
  { row: "uncounted", when: (f) => !f.turn() },
  { row: "spent", when: (f) => f.turn().holds >= MAX_HOLDS },
  { row: "halted", when: (f) => f.turn().marks.includes("halt") },
];

// Why a turn is NOT held, cheapest first: the first row that holds decides, and the last always does.
export const HOLD = [
  ...GUARDS,
  { row: "no-workflow-command", when: (f) => !f.turn().ran },
  { row: "switched-off", deep: true, when: (f) => f.settings()?.trigger?.holdOnStop !== true },
  { row: "no-governed-work", deep: true, when: (f) => !f.owner() },
  { row: "not-running", when: (f) => NOT_RUNNING.includes(f.owner().state) },
  { row: "nothing-ready", when: (f) => !(f.owner().ready ?? []).length },
  { row: "hold", holds: true, when: () => true },
];

export const HOLD_ROWS = HOLD.map((r) => r.row);

// The row that decides this Stop.
export const holdRowOf = (event, world) => ((f) => HOLD.find((r) => r.when(f)))(factsOf(event, world));

// Whether this Stop gets as far as a row that reads the owners' records (`deep`): what lets the composition root load
// them only for a turn that ran a workflow's command, and answer every other Stop at once.
export const needsOwners = (event, world) => ((f) => HOLD.find((r) => r.deep || r.when(f))?.deep === true)(factsOf(event, world));

export const hold = {
  name: "hold",
  on: ["turn-end"],
  records: false,
  run: (event, world) => ((f) => (HOLD.find((r) => r.when(f)).holds ? held(f) : null))(factsOf(event, world)),
};

function held(f) {
  const owner = f.owner();
  const count = f.turn().holds + 1;
  f.world.held?.({ kind: "workflow", task: owner.id, steps: owner.ready.slice(0, 8), count });
  return f.world.host.formatHold(holdReason(owner, count, MAX_HOLDS, f.world.engine), f.world.input);
}
