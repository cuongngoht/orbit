import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { createMemory } from "../src/memory/index.mjs";
import { caseOf, keep, memoryPaths } from "../src/memory/store.mjs";
import { disagree, flapping, forCase, hostVerdicts, summarize } from "../src/memory/history.mjs";
import { formatNote, isStale, makeNote, parseNote, relevant, slugOf } from "../src/memory/note.mjs";
import { safeName } from "../src/project/paths.mjs";
import { createContext } from "../src/run/context.mjs";
import { outDir } from "../src/run/result.mjs";
import { STORE_FILE } from "../src/project/paths.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { runCase } from "../src/run/run-case.mjs";
import { fakeContext, fixtureProject } from "./fakes/context.mjs";

// A fresh directory per run: `reserveEvidence` refuses to overwrite evidence
// that already exists, so a fixed --out path is one left over from the last
// time the suite ran -- which passes alone and fails in a full run.
const outFresh = (tag) => "--json";
import { fakeMemory } from "./fakes/memory.mjs";
import { seedStore, storeRootIn } from "./fakes/store.mjs";

// Three rooms in ONE machine store, and the rooms follow the shape of the
// writes: appended per machine, one file per note, blobs on their own.
// Asserted as a SHAPE, not as three literal strings. `memoryPaths` resolves and
// contains what it returns, and "/s" is not an absolute path on Windows -- so a
// literal comparison passed on POSIX and failed on Windows with a drive letter
// the test never mentioned. What the function promises is three rooms named so,
// each directly under the root it was given; that is true on every platform.
test("the ledger, the notes and the evidence are three rooms in one machine store", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orbit-rooms-")));
  const rooms = memoryPaths(root);
  assert.deepEqual(Object.keys(rooms).sort(), ["evidence", "notes", "root", "runs"]);
  assert.equal(rooms.root, root);
  for (const name of ["runs", "notes", "evidence"]) {
    assert.equal(basename(rooms[name]), name, `${name} is the room it says it is`);
    assert.equal(dirname(rooms[name]), root, `${name} sits directly under the store root`);
  }
  assert.equal(safeName("Acme: Web (test)"), "Acme-Web-test-");
  assert.equal(safeName(null), "project");
  rmSync(root, { recursive: true, force: true });
});

test("a note round-trips through its file, and refuses to exist without about/title/body", () => {
  const note = makeNote({ about: "case:create-thing", title: "The 403 was the VPN", body: "Not a product bug.\nRe-ran on the VPN: PASS.", fe_commit: "abc1234" }, () => "2026-09-18T00:00:00.000Z");
  const back = parseNote(formatNote({ ...note, host: "laptop-a" }), "x.md");
  assert.equal(back.about, "case:create-thing");
  assert.equal(back.type, "finding");
  assert.equal(back.host, "laptop-a", "a shared note has to say whose machine it came from");
  assert.equal(back.body, "Not a product bug.\nRe-ran on the VPN: PASS.");
  assert.equal(slugOf(note), "case-create-thing--the-403-was-the-vpn");
  assert.throws(() => makeNote({ about: "x", title: "y" }), /needs an about key/);
});

