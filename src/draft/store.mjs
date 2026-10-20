import { join } from "node:path";

export const draftPaths = (root) => ({
  root: join(root, "drafts"),
  cases: join(root, "drafts", "cases"),
  plans: join(root, "drafts", "plans"),
  state: join(root, "drafts", "state"),
  meta: join(root, "drafts", "state", "meta.json"),
});
