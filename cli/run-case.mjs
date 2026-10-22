#!/usr/bin/env node
// Run one JSON test case, step by step, through playwright-cli.
//
// One command runs the whole case: it reads <ui-tests>/screens/<screen>/cases/<id>.json (found by id), issues
// each step as a playwright-cli verb, polls the wait that proves the step
// landed, and prints one line per step. Selectors, timings, observed text and
// screenshots go to run-log.jsonl in the evidence dir, not to the terminal.
//
//   node run-case.mjs <id | path.json> NAME=TC-… [TYPE="…"]
//     --dry                resolve and print the plan; touches no browser, no database
//     --draft              run a draft case stored in the machine store
//     --force-destructive  required when the case is destructive:true
//     --stale-ok           run although fe_commit != the frontend's HEAD
//     --from=N --to=M      run only steps N..M (debugging one screen)
//     --out=DIR            evidence dir outside any repository (default: the store's evidence room)
//     --json               one machine-readable result object, nothing else
//     --report             also write self-contained HTML into the reports directory
//     --worker             inside an isolated worker (ADR 0038): read ONE orbit.worker/v1 request on
//                          stdin -- the frozen case, its params, the sealed bindings and secrets --
//                          run it, and write <out>/envelope.json beside the evidence. The host
//                          validates that envelope; nothing a worker writes is authoritative.
//
// Exit 0 = PASS or SKIP · 1 = FAIL (evidence written) · 2 = REFUSED before the
// browser (bad usage, invalid case, missing param, destructive without the
// flag, stale, no signed-in session, wrong identity) · 3 = BLOCKED (database
// unreachable, or `resolve` matched no row -- the product is not broken because
// a laptop is off the VPN).
//
// It never opens a browser. The launcher does, behind the preflight question;
// this drives the session in PT_RUN_DIR (or the project's default run dir).
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { readAll } from "../src/capability/helper-protocol.mjs";
import { shaBytes } from "../src/hash.mjs";
import { argvOf, closedPage, identityIssuer, openedPage, pageSpendRecords, pageSpendsOf, requestProblem, sealedBinder, WORKER_API } from "../src/run/worker.mjs";
import { grantLedger } from "../src/run/grants.mjs";
import { shownPath } from "../src/shown-path.mjs";
import { publishRun } from "../src/report/publish.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { exitCode, resultJson, resultLine } from "../src/run/result.mjs";
import { runCase } from "../src/run/run-case.mjs";

const argv = process.argv.slice(2);

// Which case the caller ASKED for -- the first bare word, before any flag or
// NAME=value. A stop may happen before the case is loaded (there may be no such
// case), so the ledger records what was asked for rather than what was found.
const CASE_REF = argv.find((a) => !a.startsWith("--") && !a.includes("=")) ?? null;
const JSON_OUT = argv.includes("--json");
const REPORT = argv.includes("--report");

// The ctx is built inside the try so a broken project.json still becomes a
// typed stop -- and is hoisted so the stop handler can record it when there IS
// one. A stop before the ctx exists is a stop nothing could have recorded.
async function main() {
  let ctx = null;
  try {
    ctx = await withExtensions(createContext());
    finish(ctx, runCase(ctx, argv));
  } catch (e) {
    stopped(e, ctx);
  }
}

function finish(ctx, outcome) {
  if (outcome.status === "DRY") return process.exit(0);
  console.log(JSON_OUT ? JSON.stringify(resultJson(outcome)) : resultLine(outcome));
  reported(ctx, outcome);
  process.exit(exitCode(outcome.status));
}

// Opt-in, and AFTER the result line: the verdict is what the caller waited for,
// and rendering HTML must never be the reason a run's own answer goes missing.
// `--json` stays one object on stdout; publication warnings go to stderr.
function reported(ctx, outcome) {
  if (!REPORT) return;
  const file = publishRun(ctx, outcome);
  if (file && !JSON_OUT) console.log(`report: ${shownPath(file)}`);
}

function stopped(e, ctx) {
  if (e instanceof Refused) return refuse("REFUSED", e.message, ctx);
  if (e instanceof Blocked) return refuse("BLOCKED", e.message, ctx);
  throw e;
}

// A stop is EVIDENCE ABOUT THE MACHINE, and it used to leave none.
//
// Nothing was observed about the product, which is why this can never raise
// coverage -- REFUSED and BLOCKED both say `verifies: false`. But "the database
// was unreachable again", "this profile is signed out every Monday", "the
// frontend commit never matches here" are facts about an environment, and the
// only record of them was a line in a terminal that scrolled away.
//
// Best effort, and silent if it fails: a machine with nowhere to write is
// exactly the machine most likely to be refusing, and turning that into a
// second error on top of the first tells nobody anything.
function noted(status, reason, ctx) {
  try {
    ctx?.memory?.recordRun({ case: CASE_REF, status, done: 0, of: 0, failure: reason, stoppedBy: "gate" });
  } catch {}
}

