import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { caseInPage } from "../src/case-block.mjs";
import { reportHtml, writeReport } from "../src/report/index.mjs";
import { latestRun, readRun } from "../src/report/read.mjs";
import { model, sqlCommandLine } from "../src/report/model.mjs";
import { esc } from "../src/report/html.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { fakeContext as baseContext } from "./fakes/context.mjs";

const STORE = mkdtempSync(join(tmpdir(), "orbit-report-store-"));
const OUT = join(STORE, "evidence");
const fakeContext = (opts = {}) => baseContext({ ...opts, store: () => STORE });
const REPORTS = mkdtempSync(join(tmpdir(), "orbit-ui-test-report-test-out-"));
const RECORDS = [
  { kind: "run", case: "create-thing", params: { NAME: "TC-1" }, origin: "https://app.test", sqlCommand: ["node", "sqlcmd.mjs"], fe_commit: "abc1234" },
  { kind: "identity", as: "admin", upn: "a@b.c", roles: ["App.Admin"] },
  { kind: "resolve", resolved: [{ as: "ID", value: "42", sql: "SELECT TOP 1 Id FROM Things WHERE Name='TC-1'" }] },
  { kind: "step", i: 6, do: "api", match: "api/things", method: "POST", status: 201, ok: true, result: { method: "POST", url: "https://app.test/api/things", status: 201 } },
  { kind: "step", i: 7, do: "sql", query: "SELECT COUNT(*) AS n FROM Things WHERE Name='TC-1'", expect: "Number(it[0].n) === 1", ok: true, rows: [{ n: "1" }] },
  { kind: "step", i: 8, do: "report", js: "JSON.stringify({ok:true})", expect: "it.ok === true", ok: true, result: '{"ok":true}' },
  { kind: "result", status: "PASS", done: 8, of: 8, ms: 12000, verdicts: 3, proved: { ui: 1, api: 1, sql: 1 } },
];

test.before(() => rmSync(OUT, { recursive: true, force: true }));

// The first line a reader sees. `steps` meant two things -- the count in the
// header and the rows of the table below -- and the spread in view() settled the
// clash by declaration order, so every report opened with
// "[object Object],[object Object] steps". No test read the header, and a
// template bug is only ever found by rendering the thing and looking at it.
test("the header counts the steps, and the table below still has its rows", () => {
  const html = reportHtml(RECORDS);
  assert.ok(html.includes("8/8 steps"), "the header says how far the run got");
  assert.ok(!html.includes("[object Object]"), "a list must never reach the page as one");
  assert.ok(html.includes("<td>sql</td>"), "the step table kept its rows");
});

// A tester repeats the query by hand, so the name has to read the way a case
// writes it. `${` in front of a {{tag}} is four braces the parser takes as a
// triple-stache, and the opening one was eaten: every row printed `$ID}`.
test("a resolved value is labelled the way a case would write it", () => {
  assert.ok(reportHtml(RECORDS).includes("${ID}"), "shows ${ID}, not $ID}");
});

// The reason the file exists: a report that says "sql ✓" and hides the query
// cannot be checked by hand, and a pass nobody can check is an opinion.
test("the SQL a run asked is in the report AS SENT, with the command to repeat it", () => {
  const html = reportHtml(RECORDS);
  assert.match(html, /SELECT COUNT\(\*\) AS n FROM Things WHERE Name=&#039;TC-1&#039;|SELECT COUNT\(\*\) AS n FROM Things WHERE Name='TC-1'/);
  assert.ok(!html.includes("${NAME}"), "the template would ask a different question than the run did");
  // Escaped in the markup, un-escaped by the browser the moment it is copied --
  // which is how the button hands over a line that actually runs.
  assert.match(html, /node sqlcmd\.mjs &quot;SELECT COUNT/, "the line a tester pastes into a terminal");
  assert.match(html, /SELECT TOP 1 Id FROM Things/, "resolve decided WHICH row the case was about");
});

test("all three layers are named, each with what it proved", () => {
  const html = reportHtml(RECORDS);
  for (const [id, title, sub] of [["ui", "UI", "what the screen showed"], ["api", "API", "the call the screen made"], ["sql", "SQL", "the data underneath"]]) {
    assert.ok(html.includes(`<span class="lbl ${id}">${title}</span>`), `${title} layer missing`);
    assert.ok(html.includes(sub), `${title} is not explained`);
  }
  assert.match(html, /POST https:\/\/app\.test\/api\/things → 201/);
  assert.match(html, /<td class="mono">1<\/td>/, "the row the query returned");
  assert.match(html, /proved <code>ui 1<\/code> <code>api 1<\/code> <code>sql 1<\/code>/);
});

test("a layer nothing ruled on says so rather than looking clean", () => {
  const html = reportHtml([{ kind: "run", case: "ui-only" }, { kind: "step", i: 1, do: "assert", js: "true", ok: true }, { kind: "result", status: "PASS", proved: { ui: 1, api: 0, sql: 0 } }]);
  assert.equal(html.split("This run proved nothing at this layer.").length - 1, 2, "api and sql both say it");
});

// The values come from a product's own screens and database. A page that breaks
// on an apostrophe or a <script> in a row is a page nobody can trust.
test("every recorded value is escaped into the page", () => {
  const html = reportHtml([...RECORDS, { kind: "step", i: 9, do: "sql", query: "SELECT '<script>alert(1)</script>' AS x", ok: false, rows: [], error: "boom & <b>" }]);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /boom &amp; &lt;b&gt;/);
  assert.equal(esc('a"b<c&d'), "a&quot;b&lt;c&amp;d");
});

