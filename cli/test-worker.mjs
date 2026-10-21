#!/usr/bin/env node
// TEST WORKER: the entry a generated test runs through INSIDE an isolated sandbox's worker container (ADR 0038).
//
//   node test-worker.mjs            reads ONE request from stdin -- { v: "orbit.worker/v1", runId, nonce, out,
//                                   limits: { deadlineMs }, … } -- and hands the SAME request to
//                                   `node cli/run-case.mjs --worker` on its stdin; enforces the deadline; and when it
//                                   is stopped (SIGTERM from its supervisor or its dispatch) or the runner ends
//                                   without writing `<out>/envelope.json`, writes that envelope itself:
//                                   { v, runId, nonce, status: "INTERRUPTED", why }.
//
// It decides nothing about the test: the runner writes the envelope, and the HOST validates it before anything
// authoritative is written. This only makes sure that a worker that did not finish SAYS so, in the same place.
//
// Exit = the runner's own exit code, or 3 (BLOCKED) when the run was interrupted, 2 (REFUSED) for a request that is
// not one.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKER_API = "orbit.worker/v1";
export const KILL_GRACE_MS = 5000;
export const DEFAULT_DEADLINE_MS = 120000;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const parsed = (text) => {
  try { return JSON.parse(String(text ?? "")); }
  catch { return null; }
};

// What a request must hold before anything runs.
const REQUEST = [
  { fails: (r) => r?.v !== WORKER_API, why: `the request is not ${WORKER_API}` },
  { fails: (r) => typeof r.runId !== "string" || !r.runId, why: "the request names no run" },
  { fails: (r) => typeof r.nonce !== "string" || !r.nonce, why: "the request carries no nonce" },
  { fails: (r) => typeof r.out !== "string" || !r.out.startsWith("/"), why: "the request names no absolute out directory" },
];

export const requestProblem = (r) => REQUEST.find((row) => row.fails(r))?.why ?? null;

export const envelopeOf = (r, status, why) => ({ v: WORKER_API, runId: r.runId, nonce: r.nonce, status, why });

// -> a promise of the exit code. `io`: { spawnChild(input) -> child, exists(path), write(path, text), on(signal, fn),
// setTimer(fn, ms) -> handle, clearTimer(handle) }. Everything the process touches is handed in, so a test runs it.
export function workerMain(text, io) {
  const request = parsed(text);
  const problem = requestProblem(request);
  if (problem) return Promise.resolve(refused(io, request, problem));
  return new Promise((done) => supervised(request, text, io, done));
}

function refused(io, request, why) {
  if (typeof request?.out === "string" && request.out.startsWith("/")) io.write(join(request.out, "envelope.json"), JSON.stringify(envelopeOf(request, "REFUSED", why)));
  return 2;
}

function supervised(request, text, io, done) {
  const child = io.spawnChild(text);
  const w = { request, io, done, child, settled: false };
  w.timer = io.setTimer(() => interrupted(w, "its deadline passed before the runner finished"), Number(request.limits?.deadlineMs) || DEFAULT_DEADLINE_MS);
  io.on("SIGTERM", () => interrupted(w, "it was stopped by its supervisor or its dispatch before the runner finished"));
  child.on("exit", (code) => exited(w, code));
}

function interrupted(w, why) {
  if (w.settled) return;
  w.why = why;
  w.child.kill("SIGTERM");
  w.io.setTimer(() => w.child.kill("SIGKILL"), KILL_GRACE_MS);
}

function exited(w, code) {
  if (w.settled) return;
  w.settled = true;
  w.io.clearTimer(w.timer);
  const missing = !w.io.exists(join(w.request.out, "envelope.json"));
  w.done(missing || w.why ? written(w, code) : code ?? 1);
}

function written(w, code) {
  const why = w.why ?? `the runner ended with ${code === null ? "a signal" : `exit ${code}`} and wrote no envelope`;
  if (w.why || !w.io.exists(join(w.request.out, "envelope.json"))) w.io.write(join(w.request.out, "envelope.json"), JSON.stringify(envelopeOf(w.request, "INTERRUPTED", why)));
  return 3;
}

const childOf = (text) => {
  const child = spawn(process.execPath, [join(ROOT, "cli", "run-case.mjs"), "--worker"], { stdio: ["pipe", "inherit", "inherit"], env: process.env });
  child.stdin.end(text);
  return child;
};

const REAL = { spawnChild: childOf, exists: existsSync, write: (p, t) => writeFileSync(p, t, { mode: 0o600 }), on: (sig, fn) => process.on(sig, fn), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) };

async function main() {
  process.exitCode = await workerMain(readFileSync(0, "utf8"), REAL);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
