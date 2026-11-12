// THE OWED HOLD (0.6.0, P3): a turn is not left unverified. When a session stops after editing code a component of
// this checkout owns, and no check passed after the edit, the turn is held open ONCE for this prompt, naming the safe
// check that component declares and its command -- or asking the model to say why it stops. No hook can make the model
// run anything, and this runs nothing: it says what the checkout already declares would verify the edit.
//
// It holds only when EVERY row of OWED lets it, in order, cheapest first -- so a turn that edited nothing, or ran a
// passing check after its last edit, costs a bounded read of the trail and nothing else:
//
//   the rows every Stop hold is held to first (hold.mjs GUARDS): the host can hold, the turn is not one a Stop hook
//     already kept going, the trail can count this prompt's holds, fewer than MAX_HOLDS of them, no halt cue
//   the trail says this turn edited (`tool.used` of an edit tool) and ran no check that passed after the last edit
//     (`command.ran` of a check class, ok) -- the cheap row: an ordinary turn loads no owner record past it
//   this prompt was not held for this reason already: once, never twice
//   the workflow hold (hold.mjs) does not speak for this Stop: one hold at a time, its own reason first
//   a person kept `trigger.holdUnverified` on (an automation setting, machine then project, written only in Control)
//   the session's governed work, if it has one, is not paused, cancelled or waiting for a person
//   the session's working set keeps an edit since the last passing check (`unverified.changed`) -- the async write of
//     the very last edit may not have landed yet: then nothing is held, never a guess
//   a component of runtime understanding's graph owns one of those files
//   it, or a component that depends on it, declares a SAFE verifying check (cli/governed.mjs `owed`)
//
// What it writes is one `turn.held` with `kind: "unverified"` and the check's id (the trail, through `world.held`) and
// nothing else. Every fact is a port the composition root (cli/follow-hook.mjs) binds, read only when its row is
// reached; a port that fails answers null, and a row that cannot tell never holds.
import { CHECKS } from "../../engineering/working-set/collect.mjs";
import { printable } from "../../printable.mjs";
import { clipped, named } from "../owners.mjs";
import { GUARDS, MAX_HOLDS, factsOf, holdRowOf } from "./hold.mjs";

// The governed work's states a person holds it in: never held past any of these (cli/governed.mjs STATES).
export const QUIET = ["paused", "cancelled", "waiting"];

const REASON_BYTES = 600;

const edited = (e) => e.type === "tool.used" && e.data?.kind === "edit" && e.data?.ok !== false;

const passed = (e) => e.type === "command.ran" && CHECKS.includes(e.data?.class) && e.data?.ok === true;

// The trail's cheap word: this turn edited, and no check passed after its last edit.
export const uncheckedEdit = (events) => ((last) => last >= 0 && !events.slice(last + 1).some(passed))(events.findLastIndex(edited));

const heldFor = (turn) => turn.events.some((e) => e.type === "turn.held" && e.data?.kind === "unverified");

const owedOf = (f) => f.owed();

// Why a turn is NOT held for an unverified edit, cheapest first: the first row that holds decides, and the last does.
export const OWED = [
  ...GUARDS,
  { row: "verified", when: (f) => !uncheckedEdit(f.turn().events ?? []) },
  { row: "said-already", when: (f) => heldFor(f.turn()) },
  { row: "workflow-holds", when: (f) => holdRowOf(f.event, f.world)?.holds === true },
  { row: "switched-off", deep: true, when: (f) => f.settings()?.trigger?.holdUnverified !== true },
  { row: "work-quiet", deep: true, when: (f) => QUIET.includes(f.work()?.state) },
  { row: "unrecorded", deep: true, when: (f) => !(owedOf(f)?.changed ?? []).length },
  { row: "unowned", when: (f) => !owedOf(f).components.length },
  { row: "no-check", when: (f) => !owedOf(f).check },
  { row: "hold", holds: true, when: () => true },
];

export const OWED_ROWS = OWED.map((r) => r.row);

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = fn()));
}

const owedFacts = (event, world) => ({ ...factsOf(event, world), work: once(() => world.work?.() ?? null), owed: once(() => world.owed?.() ?? null) });

// The row that decides this Stop.
export const owedRowOf = (event, world) => ((f) => OWED.find((r) => r.when(f)))(owedFacts(event, world));

// Whether this Stop gets as far as a row that reads the owners' records: what lets the composition root load them only
// for a turn that edited and ran no passing check after it.
export const needsOwners = (event, world) => ((f) => OWED.find((r) => r.deep || r.when(f))?.deep === true)(owedFacts(event, world));

export const owed = {
  name: "owed",
  on: ["turn-end"],
  records: false,
  run: (event, world) => ((f) => (OWED.find((r) => r.when(f)).holds ? held(f) : null))(owedFacts(event, world)),
};

const commandSaid = (check) => printable(`${check.argv.join(" ")}${check.cwd && check.cwd !== "." ? `, in ${check.cwd}` : ""}`);

// The reason a host hands the model: which files, which component, which check and its command -- table words, ids
// and what the checkout declared, made printable; never a prompt or anything the session said.
export const owedReason = (o, count, max) => clipped(`Orbit holds this turn (${count} of ${max} for this prompt): ${printable(named(o.paths.length ? o.paths : o.changed))} changed in component ${printable(o.check.component)} and no check passed after the edit. Run its declared ${printable(o.check.purpose)} check ${printable(o.check.id)} (${commandSaid(o.check)}) to verify it, or say in one sentence why you stop here.`, REASON_BYTES);

function held(f) {
  const o = owedOf(f);
  const count = f.turn().holds + 1;
  f.world.held?.({ kind: "unverified", check: o.check.id, count });
  return f.world.host.formatHold(owedReason(o, count, MAX_HOLDS), f.world.input);
}
