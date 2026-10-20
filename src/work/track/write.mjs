// THE FIVE MOMENTS of a tracked work, each one locked write to the work's own journal (1.8.8): a request is TRACKED
// (created or continued, and the session bound to it), a task or a workflow is LINKED, the work is HANDED OVER between
// the host and an autonomous task, it STATES how it stands, and it is REPORTED.
//
// What a line may carry is KINDS in src/work/vocab.mjs: identity, links, a reported lifecycle and a bounded, scrubbed
// summary. Never the request's wording beyond its objective, a command's arguments, a prompt, a reply, a file's
// contents or a secret -- and never an outcome nobody proved: a `done` report is a REPORT, and what stands behind it is
// read back from the owner (task fold, working set) every time src/work/track/view.mjs is asked.
//
// Every write is safe to repeat. A line with an `eid` already in the journal is not written again; a state, a handoff,
// a link or a report that the journal already says is `changed: false`; and a work that was closed is moved only by an
// explicit continuation, so a late callback writes nothing. Pure over the ports handed in:
//   ctx.works         the work store (src/work/store.mjs)
//   ctx.now()         an ISO time
//   ctx.session       the session mark (src/memory/session.mjs taskSessionMark) or null
//   ctx.checkout      the checkout id · ctx.host the host's name
//   ctx.requirementOf(ref)   { root, identity } when a requirement is kept for the item, else null (optional)
//   ctx.observe(id)          { files, checks } as observed now, for a report's snapshot (optional)
import { Refused } from "../../errors.mjs";
import { quote } from "../../quote.mjs";
import { PREFIX } from "../vocab.mjs";
import { continuedWork, digestOf, itemWork, refOf, requestWork } from "./ids.mjs";
import { late, modeOf, trackOf } from "./fold.mjs";
import { currentOf, scanOf } from "./resolve.mjs";
import { EVIDENCE_REF, LIMITS, LINKS, MODES, OUTCOMES, REPORTED_STATES, WAITS } from "./vocab.mjs";

const refuse = (why) => {
  throw new Refused(why);
};

const EID = /^[A-Za-z0-9._:-]{1,64}$/;

const ROUTE = /^[A-Za-z0-9._:/ -]{1,60}$/;

const ROLE = /^[a-z][a-z-]{0,23}$/;

const oneOf = (name, allowed, value) => (allowed.includes(value) ? value : refuse(`${name} is one of ${allowed.join(", ")}`));

const eidOf = (eid) => (eid === undefined || EID.test(String(eid)) ? eid : refuse("--eid is up to 64 letters, digits and . _ : -"));

const idFor = (records, kind) => `${PREFIX[kind]}-${records.filter((r) => r.kind === kind).length + 1}`;

const seen = (records, eid) => eid !== undefined && records.some((r) => r.eid === eid);

const put = (ctx, id, kind, row) => ctx.works.append(id, kind, { at: ctx.now(), ...row });

// ---- the work a write is about --------------------------------------------------------------------------

const existing = (ctx, id) => (ctx.works.exists(id) ? id : refuse(`no work ${id} is kept here — track the request first`));

const tracked = (records, id) => (trackOf(records).tracked ? records : refuse(`work ${id} is not tracked — start tracking it with track --continue=${id}`));

// One locked write in a tracked work: `fn(id, records, fold)`.
function inWork(ctx, workId, fn) {
  const id = existing(ctx, workId);
  return ctx.works.transact(id, () => fn(id, tracked(ctx.works.read(id), id)));
}

const duplicate = (id, why) => ({ work: id, changed: false, duplicate: true, because: why });

// ---- track ----------------------------------------------------------------------------------------------

const objectiveOf = (spec) => quote(spec.objective || (spec.ref ? `work item ${refOf(spec.ref)}` : ""), LIMITS.OBJECTIVE) || refuse("say what the request is: track \"<the request, in one sentence>\"");

