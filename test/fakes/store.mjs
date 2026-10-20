// A machine store on a throwaway disk, with the project key COMPUTED.
//
// The suite must never resolve the developer's own ~/.orbit: a test
// that recorded a run there would pollute the machine it runs on, and one that
// read from there would pass or fail depending on whose laptop it was. So every
// test that touches the ledger, the notes, the evidence, the lessons, the
// architecture facts or the drafts exports ORBIT_STORE_DIR at one of these.
//
// The key is computed rather than committed. It is a hash of the project's
// origin (src/store/resolve.mjs projectKey), so a seed directory named after
// one would be unreadable to a person and would rot silently the day a
// fixture's origin changed -- the test would still pass, against an empty
// store, which is the failure mode worth paying a few lines to avoid.
//
// FIXTURES is recomputed here rather than imported from ./context.mjs: that
// module imports this one, and a cycle between two fakes fails at load with a
// message about initialisation order that says nothing about either.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { caseDigest } from "../../src/dsl/digest.mjs";
import { loadCases } from "../../src/dsl/load.mjs";


const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const LEDGERS = join(FIXTURES, "ledger");

// Where a given project's store would land under a ORBIT_STORE_DIR base. The
// same answer resolveStore() gives, asked without a filesystem.
export function storeRootIn(base, project) {
  return join(base, project.storeKey);
}

// A base to export as ORBIT_STORE_DIR, with one of test/fixtures/ledger/* copied
// into the project's own room. `seedStore()` with no ledger is an empty store.
//
// `{ digests: true }` stamps every seeded run with the digest of the fixture
// case AS IT STANDS (src/dsl/digest.mjs) -- a test that means "a fresh PASS"
// then means exactly that. The committed seed stays digest-less on purpose: it
// is the shape a run recorded before 1.7.0 has, and a test holds that such a
// run reads unknown rather than fresh.
export function seedStore(ledger, project, opts = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-store-"));
  const from = ledger && join(LEDGERS, ledger);
  if (from && existsSync(from)) cpSync(from, storeRootIn(base, project), { recursive: true });
  if (opts.digests) stampDigests(join(storeRootIn(base, project), "runs"));
  return base;
}

function stampDigests(dir) {
  const digests = new Map(loadCases(join(FIXTURES, "ui-tests", "screens")).map((c) => [c.id, caseDigest(c)]));
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")) : [];
  for (const f of files) writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8").split("\n").map((l) => stamped(l, digests)).join("\n"));
}

function stamped(line, digests) {
  if (!line.trim()) return line;
  const run = JSON.parse(line);
  return JSON.stringify({ ...run, case_digest: digests.get(run.case) ?? null });
}
