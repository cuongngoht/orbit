// Native BACKEND acceptance (doc §15; PBI 21): the example project taken through the whole loop on every stack and in
// every planted variant by acceptance/run.mjs -- recorded only by its `--record`, from a run that matched -- and keyed
// to the SOURCE it ran on: the engine and the acceptance definition alike, so a change to either is a change the
// acceptance must see again. In a pipeline it is awaited, as native host acceptance is: only a machine with Docker
// and the time for a whole run makes it, and a release (ship.mjs without --ci) is refused until it names this source.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SOURCES = ["src", "cli", "skills", "catalog", "acceptance"];
const SKIPPED = new Set(["node_modules", ".git"]);

const posix = (root, file) => relative(root, file).split(sep).join("/");

const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => !SKIPPED.has(e.name)).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [])) : []);

// The same source on any checkout: '/' separators and LF, so a Windows checkout names the digest a Linux run recorded.
export function backendSourceDigest(root) {
  const paths = [...SOURCES.flatMap((d) => filesUnder(join(root, d))), join(root, "package.json")].sort();
  return createHash("sha256").update(paths.map((file) => `${posix(root, file)}\n${readFileSync(file, "utf8").replaceAll("\r\n", "\n")}`).join("\n")).digest("hex");
}

// Every stack × variant the ground truth names (acceptance/truth.json), which a recorded run must have matched.
export const expectedRuns = (truth) => Object.entries(truth?.stacks ?? {}).flatMap(([stack, s]) => Object.keys(s.variants ?? {}).map((variant) => ({ stack, variant })));

export function backendAcceptance(root) {
  const file = join(root, "docs", "backend-acceptance.json");
  const record = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).acceptance ?? null : null;
  return acceptanceOf(record, backendSourceDigest(root), expectedRuns(JSON.parse(readFileSync(join(root, "acceptance", "truth.json"), "utf8"))));
}

export function acceptanceOf(record, digest, expected) {
  const missing = expected.filter((e) => !(record?.runs ?? []).some((r) => r.stack === e.stack && r.variant === e.variant && r.matched === true));
  const ok = record?.schema === 1 && record.sourceDigest === digest && missing.length === 0;
  return { name: "native backend acceptance", ok, detail: ok ? `${expected.length} stack × variant runs matched their ground truth on this source` : whyNot(record, digest, missing), sourceDigest: digest };
}

const whyNot = (record, digest, missing) => (!record ? "no acceptance run is recorded: node acceptance/run.mjs --record, on a machine with Docker" : record.sourceDigest !== digest ? "the recorded run was on another source: run node acceptance/run.mjs --record again" : `not matched on this source: ${missing.map((m) => `${m.stack} ${m.variant}`).join(", ")}`);
