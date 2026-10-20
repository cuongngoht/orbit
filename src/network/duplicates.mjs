// "One action sent the same request twice" -- as an OBSERVATION, first. Two
// POSTs after one click is where an investigation starts, never where it ends:
// a CORS preflight, a redirect, a declared retry, polling, a token refresh and
// a development build all produce the same picture, and only data or an
// accepted contract turns a suspicion into a defect.
//
// Requests are GROUPED by what makes two of them the same request: method,
// canonical endpoint, query fingerprint, payload fingerprint (or "unknown") and
// the identity that sent them. Different query values (page=1, page=2) or
// different payloads are different groups, so pagination and deliberate calls
// with different bodies never form one. Only a group of two or more is asked
// anything.
//
// Each group is then EXPLAINED by an ordered table, first match wins, the last
// always matches. The order is the policy: every legitimate explanation is
// tried before any suspicion is raised, and a declared contract ("one Save,
// one POST") outranks everything except the explanations the same project
// declared (its retries, its polling). What the project declares arrives in
// `policy` -- nothing here names an endpoint, a framework or a product.
//
// `outcome` is src/investigation/vocab.mjs's word for what the NETWORK alone
// shows. src/investigation/findings.mjs weighs it against the data.
import { pathOf } from "./canonical.mjs";
import { writes } from "./observe.mjs";

// A development build double-invokes on purpose, and so does a sandbox: a task runs the same dev server.
const DEVELOPMENT_KINDS = ["development", "sandbox"];
export const isDevelopment = (kind) => DEVELOPMENT_KINDS.includes(kind);

const keyOf = (r, identity) => [r.method, r.endpoint, r.queryFp, r.payload?.fp ?? "?", identity ?? ""].join(" ");

export function groupsOf(requests, identity = null) {
  const at = new Map();
  requests.filter((r) => r.endpoint).forEach((r) => at.set(keyOf(r, identity), [...(at.get(keyOf(r, identity)) ?? []), r]));
  return [...at.entries()].filter(([, members]) => members.length > 1).map(([key, members]) => groupOf(key, members));
}

function groupOf(key, members) {
  const sorted = [...members].sort((a, b) => a.n - b.n);
  return { key, method: sorted[0].method, endpoint: sorted[0].endpoint, members: sorted, size: sorted.length, payloadKnown: sorted.every((r) => r.payload) };
}

// A declared row applies when its `match` (a regex over the endpoint's PATH)
// and optional `method` both hold.
export function declared(rows, g) {
  return (rows ?? []).find((row) => matches(row, g)) ?? null;
}

const matches = (row, g) => safeTest(row.match, pathOf(g.endpoint)) && (!row.method || String(row.method).toUpperCase() === g.method);

function safeTest(source, text) {
  try { return new RegExp(source).test(text); }
  catch { return false; }
}

const failedAttempt = (r) => Boolean(r.failed) || r.status === 408 || r.status === 429 || (r.status ?? 0) >= 500;
const ok = (r) => r.status >= 200 && r.status < 300;
const retried = (g) => g.members.slice(0, -1).some(failedAttempt) && ok(g.members.at(-1));
const refreshed = (g) => g.members[0].status === 401 && g.members.slice(1).some(ok);
const allowedCount = (row) => (Number.isInteger(row?.count) ? row.count : Infinity);
const oneKey = (g) => new Set(g.members.map((r) => JSON.stringify(r.headers?.idempotency ?? {}))).size === 1 && Object.keys(g.members[0].headers?.idempotency ?? {}).length > 0;
const statuses = (g) => g.members.map((r) => r.status ?? r.failed ?? "pending").join(", ");

