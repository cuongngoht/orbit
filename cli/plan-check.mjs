#!/usr/bin/env node
// Check the QA test plans: the gate a session runs before it writes cases, and
// the one CI runs.
//
//   node plan-check.mjs                 every plan in ui-tests/screens/*/
//   node plan-check.mjs <id|path>       one plan
//   node plan-check.mjs --json          the same result, for a machine
//
// It separates what it can DEMONSTRATE from what it merely suspects:
//   ERROR   a violation — a dangling id, a dependency cycle, a scenario whose
//           linked case cannot execute the verdict it committed to. Exit 1.
//   advice  a heuristic, or something a person has to look at. Never exit 1.
// What it cannot tell is reported as UNKNOWN and counted as neither.
//
// Exit 0 = no errors · 1 = errors · 2 = usage, no such plan, or a project.json
// nobody can read · 3 = BLOCKED, a precondition this machine could not establish.
//
// It does not change the meaning of plan.mjs, which emits a click-path script.
import { Blocked, EXIT as CODE, Refused } from "../src/run/errors.mjs";
import { checkPlans, EXIT, exitOf, lines } from "../src/qa/check.mjs";
import { loadPlans, planFor, plansDir } from "../src/qa/load.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { planWorld } from "../src/qa/world.mjs";

const argv = process.argv.slice(2);
const ref = argv.find((a) => !a.startsWith("--"));
const JSON_OUT = argv.includes("--json");

async function main() {
  try {
    await checked();
  } catch (e) {
    stopped(e);
  }
}

// With the project's own extensions loaded: a linked case is validated with the
// vocabulary and the rules run-case would hold it to.
async function checked() {
  const ctx = await withExtensions(createContext());
  const dir = plansDir(ctx.project);
  const chosen = ref ? one(ctx, ref) : loadPlans(dir);
  if (chosen === null) return missing(dir);
  report(checkPlans(chosen, planWorld(ctx, { drafts: chosen.some((p) => p._draft) })));
}

// A typed stop keeps its own code: a broken project.json is bad usage (2), and
// something this machine could not establish is BLOCKED (3). Neither is 1 --
// exit 1 means a plan said something that is not true.
function stopped(e) {
  if (e instanceof Refused) return exitWith(CODE.REFUSED, e.message);
  if (e instanceof Blocked) return exitWith(CODE.BLOCKED, `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(code, text) {
  console.error(text);
  process.exit(code);
}

// By id: the checkout's plan, else the machine store's draft of it.
const one = (ctx, id) => { const p = planFor(ctx, id); return p ? [p] : null; };

function report(found) {
  if (JSON_OUT) console.log(JSON.stringify(found, null, 2));
  if (!JSON_OUT) for (const line of lines(found)) console.log(line);
  process.exitCode = exitOf(found);
}

function missing(dir) {
  console.error(`no plan "${ref}" in ${dir} — list them: node cli/qa-plan.mjs plans`);
  process.exit(EXIT.usage);
}

main();
