// Which engine this IS, read once from the manifest that already says so.
//
// A LEAF, because two things need it and neither may import the other: an
// extension declares which engine versions it was tested against, and the
// registry of what a project has generated records which engine generated it.
// Both are answers a reader needs when something stops working after an upgrade,
// and a second copy of the number is how they would end up disagreeing.
//
// package.json is the declaration; there is no second one. It is read from this
// file's own location rather than from the working directory, because the engine
// is installed somewhere and run from somewhere else.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

let cached = null;

const manifest = () => (cached ??= read());

export const engineVersion = () => manifest().version ?? null;

// The name the host namespaces this plugin's skills and agents under (`orbit:orbit-help`).
export const engineName = () => manifest().name ?? null;

// An unreadable manifest is not worth stopping a run for -- nothing the engine
// DOES depends on knowing its own version, only what it can say about a range.
// So it answers null and every reader of a range reports "cannot tell", which is
// the honest answer and the one this engine prefers to a guess.
function read() {
  try { return JSON.parse(readFileSync(MANIFEST, "utf8")) ?? {}; }
  catch { return {}; }
}
