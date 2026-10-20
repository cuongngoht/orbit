// Which skills exist: every DIRECT child of skills/ holding a SKILL.md.
//
// There is no registry and no list to keep in step -- the directory IS the
// catalog, the same way a host discovers skills. A child that is not a plain
// directory, whose name is not a skill ID, or that has no readable SKILL.md is
// not a skill and is not listed; nothing below it is ever read.
import { readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { isSkillId, skillFile } from "./path.mjs";
import { statsOf } from "./stats.mjs";
import { metadataOf, problemsOf } from "./validate.mjs";

export function listSkills(ctx) {
  const dirs = readdirSync(ctx.skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && isSkillId(d.name));
  return dirs.map((d) => listed(ctx, d.name)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

function listed(ctx, id) {
  try { return summaryAt(id, skillFile(ctx, id)); }
  catch { return null; }
}

// `valid` and `problems` say whether the file on disk holds to the contract NOW,
// so a skill somebody broke by hand is visible before anyone opens it. The
// directory's weight rides along for the analytics page and the delete dialog;
// it is read off the disk, never tracked.
export function summaryAt(id, file, content = readFileSync(file, "utf8")) {
  const problems = problemsOf(id, content);
  return { ...metadataOf(id, content), valid: problems.length === 0, problems, skillBytes: Buffer.byteLength(content), ...statsOf(dirname(file)) };
}
