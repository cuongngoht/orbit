// Turning ONE candidate fact into a decision about the room -- the ordered table every
// other memory's reconcile.mjs is, over requirement facts.
//
// PURE, and it decides about ONE slot. It never looks at anything but the candidate,
// the standing fact for that slot and what it is told about the order revisions of a
// source were seen in. First row that holds wins; the last always does.
//
//   refused     it cites something that is not requirement-world: nothing is written
//   decided     a person answered a question about this slot: it is decided, whatever
//               stood before, and what stood is kept beside it
//   confirm     the slot already says exactly this -- a decision agreed with by a source
//               included, and an "unknown" for a slot that already has something:
//               nothing to write, and the journal says it was seen again
//   restated    the same saying, now resting on a LATER revision of a source the fact
//               already cites: the citation moves, the version does not
//   held        a person decided this slot: what a source says now does not change it
//   changed     a later revision of a source it cites says something else, or nobody
//               had said anything: a new version, and the old one kept beside it
//   rival       another source (or the same one at no later revision) says something
//               else: BOTH are kept as a conflict and a person is asked, blocking
//   new         nobody has said anything about this slot
//
// A contradiction never overwrites and a decision is never undone by a source. What
// "later" means is the order revisions were first cited (`ctx.order`), because a source
// keeps only its current revision and the order is what the requirement side remembers.
import { quote } from "../quote.mjs";
import { scrub } from "../scrub.mjs";
import { citesOf, factId, makeFact, revisionLater, superseded } from "./model.mjs";
import { isCurrent } from "./vocab.mjs";

export const OUTCOMES = ["refused", "decided", "confirm", "restated", "held", "changed", "rival", "new"];

const MAX_RIVALS = 4;

// The same saying, allowing for the way a model punctuates: case, spacing and a closing
// full stop are not a different requirement.
const normal = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();

const said = (c) => normal(quote(scrub(c.says), 400));

const standing = (fact) => Boolean(fact) && isCurrent(fact.status);

const sameSaying = (c, fact) => said(c) === normal(fact.says);

// Does the candidate cite a LATER revision of a source the fact already cites?
const newerCites = (c, fact, ctx) => citesOf(c.sources).some((n) => citesOf(fact?.sources).some((o) => o.sid === n.sid && revisionLater(ctx.order(n.sid), n.revision, o.revision)));

const notRequirementWorld = (c, ctx) => citesOf(c.sources).some((cite) => !ctx.bearing(cite.sid));

const stamps = (ctx) => ({ at: ctx.at, seenBy: ctx.seenBy });

const fieldsOf = (c, ctx, more) => ({ root: ctx.root, subject: c.subject, aspect: c.aspect, says: c.says, status: c.status ?? "stated", sources: c.sources ?? [], ...(c.derivedFrom?.length ? { derivedFrom: c.derivedFrom } : {}), ...stamps(ctx), ...more });

const finding = (kind, fact, say) => ({ kind, factId: fact?.id ?? null, say });

// ---- the results ---------------------------------------------------------------------

const refused = (c) => ({ fact: null, changed: false, finding: finding("requirement-refused", null, `${c.subject}/${c.aspect}: it cites something that is not a requirement source, so nothing was recorded`) });

const confirmed = (_c, fact) => ({ fact, changed: false });

// Only the citations of sources the fact already rests on move; a new source is not
// added, because a weaker corroboration must not weaken what a stronger one settled.
function restated(c, fact, ctx) {
  const moved = new Map(citesOf(c.sources).map((n) => [n.sid, n]));
  return { fact: makeFact({ ...fact, ...stamps(ctx), sources: movedCitations(fact.sources, moved, ctx) }), changed: true };
}

