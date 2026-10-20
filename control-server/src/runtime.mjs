// Which Node this server needs, read from the one place that says so.
//
// control-server/package.json declares `engines.node`, and `node src/main.mjs`
// never reads package.json -- so without this the declaration would be a
// comment. The Orbit engine beside it stays on Node >= 20; this requirement is
// the Control Server's alone and is asked only by main.mjs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const FLOOR = /^>=\s*(\d+)\.(\d+)/;

export const required = () => JSON.parse(readFileSync(MANIFEST, "utf8")).engines.node;

export function supported(version, range = required()) {
  const [major, minor] = String(version).replace(/^v/, "").split(".").map(Number);
  const [, wantMajor, wantMinor] = FLOOR.exec(range).map(Number);
  return major > wantMajor || (major === wantMajor && minor >= wantMinor);
}
