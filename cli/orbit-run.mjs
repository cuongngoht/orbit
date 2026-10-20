import { Refused } from "../src/errors.mjs";
import { words } from "../src/learn/args.mjs";
import { printGoalResult } from "./orbit-print.mjs";

export function runOrbit(deps) {
  const { argv } = deps;
  if (!argv.length || argv[0] === "--help" || argv[0] === "help") return deps.help();
  if (["--version", "version", "live", "control", "doctor"].includes(argv[0])) return topLevel(argv, deps);
  return runGoalCommand(deps);
}

function topLevel(argv, deps) {
  if (argv[0] === "--version" || argv[0] === "version") return deps.printVersion();
  if (argv[0] === "live") return deps.delegateLive(argv.slice(1));
  if (argv[0] === "control") return deps.delegateControl(argv.slice(1));
  if (argv[0] === "doctor") return runGoalCommand({ ...deps, argv: ["goal", "doctor", ...argv.slice(1)] });
  return null;
}

function runGoalCommand(deps) {
  const { argv, env, ops, portsHere } = deps;
  if (argv[0] !== "goal" && argv[0] !== "doctor") throw new Refused("orbit commands: goal …, doctor, live …, --help");
  const picked = pickSub(argv);
  return invokeGoalOp(deps, env, ops, portsHere, picked);
}

function invokeGoalOp(deps, env, ops, portsHere, picked) {
  const op = ops[picked.sub];
  if (!op) throw new Refused(`unknown orbit goal command — ${Object.keys(ops).join(", ")}`);
  validateOptions(picked);
  printGoalResult(deps, picked.sub, picked.rest, op(portsHere(env), picked.rest));
}

function pickSub(argv) {
  const sub = argv[0] === "doctor" ? "doctor" : words(argv.slice(1))[0];
  const rest = argv[0] === "doctor" ? [] : argv.slice(2);
  return { sub, rest };
}

const OPTIONS = { start: ["stdin", "file", "ref"], analyze: ["stdin", "file"], step: ["capability", "dry"] };

function validateOptions({ sub, rest }) {
  const allowed = new Set(["json", "host", "protocol", "session", ...(OPTIONS[sub] ?? [])]);
  const invalid = rest.find((a) => a.startsWith("-") && !allowed.has(a.replace(/^--/, "").split("=")[0]));
  if (invalid) throw new Refused(`unsupported orbit goal ${sub} option: ${invalid}`);
}
