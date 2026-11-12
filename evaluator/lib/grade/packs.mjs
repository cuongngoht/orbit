// GRADING A PACK: after the agent's container is gone, a FRESH container of the pack's image, with no network, gets the
// starting repository, the patch alone and the pack's hidden files, and runs lib/container/grade-pack.mjs. The agent's
// container is never asked anything; what is graded is the patch, against tests it never held.
//
//   gradePack(pack, ctx) -> { ran, applied, resolved, regressed, f2pFailed, p2pFailed, tests, why, image }
//   ctx: { patchFile, scratch, names: { grader }, labels, room }
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyIn, createContainer, ensureImage, removeContainer, startAttached, stateOf } from "../core/docker.mjs";
import { builtRepo } from "../core/git.mjs";
import { EVALUATOR_DIR, writeJson } from "../core/util.mjs";
import { startFiles } from "../tasks/packs.mjs";

const lastJson = (text) => String(text).split("\n").map((l) => {
  try { return JSON.parse(l); }
  catch { return null; }
}).filter((j) => j && typeof j === "object").at(-1) ?? null;

// The grader's report mapped onto what an outcome needs.
export function gradedFrom(report, pack) {
  if (!report) return { ran: false, applied: false, why: "the grader printed nothing readable" };
  if (!report.applied) return { ran: true, applied: false, why: `the patch did not apply: ${String(report.why ?? "").slice(0, 300)}` };
  const failed = (kind) => report.tests.filter((t) => t.kind === kind && !t.ok).map((t) => t.file);
  const missing = [...pack.f2p.map((t) => t.target), ...pack.p2p].filter((f) => !report.tests.some((t) => t.file === f));
  if (missing.length) return { ran: true, applied: true, why: `the grader did not run ${missing.join(", ")}` };
  return { ran: true, applied: true, resolved: !failed("f2p").length && !failed("p2p").length, regressed: failed("p2p").length > 0, f2pFailed: failed("f2p"), p2pFailed: failed("p2p"), tests: report.tests.map(({ tail, ...t }) => t) };
}

function staged(pack, ctx) {
  const root = join(ctx.scratch, "grade");
  rmSync(root, { recursive: true, force: true });
  builtRepo(join(root, "work", "repo"), startFiles(pack));
  mkdirSync(join(root, "grade"), { recursive: true });
  cpSync(join(pack.dir, "hidden"), join(root, "grade", "hidden"), { recursive: true });
  copyFileSync(ctx.patchFile, join(root, "grade", "patch.diff"));
  copyFileSync(join(EVALUATOR_DIR, "lib", "container", "grade-pack.mjs"), join(root, "grade", "grade-pack.mjs"));
  writeJson(join(root, "grade", "brief.json"), { repo: pack.repo, patch: "/grade/patch.diff", hidden: "/grade/hidden", f2p: pack.f2p, p2p: pack.p2p, perFileSeconds: pack.grade.perFileSeconds });
  return root;
}

const graderSpec = (pack, ctx, image) => ({ name: ctx.names.grader, image, labels: { ...ctx.labels, "orbit.eval.role": "grader" }, network: null, env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", HOME: "/tmp" }, limits: { cpus: pack.grade.cpus, memoryMb: pack.grade.memoryMb, pids: pack.grade.pids }, argv: ["node", "/grade/grade-pack.mjs"], workdir: "/", entrypoint: "" });

export async function gradePack(pack, ctx) {
  const img = ensureImage(pack.image);
  if (!img.ok) return { ran: false, applied: false, why: img.why };
  const root = staged(pack, ctx);
  try {
    const c = createContainer(graderSpec(pack, ctx, img.id));
    if (!c.ok) return { ran: false, applied: false, why: c.why };
    for (const [from, to] of [[join(root, "work"), "/"], [join(root, "grade"), "/"]]) if (!copyIn(from, ctx.names.grader, to).ok) return { ran: false, applied: false, why: `docker cp into the grader failed` };
    const out = join(ctx.room, "grader.out.jsonl");
    const ran = await startAttached(ctx.names.grader, out, { deadlineMs: (pack.grade.perFileSeconds * (pack.f2p.length + pack.p2p.length) + 120) * 1000, onDeadline: () => removeContainer(ctx.names.grader) });
    const state = stateOf(ctx.names.grader);
    const report = lastJson(readFileSync(out, "utf8"));
    writeJson(join(ctx.room, "grade-report.json"), report);
    return { ...gradedFrom(report, pack), image: img.id, exit: state?.exitCode ?? ran.code, timedOut: ran.timedOut };
  } finally {
    await Promise.allSettled([Promise.resolve().then(() => removeContainer(ctx.names.grader)), Promise.resolve().then(() => rmSync(root, { recursive: true, force: true }))]);
  }
}
