// TASK SOURCES: a task is named `pack:<id>` (a local pack) or `swebench:<instance id>` (a SWE-bench Verified row). Each
// source says the image the agent's container runs, where the repository is in it, the issue text the agent is given
// (and nothing else of the task), how the starting tree is made and found, its control patches, and how it is graded.
//
//   taskOf(ref, ctx) -> task      task: { ref, source, image, repo, issue, digest, controlPatch(name),
//                                         start(scratch) -> { copyIn, gitDir, base, startTree }  (gitDir: the run's own, holding startTree), grade(ctx) }
import { join } from "node:path";
import { builtRepo, startOfWork } from "../core/git.mjs";
import { gradePack } from "../grade/packs.mjs";
import { controlPatch, loadPack, packDigest, startFiles } from "./packs.mjs";
import { swebenchTask } from "./swebench.mjs";

// A pack's start: its files committed once, and that tree staged in the run's own git directory, as every source's is.
function packStart(pack, scratch) {
  const repo = join(scratch, "work", "repo");
  const r = builtRepo(repo, startFiles(pack));
  return { copyIn: [{ from: join(scratch, "work"), to: "/" }], ...startOfWork(join(repo, ".git"), join(scratch, "start.git"), repo, r.commit) };
}

function packTask(id) {
  const pack = loadPack(id);
  return {
    ref: `pack:${id}`,
    source: "pack",
    pack,
    image: pack.image,
    repo: pack.repo,
    issue: pack.issue,
    digest: packDigest(pack),
    controlPatch: (name) => controlPatch(pack, name),
    start: (scratch) => packStart(pack, scratch),
    grade: (ctx) => gradePack(pack, ctx),
  };
}

const SOURCES = { pack: packTask, swebench: swebenchTask };

export function taskOf(ref, ctx = {}) {
  const m = /^([a-z]+):(.+)$/.exec(String(ref));
  if (!m || !SOURCES[m[1]]) throw new Error(`task ${ref}: name it pack:<id> or swebench:<instance id>`);
  return SOURCES[m[1]](m[2], ctx);
}