const REQUESTED = [
  { when: (c, s) => Boolean(s.continue), run: (c, s) => continuedWork(c.works, s.continue) },
  { when: (c, s) => Boolean(s.ref), run: (c, s) => itemWork(s.ref, c.requirementOf?.(s.ref) ?? null) },
  { when: (c) => Boolean(c.session), run: (c, s) => requestWork(c.works, { session: c.session, checkout: c.checkout, digest: digestOf(objectiveOf(s)) }) },
  { when: () => true, run: () => null },
];

const targetOf = (ctx, spec) => REQUESTED.find((r) => r.when(ctx, spec)).run(ctx, spec);

const createdRow = (ctx, target, spec) => ({ id: target.id, objective: objectiveOf(spec), root: target.requirement?.identity, by: "session", session: ctx.session ?? undefined, checkout: ctx.checkout, ref: spec.ref ? refOf(spec.ref) : undefined, mode: spec.mode === undefined ? "developer" : oneOf("--mode", MODES, spec.mode), at: ctx.now() });

function created(ctx, target, spec) {
  try {
    ctx.works.create(createdRow(ctx, target, spec));
    return true;
  } catch (e) {
    return ctx.works.exists(target.id) ? false : refuse(e.message);
  }
}

const ensured = (ctx, target, spec) => (ctx.works.exists(target.id) ? false : created(ctx, target, spec));

const routeOf = (route) => (route === undefined ? undefined : ROUTE.test(route) ? route : refuse("--route is the NEXT the help named: letters, digits and . _ : / - only"));

const boundRow = (ctx, id, spec, fold, reopen) => ({ id, session: ctx.session ?? undefined, host: ctx.host, checkout: ctx.checkout, mode: fold.meta ? modeOf(fold) : spec.mode ?? "developer", skill: spec.skill, route: routeOf(spec.route), because: spec.because ? quote(spec.because, LIMITS.SUMMARY) : undefined, reopen: reopen || undefined, eid: eidOf(spec.eid) });

const latestOf = (fold, session) => fold.bindings.filter((b) => b.session === (session ?? undefined)).at(-1);

const same = (last, row) => Boolean(last) && last.route === row.route && last.mode === row.mode && last.because === row.because;

const isCurrent = (ctx, id) => !ctx.session || currentOf(scanOf(ctx.works), ctx.session, ctx.checkout)?.id === id;

const settledAlready = (ctx, id, fold, row) => row.reopen === undefined && isCurrent(ctx, id) && same(latestOf(fold, ctx.session), row);

const warningsOf = (ctx) => (ctx.session ? [] : ["this shell carries no session mark: the work is tracked by identity, and no tool activity can be attributed to it"]);

function decided(ctx, target, spec, records) {
  const fold = trackOf(records);
  const row = boundRow(ctx, idFor(records, "bound"), spec, fold, fold.closed !== null);
  return { row, skip: seen(records, row.eid) || settledAlready(ctx, target.id, fold, row) };
}

const boundAnswer = (ctx, target, row, own) => ({ tracked: true, work: target.id, how: target.how, created: own.created, changed: !own.skip, reopened: !own.skip && row.reopen === true, mode: row.mode, route: row.route ?? null, because: row.because ?? null, session: Boolean(ctx.session), warnings: warningsOf(ctx) });

function bound(ctx, target, spec, wasCreated) {
  const { row, skip } = decided(ctx, target, spec, ctx.works.read(target.id));
  if (!skip) put(ctx, target.id, "bound", row);
  return boundAnswer(ctx, target, row, { created: wasCreated, skip });
}

const untracked = () => ({ tracked: false, work: null, changed: false, warnings: ["this shell carries no session mark and no --ref or --continue named the work: nothing was tracked, and nothing is blocked"] });