function refuse(status, reason, ctx) {
  noted(status, reason, ctx);
  if (JSON_OUT) return exitWith(status, JSON.stringify({ status, reason }), console.log);
  exitWith(status, status === "BLOCKED" ? `BLOCKED: ${reason}` : reason, console.error);
}

function exitWith(status, text, write) {
  write(text);
  process.exit(EXIT[status]);
}

// ── inside a worker ─────────────────────────────────────────────────────────
// The request is read whole from stdin and never from argv: its secrets must not be in a process
// listing. Whatever happens, an envelope is written -- a worker that dies says INTERRUPTED through
// its supervisor (cli/sandbox-worker.mjs), one that ran says what it ran.
async function workerMain() {
  const request = jsonOf(await readAll(process.stdin));
  const problem = requestProblem(request);
  if (problem) return enveloped(request ?? {}, { status: "REFUSED", why: problem });
  try { enveloped(request, paged(await issuing(request), request)); }
  catch (e) { enveloped(request, stopOf(e)); }
}

// A page case's browser is opened before the run and closed after it, whatever the run came to.
function paged(ctx, request) {
  if (!request.page) return ran(ctx, request);
  openedPage(ctx, request, PAGE_IO);
  try { return spendsKept(ctx, request, ran(ctx, request)); }
  finally { closedPage(ctx); }
}

// What the page's writes spent goes into the run log beside the steps, the way a call's spend does, before the
// evidence is listed -- so the host holds every spend to what it minted (src/run/envelope.mjs spendFindings).
function spendsKept(ctx, request, o) {
  const records = pageSpendRecords(pageSpendsOf(ctx), request.grants);
  if (records.length && o.result?.evidence) appendFileSync(join(o.result.evidence, "run-log.jsonl"), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  return o;
}

// What the page's browser is set up through: the run directory's config, and the route as a file of the worker's own
// scratch -- the system temp, a tmpfs in a worker the host never reads -- readable by this user alone, removed as
// soon as the browser has loaded it.
const PAGE_IO = {
  now: () => Date.now(),
  write: (file, text) => (mkdirSync(dirname(file), { recursive: true }), writeFileSync(file, text)),
  scratch: (text) => ((file) => (writeFileSync(file, text, { mode: 0o600, flag: "wx" }), file))(join(tmpdir(), `orbit-page-${randomBytes(8).toString("hex")}.js`)),
  remove: (file) => rmSync(file, { force: true }),
};

// The worker's context: its binder holds only what the host sealed, and issues an identity the host could not
// through this very context's adapters -- bound after the context, which the binder is part of.
async function issuing(request) {
  const late = {};
  const ctx = await withExtensions({ ...createContext(), binder: sealedBinder(request, { issue: (value, env) => late.issue(value, env) }), grants: grantLedger(request.grants, request.runId, Date.now), fixture: request.fixture ?? null, evaluation: request.evaluation ?? null });
  late.issue = identityIssuer(ctx);
  return ctx;
}

const ran = (ctx, request) => ((outcome) => ({ status: outcome.status, result: resultJson(outcome) }))(runCase(ctx, argvOf(request)));

const stopOf = (e) => ({ status: e instanceof Refused ? "REFUSED" : "BLOCKED", why: e instanceof Refused || e instanceof Blocked ? e.message : `the runner itself failed — ${e?.message ?? e}` });

function jsonOf(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

function enveloped(request, o) {
  const out = request.out ?? ".";
  const evidence = o.result?.evidence ? relative(out, o.result.evidence).replace(/\\/g, "/") : null;
  const envelope = { v: WORKER_API, runId: request.runId ?? null, nonce: request.nonce ?? null, caseDigest: request.case?.digest ?? null, status: o.status, why: o.why ?? null, result: o.result ?? null, evidence, files: evidence ? listed(out, join(out, evidence)) : [] };
  writeFileSync(join(out, "envelope.json"), `${JSON.stringify(envelope)}\n`);
  process.exit(EXIT[o.status] ?? EXIT.BLOCKED);
}

function listed(out, dir) {
  const names = safeList(dir);
  return names.map((n) => join(dir, n)).filter((p) => statSync(p).isFile()).map((p) => ({ path: relative(out, p).replace(/\\/g, "/"), sha256: shaBytes(readFileSync(p)), bytes: statSync(p).size }));
}

function safeList(dir) {
  try { return readdirSync(dir, { recursive: true }).map(String); }
  catch { return []; }
}

await (argv.includes("--worker") ? workerMain() : main());
