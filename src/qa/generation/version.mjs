// A generated case, FROZEN as the version a run was bound to (doc §10; ADR 0032).
//
// A draft can be saved again under the same id, and promoting it moves the file away (src/draft/):
// neither is something evidence can point at. So the case a run executes is frozen first -- its
// digest computed the way a run records it (src/dsl/digest.mjs, the case AS WRITTEN, key order
// kept), its sidecar held to the `version` definition (src/qa/obligations/contract.mjs) -- and
// stored by the investigation as a write-once artifact at
//
//   artifacts/versions/<digest16>/<case id>.json      the case, so the id still names its file
//   artifacts/versions/<digest16>/version.json        this sidecar
//
// An audit snapshot, never a writable mirror of a suite: nothing reads it back into drafts or the
// data home. A design or a source that changes makes a new version; the old one stays.
import { Refused } from "../../errors.mjs";
import { asWritten, caseDigest } from "../../dsl/digest.mjs";
import { artifactFindings } from "../obligations/validate.mjs";

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function freezeVersion({ case: c, design, versionNumber, engineVersion, validatorVersion, dslDigest, extensionsDigest }) {
  if (!CASE_ID.test(String(c?.id ?? ""))) throw new Refused(`a case whose id is "${String(c?.id ?? "").slice(0, 60)}" cannot be frozen — its id names its file`);
  const digest = caseDigest(c);
  const version = defined({ testCaseRef: c.id, caseDigest: digest, version: versionNumber, generatorVersion: engineVersion, designRef: design, validatorVersion, dslDigest, extensionsDigest });
  held(version);
  return { id: `${c.id}@${digest.slice(0, 16)}`, version, case: asWritten(c), path: `versions/${digest.slice(0, 16)}/${c.id}.json` };
}

const defined = (record) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null));

function held(version) {
  const problems = artifactFindings("version", version);
  if (problems.length) throw new Refused(`the frozen version is not a version this engine keeps:\n  ${problems.join("\n  ")}`);
}