test("a failed step brings its own evidence, and an unreadable screenshot says so", () => {
  const html = reportHtml([
    { kind: "run", case: "smoke" },
    { kind: "step", i: 2, do: "assert", js: "document.title.length>0", ok: false, error: "assert failed: has a title", url: "/home", screenshot: "/tmp/somewhere/else/step-02.png", networkFailures: ["1. [GET] /api/menu => [403] Forbidden"] },
    { kind: "result", status: "FAIL", done: 1, of: 3, proved: { ui: 0, api: 0, sql: 0 } },
  ]);
  assert.match(html, /badge fail">FAIL/);
  assert.doesNotMatch(html, /<img/, "a broken <img> lies twice: about there being a picture, and about which one");
  assert.match(html, /screenshot not readable — step-02\.png/);
  assert.ok(!html.includes("/tmp/somewhere/else"), "an absolute path breaks the moment the directory is copied");
  assert.match(html, /403\] Forbidden/);
  assert.match(html, /0 of 1 held/, "the layer that asked and did not get an answer");
});

// A log cut short mid-write still has to render something a reader can act on,
// rather than an alarm about arithmetic.
test("a tally that outruns the steps on record does not accuse the run", () => {
  const html = reportHtml([{ kind: "run", case: "truncated" }, { kind: "result", status: "PASS", proved: { ui: 1, api: 0, sql: 0 } }]);
  assert.ok(!html.includes("of 0 held"));
  assert.match(html, /1 proved/);
});

test("the model reads the log and refuses a directory that holds no run", () => {
  const o = runCase(fakeContext(), ["create-thing", "NAME=TC-1", `--out=${join(OUT, "pass")}`]);
  const file = writeReport(o.run.out, REPORTS);
  assert.ok(existsSync(file));
  assert.equal(file, join(REPORTS, "home", "create-thing", "pass.html"), "the report leaves the evidence behind, under its screen and case, named after the run");
  assert.match(readFileSync(file, "utf8"), /SELECT COUNT\(\*\) AS n FROM Things WHERE Name='TC-1'/);
  assert.throws(() => readRun("/tmp"), /no run-log\.jsonl in \/tmp/);
  assert.deepEqual(model(readRun(o.run.out)).proved, { ui: 1, api: 1, sql: 1 });
});

// Every run of every case now shares one evidence room, so "the run I just
// made" cannot be the alphabetically last directory: `smoke-2026-01-01` sorts
// after `archive-thing-2026-09-21`, and `report` rendered a run from January.
test("the latest run is the newest one, not the last one alphabetically", () => {
  const room = join(OUT, "room");
  rmSync(room, { recursive: true, force: true });
  for (const n of ["zebra-case-2026-01-01-08-00-00", "aardvark-case-2026-09-21-08-00-00"]) mkdirSync(join(room, n), { recursive: true });
  assert.equal(latestRun(room), join(room, "aardvark-case-2026-09-21-08-00-00"));
  assert.throws(() => latestRun(join(OUT, "never")), /no run under/);
});

test("a project with no sql command gets no command line to paste", () => {
  assert.equal(sqlCommandLine({}, "SELECT 1"), null);
  assert.equal(sqlCommandLine({ sqlCommand: ["sqlcmd"] }, 'SELECT "a"'), 'sqlcmd "SELECT \\"a\\""');
});

// The counterpart to the failure card: a run that passed showed a reader
// nothing it saw, so "PASS · proved ui 1" had to be taken on faith.
test("a verdict that held shows its screen, and is not described as a failure", () => {
  const html = reportHtml([
    { kind: "run", case: "smoke" },
    { kind: "step", i: 4, do: "assert", js: "document.title.length>0", ok: true, screenshot: "/tmp/elsewhere/step-04.png" },
    { kind: "result", status: "PASS", done: 4, of: 4, proved: { ui: 1, api: 0, sql: 0 } },
  ]);
  assert.doesNotMatch(html, /<img/, "the file is gone, so there is nothing honest to show");
  assert.match(html, /screenshot not readable — step-04\.png/);
  assert.ok(!html.includes("/tmp/elsewhere"), "an absolute path breaks the moment the directory is copied");
  assert.ok(!/alt="[^"]*failed/.test(html), "a screen reader was being told every held verdict broke");
});

