// The ONE write door of a campaign: its first line is written by `start`, and every line after it by `record`.
// Nothing else appends to a campaign's journal -- not the CLI, not Orbit Control, not Live.
//
//   start(ctx, opportunity) -> { campaign, created }
//            under the project's campaigns lock: a campaign already OPEN for the same subject answers instead of a
//            second one, so two sessions analysing at once never start two campaigns about one definition
//   record(ctx, id, kind, fields, { expected? }) -> { campaign, kind, revision, line, duplicate }
//            under the campaign's lock: read the journal, fold it, judge the rules (rules.mjs), append -- or refuse and
//            write nothing. A line whose `eid` was already folded is the same event again: nothing is written.
//
// `ctx`: { store (store.mjs), door, session, host, pid, now }. `door` is the composition root's word for itself --
// "improvement" for the engine's own commands, "control" only where Orbit Control checked the page's mutation token --
// never a value anything typed can set.
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { printable } from "../printable.mjs";
import { modelOf } from "./model.mjs";
import { RULES, worldOf } from "./rules.mjs";
import { FREE_TEXT } from "./vocab.mjs";

const oneLine = (text) => printable(text).replace(/\s+/g, " ").trim();

const flattened = (fields) => Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, FREE_TEXT.includes(k) && typeof v === "string" ? oneLine(v) : v]));

const refusal = (rule, w) => Object.assign(new Refused(`${rule.id}: ${rule.say(w)}`), { code: rule.code });

function judged(w, rules) {
  const failed = rules.find((r) => r.fails(w));
  if (failed) throw refusal(failed, w);
}

const duplicate = (w) => Boolean(w.fields.eid) && w.m.seen.includes(w.fields.eid);

export const record = (ctx, id, kind, fields, opts = {}) => ctx.store.transact(id, () => recorded(ctx, worldOf(ctx.store, id, kind, flattened(fields), { door: ctx.door, ...opts })));

// Who may write and whether the campaign exists are asked first; then an event already folded is answered as it was,
// whatever the campaign moved to since -- a replay is never refused and never written twice.
function recorded(ctx, w) {
  judged(w, RULES.slice(0, 2));
  if (duplicate(w)) return { campaign: w.id, kind: w.kind, revision: w.m.position, line: null, duplicate: true };
  judged(w, RULES.slice(2));
  const line = ctx.store.append(w.id, w.kind, w.fields);
  return { campaign: w.id, kind: w.kind, revision: w.m.position + 1, line, duplicate: false };
}

// ---- the first line ---------------------------------------------------------------------------------------------

const summaryOf = (store) => (id) => ((m) => ({ id, m }))(modelOf(store.read(id) ?? []));

const openFor = (store, o) => store.list().map(summaryOf(store)).find((x) => x.m.meta?.subjectKind === o.subject.kind && x.m.meta?.subjectId === o.subject.id && !x.m.ended) ?? null;

const startedRecord = (ctx, id, o) => ({ id, opportunity: o.id, fingerprint: o.fingerprint, subjectKind: o.subject.kind, subjectId: o.subject.id, pin: o.pin, signal: o.signal, category: o.category, signature: o.signature, providers: o.providers ?? [], runs: o.runs, sessions: o.sessions, against: o.against, evidence: (o.evidence ?? []).slice(-12), tasks: (o.tasks ?? []).slice(-12), attribution: o.attribution, session: ctx.session, host: ctx.host });

function begun(ctx, o) {
  const open = openFor(ctx.store, o);
  if (open) return { campaign: open.id, created: false };
  const id = `imp-${short(`${o.fingerprint}\u0000${ctx.now()}\u0000${ctx.pid ?? ""}`, 12)}`;
  ctx.store.begin(id, startedRecord(ctx, id, o));
  return { campaign: id, created: true };
}

export function start(ctx, opportunity) {
  if (ctx.door !== "improvement" && ctx.door !== "control") throw Object.assign(new Refused("IMP_DOOR: a campaign is started by the improvement engine (improve analyse, improve start) or a person in Orbit Control"), { code: "IMP_DOOR" });
  return ctx.store.starting(() => begun(ctx, opportunity));
}
