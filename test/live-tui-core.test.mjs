// The full-screen viewer's PURE core (src/live/tui/): keys decoded by table, transitions that never mutate,
// a layout that never draws outside the screen, a frame whose every line is exactly as wide as it may be, and
// sections that say only what a view or a journal line says. No terminal, no clock, no disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_SEQUENCES, KEYMAP, HELP, actionOfKey, decodeKeys } from "../src/live/tui/keys.mjs";
import { ACTIONS, TRANSITIONS, reduce } from "../src/live/tui/reducer.mjs";
import { LIMITS, childOf, consoleTask, engineeringId, wanted } from "../src/live/tui/model.mjs";
import { budgetOf, tierOf } from "../src/live/tui/layout.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { changedRows } from "../src/live/tui/diff.mjs";
import { ASCII, glyph } from "../src/live/tui/glyphs.mjs";
import { bar, bytesOf } from "../src/live/tui/bars.mjs";
import { pickerItems } from "../src/live/tui/tree.mjs";
import { GLYPHS, LIFECYCLE_WORDS, PRESENTATION_WORDS, PULSE, WORKFLOW_GLYPHS } from "../src/live/words.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { ENG, HERE, INV, NOW, WF, ago, engView, engineering, fed, keys, stateOf, workflow } from "./live-tui.fixture.mjs";

const ESC = "\u001b";
const text = (state) => frameOf(state).lines.join("\n");

// ---- keys -----------------------------------------------------------------------------------------------

test("every named sequence decodes to its key; an unknown CSI, an Alt combination and a control byte are swallowed", () => {
  for (const [seq, key] of KEY_SEQUENCES) assert.deepEqual(decodeKeys(seq), [key], JSON.stringify(seq));
  assert.deepEqual(decodeKeys(`${ESC}[99;5u${ESC}x\u0007q`), ["q"]);
  assert.deepEqual(decodeKeys(ESC), ["escape"]);
  assert.deepEqual(decodeKeys(`j${ESC}[`), ["j"], "a sequence cut by a slow link is swallowed, never misread");
  assert.deepEqual(decodeKeys("é👤"), ["é", "👤"]);
});

test("in search every printable key is typed, and only Ctrl+C leaves; in normal mode q leaves", () => {
  const search = { mode: "search", overlay: null };
  for (const k of ["q", "1", "/", "l", "c"]) assert.deepEqual(actionOfKey(search, k), { type: "search-type", ch: k });
  assert.equal(actionOfKey(search, "space").ch, " ");
  assert.equal(actionOfKey(search, "ctrl-c").type, "quit");
  assert.equal(actionOfKey({ mode: "normal", overlay: null }, "q").type, "quit");
  assert.equal(actionOfKey({ mode: "normal", overlay: "help" }, "q").type, "overlay-close", "q closes the keys list, it does not leave");
  assert.equal(actionOfKey({ mode: "normal", overlay: "picker" }, "escape").type, "overlay-close");
  assert.equal(actionOfKey({ mode: "normal", overlay: null }, "escape").type, "escape", "Esc never leaves");
});

test("every key the help list promises is a key the normal layer has, and every action a key names is a transition", () => {
  for (const [key] of HELP) assert.ok(Object.hasOwn(KEYMAP.normal, key), key);
  const named = Object.values(KEYMAP).flatMap((layer) => Object.values(layer)).filter((a) => typeof a === "object").map((a) => a.type);
  assert.deepEqual(named.filter((type) => !ACTIONS.includes(type)), []);
  assert.deepEqual(ACTIONS, Object.keys(TRANSITIONS));
});

// ---- the reducer ------------------------------------------------------------------------------------------

const frozenDeep = (o) => (o && typeof o === "object" ? Object.freeze(Object.values(o).forEach(frozenDeep) ?? o) : o);

test("no transition mutates the state it is handed, and an action no row names changes nothing", () => {
  const s = frozenDeep(engineering());
  for (const type of ACTIONS) assert.doesNotThrow(() => reduce(s, { type, by: 1, to: "end", name: "picker", ch: "x", task: ENG, frames: [], rows: [], projects: [], children: {}, views: {}, association: s.association, extents: s.viewer.extents, columns: 90, rows: 20, nowMs: NOW, sessions: [], count: 1, message: "m" }), type);
  assert.equal(reduce(s, { type: "nonsense" }), s);
  assert.equal(reduce(s, null), s);
});

