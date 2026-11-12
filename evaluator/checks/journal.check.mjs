// The journal fold, the hard ledger and resume: what a campaign has spent, what it may still start, and what a dead
// controller left behind -- all read back from journal lines alone.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canStart, chargeOf, foldJournal, interruptedCount, ledgerOf, MAX_RERUNS, nextAttempt, openAttempts, readJournal } from "../lib/core/journal.mjs";
import { appendLine } from "../lib/core/util.mjs";

const L = (kind, o = {}) => ({ kind, at: "t", ...o });

test("a held outcome, an open attempt, and an interrupted one are told apart", () => {
  const f = foldJournal([L("started", { run: "a", attempt: 1, capUsd: 1 }), L("ended", { run: "a", attempt: 1, chargedUsd: 0.3 }), L("outcome", { run: "a", attempt: 1, word: "RESOLVED" }), L("started", { run: "b", attempt: 1, capUsd: 1 }), L("started", { run: "c", attempt: 1, capUsd: 1 }), L("interrupted", { run: "c", attempt: 1, chargedUsd: 1 }), L("started", { run: "c", attempt: 2, capUsd: 1 })]);
  assert.equal(f.runs.get("a").outcome.word, "RESOLVED");
  assert.deepEqual(openAttempts(f).map((a) => [a.run, a.attempt]), [["b", 1], ["c", 2]]);
  assert.equal(interruptedCount(f.runs.get("c")), 1);
  assert.equal(nextAttempt(f.runs.get("c")), 3);
  assert.equal(nextAttempt(undefined), 1);
});

test("the ledger: reported cost, a missing result charged at its cap, an interruption at its cap, open caps reserved", () => {
  const f = foldJournal([L("started", { run: "a", attempt: 1, capUsd: 1 }), L("ended", { run: "a", attempt: 1, chargedUsd: 0.42 }), L("started", { run: "b", attempt: 1, capUsd: 1 }), L("ended", { run: "b", attempt: 1, chargedUsd: chargeOf({ charges: true }, null, 1) }), L("started", { run: "c", attempt: 1, capUsd: 1 }), L("interrupted", { run: "c", attempt: 1, chargedUsd: 1 }), L("started", { run: "d", attempt: 1, capUsd: 1 })]);
  assert.deepEqual(ledgerOf(f, 5), { budgetUsd: 5, chargedUsd: 2.42, reservedUsd: 1, remainingUsd: 1.58 });
  assert.equal(canStart(ledgerOf(f, 5), 1), true);
  assert.equal(canStart(ledgerOf(f, 4), 1), false);
  assert.equal(canStart(ledgerOf(f, 3.42), 0), true);
});

test("what an attempt is charged: its reported cost, else its whole cap; nothing for an arm that spends nothing", () => {
  assert.equal(chargeOf({ charges: true }, 0.25, 1), 0.25);
  assert.equal(chargeOf({ charges: true }, null, 1), 1);
  assert.equal(chargeOf({ charges: false }, null, 1), 0);
});

test("a run cut short is run again at most MAX_RERUNS times", () => {
  assert.equal(MAX_RERUNS, 2);
});

test("journal lines are appended whole and read back; a torn last line is skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "evl-j-"));
  try {
    const file = join(dir, "journal.jsonl");
    appendLine(file, L("begun"));
    appendLine(file, L("started", { run: "a", attempt: 1 }));
    appendFileSync(file, '{"kind":"ended","run":"a"');
    assert.deepEqual(readJournal(file).map((l) => l.kind), ["begun", "started"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
