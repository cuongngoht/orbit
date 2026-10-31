#!/usr/bin/env node
// THE ORBIT BENCHMARK: cases that say what Orbit must do, run against the branch this checkout is on, in Docker, and
// judged by a verifier that shares nothing with what it judges. Two kinds of case:
//
//   source   Orbit's own source held to independent checks -- and, with --repair, a failure the case declares
//            repairable handed to Orbit to repair through its own autonomous engineering loop, with a real coding host
//   qa       whether Orbit's autonomous QA FINDS the defect planted in an application: the application set up on its
//            own isolated sandbox by Orbit's engine beside the controller, a real coding host working one investigation
//            over it through the relay, and every contradiction confirmed on the clean application before it counts
//
// Development tooling: it never ships (export-ignored), and nothing of the engine imports it.
//
//   node benchmark/run.mjs build [--verifier|--runner|--qa-worker] [--rebuild] [--ca-file=<pem>]
//                                     the images, built once from benchmark/images/ and reused by id; a CA bundle for a
//                                     network that inspects TLS is a build secret, never written into the image
//   node benchmark/run.mjs list       the suites, their cases, what each runs on, and their controls
//   node benchmark/run.mjs doctor [--preflight]
//                                     Docker, the images, a credential by name; --preflight runs the subject's own
//                                     declared checks (npm run lint, npm run test) in the runner container, no host
//   node benchmark/run.mjs run <case> [--variant=real|controlled-fault] [--repair] [--source=head|worktree]
//                                     [--seed=<n>] [--model=<id>] [--rounds=<n>] [--minutes=<n>] [--usd=<n>]
//                                     [--credential=<NAME>] [--ca-file=<pem>]
//                                     one case on the source of this branch: a source case frozen, verified twice,
//                                     diagnosed and -- with --repair -- repaired by Orbit and verified again; a QA case's
//                                     application set up with its own variant planted and a coding host's investigation
//                                     over it judged against the case's ground truth
//   node benchmark/run.mjs run --suite=<suite> [the same flags]
//                                     every case of a suite, one run each
//   node benchmark/run.mjs run --like=<bnr-…>
//                                     again: the same case, variant, host, source mode, seed, limits and images, a new run
//   node benchmark/run.mjs status <bnr-…>
//   node benchmark/run.mjs report <bnr-…>
//                                     where a run stands; its report (written into its room as report.md and .json)
//   node benchmark/run.mjs resume <bnr-…>
//                                     a run carried on from where its task's journal says it stands: a verification or a
//                                     setup is done again; a repair round or a QA host's round is read back, never sent again
//   node benchmark/run.mjs controls <case> [--only=<control>] [--skip-engine] [--source=head|worktree]
//                                     what the verifier must pass and must fail: for a source case, a planted fault, a
//                                     partial fix, allow-all and reject-all in the verifier's own containers; its repair
//                                     controls -- a reference candidate the judge must pass and every way of cheating it
//                                     must refuse by name, and (unless --skip-engine) a scripted host driving Orbit's own
//                                     engineering loop with no model; for a QA case, a whole run with each scripted
//                                     host -- reference, idle, false-alarm
//   node benchmark/run.mjs cleanup <bnr-…> [--scratch]
//                                     the run's containers and networks, by its label only; --scratch its scratch trees
//   node benchmark/run.mjs where      where the runs are kept, and which there are
//   node benchmark/run.mjs metrics [--suite=<suite>] [--case=<case>] [--since=<iso date>] [--by=revision]
//                                     what the kept runs show, each metric a numerator over a denominator: success,
//                                     self-healing, detection, false alarms, regressions, interventions, rounds, time
//                                     and REPORTED cost per verified outcome, reproducibility, the verifier's own
//                                     controls -- apart by host basis (none, scripted, coding-host); --by=revision adds
//                                     each case's outcome by source commit
//
// Every command takes --json. A run is recorded as an Orbit task (provider `benchmark`) in this checkout's project, so
// Orbit Live and Mission Control show it, and a person pauses or cancels it there. Its evidence is kept in the machine
// store: <store>/benchmark/<bnr-…>/. ORBIT_STORE_DIR moves it, as it moves the rest of the store.
//
// Exit 0 = PASS, or a repair the verifier passed · 1 = a failure that stands, a repair that was not accepted, or a
// planted defect not found · 2 = REFUSED (usage, a dirty tree with no --source, a fault that drifted, an invalid
// benchmark) · 3 = BLOCKED (Docker, an image, a credential, a provider, a sandbox) · 4 = INCONCLUSIVE.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Blocked } from "../src/errors.mjs";
import { flag } from "../src/learn/args.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { COMMANDS } from "./lib/commands.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [cmd, ...args] = process.argv.slice(2);

// What the task door and the store are asked with: this process's environment, without a ui-tests override that would
// point the checkout's project somewhere else.
const taskEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ORBIT_UI_TESTS"));

// Where this checkout's project keeps its store, as Orbit itself says it (`query storage --json`), never constructed here.
function storeOf() {
  const r = spawnSync(process.execPath, [join(ROOT, "cli", "query.mjs"), "storage", "--json"], { cwd: ROOT, env: taskEnv(), encoding: "utf8", timeout: 60000 });
  const root = r.status === 0 ? JSON.parse(r.stdout).storeRoot : null;
  if (!root) throw new Blocked(`Orbit could not say where this checkout's store is: ${String(r.stderr || r.stdout).trim().split("\n").at(-1)}`);
  return { storeRoot: root, storeBase: dirname(root) };
}

const harness = () => ({ root: ROOT, env: process.env, taskEnv: taskEnv(), credential: flag(args, "credential") ?? null, caFile: flag(args, "ca-file") ?? process.env.ORBIT_BENCHMARK_CA_FILE ?? null, ...storeOf() });

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"));
}

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  const result = await entry.run(cmd === "list" ? { root: ROOT } : harness(), args);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));
  process.exitCode = entry.exit ? entry.exit(result) : 0;
}

command(main);
