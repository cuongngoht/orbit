// The directories inside one ui-tests/ root, derived once so the two layouts
// (src/project/locate.mjs, src/project/repository.mjs) cannot disagree.
import { join } from "node:path";
import { SCHEMA_DIR, SCREENS_DIR } from "../tests-tree.mjs";

export const treePaths = (dataRoot) => ({ graphDir: join(dataRoot, "graph"), screensDir: join(dataRoot, SCREENS_DIR), schemaDir: join(dataRoot, SCHEMA_DIR) });
