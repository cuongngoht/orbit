// A CONTROL SET kept in a room of its own, so a set a restart cut short is carried on from what it kept and never begun
// again (0.5.0, backlog B6: a source case's controls take about twenty minutes): its manifest (kind `controls`, with
// the options it was asked with and the tree it measured), one record per control -- written when the control is
// planned and replaced once it has its row -- and controls.json when the set is whole. A control carried by a whole run
// of its own (an engine repair control, a QA control) has that run's id planned and kept BEFORE the run starts, so a
// resumed set reads that very run back when it ended, carries it on when it did not, and never starts a second one.
//
//   recordOf(room, id) -> { id, planned?, row? } | null       keptOr(room, k, ran) -> row      RUN_OF
//   runOfControl(x) -> Promise<{ run, outcome, summary }>   x: { set, id, storeRoot, resume(run), start(run), newRun() }
//   plannedRuns(room) -> [bnr-…]   every run the set planned for a control (cleanup removes their containers too)
import { readdirSync } from "node:fs";
import { docRead, docWritten, roomOf, RUN_ID } from "./room.mjs";

const at = (id) => `controls/${id}.json`;

export const recordOf = (room, id) => docRead(room, at(id));

const planned = (room, id, run) => (docWritten(room, at(id), { id, planned: { run } }), run);

const rowKept = (room, id, row) => (docWritten(room, at(id), { ...(recordOf(room, id) ?? { id }), row }), row);

// A control's row: the one the set kept, or -- for a control not decided yet -- what it comes to now, kept as it ends.
export const keptOr = async (room, k, ran) => recordOf(room, k.id)?.row ?? rowKept(room, k.id, await ran());

// The run a control's record planned, as its own room says it: its manifest, its ending, and the report written last.
function plannedRoom(storeRoot, run) {
  if (!RUN_ID.test(String(run))) return null;
  const room = roomOf(storeRoot, run);
  return { manifest: docRead(room, "manifest.json"), ending: docRead(room, "ending.json"), report: docRead(room, "report.json") };
}

// A run that ENDED: its ending, and the report its end writes last agreeing with it -- the rule a release ship holds.
const ended = (r) => Boolean(r?.ending) && r.report?.outcome === r.ending.outcome;

// What a control carried by a whole run does with the run its record planned, first match wins, the last always
// matching: read it back when it ended, carry it on when its room was kept, and otherwise -- never planned, or planned
// and never frozen -- plan a new run id, keep it, then start that run.
export const RUN_OF = [
  { id: "ENDED", when: (x) => ended(x.room), then: (x) => ({ run: x.run, outcome: x.room.ending.outcome, summary: x.room.ending.summary ?? "" }) },
  { id: "KEPT", when: (x) => Boolean(x.room?.manifest), then: (x) => x.resume(x.run) },
  { id: "NEW", when: () => true, then: (x) => x.start(planned(x.set, x.id, x.newRun())) },
];

export async function runOfControl(x) {
  const run = recordOf(x.set, x.id)?.planned?.run ?? null;
  const y = { ...x, run, room: run ? plannedRoom(x.storeRoot, run) : null };
  return RUN_OF.find((r) => r.when(y)).then(y);
}

function listed(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

export const plannedRuns = (room) => listed(room.at("controls")).filter((n) => n.endsWith(".json")).map((n) => docRead(room, `controls/${n}`)?.planned?.run).filter((r) => RUN_ID.test(String(r)));
