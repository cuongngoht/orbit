// A test WRITES only through a grant the engine mints (ADR 0037, doc §6.3).
//
// `mutates` no longer means `destructive`. A generated test may write, publish, enqueue,
// trigger, consume, settle, replay or control a workload -- but only on its own fixture, in an
// isolated sandbox its task owns, for an operation its design declared, under a bound oracle,
// within budget, on the current tree, and inside a person's policy. Each condition is a row of
// MINT, ordered, each refusing with its own id; a grant is minted only when every row holds,
// AT DISPATCH, once the sandbox, the endpoints, the fixture and the tree are known. Nothing an
// agent sends -- a field, a flag, `--human` -- can mint one: the world below is assembled by the
// composition root from owners' records, never from a proposal.
//
// A grant names exactly what it allows (task, run, attempt, sandbox and tree, the capability at
// its version, the principal, the resources, the operation class, the input's digest, the
// effect scope, the bounds) and expires. One use is spent before each effect
// (src/run/grants.mjs), so a transport retry is a second use and is refused; an intentional
// duplicate or a replay is a grant OF ITS OWN (`duplicateOf`, `replayOf`), designed on purpose.
import { canonicalJson, sha, short } from "../../hash.mjs";

export const GRANT_API = "orbit.test-grant/v1";

// world: { task, run, attempt, sandbox: {owner, tree, currentTree, isolated}, mode: {id, mutates},
//          capability: {id, version, from, mutatingEffects: [...]}, operation: {class, selectors},
//          fixture: {namespace, resources}, requested: {resources, indirect, inputDigest},
//          sinks: [fixture sink refs], design: {oracleRef, designRef, operations},
//          budget: {uses}, policy: {revision, allows: [classes]}, principal, nowMs, ttlMs, bounds }
export const MINT = [
  { id: "OWNED", holds: (w) => w.sandbox?.owner?.kind === "task" && w.sandbox.owner.id === w.task, say: (w) => `the sandbox is not task ${w.task}'s own` },
  { id: "ISOLATED", holds: (w) => w.sandbox?.isolated === true, say: () => "isolation is not proven for this sandbox — an active generated test runs only where it is (ADR 0038)" },
  { id: "MODE", holds: (w) => w.mode?.mutates === true, say: (w) => `mode ${w.mode?.id ?? "?"} does not write` },
  { id: "CAPABILITY", holds: (w) => (w.capability?.mutatingEffects ?? []).includes(w.operation?.class), say: (w) => `${w.capability?.id ?? "the capability"} does not declare ${w.operation?.class ?? "this operation"} as an effect` },
  { id: "FIXTURE", holds: (w) => Boolean(w.fixture?.namespace) && (w.requested?.resources ?? []).every((r) => (w.fixture.resources ?? []).includes(r)), say: (w) => `a resource it would touch is not in this run's fixture (${missing(w.requested?.resources, w.fixture?.resources).join(", ") || "no fixture"})` },
  { id: "INDIRECT", holds: (w) => (w.requested?.indirect ?? []).every((r) => (w.sinks ?? []).includes(r)), say: (w) => `an indirect effect would leave the fixture (${missing(w.requested?.indirect, w.sinks).join(", ")}) — a publish never allows a consumer to reach a real sink` },
  { id: "DESIGN", holds: (w) => Boolean(w.design?.oracleRef && w.design?.designRef), say: () => "no oracle and design are bound — a write is never made to see what happens" },
  { id: "INPUT", holds: (w) => typeof w.requested?.inputDigest === "string" && w.requested.inputDigest.length === 64, say: () => "the exact input is not pinned — a grant covers one input, digested, never whatever a call sends" },
  { id: "ALLOWLIST", holds: (w) => (w.design?.operations ?? []).includes(w.operation?.class), say: (w) => `the design did not declare ${w.operation?.class ?? "this operation"}` },
  { id: "BUDGET", holds: (w) => (w.budget?.uses ?? 0) > 0, say: () => "the run's write budget is spent" },
  { id: "TREE", holds: (w) => Boolean(w.sandbox?.tree) && w.sandbox.tree === w.sandbox.currentTree, say: (w) => `the sandbox runs tree ${w.sandbox?.tree ?? "?"}, the task now holds ${w.sandbox?.currentTree ?? "?"}` },
  { id: "POLICY", holds: (w) => (w.policy?.allows ?? []).includes(w.operation?.class), say: (w) => `no standing policy allows ${w.operation?.class ?? "this operation"} here — a person approves it once in Orbit Control, or not at all` },
];

const missing = (wanted, held) => (wanted ?? []).filter((r) => !(held ?? []).includes(r));

export function mintGrant(world) {
  const refused = MINT.filter((row) => !row.holds(world)).map((row) => ({ id: row.id, say: row.say(world) }));
  if (refused.length) return { grant: null, refused };
  return { grant: grantOf(world), refused: [] };
}

function grantOf(w) {
  const body = { v: GRANT_API, task: w.task, run: w.run, attempt: w.attempt ?? 1, sandbox: { tree: w.sandbox.tree }, capability: { id: w.capability.id, version: w.capability.version ?? null, from: w.capability.from ?? null }, principal: w.principal ?? null, resources: [...(w.requested.resources ?? [])].sort(), operation: { class: w.operation.class, selectors: w.operation.selectors ?? {} }, input: { digest: w.requested.inputDigest ?? null }, effects: { scope: "fixture", indirect: [...(w.requested.indirect ?? [])].sort() }, bounds: boundsOf(w), expiresAtMs: w.nowMs + (w.ttlMs ?? 15 * 60 * 1000), policyRevision: w.policy.revision ?? null };
  return { ...body, id: `grt-${short(canonicalJson(body), 16)}`, digest: sha(canonicalJson(body)) };
}

// How many times it may be used, and what makes it a duplicate or a replay ON PURPOSE.
const boundsOf = (w) => ({ maxUses: Math.max(1, Math.min(w.bounds?.maxUses ?? 1, w.budget.uses)), ...(w.bounds?.duplicateOf ? { duplicateOf: w.bounds.duplicateOf } : {}), ...(w.bounds?.replayOf ? { replayOf: w.bounds.replayOf, range: w.bounds.range ?? null, count: w.bounds.count ?? null } : {}) });
