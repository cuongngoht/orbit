// A family operation, asked of the adapter its bound resource resolves to (ADR 0035, 0036).
//
// The capability a case calls (`orbit.messaging.publish`) knows no transport. Its facade's
// `adapters.ask(request)` does the rest, in one place: the bound resource says which transport
// (and, for an observer, which adapter armed it), the selection rows pick ONE adapter or answer a
// named gap, and the adapter's own helper is asked through the same bounded helper protocol a
// pack's capability uses -- under the narrowest of its declared limits. What comes back is held to
// what the adapter DECLARED it answers (a field it never declared is dropped, so a meaning is
// never a word the helper chose) and stamped with the adapter's id, version, fingerprint and
// transport: a result can always say which adapter, at which declaration, saw what.
import { helperFacade } from "../capability/helper.mjs";
import { Blocked } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { operationFor } from "./families.mjs";
import { opKeyOf, selectAdapter } from "./select.mjs";

export const adapterFacade = (ctx, run, cap, invocation = {}) => ({ ask: (request = {}) => asked(ctx, run, cap, invocation, request) });

function asked(ctx, run, cap, inv, request) {
  const row = operationFor(cap.id);
  const target = targetOf(inv.bound ?? {});
  const chosen = selectAdapter(ctx.adapters, { family: row.family, op: row.op, transport: target.transport, pinned: target.adapter });
  if (chosen.gap) throw Object.assign(new Blocked(`${cap.id}: ${chosen.gap.why} — nothing about the product was observed`), { gap: chosen.gap, helperClass: "incomplete" });
  return answered(ctx, run, inv, chosen.adapter, row, request, target);
}

// The resource a binding resolved that says how to reach it: its transport, and the adapter it
// is pinned to when one armed it.
const targetOf = (bound) => Object.values(bound).find((v) => v && typeof v === "object" && (v.transport || v.adapter)) ?? {};

function answered(ctx, run, inv, adapter, row, request, target) {
  const key = opKeyOf(adapter, row);
  const declared = adapter.operations[key];
  const answer = helperFacade(ctx, run, asCapability(adapter), { ...inv, limits: { ...(adapter.limits ?? {}), ...(declared.limits ?? {}) } }).run(declared.op ?? key, request);
  return { ...projected(answer ?? {}, declared.outputs ?? {}), adapter: stampOf(adapter, target.transport ?? null) };
}

const asCapability = (a) => ({ id: a.id, from: a.from, helper: a.helper, ...(a.limits?.timeoutMs ? { timeoutSec: Math.ceil(a.limits.timeoutMs / 1000) } : {}) });

// Only the fields the adapter declared, and inside a list only each item's declared fields.
function projected(answer, outputs) {
  const kept = Object.entries(outputs).filter(([field]) => answer[field] !== undefined);
  return Object.fromEntries(kept.map(([field, means]) => [field, listed(answer[field], means)]));
}

const listed = (value, means) => (means?.each && Array.isArray(value) ? value.map((item) => projected(item ?? {}, means.each)) : value);

export const fingerprintOf = (a) => sha(canonicalJson(Object.fromEntries(Object.entries(a).filter(([k]) => !["from", "undeclared"].includes(k)))));

const stampOf = (a, transport) => ({ id: a.id, version: a.version, fingerprint: fingerprintOf(a), transport });
