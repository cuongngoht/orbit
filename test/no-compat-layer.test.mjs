import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Adapters a current-contract engine refuses to grow back: a migration, a compatibility shim, a mirror.
const REMOVED = ["src/mcp/migrate.mjs", "src/extensions/compat", "control-server/src/mcp/legacy.mjs", "skills/orbit-report/legacy.mjs", "src/memory/upgrade.mjs", "src/mcp/secrets.mjs", "src/projection", "src/mirror.mjs", "cli/mirror.mjs"];

function files() {
  return [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean))];
}

test("no compatibility layer ships: no adapter module, no legacy alias in production code", () => {
  for (const path of REMOVED) assert.equal(existsSync(join(ROOT, path)), false, path);
  const production = files().filter((f) => /^(src|cli|skills|control-server\/src)\//.test(f) && /\.(mjs|js|json)$/.test(f) && existsSync(join(ROOT, f)));
  for (const path of production) assert.doesNotMatch(readFileSync(join(ROOT, path), "utf8"), /\bLEGACY_[A-Z_]+\b/, path);
});
