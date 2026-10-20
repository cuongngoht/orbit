// What a piece of work LEARNED, projected into the project's knowledge -- through the one
// write door (src/knowledge/ingest.mjs), after the engine's own stamped judge
// (src/knowledge/record.mjs judgeStamped), and from receipts alone.
//
// A claim rests on a RECEIPT: a provider was asked, through the gates, and answered. The host
// proposes what the answer means -- a subject, a relation, an object, the context it holds in --
// and the engine supplies everything that makes it evidence: the source (always a work
// receipt), the reference to the receipt it cites, and how strongly it may be held. A host that
// supplies any of those is refused by name, because a claim that names its own evidence is a
// claim nobody checked.
//
// How strongly is decided by the receipt alone. An answer that named where it came from
// (`sourceRefs`) is an observation; one that named nothing is a suggestion, and stays one.
// Knowledge derives the rest: a work receipt is never verified, so a claim resting on one is at
// best confirmed by two independent sessions and is never the current source or a rule.
//
// And it is never a requirement. What a requirement says comes from a requirement source
// (src/requirements/), and `requirements record` refuses a `work:` reference by name.
// Knowledge about how to build is one thing; what the business asked for is another.
import { Refused } from "../errors.mjs";
import { ingest } from "../knowledge/ingest.mjs";
import { judgeStamped } from "../knowledge/record.mjs";
import { scrub } from "../scrub.mjs";
import { modelOf } from "./model.mjs";

export const SCHEME = "work";
export const SOURCE = "work-receipt";

// What a host may say about a claim. Everything else a candidate carries is the engine's.
export const HOST_KEYS = ["subject", "relation", "object", "context", "because", "unknowns", "scope"];

export const referenceOf = (work, receipt) => `${SCHEME}:${work}#${receipt}`;

// A reference is resolved against the work it names: that work, that receipt, and only when
// the call it records was answered.
export function resolverOf(works) {
  return (ref) => {
    const [work, receipt] = String(ref).replace(/^work:/, "").split("#");
    const lines = works.exists(work) ? works.read(work) : null;
    return Boolean(lines) && modelOf(lines).receipts.some((r) => r.id === receipt && r.outcome === "ok");
  };
}

// The receipt a claim rests on: the one asked for, or else the need's latest answered one.
export function receiptFor(model, need, receiptId) {
  const mine = model.receipts.filter((r) => r.need === need && r.outcome === "ok");
  const found = receiptId ? mine.find((r) => r.id === receiptId) : mine.at(-1);
  if (!found) throw new Refused(`${need} has no answered receipt${receiptId ? ` named ${receiptId}` : ""} — a claim rests on a result, so ask the provider first with work invoke`);
  return found;
}

// An answer that said where it came from is an observation; one that did not is a suggestion.
export const strengthOf = (receipt) => ((receipt.sourceRefs ?? []).length ? "observed" : "suggested");

const supplied = (raw) => Object.keys(raw).filter((k) => !HOST_KEYS.includes(k));

function refusal(raw, at) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return `${at}: a claim is a JSON object`;
  const extra = supplied(raw);
  return extra.length ? `${at}: ${extra.map((k) => `"${k}"`).join(", ")} is the engine's to set from the receipt, never supplied — a host says what the answer means, not what it rests on` : null;
}

const candidateOf = (raw, evidence, strength) => ({ ...Object.fromEntries(HOST_KEYS.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]])), ...(raw.because ? { because: scrub(String(raw.because)).slice(0, 240) } : {}), evidence: [evidence], source: SOURCE, strength });

// Candidates for one need, from what a host proposed. All or nothing, like every door into
// knowledge: one line refused and none is kept.
export function claimCandidates(work, model, need, rows, receiptId) {
  const receipt = receiptFor(model, need, receiptId);
  const problems = rows.map((raw, i) => refusal(raw, `claim ${i + 1}`)).filter(Boolean);
  if (problems.length) throw new Refused(problems.join("\n"));
  return { receipt, candidates: rows.map((raw) => candidateOf(raw, referenceOf(work, receipt.id), strengthOf(receipt))) };
}

// The session that PRODUCED the evidence, when it is known; the day rule otherwise.
export const seenByOf = (receipt) => ({ host: receipt.seen?.host ?? "unknown", at: receipt.at, ...(receipt.seen?.session ? { session: receipt.seen.session } : {}) });

// w: { works, memory: { knowledge (a knowledge context), tracked (Set) } } -- bound by the
// composition root; absent, projection is `off` and says why.
export function projectClaims(w, receipt, candidates) {
  if (!w.memory) return { state: "off", projected: 0, why: "no knowledge room is bound here" };
  const judged = judgeStamped(candidates, { schemes: [SCHEME], resolves: resolverOf(w.works), tracked: w.memory.tracked ?? new Set(), gates: new Set() });
  if (judged.refused) throw new Refused(`the knowledge door refused a claim: ${judged.rejected[0].why}`);
  const decided = ingest(w.memory.knowledge, judged.accepted, { seenBy: seenByOf(receipt) });
  return { state: "synced", projected: judged.accepted.length, outcomes: decided.map((d) => d.outcome) };
}
