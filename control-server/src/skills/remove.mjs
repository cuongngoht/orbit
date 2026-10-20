// Delete a skill: its WHOLE directory, because a skill is more than SKILL.md --
// scripts, helpers and templates live beside it, and leaving them behind would
// leave a directory the next catalog scan no longer calls a skill.
//
//   resolve a known skill, contained, no symlink  ->  back it up  ->  delete
//
// The backup throws before anything is removed if it cannot be made. rmSync
// never follows a symlink it finds inside the directory; it removes the link.
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { failed } from "../errors.mjs";
import { backupSkill } from "./backup.mjs";
import { skillFile } from "./path.mjs";

export function removeSkill(ctx, id) {
  const dir = dirname(skillFile(ctx, id));
  const backup = backupSkill(ctx, id, dir);
  removed(dir, backup);
  ctx.log(`deleted skill ${id}; backup at ${backup.path}`);
  return { id, deleted: true, backup: backup.id };
}

function removed(dir, backup) {
  try { rmSync(dir, { recursive: true, force: false, maxRetries: 3 }); }
  catch { throw failed("DELETE_FAILED", `the skill could not be fully deleted; the backup ${backup.id} is intact`); }
}
