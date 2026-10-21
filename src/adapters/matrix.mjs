// The SUPPORT MATRIX (doc §5.10; ADR 0035): computed on every look, never declared. An adapter says
// what it DECLARES it can do; whether that is supported is what conformance-kit RECEIPTS show for
// that adapter at that version and that fingerprint, run on a real system -- so a receipt for
// another fingerprint, a stale version or an emulator never makes anything supported, and nothing
// a declaration says about itself can.
//
// One row per adapter and operation, through ordered rows -- the first that holds wins, the last
// always answers:
//   unsupported  the family is contract-only, or a scenario on this operation FAILED
//   supported    every scenario that exercised it passed, on a real system
//   partial      it passed only on an emulator, or only some scenarios applied
//   unknown      nothing exercised it -- which is never read as supported
import { familyOf } from "./families.mjs";
import { fingerprintOf } from "./dispatch.mjs";

const exercised = (receipts, op) => receipts.flatMap((r) => (r.results ?? []).filter((s) => (s.ops ?? []).includes(op)).map((s) => ({ ...s, emulated: r.system?.emulated === true })));

export const SUPPORT = [
  { id: "CONTRACT_ONLY", when: (a) => Boolean(familyOf(a.family)?.contractOnly), level: "unsupported", why: () => "the family is in the model and no adapter for it is published" },
  { id: "FAILED", when: (a, s) => s.some((x) => x.outcome === "failed"), level: "unsupported", why: (a, s) => `a conformance scenario failed on it: ${s.filter((x) => x.outcome === "failed").map((x) => x.id).join(", ")}` },
  { id: "REAL", when: (a, s) => s.some((x) => x.outcome === "passed" && !x.emulated), level: "supported", why: (a, s) => `passed on a real system: ${s.filter((x) => x.outcome === "passed").map((x) => x.id).join(", ")}` },
  { id: "EMULATED", when: (a, s) => s.some((x) => x.outcome === "passed"), level: "partial", why: () => "it passed only on an emulator — a real system is what support is claimed on" },
  { id: "UNEXERCISED", when: () => true, level: "unknown", why: (a, s, others) => (others ? "a receipt exists for another version or fingerprint of it — it does not count for this one" : "no conformance receipt exercised it at this version and fingerprint") },
];

// `codeOf(adapter)`, when the caller can read the helper's directory, is the digest of its code: a
// receipt for other code counts for nothing (src/adapters/receipts.mjs codeDigestOf).
export function supportMatrix(adapters, receipts = [], { codeOf } = {}) {
  return adapters.flatMap((a) => Object.keys(a.operations ?? {}).map((op) => rowFor(a, op, receipts, codeOf)));
}

const forThis = (r, a, fingerprint, code) => r.adapter?.id === a.id && r.adapter.version === a.version && r.adapter.fingerprint === fingerprint && (code === undefined || r.adapter.code === code);

function rowFor(a, op, receipts, codeOf) {
  const fingerprint = fingerprintOf(a);
  const mine = receipts.filter((r) => forThis(r, a, fingerprint, codeOf?.(a)));
  const s = exercised(mine, op);
  const row = SUPPORT.find((x) => x.when(a, s));
  return { adapter: a.id, version: a.version, fingerprint, family: a.family, op, level: row.level, rule: row.id, why: row.why(a, s, receipts.some((r) => r.adapter?.id === a.id) && !mine.length), receipts: mine.length };
}
