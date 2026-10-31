#!/usr/bin/env node
// THE ORBIT BENCHMARK: benchmark cases that say what Orbit's own source must do, run against the branch this checkout is
// on, in Docker -- and, when a case fails on a cause it declares repairable, the failure handed to Orbit itself to
// repair through its own autonomous engineering loop, with a real coding host, and the candidate judged by a verifier
// that shares nothing with the repair. Development tooling: it never ships (export-ignored), and nothing of the engine
// imports it.
//
//   node benchmark/run.mjs build [--verifier|--runner] [--rebuild] [--ca-file=<pem>]
//                                     the images, built once from benchmark/images/ and reused by id; a CA bundle for a
//                                     network that inspects TLS is a build secret, never written into the image
//   node benchmark/run.mjs list       the packs, their cases, variants and controls
//   node benchmark/run.mjs doctor [--preflight]
//                                     Docker, the images, a credential by name; --preflight runs the subject's own
//                                     declared checks (npm run lint, npm run test) in the runner container, no host
//   node benchmark/run.mjs run <case> [--variant=real|controlled-fault] [--repair] [--source=head|worktree]
//                                     [--seed=<n>] [--model=<id>] [--rounds=<n>] [--minutes=<n>] [--usd=<n>]
//                                     [--credential=<NAME>] [--ca-file=<pem>]
//                                     one case on the source of this branch: frozen, verified twice, diagnosed and --
//                                     with --repair, on a repairable cause -- repaired by Orbit and verified again
//   node benchmark/run.mjs run --suite=<pack> [the same flags]
//                                     every case of a pack, one run each
//   node benchmark/run.mjs run --like=<bnr-…>
//                                     again: the same case, variant, source mode, seed, limits and images, a new run
//   node benchmark/run.mjs status <bnr-…>
//   node benchmark/run.mjs report <bnr-…>
//                                     where a run stands; its report (written into its room as report.md and .json)
//   node benchmark/run.mjs resume <bnr-…>
//                                     a run carried on from where its task's journal says it stands: a verification is
//                                     run again, a repair round is read back and never sent again
//   node benchmark/run.mjs controls <case>
//                                     the case's controls through the verifier's own containers: what it must pass and
//                                     what it must fail (a planted fault, a partial fix, allow-all, reject-all)
//   node benchmark/run.mjs cleanup <bnr-…> [--scratch]
//                                     the run's containers and networks, by its label only; --scratch its scratch trees
//   node benchmark/run.mjs where      where the runs are kept, and which there are
//
// Every command takes --json. A run is recorded as an Orbit task (provider `benchmark`) in this checkout's project, so
// Orbit Live and Mission Control show it, and a person pauses or cancels it there. Its evidence is kept in the machine
// store: <store>/benchmark/<bnr-…>/. ORBIT_STORE_DIR moves it, as it moves the rest of the store.
//
// Exit 0 = PASS, or a repair the verifier passed · 1 = a failure that stands, or a repair that was not accepted ·
// 2 = REFUSED (usage, a dirty tree with no --source, a fault that drifted, an invalid benchmark) · 3 = BLOCKED (Docker,
// an image, a credential, a provider) · 4 = INCONCLUSIVE.
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
