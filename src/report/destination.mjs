import { join } from "node:path";
import { sha } from "../hash.mjs";
import { storePath } from "../store/guard.mjs";

export function reportLock(ctx) {
  const root = ctx.store(true);
  return storePath(root, join(root, "state", "report-locks", sha(ctx.config.reports)));
}