// For each source the fact cites: the newest revision among what it cites and what the
// candidate does, keeping the fact's own locator when the revision did not move.
function movedCitations(refs, moved, ctx) {
  return refs.map((ref) => {
    const own = citesOf([ref])[0];
    const news = own && moved.get(own.sid);
    return news && revisionLater(ctx.order(own.sid), news.revision, own.revision) ? ref.replace(/@[^#\s]+/, `@${news.revision}`) : ref;
  });
}

const held = (_c, fact) => ({ fact, changed: false, contested: true, finding: finding("requirement-decision-holds", fact, `${fact.subject}/${fact.aspect}: a person decided it, and what a source says now does not change that`) });

function changed(c, fact, ctx) {
  const revision = fact.revision + 1;
  const next = makeFact(fieldsOf(c, ctx, { revision, supersedes: `${fact.id}@${fact.revision}` }));
  return { fact: next, kept: superseded(fact, `${fact.id}@${revision}`), changed: true };
}

function question(c, fact) {
  const now = quote(scrub(c.says), 120);
  const was = quote(fact.says, 120);
  return { slots: [{ subject: c.subject, aspect: c.aspect }], asks: `The sources disagree about ${c.subject} ${c.aspect}: which is right — "${was}" or "${now}"?`, blocking: true, dependsOn: [...new Set([...citesOf(fact.sources), ...citesOf(c.sources)].map((x) => `source:${x.sid}@${x.revision}`))] };
}

function rival(c, fact, ctx) {
  const revision = fact.revision + 1;
  const rivals = [`${fact.id}@${fact.revision}`, ...(fact.rivals ?? [])].slice(0, MAX_RIVALS);
  const next = makeFact({ ...fieldsOf(c, ctx, { revision, rivals }), status: "conflict", derivedFrom: undefined });
  return { fact: next, kept: fact, changed: true, question: question(c, fact), finding: finding("requirement-conflict", next, `${c.subject}/${c.aspect}: two sources say different things — both are kept, and a person is asked`) };
}

// The person's word settles the slot: a new version that says so, resting on the
// decision and on nothing else, with whatever stood kept beside it.
function decided(c, fact, ctx) {
  const revision = fact ? fact.revision + 1 : 1;
  const id = factId(ctx.root, c.subject, c.aspect);
  const next = makeFact({ root: ctx.root, subject: c.subject, aspect: c.aspect, says: c.says, status: "decided", decision: c.decision, sources: [`decision:${c.decision}`], revision, ...(fact ? { supersedes: `${fact.id}@${fact.revision}` } : {}), ...stamps(ctx) });
  return { fact: next, changed: true, ...(fact ? { kept: superseded(fact, `${id}@${revision}`) } : {}) };
}

const fresh = (c, _fact, ctx) => ({ fact: makeFact(fieldsOf(c, ctx, { revision: 1 })), changed: true });

export const RULES = [
  { outcome: "refused", when: (c, fact, ctx) => notRequirementWorld(c, ctx), result: refused },
  { outcome: "decided", when: (c, fact) => c.status === "decided" && fact?.decision !== c.decision, result: decided },
  { outcome: "confirm", when: (c, fact, ctx) => standing(fact) && (c.status === "unknown" || (sameSaying(c, fact) && (fact.status === "decided" || !newerCites(c, fact, ctx)))), result: confirmed },
  { outcome: "restated", when: (c, fact, ctx) => standing(fact) && sameSaying(c, fact), result: restated },
  { outcome: "held", when: (c, fact) => fact?.status === "decided", result: held },
  { outcome: "changed", when: (c, fact, ctx) => standing(fact) && (fact.status === "unknown" || newerCites(c, fact, ctx)), result: changed },
  { outcome: "rival", when: (c, fact) => standing(fact), result: rival },
  { outcome: "new", when: () => true, result: fresh },
];

// candidate: a judged candidate fact; fact: the standing fact for its slot, or null;
// ctx: { root, at, seenBy, order(sid) -> revisions in the order they were first cited,
//        bearing(sid) -> may this source bear a requirement }
export function reconcile(candidate, fact, ctx) {
  const row = RULES.find((r) => r.when(candidate, fact, ctx));
  return { outcome: row.outcome, ...row.result(candidate, fact, ctx) };
}