test("lines are kept in a bounded window and the viewer counts what it let go", () => {
  const many = Array.from({ length: LIMITS.EVENTS_KEPT + 50 }, (_, n) => ({ source: "task", n, at: ago(1), kind: "decision", observed: `o${n}` }));
  const s = fed(stateOf(), ENG, engView(), many);
  assert.equal(s.tasks[ENG].events.length, LIMITS.EVENTS_KEPT);
  assert.equal(s.tasks[ENG].dropped, 50);
  assert.equal(s.tasks[ENG].events[0].observed, "o50");
});

test("scrolling away from the live edge holds the list; space freezes both and follows again", () => {
  const s = reduce(engineering(), { type: "extents", extents: { recent: { max: 10, page: 4 }, sandbox: { max: 0, page: 1 }, overlay: { max: 0, page: 1 } } });
  const down = keys(s, { type: "move", by: 2 });
  assert.equal(down.viewer.scroll.recent, 2);
  assert.equal(down.viewer.hold.recent, s.tasks[ENG].events.length);
  assert.equal(keys(down, { type: "edge", to: "start" }).viewer.hold.recent, null, "back at the newest line it follows again");
  assert.equal(keys(down, { type: "page", by: 5 }).viewer.scroll.recent, 10, "clamped to the list");
  const frozen = keys(s, "freeze");
  assert.equal(frozen.viewer.frozen, true);
  assert.notEqual(frozen.viewer.hold.recent, null);
  assert.deepEqual(keys(frozen, "freeze").viewer.hold, { recent: null, sandbox: null });
});

test("a held list does not move when lines arrive, and the frame says FROZEN while the task keeps running", () => {
  const held = keys(engineering(), "freeze");
  const later = fed(held, ENG, engView(), [{ source: "task", n: 9, at: ago(1), kind: "completed", summary: "done" }]);
  assert.ok(!/Completed/.test(text(later)), "a frozen list shows what it had");
  assert.match(text(later), /FROZEN — the task keeps running/);
  assert.match(text(keys(later, "freeze")), /Completed/);
});

test("search swallows keys, jumps to a match and marks it; escape clears it", () => {
  const s = keys(engineering(), "search-open", { type: "search-type", ch: "b" }, { type: "search-type", ch: "u" }, { type: "search-type", ch: "i" }, "search-commit");
  assert.equal(s.viewer.mode, "normal");
  assert.equal(s.viewer.search.query, "bui");
  assert.match(frameOf(s).lines.find((l) => /Build succeeded/.test(l)), /^›/);
  assert.equal(keys(s, "escape").viewer.search.query, "");
});

test("a workflow follows its engineering task too, and c moves what is shown between them", () => {
  const s = workflow();
  assert.equal(childOf(s), ENG);
  assert.deepEqual(wanted(s).feeds, [WF, ENG]);
  assert.equal(engineeringId(s), ENG);
  assert.equal(keys(s, "child").focus, "child");
  assert.equal(keys(engineering(), "child").viewer.message, "no engineering task yet: the workflow has not started one");
});