// The ledger left the repository, and the masking did NOT leave with it. A run
// carries the command line it was given, the rows SQL returned and who was
// signed in; every line of it is projected into the host's MEMORY.md, quoted
// into a lesson and rendered into a report that gets mailed. Being uncommitted
// is not the same as being private.
test("the ledger masks what a run carried, and keeps what dates it", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-memory-"));
  const memory = createMemory(() => dir, { host: "laptop-a", now: () => "2026-09-19T00:00:00.000Z" });
  memory.recordRun({
    case: "create-thing", status: "PASS", done: 4, of: 4, fe_commit: "0122d9eaf", env: "test",
    params: { TARGET_UPN: "teacher1@contoso.example", TARGET_ID: "8373" },
    resolved: [{ as: "USER_ID", sql: "SELECT Id FROM Users WHERE Upn = 'teacher1@contoso.example'" }],
    identity: [{ as: "admin", upn: "admin@contoso.example", roles: ["Category Administrator"] }],
  });
  const line = JSON.parse(readFileSync(join(memoryPaths(dir).runs, "laptop-a.jsonl"), "utf8").trim());
  assert.ok(!JSON.stringify(line).includes("contoso.example"), "no address reaches a store that gets projected and quoted");
  assert.equal(line.params.TARGET_UPN, "[upn]");
  assert.equal(line.params.TARGET_ID, "8373", "a value that is not secret-shaped is still there to re-read the run with");
  assert.deepEqual(line.identity[0].roles, ["Category Administrator"], "which roles were held is the point of recording an identity");
  assert.equal(line.fe_commit, "0122d9eaf", "the build a verdict was taken on survives — coverage cannot date a PASS without it");
  assert.equal(line.status, "PASS");
  rmSync(dir, { recursive: true, force: true });
});

test("a note masks its title and body, so no address reaches a filename either", () => {
  const note = makeNote({ about: "case:create-thing", title: "teacher1@contoso.example cannot see the tile", body: "Signed in as admin@contoso.example with password=hunter2" }, () => "2026-09-19T00:00:00.000Z");
  assert.equal(note.title, "[upn] cannot see the tile");
  assert.ok(!slugOf(note).includes("contoso"), "a title becomes a path, where nobody reading the file would look for a leak");
  assert.ok(!note.body.includes("hunter2"));
  assert.equal(note.about, "case:create-thing", "the recall key is left alone — a masked key matches nothing");
});

test("recall matches the key the way a human would spell it, and dates itself against the frontend", () => {
  const all = [{ about: "case:create-thing" }, { about: "home/Add" }, { about: "screen:home" }, { about: "machine" }];
  assert.deepEqual(relevant(all, "create-thing").map((n) => n.about), ["case:create-thing"]);
  assert.deepEqual(relevant(all, "home").map((n) => n.about), ["home/Add", "screen:home"]);
  assert.equal(relevant(all, undefined).length, 4);
  assert.equal(isStale({ fe_commit: "old" }, "new"), true);
  assert.equal(isStale({ fe_commit: null }, "new"), false, "a note with no commit is undated, not stale");
});

// A case that broke once and stayed broken is not flaky; filing it as flaky is
// how a real regression gets ignored.
test("the ledger answers has-it-ever-passed, and only calls a case flaky when the verdict keeps flipping", () => {
  const runs = [
    { case: "a", host: "x", status: "PASS" }, { case: "a", host: "x", status: "FAIL" }, { case: "a", host: "x", status: "PASS" },
    { case: "b", host: "x", status: "PASS" }, { case: "b", host: "x", status: "FAIL" },
  ];
  assert.equal(forCase(runs, "a").length, 3);
  const [a, b] = summarize(runs);
  assert.deepEqual([a.case, a.runs, a.pass, a.last, a.flaky], ["a", 3, 2, "PASS", true]);
  assert.deepEqual([b.case, b.runs, b.pass, b.last, b.flaky], ["b", 2, 1, "FAIL", false]);
});

// Counted on the merged ledger, two machines that never changed their minds
// interleave into a verdict that seems to alternate -- and the regression
// somebody introduced and then fixed gets filed as noise. Flipping is per
// machine, and the line has to name the machine that did it.
test("flipping is counted per machine, so interleaved ledgers do not invent flakiness", () => {
  const runs = [
    { case: "a", host: "laptop-a", at: "1", status: "PASS" }, { case: "a", host: "laptop-b", at: "2", status: "FAIL" },
    { case: "a", host: "laptop-a", at: "3", status: "PASS" }, { case: "a", host: "laptop-b", at: "4", status: "FAIL" },
    { case: "a", host: "laptop-a", at: "5", status: "PASS" }, { case: "a", host: "laptop-b", at: "6", status: "PASS" },
  ];
  const [a] = summarize(runs);
  assert.deepEqual(a.flapped, [], "neither machine changed its mind twice — laptop-b broke once and was fixed");
  assert.equal(a.flaky, false, "the merged sequence alternates, but no machine flapped");
  assert.deepEqual(flapping([{ host: "x", status: "PASS" }, { host: "x", status: "FAIL" }, { host: "x", status: "PASS" }, { host: "y", status: "FAIL" }]), ["x"], "only the machine that flipped is named");
});

