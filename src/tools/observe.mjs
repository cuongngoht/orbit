// One OBSERVATION of every catalog tool on this machine, saved as the snapshot
// the router and Orbit Control read (`control/resources/tools/observed.json`).
//
// Detection only: nothing is installed, nothing is repaired, nothing a person
// asked for (desired.json) is touched. Each tool is detected on its own, so one
// whose probe throws is recorded as not found with the reason, and the others
// are still observed.
import { detectTool } from "./detect.mjs";

//
// A row marked `observe: "demand"` is NOT looked at here: its probe can take seconds (a CLI that
// starts an interpreter), and this runs inside a session's start, where a host gives a hook a few
// seconds. What a concrete need observed of such a row earlier is kept as it was.
export const onDemand = (entry) => entry.observe === "demand";

export function observeTools(catalog, ctx) {
  const found = catalog.filter((entry) => !onDemand(entry)).map((entry) => isolated(entry, ctx));
  ctx.state.change("observed", (doc) => ({ ...doc, observedAt: ctx.now(), tools: { ...keptOnDemand(doc.tools, catalog), ...Object.fromEntries(found.map((f) => [f.id, f])) } }));
  return found;
}

const keptOnDemand = (tools, catalog) => Object.fromEntries(catalog.filter(onDemand).filter((entry) => tools?.[entry.id]).map((entry) => [entry.id, tools[entry.id]]));

// Observe ONLY the rows asked for, and keep every other row as it was. This is what
// a concrete need for one command asks for -- never a look at everything -- so a row
// nobody asked about keeps its own `checkedAt` and goes stale on its own clock.
export function observeSome(catalog, ids, ctx) {
  const found = catalog.filter((entry) => ids.includes(entry.id)).map((entry) => isolated(entry, ctx));
  if (found.length) record(found, ctx);
  return found;
}

function record(found, ctx) {
  ctx.state.change("observed", (doc) => ({ ...doc, observedAt: ctx.now(), tools: { ...doc.tools, ...Object.fromEntries(found.map((f) => [f.id, f])) } }));
}

function isolated(entry, ctx) {
  try { return detectTool(entry, ctx); }
  catch { return { id: entry.id, status: "missing", source: null, version: null, path: null, sources: [], reason: "its detection failed", checkedAt: ctx.now() }; }
}
