// A copy of a whole skill directory, taken before it is deleted.
//
// It goes to the machine store (main.mjs resolves it through core's storeBase:
// ORBIT_STORE_DIR or the home default, never inside a repository), under
// control-backups/skills/<timestamp>/<id>/. Not beside skills/: a backup inside
// the plugin would be shipped with it, and one inside a checkout is a diff.
//
// The copy is CHECKED before anything is deleted -- a backup that did not land
// is the same as no backup, and no backup means no deletion. Symlinks inside
// the directory are copied as the links they are, never followed out of it.
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { failed } from "../errors.mjs";
import { SKILL_FILE } from "./path.mjs";

export function backupSkill(ctx, id, dir) {
  const stamp = ctx.now().toISOString().replace(/[:.]/g, "-");
  const path = join(ctx.backupRoot, stamp, id);
  copied(dir, path);
  return { id: `${stamp}/${id}`, path };
}

function copied(dir, path) {
  try { landed(dir, path); }
  catch { throw failed("BACKUP_FAILED", "the skill could not be backed up, so nothing was deleted"); }
}

function landed(dir, path) {
  cpSync(dir, path, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  if (!readFileSync(join(path, SKILL_FILE)).equals(readFileSync(join(dir, SKILL_FILE)))) throw new Error("the copied SKILL.md differs");
}
