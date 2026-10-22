// The test grants one run may spend, and what it spent (ADR 0037).
//
// The host mints grants at dispatch (src/runtime/sandbox/test-grants.mjs) and seals them into
// the worker's request; here they are a LEDGER the capability pipeline asks. `check` answers
// whether a mutating call is covered -- the capability, the run, the resources its refs bind,
// the input's digest, the operation's selectors, the principal it acts as, the provider, a use
// left, not expired -- and `spend` takes ONE
// use, recorded in the run log, at the last moment before the effect. A second use of a
// one-use grant is refused, which is what makes a transport retry impossible to mistake for an
// intentional duplicate: that is a grant of its own. The host reads the spends back and holds
// them to what it minted (src/run/envelope.mjs spendFindings).
import { canonicalJson, sha } from "../hash.mjs";

export function grantLedger(grants, runId, now) {
  const used = new Map();
  return {
    check: (cap, input) => coverOf(grants ?? [], runId, now, used, cap, input).why,
    spend: (cap, input, run) => spent(grants ?? [], runId, now, used, cap, input, run),
  };
}

const inputDigest = (input) => sha(canonicalJson(input ?? {}));

const boundRefs = (cap, input) => Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => row?.bind && input?.[k] !== undefined && row.bind !== "identity" && row.bind !== "schema").map(([k]) => String(input[k]));

// Who the call would act as: the value of its identity-bound input, or nobody.
const principalOf = (cap, input) => Object.entries(cap.inputSchema ?? {}).filter(([k, row]) => row?.bind === "identity" && input?.[k] !== undefined).map(([k]) => String(input[k]))[0] ?? null;

// Every selector the grant was minted for (a method, a path, a channel) must be what the call asks.
const selectorsHold = (selectors, input) => Object.entries(selectors ?? {}).every(([k, v]) => String(input?.[k]) === String(v));

// Why each grant does not cover this call, in order; the first that does wins.
const REASONS = [
  { why: (g, c) => (g.capability?.id === c.cap.id ? null : "another capability") },
  { why: (g, c) => (g.run === c.runId ? null : "another run") },
  { why: (g, c) => (c.now() < g.expiresAtMs ? null : "it expired") },
  { why: (g, c) => ((c.used.get(g.id) ?? 0) < (g.bounds?.maxUses ?? 1) ? null : "every use is spent") },
  { why: (g, c) => (g.input?.digest && g.input.digest === inputDigest(c.input) ? null : "the input differs from the one it was minted for") },
  { why: (g, c) => (selectorsHold(g.operation?.selectors, c.input) ? null : "the operation differs from the one it was minted for") },
  { why: (g, c) => (principalOf(c.cap, c.input) === (g.principal ?? null) ? null : "it would act as another principal than the one it was minted for") },
  { why: (g, c) => (!g.capability?.from || g.capability.from === c.cap.from ? null : "another provider of that capability") },
  { why: (g, c) => (boundRefs(c.cap, c.input).every((r) => (g.resources ?? []).includes(r)) ? null : "a resource it would touch is not granted") },
];

function coverOf(grants, runId, now, used, cap, input) {
  const c = { cap, input, runId, now, used };
  const judged = grants.map((g) => ({ g, why: REASONS.map((r) => r.why(g, c)).find(Boolean) ?? null }));
  const hit = judged.find((j) => !j.why);
  return hit ? { grant: hit.g, why: null } : { grant: null, why: judged.length ? `no grant covers it — ${judged.map((j) => `${j.g.id}: ${j.why}`).join("; ")}` : "no test grant was minted for this run" };
}

function spent(grants, runId, now, used, cap, input, run) {
  const cover = coverOf(grants, runId, now, used, cap, input);
  if (!cover.grant) return cover.why;
  used.set(cover.grant.id, (used.get(cover.grant.id) ?? 0) + 1);
  run?.log?.record({ kind: "grant", grant: cover.grant.id, capability: cap.id, operation: cover.grant.operation?.class ?? null, use: used.get(cover.grant.id), input_digest: inputDigest(input) });
  return null;
}