export function track(ctx, spec) {
  const target = targetOf(ctx, spec);
  if (target === null) return untracked();
  const wasCreated = ensured(ctx, target, spec);
  return ctx.works.transact(target.id, () => bound(ctx, target, spec, wasCreated));
}

// ---- link -----------------------------------------------------------------------------------------------

const linkOf = (spec) => ((l) => (l.pattern.test(String(spec.target ?? "")) ? { what: l.what, target: spec.target } : refuse(`a ${l.what} id looks like ${l.pattern.source}`)))(LINKS.find((x) => x.what === spec.what) ?? refuse(`a work links to: ${LINKS.map((x) => x.what).join(", ")}`));

const roleOf = (role) => (role === undefined ? undefined : ROLE.test(role) ? role : refuse("--role is a lower-case word"));

const linkedAlready = (fold, row) => fold.links.some((l) => l.what === row.what && l.target === row.target);

function linked(ctx, id, records, row) {
  const eid = eidOf(row.eid);
  if (seen(records, eid) || linkedAlready(trackOf(records), row)) return duplicate(id, `${row.what} ${row.target} is already linked`);
  put(ctx, id, "linked", { ...row, id: idFor(records, "linked"), eid });
  return { work: id, changed: true, what: row.what, target: row.target };
}

export const link = (ctx, spec) => inWork(ctx, spec.work, (id, records) => linked(ctx, id, records, { ...linkOf(spec), role: roleOf(spec.role), eid: spec.eid }));

// ---- handoff --------------------------------------------------------------------------------------------

function handedOver(ctx, id, records, spec) {
  const c = { from: modeOf(trackOf(records)), to: oneOf("--to", MODES, spec.to), eid: eidOf(spec.eid) };
  if (seen(records, c.eid) || c.from === c.to) return duplicate(id, `the work is already with the ${c.to}`);
  put(ctx, id, "handoff", { id: idFor(records, "handoff"), from: c.from, to: c.to, task: spec.task, because: spec.because ? quote(spec.because, LIMITS.SUMMARY) : undefined, session: ctx.session ?? undefined, eid: c.eid });
  return { work: id, changed: true, from: c.from, to: c.to, task: spec.task ?? null };
}

// The task is linked first (a handover names it), then the mode moves. Either is a no-op when the journal says it is so.
export function handoff(ctx, spec) {
  const linkedTask = spec.task ? link(ctx, { work: spec.work, what: spec.what ?? "task", target: spec.task, role: "handoff" }) : null;
  const moved = inWork(ctx, spec.work, (id, records) => handedOver(ctx, id, records, spec));
  return { ...moved, linked: linkedTask?.changed ?? false };
}

// ---- state ----------------------------------------------------------------------------------------------

const occurredOf = (ctx, text) => (text === undefined ? ctx.now() : Number.isFinite(Date.parse(text)) && Date.parse(text) <= Date.parse(ctx.now()) + 60_000 ? new Date(text).toISOString() : refuse("--occurred is an ISO time, not in the future"));

const waitOf = (state, wait) => (state === "waiting" ? (wait === undefined ? undefined : oneOf("--wait", WAITS, wait)) : wait === undefined ? undefined : refuse("--wait only goes with --state=waiting"));

const stateRow = (ctx, id, spec) => ({ id, state: oneOf("--state", REPORTED_STATES, spec.state), wait: waitOf(spec.state, spec.wait), why: spec.why ? quote(spec.why, LIMITS.SUMMARY) : undefined, occurred: occurredOf(ctx, spec.occurred), reopen: spec.reopen ? true : undefined, session: ctx.session ?? undefined, eid: eidOf(spec.eid) });

const sameState = (a, b) => Boolean(a) && a.state === b.state && a.wait === b.wait && a.why === b.why;

const ignored = (id, because) => ({ work: id, changed: false, ignored: true, because });