// The report is handed to somebody -- attached to a ticket, pasted into a chat,
// mailed -- and the evidence room it came from is pruned. A sibling .png
// survives none of that, so EVERY picture travels inside the file and a file
// link is never written at all.
test("every screenshot travels inside the report, and nothing is ever linked", () => {
  const o = runCase(fakeContext(), ["create-thing", "NAME=TC-1", `--out=${join(OUT, "embed")}`]);
  const html = readFileSync(writeReport(o.run.out, REPORTS), "utf8");
  assert.match(html, /<img class="shot" src="data:image\/png;base64,[A-Za-z0-9+/=]+"/, "the picture is in the file");
  for (const img of html.match(/<img[^>]*>/g) ?? []) {
    assert.match(img, /src="data:image\/png;base64,/, `an image was linked rather than embedded: ${img}`);
  }
  for (const png of readdirSync(o.run.out).filter((n) => n.endsWith(".png"))) rmSync(join(o.run.out, png));
  assert.match(readFileSync(writeReport(o.run.out, REPORTS), "utf8"), /screenshot not readable/, "the report still renders once its evidence is pruned");
});

// The verb wrote a PNG and no column pointed at it: the file existed and no
// report could ever show it.
test("a screenshot the case asked for reaches the log, and the report shows it", () => {
  const html = reportHtml([
    { kind: "run", case: "smoke" },
    { kind: "step", i: 3, do: "screenshot", file: "after.png", ok: true, screenshot: join(OUT, "embed-asked", "after.png") },
    { kind: "result", status: "PASS", done: 3, of: 3, proved: { ui: 0, api: 0, sql: 0 } },
  ]);
  assert.match(html, /Visual evidence/);
  assert.match(html, /screenshot not readable — after\.png/, "and says so when the file is not there");
});

// The report is the artefact that travels and the one thing that is never
// pruned, so it is the last copy of a case once the file is gone -- deleted,
// rewritten, or simply on somebody else's machine. "Can you run that again?"
// is then answered by what is already attached to the ticket.
test("a report is enough to run its case again, with the file deleted", () => {
  const first = runCase(fakeContext(), ["create-thing", "NAME=TC-1", `--out=${join(OUT, "rt")}`]);
  const report = writeReport(first.run.out, REPORTS);

  const again = runCase(fakeContext(), [report, "NAME=TC-1", `--out=${join(OUT, "rt2")}`]);
  assert.equal(again.c.id, "create-thing", "the case came out of the HTML");
  assert.equal(again.status, first.status);
  assert.deepEqual(again.run.proved, first.run.proved, "and proved the same three layers");
});

// One block, and the only thing between what a person reads and what the parser
// reads is the escaping table both sides share (src/case-block.mjs).
test("the case block survives values that have to be escaped, and says so when it is absent", () => {
  const nasty = { id: "x", name: 'a "quoted" <b> & more &lt; &amp;quot;', steps: [{ do: "goto", screen: "home" }] };
  const html = reportHtml([{ kind: "run", case: "x", source: nasty }, { kind: "result", status: "PASS", proved: { ui: 0, api: 0, sql: 0 } }]);
  const block = /<pre id="orbit-case">([\s\S]*?)<\/pre>/.exec(html)[1];
  assert.ok(!block.includes("<b>") && block.includes("&lt;b&gt;"), "escaped in the page like every other product value");
  assert.deepEqual({ ...caseInPage(html, "/r/x.html"), _file: undefined }, { ...nasty, _file: undefined }, "and comes back byte for byte");

  const old = caseInPage("<html>a report from before this existed</html>", "/r/old.html");
  assert.match(old._broken, /holds no Orbit case block/, "an old report is a sentence, not a stack trace");
  assert.match(caseInPage(`<pre id="orbit-case">{oops</pre>`, "/r/b.html")._broken, /not valid JSON/);
});

// One run cannot say whether a case is steady. That is the one question the
// ledger can answer and run-log.jsonl cannot, which is why it is the report's
// only input that is not the log -- and why it stays optional.
test("a report carries the last few runs of its case, and renders without them", () => {
  const history = [
    { case: "smoke", at: "2026-09-15T09:00:00Z", status: "PASS", host: "laptop-a", ms: 12000 },
    { case: "smoke", at: "2026-09-16T09:00:00Z", status: "FAIL", host: "laptop-a", ms: 31000 },
    { case: "smoke", at: "2026-09-17T09:00:00Z", status: "PASS", host: "laptop-b", ms: 11000 },
    { case: "other", at: "2026-09-17T09:00:00Z", status: "FAIL", host: "laptop-a", ms: 900 },
  ];
  const records = [{ kind: "run", case: "smoke" }, { kind: "step", i: 1, do: "assert", ok: true }, { kind: "result", status: "PASS", done: 1, of: 1, proved: { ui: 1, api: 0, sql: 0 } }];

  const band = reportHtml(records, { history });
  assert.match(band, /The last few runs of this case/);
  assert.match(band, /laptop-b/);
  assert.ok(!band.includes("other"), "another case's history is not this case's history");

  assert.doesNotMatch(reportHtml(records), /The last few runs/, "a report made months later from a copied directory still renders, without a band");
  assert.doesNotMatch(reportHtml(records, { history: [history[0]] }), /The last few runs/, "and one run is not a history");
});
