// A family operation, asked of the adapter its bound resource resolves to (ADR 0035, 0036).
//
// The capability a case calls (`orbit.messaging.publish`) knows no transport. Its facade's
// `adapters.ask(request)` does the rest, in one place: the bound resource says which transport
// (and, for an observer, which adapter armed it), the selection rows pick ONE adapter or answer a
// named gap, and the adapter's own helper is asked through the same bounded helper protocol a
// pack's capability uses -- under the narrowest of its declared limits. What comes back is held to
// what the adapter DECLARED it answers (a field it never declared is dropped, so a meaning is
// never a word the helper chose) and stamped with the adapter's id, version, fingerprint and
// transport: a result can always say which adapter, at which declaration, saw what. Beside it, a
// field of the engine's own: what the request's match read of the thing it observes and left out
// (EXCLUDED, below).
import { helperFacade } from "../capability/helper.mjs";
import { Blocked } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { identityMeaning, meaningEntries } from "../topology/vocab.mjs";
import { LIMIT_FIELDS } from "./contract-v1.mjs";
import { operationFor } from "./families.mjs";
import { opKeyOf, selectAdapter } from "./select.mjs";

export const adapterFacade = (ctx, run, cap, invocation = {}) => ({ ask: (request = {}) => asked(ctx, run, cap, invocation, request) });

function asked(ctx, run, cap, inv, request) {
  const row = operationFor(cap.id);
  const target = targetOf(inv.bound ?? {}, row);
  const chosen = selectAdapter(ctx.adapters, { family: row.family, op: row.op, transport: target.transport, pinned: target.adapter });
  if (chosen.gap) throw Object.assign(new Blocked(`${cap.id}: ${chosen.gap.why} — nothing about the product was observed`), { gap: chosen.gap });
  return answered(ctx, run, inv, chosen.adapter, row, request, target);
}

// The resource the operation is ABOUT -- its first ref, the one a case must bind -- says how to
// reach it: its transport, and the adapter it is pinned to when one armed it. Another bound
// value (an identity, a fixture) never chooses the adapter.
function targetOf(bound, row) {
  const value = bound[`${row.refs[0]}Ref`];
  return value && typeof value === "object" ? value : {};
}

function answered(ctx, run, inv, adapter, row, request, target) {
  const key = opKeyOf(adapter, row);
  const declared = adapter.operations[key];
  const subject = subjectOf(declared.outputs ?? {}, request);
  const answer = helperFacade(ctx, run, asCapability(adapter), { ...inv, limits: narrowest(inv.limits, adapter.limits, declared.limits), ...(subject.length ? { subject } : {}) }).run(declared.op ?? key, request);
  return { ...projected(answer ?? {}, declared.outputs ?? {}), ...excludedOf(answer?.[EXCLUDED], declared.outputs ?? {}, subject), adapter: stampOf(adapter, target.transport ?? null) };
}

// Each limit at its narrowest: what the invocation was allowed, the adapter's own ceiling and the
// operation's. A wider number anywhere never widens what a narrower one said.
const narrowest = (...sets) => Object.fromEntries(Object.keys(LIMIT_FIELDS).map((k) => [k, Math.min(...sets.map((s) => s?.[k] ?? Infinity))]).filter(([, v]) => v !== Infinity));

// An adapter as the helper facade launches it: its own id, owner and helper, under its own ceiling.
export const asCapability = (a) => ({ id: a.id, from: a.from, helper: a.helper, ...(a.limits?.timeoutMs ? { timeoutSec: Math.ceil(a.limits.timeoutMs / 1000) } : {}) });

// Only the fields the adapter declared, and inside a list only each item's declared fields.
function projected(answer, outputs) {
  const kept = Object.entries(outputs).filter(([field]) => answer[field] !== undefined);
  return Object.fromEntries(kept.map(([field, means]) => [field, listed(answer[field], means)]));
}

const listed = (value, means) => (means?.each && Array.isArray(value) ? value.map((item) => projected(item ?? {}, means.each)) : value);

// ── what a match left out ──────────────────────────────────────────────────
//
// A request whose `match` names WHAT it observes -- an item field of a list the operation answers, which the adapter
// declares with an identity meaning (src/topology/vocab.mjs): the message, the occurrence, the execution -- and
// something else about it too (how it settled) asks how that thing went, and is answered only what matched all of it.
// What it read of that very thing and left out is the evidence such a match hides: an answer of none, complete, reads
// exactly like "it never happened". So the helper is told which fields of the match name that thing (`subject`, the
// helper protocol's, src/capability/helper.mjs), says what it left out of it, and that is put beside the answer: held to
// the declared item fields of the list it was read from, the newest few and how many there were, under a field of the
// engine's own that no output declares -- so no verdict is ever compiled from it, and a fault or an outcome it holds is
// never what the run observed. Which field names the thing is the declaration's word, never a product's.
export const EXCLUDED = "excluded";
const EXCLUDED_ITEMS = 3;

const isTable = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// The fields of the match that name what is observed -- none when they are the whole match, which then left nothing of
// that thing out.
function subjectOf(outputs, request) {
  const named = Object.entries(isTable(request?.match) ? request.match : {}).filter(([, v]) => typeof v === "string").map(([k]) => k);
  const identity = identityFields(outputs);
  const subject = named.filter((k) => identity.has(k));
  return subject.length < named.length ? subject : [];
}

// The item fields of the lists an operation answers that the adapter declares with an identity meaning.
const identityFields = (outputs) => new Set(meaningEntries(outputs).filter(([path, means]) => path.includes("[].") && identityMeaning(means)).map(([path]) => path.slice(path.lastIndexOf("[].") + 3)));

// What the helper says it left out, under the list it read it from: one such list, an answer the helper was asked about
// (a subject), each item held to that list's declared item fields -- anything else it put there is dropped.
function excludedOf(said, outputs, subject) {
  const [field, left] = Object.entries(isTable(said) ? said : {}).find(([name, v]) => isTable(outputs[name]?.each) && leftOut(v)) ?? [];
  return field && subject.length ? { [EXCLUDED]: { field, subject, count: left.count, items: left.items.slice(-EXCLUDED_ITEMS).map((item) => projected(isTable(item) ? item : {}, outputs[field].each)) } } : {};
}

const leftOut = (v) => isTable(v) && Number.isInteger(v.count) && v.count > 0 && Array.isArray(v.items);

export const fingerprintOf = (a) => sha(canonicalJson(Object.fromEntries(Object.entries(a).filter(([k]) => !["from", "undeclared"].includes(k)))));

const stampOf = (a, transport) => ({ id: a.id, version: a.version, fingerprint: fingerprintOf(a), transport });
