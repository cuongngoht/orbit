// One skill, whole: what the list shows, the full SKILL.md, and a revision.
//
// The revision is a hash of the content as it was read. A save carries it back,
// and update.mjs refuses one whose base is no longer what is on disk -- an agent
// or a person may edit SKILL.md while it sits open in the browser, and the
// second save silently erasing the first is the failure this prevents.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { skillFile } from "./path.mjs";
import { summaryAt } from "./catalog.mjs";

export function readSkill(ctx, id) {
  const file = skillFile(ctx, id);
  const content = readFileSync(file, "utf8");
  return { ...summaryAt(id, file, content), revision: revisionOf(content), content };
}

export const revisionOf = (content) => createHash("sha256").update(content).digest("hex");
