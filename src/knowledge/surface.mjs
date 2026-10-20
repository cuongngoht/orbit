// Whether an opportunity is worth INTERRUPTING somebody for -- now, in this
// workflow -- and the sentence that says why, or why not.
//
// A developer who is asked about every gap stops reading the questions, so the
// answer is an ordered table and never a score: first match wins, the last
// always matches, and every row's `say` is printed beside what it decided.
// Nothing here names a domain, a technology or a capability: it reads the
// opportunity's own state and history, the tier of the knowledge behind it
// (src/knowledge/vocab.mjs AUTHORITY), and what this run is FOR.
//
// The order is the policy:
//
//   a person already decided          ignored · accepted -- never re-asked
//   nothing to ask                    resolved · stale
//   not worth asking                  implied only by a hint or an inference
//   already asked here                this session, this workflow
//   a verification NEEDS it           demanded -- including one deferred:
//                                     deferred means "not now", never "never"
//   not now                           deferred · offered and still undecided
//   worth one question                cases already call it · the team's own
//                                     decision implies it · two or more
//                                     subjects would be proved through it
//   otherwise                         kept and listed, quietly
import { knownIn } from "../memory/session.mjs";
import { demandsProof, rankOf, TIERS } from "./vocab.mjs";

const day = (at) => String(at ?? "").slice(0, 10) || "an unknown day";

// What an opportunity is worth: the STRONGEST tier among its needs, each of
// which is only as strong as the weakest claim on its path.
export const tierOf = (o) => (o.needs ?? []).map((n) => n.tier).reduce((best, t) => (rankOf(t) < rankOf(best) ? t : best), TIERS.at(-1));

const cited = (o) => [...new Set((o.needs ?? []).flatMap((n) => n.because ?? []))].slice(0, 2).join(", ") || "no claim";

const subjectsOf = (o) => new Set((o.needs ?? []).map((n) => n.subject)).size;

const provesText = (o) => (o.needs ?? []).map((n) => n.consequence ?? n.observation ?? n.subject).filter(Boolean).slice(0, 2).join(", ") || o.capability;

const REMEDY = { prepare: "an opportunity to prepare a reusable capability — orbit-qc-builder builds one once a person accepts it", enable: "a known provider is not usable here — Orbit Control is where a person enables it" };

const askedHere = (o, w) => knownIn(o.asked?.[w.workflow] ?? [], w.seenBy ?? {});

const holdsNow = (o, w) => (w.derived?.get(o.capability) ?? []).some((n) => !n.conditional);

export const SURFACE = [
  { row: "IGNORED", asks: false, when: (o) => o.state === "ignored", say: (o) => `a person ignored it on ${day(o.decided?.at)} — \`knowledge decide ${o.id} reopen --human\` is the only way back` },
  { row: "RESOLVED", asks: false, when: (o) => o.state === "resolved", say: (o) => `${o.resolvedBy ?? "a provider"} provides ${o.capability} now — nothing to ask` },
  { row: "STALE", asks: false, when: (o) => o.state === "stale", say: () => "the claims that implied it no longer do — nothing to ask until knowledge implies it again" },
  { row: "ACCEPTED", asks: false, when: (o) => o.state === "accepted", say: (o) => `accepted on ${day(o.decided?.at)} and still unprovided — the team's work now, not a question` },
  { row: "WEAK", asks: false, when: (o) => rankOf(tierOf(o)) > rankOf("confirmed"), say: (o) => `implied only by ${tierOf(o)} knowledge (${cited(o)}) — confirm it against source first; an inference never raises a question on its own` },
  { row: "ASKED_HERE", asks: false, when: (o, w) => askedHere(o, w), say: (o, w) => `already offered in this session for ${w.workflow} — never asked twice` },
  { row: "DEMANDED", asks: true, when: (o, w) => demandsProof(w.purpose) && holdsNow(o, w), say: (o, w) => `${w.workflow} has to prove ${provesText(o)}, and nothing here can observe it — ${REMEDY[o.remedy] ?? REMEDY.prepare}` },
  { row: "DEFERRED", asks: false, when: (o) => o.state === "deferred", say: () => "deferred by a person — it comes back when a verification actually needs it" },
  { row: "OFFERED", asks: false, when: (o) => o.state === "offered", say: (o) => `offered on ${day(o.offered)} and undecided — \`knowledge decide ${o.id} accept|defer|ignore --human\`` },
  { row: "REQUESTED", asks: true, when: (o, w) => (w.demanded?.get(o.capability) ?? 0) > 0, say: (o, w) => `${w.demanded.get(o.capability)} case(s) already call ${o.capability}, and nothing here provides it — ${REMEDY[o.remedy] ?? REMEDY.prepare}` },
  { row: "BINDING", asks: true, when: (o) => rankOf(tierOf(o)) <= rankOf("adopted"), say: (o) => `the team's own decision (${cited(o)}) needs ${o.capability}, and nothing here provides it — ${REMEDY[o.remedy] ?? REMEDY.prepare}` },
  { row: "REUSABLE", asks: true, when: (o) => subjectsOf(o) >= 2, say: (o) => `${subjectsOf(o)} different subjects would be proved through ${o.capability} — ${REMEDY[o.remedy] ?? REMEDY.prepare}` },
  { row: "QUIET", asks: false, when: () => true, say: () => "one need, from knowledge nobody decided on — kept and listed, not worth an interruption yet" },
];

export const SURFACE_ROWS = SURFACE.map((s) => s.row);

// world: { purpose, workflow, seenBy, derived (capability → needs this run),
// demanded (capability → how many cases already call it) }
export function surfaced(o, world) {
  const row = SURFACE.find((s) => s.when(o, world));
  return { row: row.row, asks: row.asks, say: row.say(o, world) };
}