// The whole reason the ledger is shared rather than per-laptop.
test("two machines disagreeing about one case is a fact the merged ledger can state", () => {
  const runs = [
    { case: "a", host: "laptop-a", status: "PASS" }, { case: "a", host: "laptop-b", status: "FAIL" },
    { case: "a", host: "laptop-a", status: "PASS" }, { case: "a", host: "laptop-b", status: "FAIL" },
  ];
  const [a] = summarize(runs);
  assert.deepEqual(a.hosts, [{ host: "laptop-a", last: "PASS" }, { host: "laptop-b", last: "FAIL" }]);
  assert.equal(disagree(a.hosts), true);
  assert.equal(disagree(hostVerdicts([{ host: "x", status: "PASS" }, { host: "y", status: "PASS" }])), false);
});

test("each machine appends to its own ledger file, and reading merges them in time order", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-mem-")), "store");
  const a = createMemory(() => dir, { host: "laptop-a", now: () => "2026-09-18T08:00:00Z" });
  const b = createMemory(() => dir, { host: "laptop-b", now: () => "2026-09-18T07:00:00Z" });
  assert.deepEqual(a.runs(), [], "reading an untouched store must not create it");
  a.recordRun({ case: "create-thing", status: "PASS", done: 8, of: 8 });
  b.recordRun({ case: "create-thing", status: "FAIL", done: 2, of: 8 });
  assert.deepEqual(readdirSync(memoryPaths(dir).runs).sort(), ["laptop-a.jsonl", "laptop-b.jsonl"], "one file per machine — and the merge is what makes a SHARED store work");
  assert.deepEqual(a.runs().map((r) => [r.host, r.status]), [["laptop-b", "FAIL"], ["laptop-a", "PASS"]], "merged, oldest first");
  rmSync(dir, { recursive: true, force: true });
});

test("notes are stored under the project and carry the machine that wrote them", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-mem-")), "store");
  const mem = createMemory(() => dir, { host: "laptop-a", now: () => "2026-09-18T00:00:00Z" });
  assert.deepEqual(mem.notes(), []);
  const file = mem.saveNote(makeNote({ about: "machine", title: "Edge only", body: "Chrome profile is signed out here." }));
  assert.match(readFileSync(file, "utf8"), /host: laptop-a/);
  assert.deepEqual(mem.notes().map((n) => [n.title, n.host]), [["Edge only", "laptop-a"]]);
  rmSync(dir, { recursive: true, force: true });
});

// End to end through the real port against a seeded store. Two machines are in
// that seed on purpose: the per-host files and the merge that reads them are
// what a SHARED store buys, and they are the only reason `flaky` can answer
// "passes on mine, fails on his" at all.
test("a seeded store reads back through the real port, merged across machines", () => {
  const project = fixtureProject();
  const mem = createMemory(() => storeRootIn(seedStore("main", project), project));
  assert.equal(mem.runs().length, 3);
  assert.deepEqual(mem.notes().map((n) => n.about), ["home/Add"]);
  const [thing] = summarize(mem.runs());
  assert.equal(disagree(thing.hosts), true, "two machines, two verdicts — what a store on a share is for");
});

test("a finished run records itself in the ledger; a --dry run records nothing", () => {
  const memory = fakeMemory();
  const ctx = fakeContext({ memory });
  runCase(ctx, ["create-thing", "NAME=TC-1", "--dry"]);
  assert.deepEqual(memory.recorded, [], "a dry run touched nothing, so it happened to nothing");
  runCase(ctx, ["create-thing", "NAME=TC-1"]);
  assert.equal(memory.recorded.length, 1);
  assert.deepEqual([memory.recorded[0].case, memory.recorded[0].status, memory.recorded[0].fe_commit], ["create-thing", "PASS", "abc1234"]);
  assert.ok(!JSON.stringify(memory.recorded[0]).includes("hunter"), "the fake masks because the real port does — otherwise no runner test is evidence about the real one");
});

