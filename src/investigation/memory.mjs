// What an investigation verified, projected into the project's KNOWLEDGE --
// through the one write door (src/knowledge/ingest.mjs), after the engine's own
// stamped judge (src/knowledge/record.mjs judgeStamped), and from receipts
// alone: nothing a model wrote becomes a claim.
//
// Only a RESULT against an ACCEPTED oracle is projected: a scenario of a plan
// the team committed, or the map's recorded effect of a control. A draft plan's
// criterion prepares tests and is never knowledge; neither is "blocked" nor
// "exercised". A satisfied receipt says the subject holds; a violated one names
// the same triple with `contradicts`, which counts against the claim and never
// overwrites it -- and, with no claim to count against, writes nothing: a
// negative result lives in the journal and the report, not as a claim that
// something is false.
//
// Each claim cites the receipt it rests on (`investigation:<id>#<receipt>`, a
// reference the engine stamps and resolves itself) and watches the receipt's
// scope. The session is the RECEIPT's -- the one that produced the evidence --
// so projecting it again, from this host or another, adds no support.
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { claimId } from "../knowledge/model.mjs";
import { ingest } from "../knowledge/ingest.mjs";
import { judgeStamped } from "../knowledge/record.mjs";
import { scrub } from "../scrub.mjs";
import { modelOf } from "./model.mjs";

const ID = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// What a subject or a value may be, kept readable: lower-case, anything else a
// dash, and a short hash of the original whenever it had to change -- so
// `tenantA` and `tenanta` stay two things.
export function slugOf(text, fits = ID, max = 96) {
  const raw = String(text ?? "");
  if (fits.test(raw)) return raw;
  const plain = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "") || "x";
  return `${plain.slice(0, max - 7)}-${short(raw, 6)}`;
}

// Which receipts are knowledge, and what triple each one is.
const TRIPLES = {
  "scenario-layer": (r) => ({ subject: r.subject, object: r.oracle.ref }),
  "post-write": (r) => ({ subject: r.oracle.ref, object: "mapped-effect" }),
};

export const projectable = (r) => ["satisfied", "violated"].includes(r.outcome) && r.oracle?.authority === "accepted" && Boolean(TRIPLES[r.type]);

export function candidateOf(r, investigation) {
  const triple = TRIPLES[r.type](r);
  const base = { subject: slugOf(triple.subject), relation: "satisfies", object: slugOf(triple.object), context: contextOf(r), evidence: [`investigation:${investigation}#${r.id}`], source: "investigation", strength: "observed", ...(r.scope?.length ? { scope: r.scope } : {}), because: scrub(String(r.why ?? "")).slice(0, 240) };
  return r.outcome === "violated" ? { ...base, contradicts: claimId(base) } : base;
}

const contextOf = (r) => Object.fromEntries(Object.entries({ layer: r.layer, environment: r.context?.environment, identity: r.context?.identity, build: r.context?.build }).filter(([, v]) => v).map(([k, v]) => [k, slugOf(v, VALUE, 64)]));

// A reference is resolved against the store it names: that investigation, that receipt.
export function resolverOf(store) {
  return (ref) => {
    const [id, record] = String(ref).replace(/^investigation:/, "").split("#");
    return store.exists(id) && modelOf(store.read(id)).receipts.some((r) => r.id === record);
  };
}

// w.memory: { knowledge (a knowledge context), tracked (Set) } -- bound by the
// composition root; absent, or switched off in settings, projection is `off`.
export function projectReceipts(w, receipts) {
  if (!w.memory || w.settings.memory?.project === false) return { state: "off", projected: [], why: w.memory ? "settings memory.project is off" : "no knowledge room is bound here" };
  try { return synced(w, receipts); }
  catch (e) { return { state: "failed", projected: [], why: scrub(String(e?.message ?? e)).slice(0, 300) }; }
}

function synced(w, receipts) {
  const eligible = receipts.filter(projectable);
  const groups = new Map(eligible.map((r) => [JSON.stringify(r.seen ?? null), eligible.filter((x) => JSON.stringify(x.seen ?? null) === JSON.stringify(r.seen ?? null))]));
  const projected = [...groups.values()].flatMap((group) => ingested(w, group));
  return { state: "synced", projected, why: `${projected.length} receipt(s) projected; ${receipts.length - projected.length} are not knowledge (no accepted oracle, or not a result)` };
}

function ingested(w, group) {
  const judged = judgeStamped(group.map((r) => candidateOf(r, w.id)), { schemes: ["investigation"], resolves: resolverOf(w.store), tracked: w.memory.tracked ?? new Set(), gates: new Set() });
  if (judged.refused) throw new Refused(`the knowledge door refused a receipt: ${judged.rejected[0].why}`);
  ingest(w.memory.knowledge, judged.accepted, { seenBy: seenByOf(group[0]) });
  return group.map((r) => r.id);
}

// The session that PRODUCED the evidence, when it is known; the day rule otherwise.
const seenByOf = (r) => ({ host: r.seen?.host ?? "unknown", at: r.at, ...(r.seen?.session ? { session: r.seen.session } : {}) });
