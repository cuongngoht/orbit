// THE PLUGIN AN ARM IS HANDED: `git archive` of one revision of the plugin's repository (a tag such as v0.5.0, or a
// commit), extracted once into the evaluator's home and copied into the task container at /opt/orbit-plugin. It is
// exactly what the repository exports -- its export-ignore rules leave out this evaluator, the old benchmark and every
// other development tree -- and an archive that still holds any of the evaluator is refused: the agent under test must
// never be handed an answer.
//
// An arm that carries the plugin may be SEATED (`seat: true`): before its agent starts, the entry runs, once, in the
// task container, the command the plugin's own coordinator skill (`/orbit-help`) runs the first time a person asks in a
// repository -- `node <plugin>/cli/help.mjs` in the checkout, which binds the checkout in the run's fresh store and
// writes nothing in the checkout -- with no answer from a person, no network and no credential. It measures the plugin
// as an adopter has it (a repository a person has used it in), where an unseated arm measures it merely installed.
//
//   resolvedPlugin(repo, rev) -> { rev, commit }        preparedPlugin(home, repo, commit) -> { dir, digest, files }
//   SEAT_ARGV      seatOf(def) -> null | { argv }      seatProblems(def, carriesPlugin) -> [problem]
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../core/git.mjs";
import { must } from "../core/proc.mjs";
import { sha256 } from "../core/util.mjs";
import { TOOLS_MOUNT } from "../core/versions.mjs";

export const PLUGIN_DIR_IN_CONTAINER = "/opt/orbit-plugin";

// The plugin's own adoption command: the same for every revision that carries it (v0.5.0 and the 0.6.0 candidate).
export const SEAT_ARGV = [`${TOOLS_MOUNT}/bin/node`, `${PLUGIN_DIR_IN_CONTAINER}/cli/help.mjs`];

export const seatOf = (def) => (def.seat === true ? { argv: SEAT_ARGV } : null);

export const seatProblems = (def, carriesPlugin) => (def.seat === undefined ? [] : !carriesPlugin ? ["seat: an arm that carries no plugin has nothing to seat"] : typeof def.seat === "boolean" ? [] : ["seat is true or false"]);

const PREFIX = "orbit-plugin";

// Paths an archive handed to an agent must never hold (the evaluator, its packs, the old benchmark's suites).
const FORBIDDEN = [/^orbit-plugin\/evaluator(\/|$)/, /^orbit-plugin\/benchmark\/suites\/./, /^orbit-plugin\/benchmark\/fixtures\/./];

export function resolvedPlugin(repo, rev) {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd: repo });
  if (!r.ok) throw new Error(`the plugin revision ${rev} is not a commit of ${repo} (fetch the tag first: git fetch origin tag ${rev})`);
  return { rev, commit: r.out.trim() };
}

const listed = (tarFile) => must(["tar", "-tf", tarFile]).out.split("\n").filter(Boolean);

export function preparedPlugin(home, repo, commit) {
  const root = join(home, "plugins", commit);
  const tarFile = join(root, "archive.tar");
  if (!existsSync(join(root, "READY"))) build(root, repo, commit, tarFile);
  return { dir: join(root, PREFIX), digest: sha256(readFileSync(tarFile)), files: listed(tarFile).filter((p) => !p.endsWith("/")).length };
}

function build(root, repo, commit, tarFile) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const r = git(["archive", "--format=tar", `--prefix=${PREFIX}/`, commit], { cwd: repo, binary: true });
  if (!r.ok) throw new Error(`git archive ${commit} failed: ${r.err}`);
  writeFileSync(tarFile, r.out);
  const bad = listed(tarFile).filter((p) => FORBIDDEN.some((re) => re.test(p)));
  if (bad.length) throw new Error(`the archive of ${commit} holds what an agent must never be handed: ${bad.slice(0, 5).join(", ")}`);
  const tmp = join(root, "extract");
  mkdirSync(tmp);
  must(["tar", "-xf", tarFile, "-C", tmp]);
  renameSync(join(tmp, PREFIX), join(root, PREFIX));
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(root, "READY"), `${commit}\n`);
}
