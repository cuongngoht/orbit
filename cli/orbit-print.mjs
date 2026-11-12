import { engined, enginedDeep } from "../src/engined.mjs";

export function printGoalResult(deps, sub, rest, result) {
  const json = rest.includes("--json") || deps.argv.includes("--json");
  const say = deps.sayOps[sub] ?? deps.sayOps.doctor;
  console.log(json ? JSON.stringify(enginedDeep(result, deps.pluginRoot), null, 2) : deps.printable(engined(say(result), deps.pluginRoot)));
}
