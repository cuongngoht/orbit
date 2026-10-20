// The session review: one page over the ledger, and the half a green table
// cannot give anybody -- what a person still has to do.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { reviewHtml, reviewModel } from "../src/report/review.mjs";

const RUNS = [
  { case: "create-thing", start: "home", status: "PASS", at: "2026-09-18T08:00:00.000Z", host: "laptop-a", done: 8, of: 8, ms: 12400, proved: { ui: 2, api: 1, sql: 1 }, identity: [{ as: "admin" }], evidence: "/e/create-thing" },
  { case: "smoke", status: "PASS", at: "2026-09-18T08:10:00.000Z", host: "laptop-a", done: 3, of: 3, ms: 4000, proved: { ui: 1, api: 0, sql: 0 }, evidence: "/e/smoke" },
  { case: "open-thing", status: "BLOCKED", at: "2026-09-18T08:20:00.000Z", host: "laptop-a", done: 1, of: 5, proved: { ui: 0, api: 0, sql: 0 } },
  { case: "archive-thing", status: "FAIL", at: "2026-09-18T08:30:00.000Z", host: "laptop-a", done: 4, of: 9, proved: { ui: 1, api: 0, sql: 0 }, failedStep: { i: 5, do: "click", on: "detail/Archive" } },
];

// The point of the page. A tester who reads only the table signs off four cases;
// three of them have not been verified by anybody.
test("what still needs a person is derived from the runs, not asserted by hand", () => {
  const { manual } = reviewModel(RUNS, { cases: ["create-thing", "smoke", "open-thing", "archive-thing", "delete-thing"] });
  const by = Object.fromEntries(manual.map((m) => [m.case, m.kind]));
  assert.equal(by["smoke"], "proved on the screen only", "a PASS with no witness below the screen is not a verified write");
  assert.equal(by["open-thing"], "no verdict on the product", "BLOCKED ruled on nothing — and is not a defect");
  assert.equal(by["archive-thing"], "failed");
  assert.equal(by["delete-thing"], "not run in this window", "a case nobody ran is the easiest thing in a session to lose");
  assert.equal(by["create-thing"], undefined, "it proved ui, api and sql — there is nothing left to ask of a human");
});

test("the runs are counted by verdict, and a failure says where it stopped", () => {
  const m = reviewModel(RUNS);
  assert.deepEqual(m.totals, [{ status: "PASS", n: 2, tone: "pass" }, { status: "BLOCKED", n: 1, tone: "warn" }, { status: "FAIL", n: 1, tone: "fail" }]);
  assert.equal(m.rows.find((r) => r.case === "archive-thing").why, "failed at step 5 click detail/Archive");
  assert.match(m.callout, /^2\/4 PASS · 3 item\(s\)/, "no case list was given, so nothing is reported as un-run");
  assert.equal(m.calloutClass, "danger", "one failure colours the whole session, whatever the other rows say");
  assert.equal(reviewModel([RUNS[0]]).calloutClass, "ok", "nothing outstanding is the only case that reads as done");
});

// A link that 404s once teaches a reader to stop trusting the other links too.
//
// The report no longer sits beside the evidence, so the link is derived: the
// reports directory plus the run's own name. Built with join, like the code
// under test -- a literal "/r/….html" never matched on Windows, where the
// separator is a backslash, so the link came back empty on one OS only.
test("only a report that is actually on disk is linked", () => {
  const written = join("/r", "home", "create-thing", "create-thing.html");
  const has = (file) => file === written;
  const { rows } = reviewModel(RUNS, { has, reports: "/r" });
  assert.equal(rows[0].report, written);
  assert.equal(rows[1].report, "", "smoke was run without --report, so there is nothing to link and no path to show instead");
  assert.equal(reviewModel(RUNS, { has }).rows[0].report, "", "no reports directory means no link, never a guess");
});

// Every value on the page came from a product's own screen, url or database.
test("the page escapes what the product put in it", () => {
  const nasty = [{ ...RUNS[3], failedStep: { i: 1, do: "click", on: "<script>alert(1)</script>" } }];
  const html = reviewHtml(nasty, {});
  assert.ok(!html.includes("<script>alert(1)</script>"), "a step name is escaped like everything else");
  assert.match(html, /&lt;script&gt;/);
});
