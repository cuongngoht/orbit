// THE OWED HOLD (0.6.0, P3): a turn is not left unverified. What a turn OWES before it stops is verification evidence
// for what it changed. When a session stops after an edit no test passed after, the turn is held open ONCE for this
// prompt, naming what would provide that evidence from the facts the engine HAS, in order (NAMED): the safe verifying
// check a component that owns the edited path declares, and its command; else (P3b) the tracked test files the relation
// adapters link to the edited files -- the files, never a command, since nothing declared how this checkout runs them,
// and a behaviour change no existing test covers wants a regression test; else nothing is held. It also asks the model
// to say why it stops, if it does. No hook can make the model run anything, and this runs nothing.
//
// It holds only when EVERY row of OWED lets it, in order, cheapest first -- so a turn that edited nothing, or ran a
// passing check after its last edit, costs a bounded read of the trail and nothing else:
//
//   the rows every Stop hold is held to first (hold.mjs GUARDS): the host can hold, the turn is not one a Stop hook
//     already kept going, the trail can count this prompt's holds, fewer than MAX_HOLDS of them, no halt cue
//   the trail says this turn edited (`tool.used` of an edit tool) and ran no TEST that passed after the last edit
//     (`command.ran` of a class collect.mjs WORKS names, ok: a lint or a build passing shows the code reads well or
//     compiles, never that it works) -- the cheap row: an ordinary turn loads no owner record past it
//   this prompt was not held for this reason already: once, never twice
//   the workflow hold (hold.mjs) does not speak for this Stop: one hold at a time, its own reason first
//   a person kept `trigger.holdUnverified` on (an automation setting, machine then project, written only in Control)
//   the session's governed work, if it has one, is not paused, cancelled or waiting for a person
//   the session's working set keeps an edit since the last passing test (`unverified.changed`) -- the async write of
//     the very last edit may not have landed yet: then nothing is held, never a guess
//   no DECLARED verifying check of a component that owns an edited path passed after the last edit (`declaredPassed`:
//     the check's own command, as the working set classes it, among `unverified.ran`)
//   something NAMED says what would verify them (cli/governed.mjs `owed`): a component of runtime understanding's graph
//     owns one of those files and it, or a component that depends on it, declares a SAFE verifying check; else a relation
//     adapter links tracked tests to them (src/context/relations.mjs `testsWith`). A path neither speaks for: silent
//
// What it writes is one `turn.held` with `kind: "unverified"` and the check's id, or how many test files it named (the
// trail, through `world.held`; never a path) and nothing else. Every fact is a port the composition root (cli/follow-hook.mjs) binds, read only when its row is
// reached; a port that fails answers null, and a row that cannot tell never holds.
import { WORKS } from "../../engineering/working-set/collect.mjs";
import { printable } from "../../printable.mjs";
import { clipped, named } from "../owners.mjs";
import { GUARDS, MAX_HOLDS, factsOf, holdRowOf } from "./hold.mjs";

// The governed work's states a person holds it in: never held past any of these (cli/governed.mjs STATES).
export const QUIET = ["paused", "cancelled", "waiting"];

const REASON_BYTES = 600;

const edited = (e) => e.type === "tool.used" && e.data?.kind === "edit" && e.data?.ok !== false;

// A run that shows the change WORKS (collect.mjs WORKS: a test): a lint or a build passing never clears what is owed.
const passed = (e) => e.type === "command.ran" && WORKS.includes(e.data?.class) && e.data?.ok === true;

// The trail's cheap word: this turn edited, and no test passed after its last edit.
export const uncheckedEdit = (events) => ((last) => last >= 0 && !events.slice(last + 1).some(passed))(events.findLastIndex(edited));

const heldFor = (turn) => turn.events.some((e) => e.type === "turn.held" && e.data?.kind === "unverified");

const owedOf = (f) => f.owed();

// What would verify the edits, from the facts the engine has, in order -- the first that names something is said:
//   check   a declared SAFE verifying check of a component that owns an edited path: its id and its command
//   tests   the tracked tests the relation adapters link to the edited files: the files, how many in the trail
export const NAMED = [
  { by: "check", when: (o) => Boolean(o.check), reason: (o, count, max) => checkReason(o, count, max), trail: (o) => ({ check: o.check.id }) },
  { by: "tests", when: (o) => (o.tests ?? []).length > 0, reason: (o, count, max) => testsReason(o, count, max), trail: (o) => ({ tests: o.tests.length }) },
];

export const namedOf = (o) => NAMED.find((n) => n.when(o)) ?? null;

// Why a turn is NOT held for an unverified edit, cheapest first: the first row that holds decides, and the last does.
export const OWED = [
  ...GUARDS,
  { row: "verified", when: (f) => !uncheckedEdit(f.turn().events ?? []) },
  { row: "said-already", when: (f) => heldFor(f.turn()) },
  { row: "workflow-holds", when: (f) => holdRowOf(f.event, f.world)?.holds === true },
  { row: "switched-off", deep: true, when: (f) => f.settings()?.trigger?.holdUnverified !== true },
  { row: "work-quiet", deep: true, when: (f) => QUIET.includes(f.work()?.state) },
  { row: "unrecorded", deep: true, when: (f) => !(owedOf(f)?.changed ?? []).length },
  { row: "declared-passed", when: (f) => owedOf(f).declaredPassed === true },
  { row: "unnamed", when: (f) => !namedOf(owedOf(f)) },
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

// The reason a host hands the model: which files, and what would verify them -- a component and its declared check and
// command, or the tracked tests linked to them -- table words, ids, paths and what the checkout declared, made
// printable; never a prompt or anything the session said.
const checkReason = (o, count, max) => `Orbit holds this turn (${count} of ${max} for this prompt): ${printable(named(o.paths.length ? o.paths : o.changed))} changed in component ${printable(o.check.component)} and no test or declared verifying check passed after the edit. Run its declared ${printable(o.check.purpose)} check ${printable(o.check.id)} (${commandSaid(o.check)}) to verify it, or say in one sentence why you stop here.`;

const testsReason = (o, count, max) => `Orbit holds this turn (${count} of ${max} for this prompt): ${printable(named(o.changed))} changed and no test passed after the edit. The tests that go with it here: ${printable(named(o.tests))}. Run them as this project runs its tests to verify it -- and a behaviour change no existing test covers wants a regression test -- or say in one sentence why you stop here.`;

export const owedReason = (o, count, max) => clipped(namedOf(o).reason(o, count, max), REASON_BYTES);

function held(f) {
  const o = owedOf(f);
  const count = f.turn().holds + 1;
  f.world.held?.({ kind: "unverified", ...namedOf(o).trail(o), count });
  return f.world.host.formatHold(owedReason(o, count, MAX_HOLDS), f.world.input);
}