test("the console reads the sandbox of whichever followed task claims one, and asks for nothing while closed", () => {
  const withSandbox = fed(stateOf(), ENG, engView({ receipts: [{ domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", at: ago(9) }] }), []);
  assert.equal(wanted(withSandbox).console, null);
  const open = keys(withSandbox, "console");
  assert.deepEqual([wanted(open).console.task, wanted(open).console.env], [ENG, "env-0123456789ab"]);
  assert.equal(consoleTask(open), ENG);
  const hostile = keys(fed(stateOf(), ENG, engView({ receipts: [{ domain: "sandbox", ref: "../../etc", at: ago(9) }] }), []), "console");
  assert.equal(wanted(hostile).console.refusal.code, "INVALID_ENVIRONMENT_ID", "a claim that is not an env id is refused, never a path");
});

test("a log read is kept per stream, bounded, and a reset begins the stream again", () => {
  const s = keys(engineering(), "console", { type: "console-target", task: ENG, env: "env-0123456789ab", sessions: [{ session: "rs-0123456789ab", state: "RUNNING" }], session: "rs-0123456789ab" });
  const got = (lines, extra = {}) => ({ type: "log", task: ENG, session: "rs-0123456789ab", stream: "out", got: { lines, next: 10, size: 10, ...extra } });
  const once = reduce(s, got(["a", "b"]));
  assert.deepEqual(once.console.streams.out.lines, ["a", "b"]);
  assert.deepEqual(reduce(once, got(["c"], { reset: true })).console.streams.out.lines, ["c"]);
  assert.equal(reduce(once, { ...got(["x"]), session: "rs-ffffffffffff" }), once, "another session's lines are not this console's");
  assert.deepEqual(reduce(once, { type: "stream" }).console.stream, "err");
});

// ---- layout and frame -------------------------------------------------------------------------------------

test("tiers by width, and too small below 60×12", () => {
  assert.deepEqual([200, 120, 119, 90, 89, 60, 59].map((c) => tierOf(c, 30).name), ["wide", "wide", "medium", "medium", "narrow", "narrow", "too-small"]);
  assert.equal(tierOf(100, 11).name, "too-small");
});

test("a budget never gives more rows than the body has, and keeps the stage and the recent lines first", () => {
  const sections = ["stage", "workflow", "engineer", "qa", "sandbox", "recent", "notices"].map((name) => ({ name, rows: Array(20).fill({}) }));
  for (const height of [8, 12, 20, 40, 80]) {
    const b = budgetOf(sections, height);
    const used = [...b.rows.values()].reduce((n, r) => n + r, 0) + (b.gaps ? b.sections.length - 1 : 0);
    assert.ok(used <= height, `${height}: ${used}`);
    assert.ok(b.sections.some((s) => s.name === "stage") && b.sections.some((s) => s.name === "recent"), String(height));
  }
});

const sizes = [[200, 50], [120, 34], [100, 30], [90, 24], [70, 20], [60, 12], [50, 10], [30, 5]];

test("every line of every frame is exactly the width it may have, the frame exactly the screen's height", () => {
  for (const [columns, rows] of sizes) {
    for (const s of [engineering({ columns, rows }), workflow({ columns, rows }), keys(engineering({ columns, rows }), { type: "overlay", name: "evidence" }), keys(engineering({ columns, rows }), { type: "overlay", name: "inspect" })]) {
      const f = frameOf(s);
      assert.equal(f.lines.length, rows, `${columns}×${rows}`);
      for (const line of f.lines) assert.equal(displayWidth(unstyled(line)), columns - 1, `${columns}×${rows}: ${line}`);
    }
  }
});

test("wide text is cut by what it shows: CJK and emoji never push a line past the screen", () => {
  const wide = "退款验证失败👤📸".repeat(30);
  const s = engineering({ events: [{ source: "task", n: 0, at: ago(5), kind: "completed", summary: wide }], view: { lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed", summary: wide } } });
  for (const line of frameOf(s).lines) assert.equal(displayWidth(unstyled(line)), 119);
});

test("NO_COLOR draws no escape at all; colour draws only SGR", () => {
  assert.equal(text(engineering()).includes(ESC), false);
  const seqs = text(engineering({ colour: true })).match(/\u001b\[[0-9;?]*[A-Za-z]/g) ?? [];
  assert.ok(seqs.length > 0 && seqs.every((x) => /^\u001b\[\d*(;\d+)*m$/.test(x)));
});

test("--ascii leaves no glyph behind, and every live glyph has an ASCII row -- the orbit is drawn ASCII of its own (0.0.3)", () => {
  const all = [...PULSE, ...Object.values(GLYPHS).map((g) => g.char), ...Object.values(LIFECYCLE_WORDS).map((w) => w.glyph), ...Object.values(PRESENTATION_WORDS).map((w) => w.glyph), ...Object.values(WORKFLOW_GLYPHS)];
  for (const g of all) assert.ok(/^[\x20-\x7e]*$/.test(glyph(g, true)), `${g} -> ${glyph(g, true)}`);
  assert.ok(Object.keys(ASCII).length > 20);
  for (const s of [engineering({ ascii: true }), workflow({ ascii: true }), workflow({ ascii: true, start: { layout: "pane" } })]) {
    const odd = [...frameOf(s).lines.join("")].filter((ch) => ch.codePointAt(0) > 0x7e && !/\p{L}|\p{N}/u.test(ch));
    assert.deepEqual([...new Set(odd)], []);
    for (const orbitMs of [0, 400, 1300, 2900]) assert.doesNotMatch(frameOf(s, undefined, { orbitMs }).lines.join(""), /[\u2800-\u28ff]/, "no Braille cell in an ASCII frame, at any moment of the orbit");
  }
});

test("the diff sends only rows that changed, and every row when the size changed or a redraw is asked", () => {
  const a = frameOf(reduce(engineering(), { type: "painted" }));
  const b = frameOf(reduce(fed(reduce(engineering(), { type: "painted" }), ENG, engView(), [{ source: "task", n: 9, at: ago(0), kind: "blocked", stop: "ENVIRONMENT_BLOCKED", needs: "environment" }]), { type: "painted" }));
  assert.equal(changedRows(a, a).length, 0);
  assert.ok(changedRows(a, b).length > 0 && changedRows(a, b).length < a.lines.length);
  assert.equal(changedRows(null, a).length, a.lines.length);
  assert.equal(changedRows(a, { ...a, rows: a.rows + 1, lines: [...a.lines, ""] }).length, a.lines.length + 1);
});

// ---- what the sections say --------------------------------------------------------------------------------

test("the engineering task: its stage, its checks with what backs each, the test running again, QA, recent milestones", () => {
  const screen = text(engineering());
  assert.match(screen, /STAGE +EXECUTING · TESTING · 31s in this stage · attempt 2\/5 · fix/);
  assert.match(screen, /ENGINEER +▓+░+ +2\/12 stages +2 file\(s\) \+41 −3 +3 action\(s\) +2\/5 attempts +5\/40 min/);
  assert.match(screen, /BUILD ✓ +12s +build +passed +← check:chk-3/);
  assert.match(screen, /TEST +✗ +8s +test +exit 1 · 3 of 12 failing +← check:chk-4/);
  assert.match(screen, /TEST +[◐◓◑◒] +3s +test +running again/);
  assert.match(screen, new RegExp(`QA +${INV} · observe · 1 step · runs 0 ✓ 0 ✗ · 1 finding · running`));
  assert.match(screen, /⚠ finding SUSPECTED_DEFECT low · reproduced/);
  assert.match(screen, /RECENT +newest on top · milestones/);
  assert.ok(screen.indexOf("Fix recorded") < screen.indexOf("Tests failed") && screen.indexOf("Tests failed") < screen.indexOf("Build succeeded"), "newest on top");
  assert.match(screen, /NOTICES +\[11:36:54\] ✗ TEST failed · 3 of 12 failing \(act-5\)/);
});

test("a workflow: its steps over the plan's own count, its engineering task's checks, and a reported step said as reported", () => {
  const screen = text(workflow());
  assert.match(screen, new RegExp(`WORKFLOW +▓+░+ +1/4 steps +engineering ${ENG} EXECUTING · TESTING +1/2 verified`));
  assert.match(screen, /requirement ✓ 10s/);
  assert.match(screen, /context ~ reported/);
  assert.match(screen, /engineering [◐◓◑◒] 5m00s agent orbit-engineer/);
  assert.match(screen, /review ·/);
  assert.match(screen, /BUILD ✓/);
  assert.match(screen, /workflow/);
});

test("an approval is said where a person looks, with where to decide it, and no key decides it", () => {
  const approval = { id: "apr-1", action: "database.migrate", environment: "dev", reason: "needs schema 82", state: "pending", open: true };
  const s = engineering({ view: { lifecycle: "WAITING_APPROVAL", approvals: [approval] }, events: [...[{ source: "task", n: 0, at: ago(4), kind: "approval-requested", id: "apr-1", action: "database.migrate", environment: "dev" }]] });
  const screen = text(s);
  assert.match(screen, /⏸ WAITING APPROVAL/);
  assert.match(screen, /waiting for a person: apr-1 · database\.migrate on dev · decide in Orbit Control/);
  assert.match(text(keys(s, { type: "overlay", name: "evidence" })), /approval +apr-1 +pending +database\.migrate on dev +decide in Orbit Control/);
  const decides = Object.values(KEYMAP).flatMap((l) => Object.values(l)).filter((a) => typeof a === "object" && /^(approv|grant|reject|resume|cancel|pause|stop|release|start)/.test(a.type));
  assert.deepEqual(decides, []);
});

test("evidence: a reported action is not proof, and a field the record lacks says NOT RECORDED", () => {
  const reportedAct = { id: "act-7", type: "implement", state: "succeeded", startedAt: ago(9), endedAt: ago(8), receipts: [], evidence: "reported", summary: "changed validator" };
  const s = reduce(keys(engineering({ view: { actions: [...engView().actions, reportedAct] } }), { type: "overlay", name: "evidence" }), { type: "extents", extents: { recent: { max: 0, page: 1 }, sandbox: { max: 0, page: 1 }, overlay: { max: 20, page: 5 } } });
  assert.match(text(s), /reported +act-7 implement +reported, not proven/);
  assert.ok(!/act-6/.test(text(s)), "a running action is not yet reported");
  const opened = keys(s, { type: "move", by: 1 }, "pick");
  assert.match(text(opened), /source +NOT RECORDED/);
});

test("the picker lists the registry's checkouts and this checkout's tasks, a workflow's engineering task under it", () => {
  const s = keys(reduce(reduce(reduce(workflow(), { type: "projects", projects: [{ key: "refunds", name: "refunds", checkouts: [{ id: HERE, root: "/work/refunds", summary: { branch: "feature/refunds" } }, { id: "d".repeat(64), root: "/work/b", summary: null }] }] }), { type: "rows", checkoutId: HERE, rows: [{ id: WF, checkout: HERE, terminal: false, createdAt: ago(400), coordinates: true }, { id: ENG, checkout: HERE, terminal: false, createdAt: ago(300), coordinates: false }] }), { type: "children", children: { [WF]: ENG }, views: {} }), { type: "overlay", name: "picker" });
  const items = pickerItems(s);
  assert.deepEqual(items.map((i) => [i.kind, i.depth, i.task ?? null]), [["project", 0, null], ["checkout", 1, null], ["task", 2, WF], ["task", 3, ENG], ["checkout", 1, null]]);
  assert.equal(items[s.viewer.cursor].task, WF, "the picker opens on the task shown");
  assert.match(text(s), /2 running · 0 ended/);
  const other = keys(reduce(s, { type: "extents", extents: { ...s.viewer.extents, overlay: { max: 4, page: 3 } } }), { type: "edge", to: "end" }, "pick");
  assert.equal(other.picker.expanded["d".repeat(64)], true);
});

test("the association is followed until a person picks; AMBIGUOUS leaves the picker open", () => {
  const none = stateOf({ root: null, start: { root: null, overlay: "picker", association: { how: "ambiguous", task: null, ids: ["tsk-111111111111", "tsk-222222222222"] } } });
  assert.match(text(none), /2 tasks run in this checkout: pick the one to show/);
  assert.match(text(stateOf({ root: null, start: { root: null, overlay: "picker", association: { how: "none", task: null, ids: [] } } })), /no task here yet: one started here is shown by itself/);
  const found = reduce(none, { type: "association", association: { how: "session", task: ENG, ids: [ENG] } });
  assert.deepEqual([found.root, found.viewer.overlay], [ENG, null]);
  const picked = { ...none, picker: { ...none.picker, auto: false } };
  assert.equal(reduce(picked, { type: "association", association: { how: "session", task: ENG, ids: [ENG] } }).root, null);
});

test("bars draw a count only with its total; sizes read as a person says them", () => {
  assert.equal(bar(3, 12, 12), "▓▓▓░░░░░░░░░");
  assert.equal(bar(1, null, 10), null);
  assert.equal(bar(0, 0, 10), null);
  assert.deepEqual([bytesOf(12), bytesOf(2048), bytesOf(5 * 1024 * 1024), bytesOf(null)], ["12 B", "2.0 KB", "5.0 MB", "?"]);
});

test("a task the association chose gives way, once it ended, to the task it names next; a picked task never does", () => {
  const ended = engineering({ start: { auto: true }, view: { lifecycle: "COMPLETED", terminal: true, ended: { kind: "completed" } } });
  const s = reduce(ended, { type: "frames", task: ENG, frames: [{ event: "end", id: "t=9", data: { reason: "terminal" } }] });
  const next = { how: "checkout", task: WF, ids: [WF] };
  assert.equal(reduce(s, { type: "association", association: next }).root, WF, "the work that started is followed");
  assert.equal(reduce(s, { type: "association", association: { how: "finished", task: WF, ids: [WF] } }).root, ENG, "never from one ended task to another");
  assert.equal(reduce({ ...s, picker: { ...s.picker, auto: false } }, { type: "association", association: next }).root, ENG, "a person's choice stays");
  assert.equal(reduce(engineering(), { type: "association", association: next }).root, ENG, "a running task stays");
});

test("a directory bound after the viewer opened becomes its place once, and only once", () => {
  const none = stateOf({ root: null, start: { root: null, place: null, overlay: "picker" } });
  const found = reduce(none, { type: "located", place: { ...none.place, key: "k", checkoutId: HERE } });
  assert.equal(found.place.checkoutId, HERE);
  assert.equal(found.picker.expanded[HERE], true);
  assert.equal(reduce(found, { type: "located", place: { key: "k", checkoutId: "d".repeat(64) } }).place.checkoutId, HERE);
  assert.match(text(none), /not a Orbit checkout yet: a task started here is shown by itself/);
});

test("VERIFY: what the change is held to, read off the journal -- regressed, missing, owed, failed as before, passed, NOT AFFECTED, the baseline and the blockers", () => {
  const impact = { key: "impact:imp-9", domain: "impact", ref: "imp-9", outcome: "MISSING", summary: "changes: 2 component(s) reached (c:web modified, c:e2e dependent); 3 check(s) required, 2 not affected, 1 with nothing to verify it", at: ago(30) };
  const verification = [
    { subject: "rt-1", obligation: "c:web · build build:web passes", state: "satisfied" },
    { subject: "rt-2", obligation: "c:web · test test:web fails no worse than before the change", state: "satisfied" },
    { subject: "rt-3", obligation: "c:e2e · test test:e2e passes", state: "violated" },
    { subject: "rt-4", obligation: "c:api · build build:api — not affected, not run", state: "not-applicable" },
    { subject: "rt-5", obligation: "c:infra · verify validate:infra — not affected, not run", state: "not-applicable" },
    { subject: "missing-0123456789", obligation: "nothing declared verifies docs/refunds.md", state: "blocked" },
  ];
  const screen = text(engineering({ rows: 50, view: { receipts: [impact], verification } }));
  assert.match(screen, /VERIFY +MISSING +▓+░* +2\/3 settled +2 not affected +1 missing/);
  assert.match(screen, /BLOCKERS 1 regressed · 1 with nothing to verify it/);
  assert.match(screen, /✗ c:e2e · test test:e2e passes +REGRESSED/);
  assert.match(screen, /⚠ nothing declared verifies docs\/refunds\.md +MISSING/);
  assert.match(screen, /≈ c:web · test test:web fails no worse than before the change +failed as before/);
  assert.match(screen, /✓ c:web · build build:web passes +passed/);
  assert.match(screen, /· 2 not affected — not run: c:api · build build:api, c:infra · verify validate:infra/);
});

test("VERIFY is absent for a task whose journal holds no impact receipt: a task recorded before 1.8.4 draws as it did", () => {
  assert.doesNotMatch(text(engineering()), /VERIFY/);
});