const STATE_SKIPS = [
  { when: (c) => c.fold.closed !== null && !c.row.reopen, say: () => "the work is closed: a late line moves nothing — continue it with track --continue" },
  { when: (c) => !c.row.reopen && late(c.fold, { ...c.row, at: c.row.occurred }), say: () => "a newer state is already standing: this one happened before it" },
  { when: (c) => !c.row.reopen && sameState(c.fold.states.at(-1), c.row), say: () => "that is the state already standing" },
  { when: (c) => seen(c.records, c.row.eid), say: () => "that event was already written" },
];

function stated(ctx, id, records, spec) {
  const c = { records, fold: trackOf(records), row: stateRow(ctx, idFor(records, "state"), spec) };
  const skip = STATE_SKIPS.find((r) => r.when(c));
  if (skip) return ignored(id, skip.say(c));
  put(ctx, id, "state", c.row);
  return { work: id, changed: true, state: c.row.state, wait: c.row.wait ?? null, reopened: c.row.reopen === true };
}

export const state = (ctx, spec) => inWork(ctx, spec.work, (id, records) => stated(ctx, id, records, spec));

// ---- report ---------------------------------------------------------------------------------------------

const itemsOf = (name, items) => ((list) => (list.length > LIMITS.ITEMS ? refuse(`${name} holds at most ${LIMITS.ITEMS} items`) : list.map((i) => quote(i, LIMITS.ITEM)).filter(Boolean)))(items ?? []);

const evidenceOf = (items) => ((list) => (list.every((e) => EVIDENCE_REF.test(e)) ? list : refuse("--evidence is a pointer: task:, investigation:, requirement: or run: and an id")))(itemsOf("--evidence", items));

const changedOf = (obs) => (obs?.files ?? []).slice(0, LIMITS.FILES).map((f) => ({ path: String(f.path).slice(0, 300), attribution: f.attribution }));

const checksOfObs = (obs) => (obs?.checks ?? []).slice(0, LIMITS.CHECKS).map((c) => ({ at: c.at, class: c.class, what: c.what, result: c.result, current: c.current }));

// What the ENGINE saw, put in the report: the caller cannot type the files or the checks.
const reportRow = (ctx, id, spec, obs) => ({ id, outcome: oneOf("--outcome", OUTCOMES, spec.outcome), summary: spec.summary ? quote(spec.summary, LIMITS.SUMMARY) : undefined, changed: changedOf(obs), checks: checksOfObs(obs), proved: itemsOf("--proved", spec.proved), unverified: itemsOf("--unverified", spec.unverified), blocked: itemsOf("--blocked", spec.blocked), evidence: evidenceOf(spec.evidence), session: ctx.session ?? undefined, eid: eidOf(spec.eid) });

const closes = (row) => row.outcome !== "blocked";

const REPORT_SKIPS = [
  { when: (c) => seen(c.records, c.row.eid), say: () => "that event was already written" },
  { when: (c) => c.fold.closed !== null && closes(c.row) && c.fold.closed.outcome === c.row.outcome, say: (c) => `the work is already reported ${c.row.outcome}` },
  { when: (c) => c.fold.closed !== null && closes(c.row), refuses: true, say: (c) => `the work is closed as ${c.fold.closed.outcome}: continue it with track --continue before reporting another outcome` },
  { when: (c) => c.fold.closed !== null, say: () => "the work is closed: a late line moves nothing" },
];

function reported(ctx, id, records, spec) {
  const c = { records, fold: trackOf(records), row: reportRow(ctx, idFor(records, "report"), spec, ctx.observe?.(id)) };
  const skip = REPORT_SKIPS.find((r) => r.when(c));
  if (skip) return skip.refuses ? refuse(skip.say(c)) : ignored(id, skip.say(c));
  put(ctx, id, "report", c.row);
  return { work: id, changed: true, outcome: c.row.outcome, files: c.row.changed.length, checks: c.row.checks.length };
}

export const report = (ctx, spec) => inWork(ctx, spec.work, (id, records) => reported(ctx, id, records, spec));