// The ledger exists to answer "has this ever passed". A --from/--to run is a
// slice of a case, so counting it as a pass makes a debugging session look like
// a green case, and counting the flips in and out of it invents flakiness.
test("a PARTIAL run is recorded, but never counted as the case passing", () => {
  const runs = [
    { case: "create-thing", status: "FAIL", host: "laptop-a", at: "2026-09-16T09:00:00Z" },
    { case: "create-thing", status: "FAIL", host: "laptop-a", at: "2026-09-17T09:00:00Z" },
    { case: "create-thing", status: "PARTIAL", host: "laptop-a", at: "2026-09-18T09:00:00Z" },
  ];
  const [row] = summarize(runs);
  assert.equal(row.pass, 0, "no run of this case has ever passed");
  assert.equal(row.runs, 2, "the slice is not a verdict about the case");
  assert.equal(row.flaky, false, "a slice between two failures is not the case flapping");
  assert.equal(row.last, "PARTIAL", "what just happened is still shown");
  assert.deepEqual(row.hosts, [{ host: "laptop-a", last: "FAIL" }], "the machine keeps its last REAL verdict, not the slice");
});

// The store is COMMITTED, so every file in it comes back with the checkout's
// line endings. On Windows that is CRLF, the \n anchors matched nothing, and
// `query notes` was silently empty on exactly the machines a shared store is
// for. Invisible on Linux, and invisible in CI until `query check` got an exit
// code -- which is the whole reason the matrix runs windows-latest.
test("a note written on one machine parses on a checkout with the other line endings", () => {
  const note = makeNote({ about: "home/Add", title: "The dialog animates in", body: "first line\n\nsecond line", type: "trap", fe_commit: "abc1234" }, () => "2026-01-01T00:00:00Z");
  const lf = formatNote(note);
  const crlf = lf.replace(/\n/g, "\r\n");

  assert.notEqual(lf, crlf, "the two really are different bytes");
  for (const [what, text] of [["LF", lf], ["CRLF", crlf]]) {
    const back = parseNote(text, "home-add.md");
    assert.ok(back, what + " did not parse at all");
    assert.equal(back.about, "home/Add", what);
    assert.equal(back.type, "trap", what);
    assert.equal(back.fe_commit, "abc1234", what);
    assert.equal(back.body, "first line\n\nsecond line", what + " body");
  }
});

// A memory that only ever grows is one people delete wholesale. Evidence is the
// room that grows, and it is the only one safe to prune: the report embeds every
// picture it shows and the case it ran, so a directory stops being the only copy
// of anything the moment its report exists.
test("the whole retention rule is one pure decision, and keep/prune never disagree", () => {
  const dirs = ["a-2026-01-01-00-00-00", "a-2026-01-02-00-00-00", "a-2026-01-03-00-00-00", "b-2026-01-01-00-00-00"];
  const all = new Set(dirs);

  const counted = keep(dirs, { n: 2, rendered: all });
  assert.deepEqual(counted.prune, ["a-2026-01-01-00-00-00"], "counted per case, so a busy case cannot evict a quiet one's only run");
  assert.deepEqual(counted.keep.length, 3);
  assert.equal(counted.keep.length + counted.prune.length, dirs.length, "every directory is in exactly one of the two answers");

  const spared = keep(dirs, { n: 1, rendered: all, unresolved: new Set(["a-2026-01-01-00-00-00"]) });
  assert.ok(spared.keep.includes("a-2026-01-01-00-00-00"), "ten green re-runs must not bury the failure underneath them");

  assert.deepEqual(keep(dirs, { n: 1 }).prune, [], "nothing rendered is nothing disposable — evidence no report was built from is the only copy");
  assert.deepEqual(keep(dirs, { n: 0, rendered: all }).prune, [], "0 keeps everything — the project's call, not the engine's");
  assert.equal(caseOf("archive-thing-2026-09-21-08-10-00"), "archive-thing", "a case name may hold dashes and digits of its own");
});

