// ROUNDS of a bounded discovery loop on a task's own work (0.6.0, U2) -- a pure fold over the work journal, which is
// already the record of what a task understands: its done criteria are `proof` needs, its gaps `knowledge` needs (one
// that cannot be filled here is settled `blocked`), a hypothesis is a need not yet settled, and a ROUND is a
// `checkpoint`. A checkpoint keeps what the round ASKED (the targets the context package offered and the host read, by
// `targetKey`) and what it GAINED (the needs it settled anew), so nothing here stores a state of its own.
//
//   ROUND_STOP   an ordered table, the first row that holds is the round state, and the last always holds:
//                  budget   MAX_ROUNDS checkpoints are spent
//                  no-gain  the last NO_GAIN_ROUNDS checkpoints in a row settled nothing new
//                  go-on    neither: another round may still fill a gap
//   offered      whether a target may be offered again: never while what answered it -- the needs the round that asked
//                it settled, or those of them about the path the target names -- is still settled and none of them
//                moved (a stale line, or a scope that moved since, handed in as `moved`). A round that asked it and
//                settled nothing leaves it offered: NO_GAIN bounds that.
//
// Writes stay where they are -- `work need | settle | checkpoint | resume`; `context --work=` only reads this fold.
import { stateOf } from "./model.mjs";
import { SETTLED_STATES } from "./vocab.mjs";

export const MAX_ROUNDS = 5;
export const NO_GAIN_ROUNDS = 2;
export const MAX_ASKED = 6;
export const ASKED_LIMIT = 160;

// A target as the context package prints it -- `<source> · <target>` -- which is how a host names what it asked.
export const targetKey = (t) => `${t.source} · ${t.target}`;

// What a host may say it asked: short keys, printable, at most MAX_ASKED; anything else is refused by the door that
// writes the checkpoint, never trimmed into something it did not say.
export const askedFindings = (asked) => [...(asked.length > MAX_ASKED ? [`at most ${MAX_ASKED} --asked targets in one round`] : []), ...asked.filter((a) => typeof a !== "string" || !a.trim() || a.length > ASKED_LIMIT || /[\u0000-\u001f]/.test(a)).map(() => `an --asked target is one line of at most ${ASKED_LIMIT} characters, as the context package printed it: "<source> · <target>"`)];

// ---- what a round gained ----------------------------------------------------------------------------------------------

const settledLines = (model) => model.records.map((r, n) => ({ ...r, n })).filter((r) => r.kind === "settled");

// Settled in the window, and not already settled the same way before it: a need settled again as it was is no gain.
const anew = (lines, line, from) => !lines.some((x) => x.n < from && x.need === line.need && x.state === line.state);

// -> the needs settled anew since the last checkpoint: what this round GAINED.
export function gainedSince(model) {
  const from = model.checkpoints.at(-1)?.upto ?? 0;
  const lines = settledLines(model);
  return [...new Set(lines.filter((l) => l.n >= from && anew(lines, l, from)).map((l) => l.need))];
}

// ---- the round state ---------------------------------------------------------------------------------------------------

const lastRounds = (model) => model.checkpoints.slice(-NO_GAIN_ROUNDS);

const gainedNothing = (model) => lastRounds(model).length === NO_GAIN_ROUNDS && lastRounds(model).every((c) => (c.gained ?? []).length === 0);

export const ROUND_STOP = [
  { row: "budget", stop: true, when: (m) => m.checkpoints.length >= MAX_ROUNDS, because: (m) => `${m.checkpoints.length} of ${MAX_ROUNDS} rounds are spent — stop, and say what is still missing` },
  { row: "no-gain", stop: true, when: gainedNothing, because: () => `the last ${NO_GAIN_ROUNDS} rounds settled nothing new — reading more the same way will not; stop, and say what is still missing` },
  { row: "go-on", stop: false, when: () => true, because: (m) => `${m.checkpoints.length} of ${MAX_ROUNDS} rounds spent, and the last one${m.checkpoints.length ? "" : " (none yet)"} ${m.checkpoints.at(-1)?.gained?.length ? `settled ${m.checkpoints.at(-1).gained.length} need(s)` : "is not a reason to stop"}` },
];

// -> { rounds, max, stop, row, because, gained (the last round's), asked (every key asked so far) }
export function roundsOf(model) {
  const row = ROUND_STOP.find((r) => r.when(model));
  return { rounds: model.checkpoints.length, max: MAX_ROUNDS, stop: row.stop, row: row.row, because: row.because(model), gained: model.checkpoints.at(-1)?.gained ?? [], asked: [...new Set(model.checkpoints.flatMap((c) => c.asked ?? []))] };
}

// ---- whether a target is offered again ----------------------------------------------------------------------------------

const settledStill = (model, id, moved) => model.needs.has(id) && SETTLED_STATES.includes(stateOf(model.needs.get(id), model)) && !moved.has(id);

// What answered a target in a round that asked it: the needs that round settled anew -- narrowed, when the target names a
// path, to those about that path (a need's own scope), so one of two targets read in a round is not re-offered because
// the other's answer moved.
const aboutTarget = (model, ids, target) => ids.filter((id) => (model.needs.get(id)?.scope ?? []).includes(target.target));

const answersIn = (model, c, target) => ((about) => (about.length ? about : c.gained ?? []))(aboutTarget(model, c.gained ?? [], target));

const askedIn = (model, target) => model.checkpoints.filter((c) => (c.asked ?? []).includes(targetKey(target)));

// work: { model, moved: Set of need ids whose files moved since they were settled (read, never written, by the caller) }
export const offered = (target, work) => !askedIn(work.model, target).some((c) => ((ids) => ids.length > 0 && ids.every((id) => settledStill(work.model, id, work.moved ?? new Set())))(answersIn(work.model, c, target)));
