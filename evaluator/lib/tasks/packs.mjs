// LOCAL TASK PACKS: a starting repository kept as data, a request, hidden tests and control patches (tasks/packs/<id>/,
// see convert.mjs for where they came from). A pack is a TASK of the evaluator: the agent's container is the pack's
// image with the starting repository copied in at /work/repo; the grader is a fresh container of the same image with
// no network (grade/packs.mjs).
//
//   packIds() -> [id]      loadPack(id) -> pack       startFiles(pack) -> [{ rel, text }]      packDigest(pack) -> sha256
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVALUATOR_DIR, sha256 } from "../core/util.mjs";

export const PACKS_DIR = join(EVALUATOR_DIR, "tasks", "packs");

export const packIds = (root = PACKS_DIR) => (existsSync(root) ? readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory() && existsSync(join(root, n, "pack.json"))).sort() : []);

export function loadPack(id, root = PACKS_DIR) {
  const dir = join(root, id);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !existsSync(join(dir, "pack.json"))) throw new Error(`no task pack named ${id}`);
  const meta = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  return { ...meta, dir, issue: readFileSync(join(dir, "issue.md"), "utf8") };
}

export const startFiles = (pack) => JSON.parse(readFileSync(join(pack.dir, "start.json"), "utf8")).files;

export const controlPatch = (pack, name) => ((file) => (existsSync(file) ? readFileSync(file) : null))(join(pack.dir, "controls", `${name}.patch`));

const walk = (dir, base = dir) => readdirSync(dir).sort().flatMap((n) => ((p) => (statSync(p).isDirectory() ? walk(p, base) : [p.slice(base.length + 1)]))(join(dir, n)));

// The digest of everything a pack is: every file under it, by path and bytes.
export const packDigest = (pack) => sha256(walk(pack.dir).map((rel) => `${rel}\0${sha256(readFileSync(join(pack.dir, rel)))}`).join("\n"));
