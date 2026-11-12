// Every case of the old benchmark's change suites converted into packs, and the ones that cannot be a pack listed in
// tasks/packs/EXCLUDED.md with the reason.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertCase } from "./convert.mjs";

export const SUITES = ["orbit-engineering", "orbit-heldout"];

export function convertAll(benchDir, outRoot) {
  const seen = new Map();
  const done = SUITES.flatMap((suite) => readdirSync(join(benchDir, "suites", suite)).filter((n) => n.startsWith("orbit-")).sort().map((n) => ({ suite, ...convertCase(benchDir, suite, n, outRoot, seen) })));
  const excluded = done.filter((d) => d.excluded);
  writeFileSync(join(outRoot, "EXCLUDED.md"), ["# Cases that are not packs", "", "Converted from the old benchmark's change suites; these were left out, each for the reason given.", "", "| case | suite | why |", "|---|---|---|", ...excluded.map((d) => `| ${d.case} | ${d.suite} | ${d.excluded} |`), ""].join("\n"));
  return done;
}
