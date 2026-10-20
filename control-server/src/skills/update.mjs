// Replace one SKILL.md, or leave it exactly as it was.
//
//   resolve the known skill  ->  hold the body to the contract  ->  refuse a
//   stale base  ->  write a temporary file  ->  rename it over SKILL.md
//
// Nothing is written until every check has passed, and the write itself is
// core's writeAtomic: a failed save leaves the old file in place, never half of
// the new one. Only SKILL.md is touched -- the rest of the directory, and the
// directory's name, are not this operation's to change.
import { readFileSync } from "node:fs";
import { realIo, writeAtomic } from "../core.mjs";
import { conflict, failed, invalid } from "../errors.mjs";
import { skillFile } from "./path.mjs";
import { readSkill, revisionOf } from "./read.mjs";
import { problemsOf } from "./validate.mjs";

export function updateSkill(ctx, id, body) {
  const file = skillFile(ctx, id);
  admitted(id, file, body);
  replaced(file, body.content);
  return readSkill(ctx, id);
}

function admitted(id, file, body) {
  if (typeof body?.content !== "string") throw invalid("INVALID_BODY", "the request body must be JSON with a string content");
  if (stale(file, body.revision)) throw conflict("STALE_SKILL", `${id} changed on disk after it was opened — reload it, then save again`);
  const problems = problemsOf(id, body.content);
  if (problems.length) throw invalid("INVALID_SKILL", `${id} was not saved: it does not hold to the skill contract (${problems.length} problem${problems.length > 1 ? "s" : ""}, listed in details)`, problems);
}

// A save that names no revision is not checked against one: a script driving
// the API may mean "whatever is there", and it said so by leaving it out.
const stale = (file, revision) => revision !== undefined && revision !== revisionOf(readFileSync(file, "utf8"));

function replaced(file, content) {
  try { writeAtomic(file, content, realIo(), false); }
  catch { throw failed("WRITE_FAILED", "SKILL.md could not be replaced; the file on disk is unchanged"); }
}
