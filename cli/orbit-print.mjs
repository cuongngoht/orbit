export function printGoalResult(deps, sub, rest, result) {
  const json = rest.includes("--json") || deps.argv.includes("--json");
  const say = deps.sayOps[sub] ?? deps.sayOps.doctor;
  console.log(json ? JSON.stringify(result, null, 2) : deps.printable(say(result)));
}
