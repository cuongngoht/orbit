// THE SPEC of ORBIT-MEM-006: a journal survives a process killed mid-append -- written from its contract and never from
// its code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy of it, and it never
// imports the subject. Every check is a plan of appends and tears played against one journal, and an expectation over
// the ids the probe reports for what was read back: `has` (must be among them), `lacks` (must not be), `exactly` (the
// whole set).
//
// The contract (AGENTS.md -- a task is an append-only journal and the only state it has -- and the headers of
// src/task/store.mjs and satellite/src/store/journal.mjs, whose pattern src/goal/store.mjs keeps too): a journal is
// APPEND-ONLY, every line in order, and every view is a fold over it. A process killed mid-append leaves a line with no
// end; appending straight after it would glue the next record onto the fragment, and the tolerant reader would drop
// BOTH -- so a torn tail is ended first: the fragment stays unreadable, and everything after it survives. A torn or
// garbled line is dropped, never fatal. So whatever was torn, wherever and however often, every record appended
// through the journal's own door reads back, in the order it was written, and nothing the door did not write does.
//
// A tear is a fragment of a line -- never a whole line, never more than one -- written straight onto the journal file,
// as a killed process leaves it. Three journals keep the rule: a task's, a goal's and a mission's.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-MEM-006";

export const GROUPS = {
  "no-tear": "records appended with nothing torn all read back, in order",
  "torn-then-record": "a record appended after a torn line reads back, and the fragment does not",
  "torn-then-many": "every record appended after a torn line reads back, in order",
  "torn-at-the-end": "a torn last line is not read, and every record before it is",
  "torn-first": "a torn line before any record keeps every record after it",
  "torn-twice-in-a-row": "two fragments one after the other are still one torn line: what follows survives",
  "torn-again-and-again": "a tear after every few records loses none of them",
  "empty-tear": "a process killed before it wrote anything leaves nothing to end: every record reads back",
  seeded: "seeded plans of appends and tears, on every journal: every record reads back, in order, and nothing else",
};

// ---- the reference model: the contract, as data -------------------------------------------------------------------

const written = (plan) => plan.reduce((n, step) => n + (step.write ?? 0), 0);

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

// Every record the door wrote reads back, in order; nothing else is read; nothing is lost.
export const owed = (input) => ({ exactly: [...range(written(input.plan)).map((n) => `kept:${n}`), "order:kept"].sort() });

// ---- what the inputs are made of ------------------------------------------------------------------------------------

export const JOURNALS = ["task", "goal", "mission"];

// What a killed process leaves: the start of a line, cut anywhere before its end -- never a whole line.
export const FRAGMENTS = ['{"at":"2026-10-31T09:00:00.000Z","kind":"st', '{"at":"2026-10-31T09:0', "{", '{"kind":"stage","stage":"WORKSP', '{"at":"2026-10-31T09:00:00.000Z","kind":"noted","n":"r9', '{"kind":"unit","unit":"é'];

const write = (n) => ({ write: n });
const tear = (text) => ({ tear: text });

// Each scenario with the number of records it appends through the door, counted by hand.
const SCENARIOS = [
  ["no-tear", [write(1)], 1],
  ["no-tear", [write(3), write(2)], 5],
  ["torn-then-record", [write(2), tear(FRAGMENTS[0]), write(1)], 3],
  ["torn-then-record", [write(1), tear(FRAGMENTS[2]), write(1)], 2],
  ["torn-then-many", [write(1), tear(FRAGMENTS[1]), write(6)], 7],
  ["torn-at-the-end", [write(3), tear(FRAGMENTS[3])], 3],
  ["torn-first", [tear(FRAGMENTS[4]), write(3)], 3],
  ["torn-twice-in-a-row", [write(1), tear(FRAGMENTS[0]), tear(FRAGMENTS[5]), write(2)], 3],
  ["torn-again-and-again", [write(1), tear(FRAGMENTS[1]), write(1), tear(FRAGMENTS[3]), write(2), tear(FRAGMENTS[2]), write(1)], 5],
  ["empty-tear", [write(2), tear(""), write(2)], 4],
];

const allKept = (count) => ({ exactly: [...range(count).map((n) => `kept:${n}`), "order:kept"].sort() });

const hand = (group, store, plan, count) => ({ group, input: { call: "journal", store, plan }, expect: allKept(count) });

// Every scenario, on every journal: a check per journal, so one journal that loses a record is a failing check.
export const STRUCTURE = SCENARIOS.flatMap(([group, plan, count]) => JOURNALS.map((store) => hand(group, store, plan, count)));

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

// A run of appends, then -- half the time -- a tear; the plan always appends at least once.
const segment = (r) => [write(1 + Math.floor(r() * 3)), ...(r() < 0.5 ? [tear(pick(r, FRAGMENTS))] : [])];

const seededPlan = (r) => [...(r() < 0.2 ? [tear(pick(r, FRAGMENTS))] : []), ...Array.from({ length: 1 + Math.floor(r() * 4) }, () => segment(r)).flat()];

const seededRow = (r) => ((input) => ({ group: "seeded", input, expect: owed(input) }))({ call: "journal", store: pick(r, JOURNALS), plan: seededPlan(r) });

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...Array.from({ length: Math.max(8, samples) }, () => seededRow(r))]);
}

// ---- the reference model, held to the table written by hand ---------------------------------------------------------

const agrees = (c) => JSON.stringify(owed(c.input)) === JSON.stringify(c.expect);

function parses(text) {
  try { return (JSON.parse(text), true); }
  catch { return false; }
}

const wholeLine = (text) => text.includes("\n") || parses(text);

export const selfTest = () => [...STRUCTURE.filter((c) => !agrees(c)).map((c) => `the reference model disagrees with the contract on a ${c.group} check: ${JSON.stringify(c.input)}`), ...FRAGMENTS.filter(wholeLine).map((f) => `a fragment is a whole line, which no killed process leaves: ${f}`)];
