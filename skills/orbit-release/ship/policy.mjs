// THE RELEASE POLICY, read from its data (policy.json, ADR 0049): every case of every suite a release must hold, what
// each kind of case must come to, the one coding host a model-carried row may have, the limits a ship runs within, and
// the paths no repair may touch. The catalog is named case by case, so a case that leaves a suite -- or one that joins
// it unnamed -- is CATALOG_DRIFT, never a smaller catalog that passes.
//
//   policyOf(text) -> policy          rowsOf(policy, listed) -> [row]          catalogDrift(policy, listed) -> [says]
//   limitsOf(policy, asked) -> limits   policyDigest(policy) -> hex          matchesAny(globs, rel) -> boolean
//   LIMIT_FLAGS: each limit's flag, as a person types it
//   row: { id, case, suite, kind, req, run: verify|controls|autonomous, variant, repair, expect, autonomous, recorded,
//          rank }
//   A RECORDED row (ADR 0051) is a model-carried row of a suite or a case the policy's `recorded` names: the ship runs
//   it once, under its retries, and reports it held or not -- it never blocks SHIPPABLE. Controls are never recorded.
import { Refused } from "../../../src/errors.mjs";
import { canonicalJson, sha } from "../../../src/hash.mjs";

const RUNS = ["verify", "controls", "autonomous"];

const KINDS = ["source", "qa", "engineering", "sessions", "activation"];

// What a policy must say before anything is run on its word.
const SHAPE = [
  { says: "schema 1", holds: (p) => p?.schema === 1 },
  { says: "a host naming claude-code and the coding-host basis", holds: (p) => p.host?.cli === "claude-code" && p.host?.basis === "coding-host" && Array.isArray(p.host?.endpoints) && p.host.endpoints.length > 0 },
  { says: "requirements for every kind of case, each run one of verify, controls, autonomous", holds: (p) => KINDS.every((k) => Array.isArray(p.requirements?.[k]) && p.requirements[k].every((r) => RUNS.includes(r.kind))) },
  { says: "a catalog of suites, each a list of case ids", holds: (p) => p.catalog && Object.values(p.catalog).every((ids) => Array.isArray(ids) && ids.length > 0) },
  { says: "limits within their bounds", holds: (p) => Object.entries(p.limits ?? {}).every(([k, v]) => within(p.bounds?.[k], v)) },
  { says: "protected paths", holds: (p) => Array.isArray(p.protected) && p.protected.length > 0 },
  { says: "recorded rows naming only suites and cases the catalog holds", holds: (p) => p.recorded === undefined || recordedHolds(p) },
];

const recordedHolds = (p) => Array.isArray(p.recorded.suites) && Array.isArray(p.recorded.cases) && p.recorded.suites.every((s) => Object.hasOwn(p.catalog, s)) && p.recorded.cases.every((c) => Object.values(p.catalog).flat().includes(c));

const within = (b, v) => Array.isArray(b) && typeof v === "number" && v >= b[0] && v <= b[1];

export function policyOf(text) {
  const p = JSON.parse(text);
  const bad = SHAPE.filter((r) => !safely(() => r.holds(p)));
  if (bad.length) throw new Refused(`the release policy does not hold: it needs ${bad.map((r) => r.says).join("; ")}`);
  return p;
}

function safely(fn) {
  try { return fn() === true; }
  catch { return false; }
}

export const policyDigest = (p) => sha(canonicalJson(p));

// ---- the rows a cycle holds ------------------------------------------------------------------------------------------

// Every case the benchmark lists, by id: its kind and its suite (`run.mjs list --json`).
const listedCases = (listed) => new Map((listed?.suites ?? []).flatMap((s) => s.cases.map((c) => [c.id, { ...c, suite: s.id }])));

// Whether a row is RECORDED and not required: a model-carried row whose suite or case the policy's `recorded` names.
const recordedIn = (p, suite, id) => (p.recorded?.suites ?? []).includes(suite) || (p.recorded?.cases ?? []).includes(id);

const rowOf = (p, caseId, suite, kind, req) => ({ id: `${caseId}:${req.id}`, case: caseId, suite, kind, req: req.id, run: req.kind, variant: req.variant ?? null, repair: req.repair === true, expect: req.expect ?? null, autonomous: req.kind === "autonomous", recorded: req.kind === "autonomous" && recordedIn(p, suite, caseId), rank: RUNS.indexOf(req.kind) });

const caseRows = (p, cases) => ([suite, ids]) => ids.flatMap((id) => (p.requirements[cases.get(id)?.kind] ?? []).map((req) => rowOf(p, id, suite, cases.get(id).kind, req)));

const extraRows = (p, cases) => (p.extra ?? []).filter((x) => cases.has(x.case)).map((x) => rowOf(p, x.case, cases.get(x.case).suite, cases.get(x.case).kind, x));

// The rows in the order a cycle runs them -- every verification, then every control, then every model-carried row --
// so a cycle that will be repaired never spends a model's budget; the catalog's order within each.
export function rowsOf(p, listed) {
  const cases = listedCases(listed);
  const rows = [...Object.entries(p.catalog).flatMap(caseRows(p, cases)), ...extraRows(p, cases)];
  return rows.map((r, i) => ({ ...r, order: i })).sort((a, b) => a.rank - b.rank || a.order - b.order);
}

// What the catalog and the suites disagree on, either way: a case the policy names that no suite holds, and one a suite
// holds that the policy does not name.
export function catalogDrift(p, listed) {
  const cases = listedCases(listed);
  const named = new Set(Object.values(p.catalog).flat());
  return [...[...named].filter((id) => !cases.has(id)).map((id) => `${id} is in the release policy and no suite holds it`), ...[...cases.keys()].filter((id) => !named.has(id)).map((id) => `${id} is in suite ${cases.get(id).suite} and the release policy does not name it`)];
}

// ---- limits ------------------------------------------------------------------------------------------------------------

// The flag a person sets each limit with (`ship.mjs --retries=2`): read by ship.mjs, and named back in a refusal -- a
// person typed `--retries`, never the policy's own key. A limit with no flag here is the policy's alone.
export const LIMIT_FLAGS = { minutes: "minutes", usd: "usd", cycles: "cycles", repairAttempts: "attempts", autonomousRetries: "retries" };

const flagSaid = (k) => `--${LIMIT_FLAGS[k] ?? k}`;

// The limits a ship runs within: the policy's, or what a person asked, inside the policy's bounds -- never past them.
export function limitsOf(p, asked = {}) {
  const out = { ...p.limits };
  const bad = Object.entries(asked).filter(([k, v]) => v !== undefined && !within(p.bounds?.[k], v));
  if (bad.length) throw new Refused(`out of bounds: ${bad.map(([k]) => `${flagSaid(k)} is ${p.bounds?.[k]?.join("..") ?? "not a limit"}`).join(", ")}`);
  return Object.assign(out, Object.fromEntries(Object.entries(asked).filter(([, v]) => v !== undefined)));
}

// ---- paths -------------------------------------------------------------------------------------------------------------

const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const globRe = (glob) => new RegExp(`^${glob.split("**").map((part) => part.split("*").map(esc).join("[^/]*")).join(".*")}$`);

export const matchesAny = (globs, rel) => globs.some((g) => globRe(g).test(rel));
