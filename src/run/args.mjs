// The runner's command line: a case reference, NAME=value pairs, and flags.
export const USAGE = "usage: run-case <id | path.json | report.html> [NAME=value …] [--dry] [--draft] [--force-destructive] [--stale-ok] [--from=N] [--to=M] [--out=DIR] [--json] [--report]";

export function parseArgs(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const [ref, ...pairs] = argv.filter((a) => !a.startsWith("--"));
  return { ref, given: pairsOf(pairs), ...flagsOf(flags) };
}

const pairsOf = (pairs) => Object.fromEntries(pairs.map((w) => [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)]));

function flagsOf(flags) {
  const has = (f) => flags.includes(`--${f}`);
  const opt = (n) => flags.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return { dry: has("dry"), draft: has("draft"), force: has("force-destructive"), staleOk: has("stale-ok"), json: has("json"), from: opt("from"), to: opt("to"), out: opt("out") };
}
