// THE CUT of a round a case interrupts (0.5.0): its host stopped the way a crash stops a session, at a moment of the
// engineering task's OWN progress -- never at a minute of the clock. A clock said a fast host never reached its minute
// (ORBIT-E2E-007 on Sonnet, pre-check shp-32ab31b1a632: round 1 done in under four), and then nothing was interrupted;
// progress says where the work stands, whatever the host's speed. A case's `interrupt: { round, after }` names the
// steps, in order, an engineering task must have STARTED -- `["implement", "check"]`: the first check after the change
// was opened -- and the round's container is stopped, with no grace, the moment one engineering task's journal shows
// them. A host is never told it will be cut: its brief names the whole round's budget.
//
// A step is named as a host decides it (src/orchestration/dispatch.mjs ACTION_KINDS), and found under the type the
// task's journal records it as: its own name, but a check under its command's purpose, an invoke and a push under the
// action they are (JOURNALED, held to the rows by test/benchmark-cut.test.mjs).
//
// The runner store is the host's to write, so it is read here as untrusted data and as a CLOCK only: through no link
// (every directory and the journal are lstat'ed, and a link is never followed), bounded in how many projects, tasks and
// bytes it reads, a line that does not parse left out. What the round did is read back by the inspection, through Orbit,
// exactly as before.
//
//   cutOf(c, k, store) -> null | () -> boolean     reachedIn(store, after) -> boolean     inOrder(types, after) -> boolean
//   journalTypesOf(step) -> [type]                 cuts(c) -> boolean                     cutSaid(c) -> words
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PURPOSES } from "../../../src/orchestration/vocab.mjs";

// The provider of the task a cut watches: an engineering task -- never the goal's workflow beside it.
const ENGINEERING = "autonomous-engineering";

const TASK_DIR = /^tsk-[a-f0-9]{12}$/;

// How much of a runner store one look reads: a runner store holds one project and a task or three.
export const BOUNDS = { projects: 16, tasks: 32, journalBytes: 8 * 1024 * 1024 };

// The steps whose journal type is not their own name.
const JOURNALED = { check: [...PURPOSES, "check"], invoke: ["capability.invoke"], push: ["repository.push"] };

export const journalTypesOf = (step) => JOURNALED[step] ?? [step];

function lstatOf(p) {
  try { return lstatSync(p); }
  catch { return null; }
}

// A directory as itself: a link to one is never one here.
const isDir = (p) => lstatOf(p)?.isDirectory() === true;

function namesIn(dir, max) {
  try { return readdirSync(dir).sort().slice(0, max); }
  catch { return []; }
}

const lineOf = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

// One task's journal, as a regular file of bounded size and never through a link -- its lines, or none.
const journalLines = (file) => ((st) => (st?.isFile() && st.size <= BOUNDS.journalBytes ? readFileSync(file, "utf8").split("\n").map(lineOf).filter((l) => l && typeof l === "object") : []))(lstatOf(file));

// The types of the actions an ENGINEERING task's journal says started, in order -- none for any other task.
const engineeringTypes = (lines) => (lines[0]?.kind === "created" && lines[0].provider === ENGINEERING ? lines.filter((l) => l.kind === "action-started").map((l) => String(l.type)) : []);

// Where the step is found from `at` on, just past it -- or -1.
const pastStep = (types, step, at) => ((i) => (i < 0 ? -1 : i + 1))(types.findIndex((t, i) => i >= at && journalTypesOf(step).includes(t)));

// Whether the steps `after` names were started in that order -- other steps may come between them.
export const inOrder = (types, after) => after.reduce((at, step) => (at < 0 ? at : pastStep(types, step, at)), 0) >= 0;

const tasksOf = (store, project) => ((dir) => (isDir(dir) ? namesIn(dir, BOUNDS.tasks).filter((t) => TASK_DIR.test(t) && isDir(join(dir, t))).map((t) => join(dir, t, "journal.jsonl")) : []))(join(store, project, "tasks"));

// Every task journal of the store's projects, within the bounds.
const journalsIn = (store) => (isDir(store) ? namesIn(store, BOUNDS.projects).filter((p) => isDir(join(store, p))).flatMap((p) => tasksOf(store, p)) : []);

// Whether one engineering task of the store has started the steps `after` names, in order.
export const reachedIn = (store, after) => journalsIn(store).some((file) => inOrder(engineeringTypes(journalLines(file)), after));

// Whether a case declares a cut this controller makes: an interruption with the steps that cut it (a run's frozen copy of
// a case from before 0.5.0 named a minute, which is cut nowhere and held to nothing).
export const cuts = (c) => Array.isArray(c.interrupt?.after) && Number.isInteger(c.interrupt.round);

// The cut of round `k` of a case: a question asked while its runner runs, or null for a round the case does not cut.
export const cutOf = (c, k, store) => (cuts(c) && c.interrupt.round === k ? () => reachedIn(store, c.interrupt.after) : null);

// Where a case cuts its round, in a report's words.
export const cutSaid = (c) => (cuts(c) ? `round ${c.interrupt.round}, once its engineering task had started ${c.interrupt.after.join(" then ")}` : null);
