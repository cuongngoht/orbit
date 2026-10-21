// The adapters ONE context may select from (ADR 0035).
//
// Append-only, like the capability registry: a declaration is judged whole before anything is
// recorded, so a bad one leaves nothing behind, and a refusal is RECORDED with its reasons
// rather than thrown -- a project whose one adapter is wrong still loads every other one, and
// `query adapters` says why that one is missing. Two adapters may serve one transport; which
// one answers a given operation is the selection rows' decision, never registration order.
import { declarationFindings } from "./contract-v1.mjs";

export function createAdapterRegistry(vocab) {
  const rows = new Map();
  const refused = [];
  return {
    register: (decl, from) => registered(rows, refused, vocab, decl, from),
    get: (id) => rows.get(id) ?? null,
    list: () => [...rows.values()],
    serving: (family, transport) => [...rows.values()].filter((a) => a.family === family && a.transports.includes(transport)),
    refused: () => [...refused],
  };
}

function registered(rows, refused, vocab, decl, from) {
  const found = declarationFindings(decl, vocab);
  const duplicate = rows.has(decl?.id) ? [`${decl.id}: already registered by ${rows.get(decl.id).from}`] : [];
  const problems = [...found.problems, ...duplicate];
  if (problems.length) return refusal(refused, decl, from, problems);
  return accepted(rows, decl, from, found.undeclared);
}

function refusal(refused, decl, from, problems) {
  refused.push({ id: typeof decl?.id === "string" ? decl.id : null, from, problems });
  return { ok: false, problems };
}

function accepted(rows, decl, from, undeclared) {
  rows.set(decl.id, Object.freeze({ ...decl, from, undeclared }));
  return { ok: true, problems: [], undeclared };
}
