// WHICH TASK a viewer shows, when nobody named one. A machine holds many projects, checkouts, sessions and
// tasks, and a status line that showed whatever moved last would show another session's work as this one's.
// So the answer is an ordered table, first row wins, the last always matches -- and "the newest task on the
// machine" is not a row. Every candidate is this checkout's (a task's `created.checkout`); a task is this
// SESSION's only when its journal says so (`created.session`, the mark the session's own commands stamped).
// When two could be meant, the answer is AMBIGUOUS and the viewer says how to choose: a guess shown as fact
// is the one wrong answer.
//
//   associate(input) -> { task, how, ids }
//   input: { explicit, pins: { session, checkout }, mark, checkout, rows, now, finishedForMs }
//     rows: [{ id, checkout, session, terminal, createdAt, endedAt }]    one per task of this project, read
//           by the caller from each journal's first line and its fold (never a second record)
//     mark: the session mark a task created by THIS session would carry, or null
//     now, finishedForMs: milliseconds -- how long a task that ended is still worth showing
//
//   how: explicit · pin · session · checkout · finished · ambiguous · none
export const FINISHED_FOR_MS = 600_000;

const mine = (input) => input.rows.filter((r) => r.checkout === input.checkout);
const going = (input) => mine(input).filter((r) => !r.terminal);
const lately = (input) => (r) => r.terminal && r.endedAt !== null && input.now - Date.parse(r.endedAt) <= (input.finishedForMs ?? FINISHED_FOR_MS);
const ofSession = (input) => (r) => input.mark !== null && r.session === input.mark;
const newest = (rows) => [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)).at(-1);
const showable = (input, id) => mine(input).find((r) => r.id === id && (!r.terminal || lately(input)(r)));

// A coordinated workflow that ended is still shown as itself, as it was while it ran -- not the engineering task it
// started, which was created after it, inside its run (1.8.6). Only a task created after the workflow ENDED (new work)
// is shown instead.
const createdAfter = (c) => (r) => r.createdAt > c.endedAt;
const lastOf = (rows) => ((c) => (c && !rows.some(createdAfter(c)) ? c : newest(rows)))(newest(rows.filter((r) => r.coordinates === true)));

const recentlyEnded = (input) => lastOf(mine(input).filter(lately(input)).filter(ofSession(input))) ?? ((rows) => (rows.length === 1 ? rows[0] : undefined))(mine(input).filter(lately(input)));

export const ASSOCIATION = [
  { how: "explicit", task: (i) => i.explicit ?? null },
  { how: "pin", task: (i) => (i.pins?.session && showable(i, i.pins.session)?.id) ?? null },
  { how: "pin", task: (i) => (i.pins?.checkout && showable(i, i.pins.checkout)?.id) ?? null },
  { how: "coordinator", task: (i) => newest(going(i).filter(ofSession(i)).filter((r) => r.coordinates === true))?.id ?? null },
  { how: "session", task: (i) => newest(going(i).filter(ofSession(i)))?.id ?? null },
  { how: "checkout", task: (i) => (going(i).length === 1 ? going(i)[0].id : null) },
  { how: "ambiguous", task: () => null, ids: (i) => (going(i).length > 1 ? going(i).map((r) => r.id).sort() : null) },
  { how: "finished", task: (i) => recentlyEnded(i)?.id ?? null },
  { how: "none", task: () => null, ids: () => [] },
];

const answerOf = (row, input) => ({ how: row.how, task: row.task(input), ids: row.ids ? row.ids(input) : null });
const decides = (a) => a.task !== null || a.ids !== null;

export function associate(input) {
  const answer = ASSOCIATION.map((row) => answerOf(row, input)).find(decides);
  return { how: answer.how, task: answer.task, ids: answer.ids ?? (answer.task ? [answer.task] : []) };
}