export const EXPLANATIONS = [
  { id: "PREFLIGHT", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g) => g.method === "OPTIONS", say: () => "CORS preflight: the browser asks before the real request" },
  { id: "REDIRECT", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g) => g.members.some((r) => r.status >= 300 && r.status < 400), say: () => "a redirect chain, not two attempts" },
  { id: "POLLING", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g, p) => declared(p.polling, g), say: () => "declared polling (settings duplicates.polling)" },
  { id: "RETRY_DECLARED", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g, p) => retried(g) && g.size <= (declared(p.retries, g)?.attempts ?? 0), say: (g) => `a declared retry: ${statuses(g)}` },
  { id: "TOKEN_REFRESH", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "low", when: (g) => refreshed(g), say: (g) => `refused, then answered (${statuses(g)}): a sign-in refresh and a retry` },
  { id: "INTENTIONAL", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g, p) => Boolean(declared(p.intentional, g)) && g.size <= allowedCount(declared(p.intentional, g)), say: (g) => `declared as ${g.size} deliberate call(s) (settings duplicates.intentional)` },
  { id: "CONTRACT", legit: false, outcome: "CONFIRMED_DEFECT", confidence: "high", when: (g, p) => g.size > (declared(p.contracts, g)?.maxPerAction ?? Infinity), say: (g, p) => `${g.size} ${g.method}s for one action; the accepted contract allows ${declared(p.contracts, g).maxPerAction}` },
  { id: "RETRY_UNDECLARED", legit: false, outcome: "REQUIRES_REQUIREMENT", confidence: "low", when: (g) => retried(g), say: (g) => `looks like a client retry after a failure (${statuses(g)}), and no retry policy is declared`, needs: () => ["declare the client's retry policy (duplicates.retries), or confirm it has none"] },
  { id: "IDEMPOTENT_DECLARED", legit: true, outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", when: (g, p) => declared(p.idempotent, g), say: () => "declared idempotent: repeating it changes nothing" },
  { id: "DEVELOPMENT", legit: false, outcome: "INCONCLUSIVE", confidence: "low", when: (g, p) => isDevelopment(p.environment?.kind), say: (g) => `${g.size} identical ${g.method}s on a DEVELOPMENT build, where frameworks double-invoke on purpose`, needs: () => ["repeat on a non-development build of the same revision"] },
  { id: "REDUNDANT_READ", legit: false, outcome: "SUSPECTED_DEFECT", confidence: "low", when: (g) => !writes(g.method), say: (g) => `${g.size} identical ${g.method}s for one action — a redundant read: it costs, it changes no data` },
  { id: "SAME_IDEMPOTENCY_KEY", legit: false, outcome: "SUSPECTED_DEFECT", confidence: "low", when: (g) => oneKey(g), say: (g) => `${g.size} ${g.method}s carrying ONE idempotency key: a correct server keeps a single record`, needs: () => ["a data check for the records the action created"] },
  { id: "PAYLOAD_UNKNOWN", legit: false, outcome: "INCONCLUSIVE", confidence: "low", when: (g) => !g.payloadKnown, say: (g) => `${g.size} ${g.method}s to one endpoint for one action, payloads NOT compared`, needs: () => ["request bodies (settings network.fingerprints) or a data check"] },
  { id: "EQUIVALENT_WRITES", legit: false, outcome: "SUSPECTED_DEFECT", confidence: "high", when: (g) => writes(g.method), say: (g) => `${g.size} equivalent ${g.method}s for ONE action (${statuses(g)})`, needs: () => ["a data check for the records the action created, or an accepted contract (duplicates.contracts)"] },
  { id: "UNEXPLAINED", legit: false, outcome: "INCONCLUSIVE", confidence: "low", when: () => true, say: (g) => `${g.size} identical ${g.method}s, and nothing here explains them`, needs: () => ["a person who knows what this endpoint is for"] },
];

// policy: { environment, polling, retries, idempotent, intentional, contracts }
export function duplicateCandidates(requests, policy = {}, identity = null) {
  return groupsOf(requests, identity).map((g) => explained(g, policy));
}

function explained(g, policy) {
  const row = EXPLANATIONS.find((e) => e.when(g, policy));
  const missing = [...new Set(g.members.flatMap((r) => r.missing ?? []))];
  return { key: g.key, method: g.method, endpoint: g.endpoint, members: g.members.map((r) => r.n), statuses: g.members.map((r) => r.status ?? r.failed ?? null), explanation: row.id, legit: row.legit, outcome: row.outcome, confidence: row.confidence, say: row.say(g, policy), needs: row.needs?.(g, policy) ?? [], missing };
}
