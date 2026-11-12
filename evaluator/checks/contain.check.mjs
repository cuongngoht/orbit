// A run's failure is that run's outcome, never the campaign's end: what throws while a run's start is built, while it
// runs or while its patch is taken ends THAT run INFRA_ERROR with a code and one line of why, what throws while it is
// graded ends it UNGRADABLE, each journaled, and the next run still runs. Only Docker no longer answering at all -- the
// campaign's -- ends the campaign, said in a `halted` line, with the attempt left open for a resume to close.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { armOf } from "../lib/arms/index.mjs";
import { foldJournal, openAttempts, readJournal } from "../lib/core/journal.mjs";
import { CLAUDE_CODE_VERSION } from "../lib/core/versions.mjs";
import { inPhase, runAttempt } from "../lib/run/attempt.mjs";
import { roomOf, startCampaign } from "../lib/run/campaign.mjs";

const LIMITS = { usd: 0, turns: 10, minutes: 10, cpus: 2, memoryMb: 2048, pids: 512 };
const TASK = "pack:orders-e2e-001";
const def = (id) => ({ schema: 1, id, budgetUsd: 0, limits: LIMITS, arms: { a: { kind: "scripted", behaviour: "noop" } }, runs: [1, 2, 3, 4].map((trial) => ({ arm: "a", task: TASK, trial })) });
const TOOLS = () => ({ ok: true, volume: "evl-tools-fake", claudeCode: CLAUDE_CODE_VERSION, node: "v22" });

// What each trial's execution does: its start throws, it throws while running, its patch cannot be taken, it ends clean.
const BEHAVIOUR = {
  1: () => inPhase("START", () => { throw new Error("git failed (128):\nfatal: bad object fedd9709"); }),
  2: () => { throw new Error("docker cp: no such container"); },
  3: () => inPhase("PATCH", () => { throw new Error("the start tree is not in the run's git directory"); }),
  4: async () => ({ infra: null, timedOut: false, summary: { started: true, status: "DONE" }, patch: { bytes: 0, paths: [] } }),
};

function campaignWith(id, ports) {
  const home = mkdtempSync(join(tmpdir(), "evl-contain-"));
  writeFileSync(join(home, "c.json"), JSON.stringify(def(id)));
  return { home, run: () => startCampaign(join(home, "c.json"), { home, ports: { tools: TOOLS, dockerAnswers: () => true, ...ports } }) };
}

const outcomes = (home, id) => readJournal(join(roomOf(home, id), "journal.jsonl")).filter((l) => l.kind === "outcome");

test("a start, a run or a patch that throws ends that run INFRA_ERROR with its code and one line, and the next run still runs", async () => {
  const c = campaignWith("contain-1", { execute: (ctx) => BEHAVIOUR[ctx.run.trial]() });
  try {
    await c.run();
    const o = outcomes(c.home, "contain-1");
    assert.deepEqual(o.map((l) => l.word), ["INFRA_ERROR", "INFRA_ERROR", "INFRA_ERROR", "EMPTY_PATCH"]);
    assert.deepEqual(o.slice(0, 3).map((l) => l.why.split(":")[0]), ["START", "RUN", "PATCH"]);
    assert.equal(o[0].why, "START: git failed (128): fatal: bad object fedd9709");
    const lines = readJournal(join(roomOf(c.home, "contain-1"), "journal.jsonl"));
    assert.equal(lines.filter((l) => l.kind === "ended").length, 4);
    assert.ok(lines.some((l) => l.kind === "finished"));
    assert.match(readFileSync(join(roomOf(c.home, "contain-1"), "runs", "a-pack-orders-e2e-001-t1", "a1", "error.txt"), "utf8"), /^START: Error: git failed/);
  } finally {
    rmSync(c.home, { recursive: true, force: true });
  }
});

test("Docker no longer answering is the campaign's: it halts, the attempt stays open for a resume, no outcome is held", async () => {
  const c = campaignWith("contain-2", { execute: () => BEHAVIOUR[2](), dockerAnswers: () => false });
  try {
    await assert.rejects(c.run(), /Docker stopped answering/);
    const lines = readJournal(join(roomOf(c.home, "contain-2"), "journal.jsonl"));
    assert.equal(lines.filter((l) => l.kind === "outcome").length, 0);
    assert.equal(openAttempts(foldJournal(lines)).length, 1);
    assert.match(lines.at(-1).kind === "halted" ? lines.at(-1).reason : "", /Docker stopped answering/);
  } finally {
    rmSync(c.home, { recursive: true, force: true });
  }
});

test("a grade that throws ends the run UNGRADABLE with the grader's one line, journaled", async () => {
  const home = mkdtempSync(join(tmpdir(), "evl-contain-"));
  try {
    const journal = join(home, "journal.jsonl");
    const patchFile = join(home, "p.diff");
    writeFileSync(patchFile, "diff --git a/x b/x\n");
    const task = { ref: "pack:x", image: "x", repo: "/r", digest: "d", grade: () => { throw new Error("the harness\ncrashed"); } };
    const execute = async () => ({ infra: null, timedOut: false, summary: { started: true, status: "DONE" }, patch: { bytes: 20, file: patchFile, paths: ["x"] } });
    const r = await runAttempt({ campaign: { id: "g", limits: LIMITS }, home, room: home, journal, run: { key: "a__x__t1" }, attempt: 1, arm: armOf("a", { kind: "scripted", behaviour: "noop" }), task, execute, dockerAnswers: () => true });
    assert.equal(r.outcome.word, "UNGRADABLE");
    assert.match(r.outcome.why, /GRADE: the harness crashed/);
    assert.equal(readJournal(journal).filter((l) => l.kind === "outcome").length, 1);
    assert.ok(existsSync(join(home, "runs", "a-x-t1", "a1", "error.txt")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
