import { readFileSync } from "node:fs";
import { Refused } from "../errors.mjs";
import { flag, has, words } from "../learn/args.mjs";
import { startGoal } from "./start-goal.mjs";

export function startFromArgs(ports, args) {
  const ref = flag(args, "ref");
  if (has(args, "stdin")) return startGoal(ports, readFileSync(0, "utf8"), { sourceRef: ref });
  const file = flag(args, "file");
  if (file) return startGoal(ports, readFileSync(file, "utf8"), { sourceRef: ref });
  return startWords(ports, args, ref);
}

function startWords(ports, args, ref) {
  const rest = words(args).join(" ");
  if (rest) return startGoal(ports, rest, { sourceRef: ref });
  throw new Refused("goal start needs --stdin, --file=<path>, or text after start");
}