test("pruning on disk removes exactly what the rule named, and creates nothing", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-prune-")), "store");
  const mem = createMemory(() => dir);
  assert.deepEqual(mem.prune({ n: 2 }), [], "a project that has never run leaves nothing behind, and no empty directory either");
  assert.ok(!existsSync(memoryPaths(dir).evidence), "asking what to prune must not create the room");

  const dirs = [1, 2, 3, 4].map((d) => `a-2026-01-0${d}-00-00-00`);
  for (const d of dirs) mkdirSync(join(mem.evidenceDir(), d), { recursive: true });
  assert.deepEqual(mem.prune({ n: 1 }), [], "unrendered evidence is never disposable");
  assert.deepEqual(mem.prune({ n: 1, rendered: new Set([dirs[1]]) }), [dirs[1]], "only what a report was built from");
  assert.deepEqual(readdirSync(mem.evidenceDir()), [dirs[0], dirs[2], dirs[3]], "and the older un-rendered ones stay");
  rmSync(dir, { recursive: true, force: true });
});

// L3: the memory reaches the RUN. Nothing in src/run/ ever read a note, so
// "recall first" was advice in a playbook -- and advice an agent skips is
// advice nobody can tell was skipped.
test("a run recalls the notes filed against its case and its start screen, and logs what it was told", () => {
  const memory = fakeMemory({ notes: [
    { about: "case:create-thing", title: "Seed job must have run first", host: "laptop-a", at: "2026-09-01T00:00:00Z", fe_commit: "abc1234" },
    { about: "home", title: "The dialog animates in", host: "laptop-b", at: "2026-09-02T00:00:00Z", fe_commit: "older" },
    { about: "case:something-else", title: "not this one", host: "laptop-a", at: "2026-09-02T00:00:00Z" },
  ] });
  const o = runCase(fakeContext({ memory }), ["create-thing", "NAME=TC-1", outFresh("recall")]);

  const recall = o.run.log.records.find((r) => r.kind === "recall");
  assert.deepEqual(recall.notes.map((n) => n.about), ["case:create-thing", "home"], "the case AND the screen it starts on — and nothing else");
  assert.equal(recall.notes[0].stale, false, "a note recorded against this build is current");
  assert.equal(recall.notes[1].stale, true, "one recorded against another build says so rather than being trusted or dropped");
  assert.ok(!JSON.stringify(recall).includes("not this one"), "a note about another case is not this run's business");
});

test("a run with nothing written down about it logs no recall at all", () => {
  const o = runCase(fakeContext({ memory: fakeMemory() }), ["create-thing", "NAME=TC-1", outFresh("none")]);
  assert.equal(o.run.log.records.find((r) => r.kind === "recall"), undefined, "an empty section is a page saying it has nothing to say, twice");
});

// A gate stop observed nothing about the PRODUCT, which is why it can never
// raise coverage. It observed something about the MACHINE, and the only trace
// used to be a line that scrolled past.
test("the ledger records what a run PROVED, and the numbers that warn before a case flips", () => {
  const memory = fakeMemory();
  const o = runCase(fakeContext({ memory }), ["create-thing", "NAME=TC-1", outFresh("ledger")]);
  const [line] = memory.recorded;
  assert.deepEqual(line.screens, ["home", "dlg-thing"], "which screens it touched — how `report --screen=` selects at all");
  assert.equal(line.slowest.do, "goto", "the slowest step, so a case can be warned about before it times out");
  assert.ok(line.slowest.ms > 0);
  assert.equal(typeof line.budget.usedPct, "number", "and how much of the run deadline that spent");
  assert.equal(line.budget.runSec, 900);
  assert.equal(o.status, "PASS");
});
