#!/usr/bin/env node
// Run test cases unattended: keep the machine awake, open the signed-in
// browser(s), wait for them to settle, run each case in order, close them.
//
//   node run-awake.mjs <case> [PARAM=value …] [run-case flags] [-- <case> …]
//
// Launcher choices come from project.json (`launch`) and the environment:
// ORBIT_MODE=headless|headed ORBIT_CHANNEL=<browser> ORBIT_ENV=<env>
// ORBIT_PROFILE=<profile> (when the case names no identity).
// ORBIT_KEEP_OPEN=1 leaves the browser open; ORBIT_CONTINUE=1 runs on
// after a failure. Exit code is the worst run-case code, or 2 when the browser
// never became usable.
//
// Under Claude Code the agent must call the launcher itself so the preflight
// guard sees it; this script is a human's tool and says so when it detects it
// is being run by the agent.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromEnv, varName } from "../src/project/env.mjs";
import { closeAll, groupCases, identitiesOf, openAll, runAll } from "../src/awake/run-awake.mjs";
import { stayAwake } from "../src/awake/inhibit.mjs";
import { createContext } from "../src/run/context.mjs";
import { Refused } from "../src/run/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LABEL = { 0: "OK", 1: "FAIL", 2: "REFUSED", 3: "BLOCKED", 4: "INCONCLUSIVE" };
const say = console.log;

function main() {
  const groups = groupCases(process.argv.slice(2));
  if (!groups.length) return refuse("usage: node run-awake.mjs <case> [PARAM=value …] [run-case flags] [-- <case> …]");
  const ctx = createContext();
  if (process.env.CLAUDECODE) console.error("! running under Claude Code: the preflight guard cannot see this nested launch — the four browser choices must already have been answered.");
  run(ctx, groups, groups.some((g) => !g.includes("--dry")));
}

function run(ctx, groups, needBrowser) {
  say(`awake   : ${needBrowser ? stayAwake() ?? `CANNOT inhibit sleep on ${process.platform} — disable sleep by hand for this run` : "not needed (--dry only)"}`);
  const opened = needBrowser ? open(ctx, groups) : [];
  const results = runAll(groups, join(HERE, "run-case.mjs"), process.env, say);
  closeAll(opened, process.env);
  summarise(groups, results, opened);
}

function open(ctx, groups) {
  try {
    const opened = openAll(ctx, identitiesOf(ctx, groups), say);
    process.env[varName("RUN_DIR")] = opened[0].runDir;
    process.env[varName("ORIGIN")] = new URL(opened[0].target).origin;
    return opened;
  } catch (e) {
    if (e instanceof Refused) return refuse(e.message);
    throw e;
  }
}

function summarise(groups, results, opened) {
  const notRun = groups.slice(results.length).map((g) => `${g[0]} not run`);
  say(`\nsummary : ${[...results.map((r) => `${r.id} ${LABEL[r.code] ?? r.code}`), ...notRun].join(" · ")}`);
  say(`browser : ${opened.length ? (fromEnv(process.env, "KEEP_OPEN") ? `left open (${opened.length})` : `closed (${opened.length})`) : "never opened"}`);
  process.exit(Math.max(...results.map((r) => r.code)));
}

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

main();
