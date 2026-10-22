// INSPECT (`o`, doc §9): the generated tests a viewer follows, one row per OBLIGATION from the investigation's own
// allow-listed milestone events -- its shape and target as it was discovered, where it stands, the word its latest
// attempt earned and the row that gave it, how many attempts it took -- and, opened, every field, NOT RECORDED where
// the activity carried none. A retry is the same test; nothing is inferred; the key only changes what is shown.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activityOf } from "../src/investigation/activity.mjs";
import { qaFold } from "../src/live/current.mjs";
import { HELP, KEYMAP, actionOfKey } from "../src/live/tui/keys.mjs";
import { INSPECT_FIELDS, inspectItems, inspectOverlay } from "../src/live/tui/overlays/inspect.mjs";

const INV = "inv-20261022-120000-abcd";
let clock = 0;
const at = () => `2026-10-22T12:00:${String(clock++).padStart(2, "0")}.000Z`;
const events = (records) => records.flatMap((r) => activityOf({ at: r.at ?? at(), ...r })).map((e) => ({ ...e, source: INV }));

const obligation = (o, shape, extra = {}) => [{ kind: "obligation", eventId: `obl-${o}`, obligation: o, shape, target: "endpoint:invoice-read", authority: "accepted", ...extra }, { kind: "designed", eventId: `dsg-${o}`, obligation: o, design: `tds-${o}`, state: "designed" }, { kind: "version", eventId: `ver-${o}`, design: `tds-${o}`, version: `case-${o}@0123456789abcdef` }];
const started = (o, attempt) => ({ kind: "started", eventId: `str-${o}-${attempt}`, version: `case-${o}@0123456789abcdef`, execution: `exe-${o}-${attempt}`, attempt });
const evaluated = (o, attempt, outcome, cause) => ({ kind: "evaluated", eventId: `evl-${o}-${attempt}`, execution: `exe-${o}-${attempt}`, obligation: o, outcome, cause, attempt });

const derived = (evs) => ({ root: { qa: qaFold(evs) } });
const line = (r) => [...(r.left ?? []), ...(r.right ?? [])].filter(Boolean).map((x) => x.text).join("");
const text = (o) => [...o.lead, ...o.rows, ...(o.after ?? [])].map(line).join("\n");

test("one obligation tried twice is one row: its shape and target as discovered, the latest word and its row, two attempts", () => {
  const d = derived(events([...obligation("tob-a", "permission-enforced"), started("tob-a", 1), evaluated("tob-a", 1, "INCONCLUSIVE", "POSITIVE_CONTROL"), started("tob-a", 2), evaluated("tob-a", 2, "SATISFIED", "MET")]));
  const [it] = inspectItems(d);
  assert.deepEqual([it.shape, it.target, it.authority, it.state, it.outcome, it.cause, it.attempt, it.attempts], ["permission-enforced", "endpoint:invoice-read", "accepted", "evaluated", "SATISFIED", "MET", 2, 2]);
  const o = inspectOverlay({ viewer: { detail: null } }, d);
  assert.equal(o.rows.length, 1);
  assert.match(text(o), /permission-enforced +SATISFIED \(MET\) +2 attempts · endpoint:invoice-read/);
});

test("a test still running says so, and a field the activity never carried is NOT RECORDED -- never a guess", () => {
  const d = derived(events([...obligation("tob-b", "effect-once-per-key", { authority: undefined }), started("tob-b", 1)]));
  const o = inspectOverlay({ viewer: { detail: 0 } }, d);
  assert.match(text(o), /effect-once-per-key +running +1 attempt/);
  assert.deepEqual(o.after.slice(1).map((r) => r.left[0].text.trim()), INSPECT_FIELDS);
  assert.match(text(o), /authority +NOT RECORDED/);
  assert.match(text(o), /investigation +inv-20261022-120000-abcd/, "a value never runs into its name");
});

test("with nothing said about a generated test, it says so and offers nothing to open", () => {
  const o = inspectOverlay({ viewer: { detail: null } }, derived([]));
  assert.equal(o.selectable, false);
  assert.match(text(o), /no investigation this viewer follows has said anything about a generated test yet/);
});

test("`o` opens it from the dashboard and from any overlay, and the help list names it", () => {
  assert.deepEqual(actionOfKey({ mode: "normal", overlay: null }, "o"), { type: "overlay", name: "inspect" });
  assert.deepEqual(actionOfKey({ mode: "normal", overlay: "evidence" }, "o"), { type: "overlay", name: "inspect" });
  assert.ok(HELP.some(([key]) => key === "o") && KEYMAP.normal.o);
});
