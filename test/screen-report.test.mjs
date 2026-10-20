// ONE SCREEN, every case that touched it. The artefact that answers the
// question the other four could not: "how far has this screen been checked?"
//
// Every verdict on the page is the one its run earned. These tests exist mostly
// to prove that nothing here re-judges one, and that a page cannot be made to
// look more tested than the ledger says.
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenHtml, screenModel } from "../src/report/screen.mjs";

const run = (over) => ({ case: "c", status: "PASS", at: "2026-09-20T09:00:00Z", host: "laptop-a", ms: 5000, screens: ["home"], evidence: `/ev/${over.case ?? "c"}`, proved: { ui: 1, api: 0, sql: 0 }, done: 2, of: 2, ...over });

const log = (over = {}) => [
  { kind: "run", case: over.case ?? "c", source: { id: over.case ?? "c", name: over.name ?? "A case" }, sqlCommand: ["sqlcmd"] },
  ...(over.identity ?? []).map((i) => ({ kind: "identity", ...i })),
  ...(over.queries ?? []).map((q, n) => ({ kind: "step", i: n + 1, do: "sql", query: q, ok: true })),
  { kind: "result", status: over.status ?? "PASS", done: 2, of: 2, proved: over.proved ?? { ui: 1, api: 0, sql: 0 } },
];

const loader = (byDir) => (dir) => byDir[dir] ?? null;

// The whole selection is one filter over the ledger's `screens` field. Reading
// the cases off disk instead would make the answer depend on files that may
// have been edited since the run.
test("only the runs that touched this screen appear, and only the latest of each case", () => {
  const runs = [
    run({ case: "a", at: "2026-09-19T09:00:00Z", status: "FAIL" }),
    run({ case: "a", at: "2026-09-20T09:00:00Z", status: "PASS" }),
    run({ case: "b", screens: ["detail"] }),
  ];
  const m = screenModel("home", runs, loader({ "/ev/a": log({ case: "a" }) }));
  assert.deepEqual(m.cases.map((c) => c.case), ["a"], "b never touched this screen");
  assert.equal(m.cases[0].status, "PASS", "the newest run of a case is where it stands now, not its worst day");
  assert.equal(m.total, 1);
});

// Only PASS verifies. A page that summed grey as "checked" would be the exact
// mistake RUN_STATES exists to prevent.
test("only PASS is counted as verified, and an untouched screen says so", () => {
  const runs = ["PASS", "SKIP", "BLOCKED", "PARTIAL"].map((status, n) => run({ case: `c${n}`, status, proved: { ui: 1, api: 0, sql: 0 } }));
  const dirs = Object.fromEntries(runs.map((r) => [r.evidence, log({ case: r.case, status: r.status })]));
  const m = screenModel("home", runs, loader(dirs));
  assert.equal(m.total, 4);
  assert.equal(m.verified, 1, "three of these ruled on nothing");
  assert.equal(m.verdictClass, "warn");

  const empty = screenModel("nowhere", runs, loader(dirs));
  assert.deepEqual(empty.cases, []);
  assert.match(empty.verdict, /no run has touched this screen yet/, "and never 0/0 dressed up as complete");
});

