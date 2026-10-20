// The exploration page: one session over one surface, and the half a list of
// controls cannot give anybody -- what a person still has to answer.
//
// An exploration earns no verdict, so every test here is about what the page
// DERIVES from what was observed. Nothing on it may be a judgement the session
// did not make.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LAYERS } from "../src/dsl/verbs.mjs";
import { exploreHtml, exploreModel, hasCharter, readObservations } from "../src/report/explore.mjs";

// Built with join, like the code under test: a literal "test/fixtures/…" is a
// path only POSIX agrees with, and this suite has been broken that way before.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "explore.jsonl");
const records = readObservations(readFileSync(FIXTURE, "utf8"));

// The point of the page. A reader who sees six controls and two cases would
// sign this screen off; five separate things on it have not been answered.
test("what still needs a person is derived from the observations, not asserted by hand", () => {
  const { manual } = exploreModel(records);
  const by = Object.fromEntries(manual.map((m) => [`${m.kind}|${m.about}`, m.say]));
  assert.ok(by["open question|home/Export"], "a question the browser could not answer is the deliverable, not a gap");
  assert.ok(by["never touched|home/Export"], "a control on the surface that nothing exercised is still a hypothesis");
  assert.ok(by["contradiction to reproduce|home/Star"], "a contradiction is handed over to be reproduced, never filed by the page");
  assert.ok(by["case not kept|star-thing"], "a case that did not survive its own run is in no screen folder, and the page says so");
  assert.equal(by["open question|dlg-thing/Save"], undefined, "Save proved all three layers — there is nothing left to ask");
});

// The optimistic-render trap, and the reason it is not read off a label: every
// keystroke moves the screen without calling anything, so a rule keyed on "did
// the screen change" reports each one and the real finding drowns in them. The
// session that clicked the control knew whether it commits, so it says so, and
// a guess never gets to raise a contradiction.
test("a control that asked the server for nothing is a finding only where the session said it commits", () => {
  const { actions } = exploreModel(records);
  const quiet = actions.filter((a) => a.quiet).map((a) => a.on);
  assert.deepEqual(quiet, ["home/Import"]);
  assert.ok(!quiet.includes("dlg-thing/Name"), "typing into a textbox calls nothing and is not a finding");
  assert.ok(!quiet.includes("home/Refresh"), "a refresh commits nothing, so a cached list is not reported as a lost save");
  const unmarked = exploreModel([{ kind: "charter", screen: "home" }, { kind: "action", on: "home/Save", saw: { ui: "saved", api: [] } }]);
  assert.equal(unmarked.actions[0].quiet, false, "a session that did not record what it was doing has not found anything — the label is not asked");
});

// The one contradiction a page can be certain of while knowing nothing about
// the product: the screen said yes and the call said no.
test("a call outside 2xx marks the action, and the status keeps its own tone", () => {
  const { actions } = exploreModel(records);
  const star = actions.find((a) => a.on === "home/Star");
  const save = actions.find((a) => a.on === "dlg-thing/Save");
  assert.equal(star.broke, true);
  assert.equal(save.broke, false, "201 is a success, not merely 'not 200'");
  assert.equal(star.layers.find((l) => l.id === "api").calls[0].tone, "fail");
});

// A layer is what a VERB proves. Hard-coding ui/api/sql here would mean the day
// a verb rules on a fourth one, the page silently drops what was seen there.
test("every action is laid out on every layer the verb table knows, and an unwatched layer says so", () => {
  const { actions } = exploreModel(records);
  const add = actions.find((a) => a.on === "home/Add");
  assert.deepEqual(add.layers.map((l) => l.id), LAYERS);
  assert.equal(add.layers.find((l) => l.id === "sql").none, true, "sql cannot be seen from a browser — unwatched is not 'proven untouched'");
  assert.equal(add.layers.find((l) => l.id === "ui").text, "the Thing dialog opened");
});

test("the session is summarised in one line, and a contradiction colours the whole page", () => {
  const m = exploreModel(records);
  assert.match(m.callout, /7 control\(s\) · 6 acted on · 1 contradiction\(s\) · 1\/2 case\(s\) kept · 5 item\(s\)/);
  assert.equal(m.calloutClass, "danger", "one contradiction colours the session, whatever the other counts say");
  assert.equal(exploreModel([{ kind: "charter", screen: "home", write: true }]).calloutClass, "ok", "nothing outstanding is the only page that reads as done");
});

// A session that never submitted saw only the screen. Saying nothing would let
// it be read as "the writes were fine", which is the one thing it cannot know.
test("a read-only session owes a person the whole layer it never witnessed", () => {
  const readOnly = records.filter((r) => r.kind !== "charter").concat([{ kind: "charter", screen: "home", say: "look only", write: false }]);
  const kinds = exploreModel(readOnly).manual.map((m) => m.kind);
  assert.ok(kinds.includes("nothing below the screen"));
  assert.ok(!exploreModel(records).manual.some((m) => m.kind === "nothing below the screen"), "a --write session witnessed calls, so it does not owe that");
});

// Every value on the page came from a product's own screen, url or response.
test("the page escapes what the product put in it", () => {
  const html = exploreHtml(records, { project: "fixture" });
  assert.ok(!html.includes("<script>alert(1)</script>"), "a response body quoted in a finding is escaped like everything else");
  assert.match(html, /&lt;script&gt;/);
});

// A file somebody pointed at by mistake would render every section empty and
// read as "nothing to report" -- the one thing an exploration must never say by
// accident. And a line lost to an interrupted session costs that line only.
test("a charter is required, and a broken line costs its own line", () => {
  assert.equal(hasCharter(records), true);
  assert.equal(hasCharter(readObservations('{"kind":"control","on":"home/Add"}')), false);
  const torn = readObservations('// a comment\n\n{"kind":"charter","screen":"home"}\n{"kind":"control", THIS IS NOT JSON\n{"kind":"question","ask":"still read"}');
  assert.equal(torn.length, 2, "the comment, the blank and the torn line are skipped; the records after it survive");
  assert.equal(torn[1].ask, "still read");
});
