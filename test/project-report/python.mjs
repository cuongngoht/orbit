// Which Python the project-report tests run their parts with -- found the way the
// product finds one (the shipped catalog row, real detection), so a machine the
// tests pass on is a machine the report runs on.
//
// On CI (CI=true, or ORBIT_REQUIRE_PYTHON=1) a missing interpreter FAILS the
// suite: the parts are half of what is being tested. On a developer's machine
// it is a skip with the reason, which the ship gate prints as a count.
// ORBIT_TEST_PYTHON names one explicitly (e.g. `uv python find 3.12`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolCatalog } from "../../src/tools/catalog.mjs";
import { detectTool } from "../../src/tools/detect.mjs";
import { realDetection } from "../../src/tools/real.mjs";

const REPO = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "..", "..");
export const KIT = join(REPO, "skills", "orbit-report", "python");
export const SHIM = join(KIT, "orbit_part.py");

let found;

export function testPython() {
  found ??= locate();
  return found;
}

function locate() {
  if (process.env.ORBIT_TEST_PYTHON) return { path: process.env.ORBIT_TEST_PYTHON, version: "given" };
  const row = toolCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "tools.json"), "utf8"))).find((t) => t.id === "python");
  const hit = detectTool(row, { ...realDetection(process.env), projectRoot: null, receipts: [], rooms: {}, now: () => new Date().toISOString() });
  return hit.status === "ready" ? { path: hit.path, version: hit.version } : { path: null, reason: hit.reason ?? "no Python 3.11 or newer on PATH" };
}

export const pythonRequired = () => process.env.CI === "true" || process.env.ORBIT_REQUIRE_PYTHON === "1";

// For a test: the interpreter, or a skip (a failure where Python is required).
export function pythonOr(t) {
  const py = testPython();
  if (py.path) return py.path;
  if (pythonRequired()) throw new Error(`these tests need Python 3.11 or newer and none was found: ${py.reason}`);
  t.skip(`no Python 3.11+ here (${py.reason}); set ORBIT_TEST_PYTHON to run these`);
  return null;
}