// Evidence is pruned on purpose. A screen that looked less tested the longer
// you kept testing it would be worse than no page at all.
test("a case whose evidence was pruned keeps its verdict, and says where the pictures went", () => {
  const m = screenModel("home", [run({ case: "gone", status: "PASS" })], loader({}));
  assert.equal(m.cases[0].status, "PASS", "the ledger still holds the verdict");
  assert.match(m.cases[0].gone, /evidence has been pruned/);
  assert.match(m.cases[0].gone, /inside that run's own report/, "and says where they are, not merely that they are missing");
  assert.deepEqual(m.cases[0].shots, []);
  assert.equal(m.verified, 1, "pruning a directory does not un-verify a run");
});

// "The administrator could" says nothing about what somebody without the role
// could, which is why a scoping answer is this table or is nothing.
test("the identity matrix keeps the roles, dedupes the actors, and names the cases", () => {
  const runs = [run({ case: "a" }), run({ case: "b" })];
  const dirs = {
    "/ev/a": log({ case: "a", identity: [{ as: "admin", upn: "real@customer.example", roles: ["Cat Admin"] }] }),
    "/ev/b": log({ case: "b", identity: [{ as: "admin", upn: "real@customer.example", roles: ["Cat Admin"] }, { as: "plain", roles: [] }] }),
  };
  const m = screenModel("home", runs, loader(dirs));
  assert.deepEqual(m.identities.map((i) => i.as).sort(), ["admin", "plain"], "one row per actor+roles, not one per run");
  assert.equal(m.identities.find((i) => i.as === "admin").cases, "a, b");
  assert.equal(m.identities.find((i) => i.as === "admin").roles, "Cat Admin", "which roles were held is the point");
  assert.equal(m.identities.find((i) => i.as === "plain").roles, "—", "and an actor holding none says so rather than being blank");
});

// Re-running the query by hand is the only reason this page beats a screenshot.
test("every query asked of the data underneath is listed once, with the line that repeats it", () => {
  const runs = [run({ case: "a" }), run({ case: "b" })];
  const same = "SELECT COUNT(*) FROM Things";
  const dirs = {
    "/ev/a": log({ case: "a", queries: [same, "SELECT Id FROM Users"] }),
    "/ev/b": log({ case: "b", queries: [same] }),
  };
  const m = screenModel("home", runs, loader(dirs));
  assert.equal(m.queries.length, 2, "the same question asked twice is one question");
  assert.ok(m.queries.every((q) => q.rerun.startsWith("sqlcmd ")), "each one carries the command that runs it again");
  assert.ok(m.queries.some((q) => q.asked === "step 1"));
});

// Nothing on this page may invent a reason a run did not give.
test("what still needs a person comes from the runs, in their own words", () => {
  const runs = [
    run({ case: "skipped", status: "SKIP" }),
    run({ case: "screen-only", status: "PASS", proved: { ui: 2, api: 0, sql: 0 } }),
    run({ case: "broke", status: "FAIL", failedStep: { i: 3, do: "assert", on: "home/Add" } }),
  ];
  const dirs = Object.fromEntries(runs.map((r) => [r.evidence, log({ case: r.case, status: r.status, proved: r.proved })]));
  const said = screenModel("home", runs, loader(dirs)).checks;
  assert.match(said.find((c) => c.case === "skipped").say, /nothing was verified this time/);
  assert.match(said.find((c) => c.case === "screen-only").say, /passed on the screen alone/);
  assert.match(said.find((c) => c.case === "broke").say, /reproduce it by hand before calling it a product bug/);
});

// The same model, so the same allow-list, so the same two deliberate
// exceptions. A second way to render a run would be a second story about it.
test("the page masks what a per-run report masks, and keeps the SQL runnable", () => {
  const runs = [run({ case: "a" })];
  const records = [
    { kind: "run", case: "a", sqlCommand: ["sqlcmd"], source: { id: "a" }, params: { NAME: "TC-1", PASSWORD: "hunter2" } },
    { kind: "identity", as: "admin", upn: "real@customer.example", roles: ["Cat Admin"] },
    { kind: "step", i: 1, do: "sql", query: "SELECT Upn FROM Users", rows: [{ Upn: "t1@contoso.example" }], ok: true },
    { kind: "result", status: "PASS", done: 2, of: 2, proved: { ui: 0, api: 0, sql: 1 } },
  ];
  const html = screenHtml("home", runs, loader({ "/ev/a": records }));
  for (const secret of ["hunter2", "real@customer.example", "t1@contoso.example"]) {
    assert.ok(!html.includes(secret), `the consolidated page leaked "${secret}"`);
  }
  assert.match(html, /SELECT Upn FROM Users/, "a masked query is one nobody can re-run");
  assert.match(html, /Cat Admin/, "and the roles stay, because that is what the matrix is for");
  assert.doesNotMatch(html, /\{\{/, "no placeholder may reach a rendered page");
});
