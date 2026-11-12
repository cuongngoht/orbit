// WHAT THE PLUGIN WROTE (lib/core/trail.mjs): after a plugin arm's agent ends, its trail and its task and work journals
// are kept in the room as METADATA -- numbers, booleans and short tokens, never a sentence, a command line or a path --
// bounded, and counted by the report: holds by what they held for, advice by the fact it named, the scripts it ran.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_LINES, metaOf, trailOf } from "../lib/core/trail.mjs";
import { reportOf } from "../lib/run/report.mjs";

const withDir = (f) => {
  const dir = mkdtempSync(join(tmpdir(), "evl-trail-"));
  try { return f(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

const jsonl = (file, lines) => (mkdirSync(join(file, ".."), { recursive: true }), writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));

const ev = (type, data) => ({ v: 2, id: `e-${Math.random().toString(16).slice(2)}`, at: "2026-11-12T12:00:00.000Z", type, session: "claude:abc123", project: "p1", data });

test("metadata only: numbers, booleans and short tokens are kept; a sentence, a command line, an absolute path and a way up are dropped", () => {
  assert.deepEqual(metaOf({ kind: "unverified", tests: 2, ok: true, n: null, why: "the edit was not tested", cmd: "pytest -q tests/x.py", file: "/testbed/a.py", up: "a/../b", orbit: "cli/help" }, { slash: true }), { kind: "unverified", tests: 2, ok: true, n: null, orbit: "cli/help" });
  assert.deepEqual(metaOf({ orbit: "cli/help", path: "src/a.py" }), {}, "a journal's token has no slash: no relative path either");
  assert.deepEqual(metaOf({ a: { b: { c: { d: { e: { f: 1 } } } } } }), { a: { b: { c: { d: {} } } } }, "bounded in depth");
  assert.deepEqual(metaOf(["x", "two words", 3]), ["x", 3]);
});

test("the trail and every task and work journal of the store are kept as metadata, and summed: holds by kind, advice by fact, scripts run", () => withDir((dir) => {
  jsonl(join(dir, "control", "activity", "trace", "2026-11-12-host.jsonl"), [
    ev("prompt.submitted", { prompt: { chars: 40, hash: "0b4a56375a86" }, intent: "development" }),
    ev("command.ran", { orbit: "cli/help", ok: true }),
    ev("command.ran", { class: "test", exe: "pytest", ok: false }),
    ev("advice.given", { fact: "check.failed", subject: "test:pytest", provider: "orbit-develop", kind: "skill" }),
    ev("turn.held", { kind: "unverified", tests: 1, count: 1 }),
    ev("turn.held", { kind: "unverified", check: "unit", count: 2 }),
    ev("turn.ended", {}),
  ]);
  writeFileSync(join(dir, "control", "activity", "trace", "salt"), "secret-salt\n");
  jsonl(join(dir, "repo-abc", "tasks", "tsk-1", "journal.jsonl"), [{ kind: "created", at: "2026-11-12T12:00:00Z", task: "tsk-1", objective: "fix the bug in the parser" }, { kind: "stage", stage: "VERIFY", seq: 2 }]);
  jsonl(join(dir, "repo-abc", "work", "w-1", "journal.jsonl"), [{ kind: "bound", work: "w-1", digest: "ab12" }]);
  jsonl(join(dir, "repo-abc", "notes", "other.jsonl"), [{ kind: "x", text: "not a source" }]);
  const t = trailOf(dir);
  assert.deepEqual(t.summary, { events: 7, byType: { "prompt.submitted": 1, "command.ran": 2, "advice.given": 1, "turn.held": 2, "turn.ended": 1 }, held: { unverified: 2 }, advice: { "check.failed": 1 }, commands: { "cli/help": 1 }, journals: { task: 1, work: 1 }, cut: false });
  const task = t.lines.filter((l) => l.source === "task").map((l) => l.line);
  assert.deepEqual(task, [{ kind: "created", at: "2026-11-12T12:00:00Z", task: "tsk-1" }, { kind: "stage", stage: "VERIFY", seq: 2 }], "the objective's sentence is not metadata");
  assert.ok(!JSON.stringify(t.lines).includes("secret-salt") && !JSON.stringify(t.lines).includes("not a source"), "only the trail's shards and the journals");
  assert.deepEqual(trailOf(join(dir, "absent")).summary.events, 0);
  assert.deepEqual(trailOf(null).lines, []);
}));

test("bounded: past its line cap the file is cut, and says so", () => withDir((dir) => {
  jsonl(join(dir, "control", "activity", "trace", "d.jsonl"), Array.from({ length: MAX_LINES + 10 }, () => ev("tool.used", { tool: "Bash", ok: true })));
  const t = trailOf(dir);
  assert.deepEqual([t.lines.length, t.summary.cut], [MAX_LINES, true]);
}));

test("the report counts, per arm, the holds by kind and the advice by fact from every run's kept trail", () => withDir((room) => {
  const plan = [1, 2].map((trial) => ({ key: `a__t__t${trial}`, arm: "a", task: "pack:x", trial }));
  writeFileSync(join(room, "campaign.json"), JSON.stringify({ id: "c", limits: { usd: 1 }, budgetUsd: 2, arms: { a: { kind: "claude+orbit", rev: "x" } }, plan }));
  const trail = (held, advice) => ({ events: 3, byType: {}, held, advice, commands: { "cli/help": 1 }, journals: { task: 0, work: 0 }, cut: false });
  const lines = plan.flatMap((r, i) => [{ kind: "started", run: r.key, attempt: 1, capUsd: 1 }, { kind: "ended", run: r.key, attempt: 1, chargedUsd: 0.1, summary: { costUsd: 0.1 }, trail: i ? trail({ unverified: 2 }, {}) : trail({ unverified: 1, workflow: 1 }, { "check.failed": 1 }) }, { kind: "outcome", run: r.key, attempt: 1, word: "RESOLVED" }]);
  writeFileSync(join(room, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const a = reportOf(room).arms[0].trail;
  assert.deepEqual(a, { runs: 2, events: 6, held: { unverified: 3, workflow: 1 }, advice: { "check.failed": 1 }, commands: { "cli/help": 2 }, runsHeld: 2, runsAdvised: 1 });
}));
