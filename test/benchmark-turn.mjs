// The benchmark's heavy Docker-free test files take TURNS. Each drives real Orbit processes -- a task written through
// cli/task.mjs, an engineering loop, a probe per case -- and `node --test` runs files side by side, so two or three of
// them at once saturate a small CI runner and starve the suite's timing-bound tests (three sessions seating one store,
// three hooks sharing a trace store) of the seconds their locks and budgets allow. A file that calls takeTurn() waits
// until no other such file runs; the turn ends when its process does, and a holder that died is passed over.
// It is harness (test/benchmark-*.mjs) and runs nothing when a test runner loads it.
//
//   await takeTurn()      at the top of a heavy file, before its tests
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const TURN = join(tmpdir(), "orbit-benchmark-turn");
const PID = join(TURN, "pid");
const EVERY_MS = 250;

// A pid this machine still runs; EPERM is a process somebody else owns, and still running.
const alive = (pid) => {
  try { return process.kill(pid, 0); } catch (e) { return e.code === "EPERM"; }
};

// The holder's pid, or 0 while it has not written it yet -- never read as dead.
const holder = () => {
  try { return Number(readFileSync(PID, "utf8")) || 0; } catch { return 0; }
};

function taken() {
  try { mkdirSync(TURN); } catch { return false; }
  writeFileSync(PID, String(process.pid));
  process.on("exit", () => rmSync(TURN, { recursive: true, force: true }));
  return true;
}

function passedOver() {
  const pid = holder();
  if (pid > 0 && !alive(pid)) rmSync(TURN, { recursive: true, force: true });
}

export async function takeTurn() {
  while (!taken()) {
    passedOver();
    await sleep(EVERY_MS);
  }
}
