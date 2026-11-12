// PACK VERIFICATION, with no agent: each pack's grader run on the empty patch (every fail-to-pass test must fail and
// every pass-to-pass test pass -- else the task is not a task) and on each of its control patches (gold must resolve,
// regress must regress, the rest as the pack declares). It proves the packs and the grader together.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labelsOf } from "../core/docker.mjs";
import { ensureDir, sha256 } from "../core/util.mjs";
import { gradePack } from "../grade/packs.mjs";
import { controlPatch, loadPack, packIds } from "../tasks/packs.mjs";

const HOLDS = {
  NULL: (g, pack) => g.ran && g.applied && g.f2pFailed.length === pack.f2p.length && !g.p2pFailed.length,
  RESOLVED: (g) => g.ran && g.applied && g.resolved,
  NOT_RESOLVED: (g) => g.ran && g.applied && !g.resolved,
  REGRESSED: (g) => g.ran && g.applied && g.regressed,
};

async function oneControl(pack, name, expect, scratch) {
  const patchFile = join(scratch, `${name}.patch`);
  writeFileSync(patchFile, name === "null" ? "" : controlPatch(pack, name));
  const tag = sha256(`${pack.id}/${name}/${process.pid}`).slice(0, 10);
  const g = await gradePack(pack, { patchFile, scratch: ensureDir(join(scratch, name)), names: { grader: `evl-verify-${tag}` }, labels: labelsOf("verify", `${pack.id}/${name}`, "grader"), room: ensureDir(join(scratch, `${name}-room`)) });
  return { pack: pack.id, control: name, expect, holds: HOLDS[expect](g, pack), f2pFailed: g.f2pFailed ?? null, p2pFailed: g.p2pFailed ?? null, why: g.why ?? null };
}

export async function verifyPacks(ids = packIds()) {
  const rows = [];
  for (const id of ids) {
    const pack = loadPack(id);
    const scratch = mkdtempSync(join(tmpdir(), "evl-verify-"));
    try {
      for (const [name, c] of [["null", { expect: "NULL" }], ...Object.entries(pack.controls)]) rows.push(await oneControl(pack, name, c.expect, scratch));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return rows;
}
