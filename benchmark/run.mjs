#!/usr/bin/env node
// THE ORBIT BENCHMARK: cases that say what Orbit must do, run against the branch this checkout is on, in Docker, and
// judged by a verifier that shares nothing with what it judges. Four kinds of case:
//
//   source       Orbit's own source held to independent checks -- and, with --repair, a failure the case declares
//                repairable handed to Orbit to repair through its own autonomous engineering loop, with a real coding
//                host
//   qa           whether Orbit's autonomous QA FINDS the defect planted in an application: the application set up on
//                its own isolated sandbox by Orbit's engine beside the controller, a real coding host working one
//                investigation over it through the relay, and every contradiction confirmed on the clean application
//   engineering  a goal about a frozen fixture project, taken through Orbit's goal entry to a verified change, or
//                refused
//   activation   (0.5.0) a prompt that names no skill, handed to the coding host with Orbit -- or without it -- over a
//                fixture project: whether it uses Orbit by itself and only where it helps, held to a hidden truth, the
//                owners' records and, for an outcome case, the hidden checks of what it delivered
//
// Development tooling: it never ships (export-ignored), and nothing of the engine imports it.
//
//   node benchmark/run.mjs build [--verifier|--runner|--qa-worker] [--rebuild] [--ca-file=<pem>]
//                                     the images, built once from benchmark/images/ and reused by id; a CA bundle for a
//                                     network that inspects TLS is a build secret, never written into the image
//   node benchmark/run.mjs list       the suites, their cases, what each runs on, and their controls
//   node benchmark/run.mjs doctor [--preflight] [--host [--model=<id>] [--effort=<level>] [--credential=<NAME>]]
//                                     Docker, the images, a credential by name; --preflight runs the subject's own
//                                     declared checks (npm run lint, npm run test) in the runner container, no host;
//                                     --host asks the runner image's Claude Code one question through the egress proxy
//                                     (no tool, no plugin, a budget of a few cents), with the model and effort a run
//                                     would hand it: whether it starts, which version and model it says it is, whether
//                                     the credential is accepted -- a code when not
//   node benchmark/run.mjs run <case> [--variant=real|controlled-fault] [--repair] [--source=head|worktree]
//                                     [--seed=<n>] [--model=<id>] [--effort=low|medium|high|xhigh|max]
//                                     [--rounds=<n>] [--minutes=<n>] [--usd=<n>]
//                                     [--credential=<NAME>] [--ca-file=<pem>] [--host=session:<label>]
//                                     [--tree=<dir>] [--run-id=<bnr-…>] [--parent=<tsk-…>]
//                                     [--repeat=<n>] [--arm=none|baseline|release|all]
//                                     one case on the source of this branch: a source case frozen, verified twice,
//                                     diagnosed and -- with --repair -- repaired by Orbit and verified again; a QA case's
//                                     application set up with its own variant planted and a coding host's investigation
//                                     over it judged against the case's ground truth
//   node benchmark/run.mjs run --suite=<suite> [the same flags, but --run-id]
//                                     every case of a suite, one run each
//                                     --tree measures another checkout of this repository (its HEAD, or with
//                                     --source=worktree its tree) -- the cases, the harness, the store and the task stay
//                                     this checkout's; --run-id names the run's room before it starts (refused when it is
//                                     kept already); --parent names the task that started the run (a release ship)
//                                     --repeat=<n> (1..10) runs each case n times, each its own room and task, named as
//                                     one repeat group in every manifest (config.repeat) -- one PASS is not a rate;
//                                     --arm runs a case on one arm it declares (none: no Orbit at all, no plugin and no
//                                     trail; baseline: the plugin frozen from the case's or suite's baselinePlugin
//                                     revision, v0.4.0 by default; release: the run's own source, the default), or with
//                                     all on each in turn -- the same model, inputs, image and limits
//                                     --effort hands the coding host Claude Code's --effort beside --model (EFFORTS);
//                                     the manifest, the report and a verified candidate's host say it, and metrics
//                                     count a model at each effort as a host of its own; with none, the host's default
//   node benchmark/run.mjs run --like=<bnr-…> [--repeat=<n>]
//                                     again: the same case, variant, host, model, effort, arm, source mode, seed, limits
//                                     and images, a new run (n new runs, one repeat group)
//   node benchmark/run.mjs status <bnr-…>
//   node benchmark/run.mjs report <bnr-…>
//                                     where a run stands; its report (written into its room as report.md and .json)
//   node benchmark/run.mjs resume <bnr-…>
//                                     a run carried on from where its task's journal says it stands: a verification or a
//                                     setup is done again; a repair round or a QA host's round is read back, never sent
//                                     again -- or a control set carried on from its room: every control it kept stands,
//                                     the rest run, and a control's own run (engine, QA) is read back or carried on
//   node benchmark/run.mjs controls <case> [--only=<control>] [--skip-engine] [--source=head|worktree]
//                                     [--tree=<dir>] [--parent=<tsk-…>] [--run-id=<bnr-…>]
//                                     what the verifier must pass and must fail: for a source case, a planted fault, a
//                                     partial fix, allow-all and reject-all in the verifier's own containers; its repair
//                                     controls -- a reference candidate the judge must pass and every way of cheating it
//                                     must refuse by name, and (unless --skip-engine) a scripted host driving Orbit's own
//                                     engineering loop with no model; for a QA case, a whole run with each scripted
//                                     host -- reference, idle, false-alarm; for an activation case, a whole run with
//                                     each of its scripted hosts, held to its verdict and its class. A control that no
//                                     longer applies to the
//                                     source is its own row, DRIFTED, and the command then exits 2. The set keeps a room
//                                     of its own (--run-id names it before it starts), each control's row as it ends
//   node benchmark/run.mjs cleanup <bnr-…> [--scratch]
//                                     the run's containers and networks, by its label only (a control set's, and every
//                                     run it planned for a control); --scratch its scratch trees
//   node benchmark/run.mjs where      where the runs are kept, and which there are
//   node benchmark/run.mjs metrics [--suite=<suite>] [--case=<case>] [--since=<iso date>] [--revision=<commit>]
//                                  [--by=revision,model,arm,language] [--k=<n>]
//                                     what the kept runs show, each metric a numerator over a denominator: success,
//                                     self-healing, detection, false alarms, regressions, interventions, rounds, time
//                                     and REPORTED cost per verified outcome, reproducibility, the verifier's own
//                                     controls -- apart by host basis (none, scripted, coding-host); per row (case,
//                                     variant, arm, basis, model and effort) and per model at its effort, pass@1, pass@k
//                                     (k 1..10, default 3), the median cost and minutes; tool-call failures per suite and
//                                     per model at its effort (per tool, per relay subcommand, per PASS, per sandbox
//                                     step); each Orbit arm's overhead over the none arm. --by=revision adds each case's
//                                     outcome and rates by source commit, --by=model, --by=arm and --by=language every
//                                     metric again per model at its effort, per arm or per prompt's language; the
//                                     activation rows (activation precision and recall, strategy, skill and agent
//                                     selection, unnecessary delegation, the router, capability coverage, work
//                                     completed)
//   node benchmark/run.mjs reliability [--revision=<commit>] [--suite=<suite>] [--case=<case>] [--since=<iso date>]
//                                      [--k=<n>]
//                                     the reliability report a release quotes, folded from the kept runs like metrics:
//                                     the rates by row and by model, the tool-call failures, each case's arms side by
//                                     side and the overhead (orbit.benchmark.reliability/v1). It writes nothing
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

// The checkout a run measures, when it is not this one (`--tree`): resolved here, held to a checkout's top directory by
// the freeze.
const treeOf = () => ((t) => (t ? resolve(t) : null))(flag(args, "tree"));

const harness = () => ({ root: ROOT, tree: treeOf(), env: process.env, taskEnv: taskEnv(), credential: flag(args, "credential") ?? null, caFile: flag(args, "ca-file") ?? process.env.ORBIT_BENCHMARK_CA_FILE ?? null, ...storeOf() });

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
