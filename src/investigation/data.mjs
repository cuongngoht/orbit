// A read-only DATA check tied to one action: "what is actually true below the
// screen, after this".
//
// Four rules, each the engine's own rule for a case, applied here too:
//   read-only   one SELECT or WITH (src/dsl/sql-text.mjs), after ${…} is filled
//   no guessing every table the query names must be one the MAP records a
//               control writing (graph/effects.json). A table nobody recorded is
//               refused: map it with orbit-ui-map, then ask
//   own values  ${TC} is the synthetic value the action's chain typed -- the
//               row is picked by what THIS investigation wrote, never by a
//               guessed predicate over somebody's data. A chain that typed
//               more than one value has to say which: ${TC:<screen/via>}
//   keep counts only the NUMBER of rows is kept; their contents never
//
// Eventual consistency is a declared WINDOW, never a guess: `within` seconds,
// or the seconds settings `consistency` gives the control's timing. Inside it
// the check re-reads until the count is what was expected; a count ABOVE what
// was expected stops the wait at once, because more rows do not go away.
//
// A database that cannot be read is BLOCKED -- recorded as such, and never a
// finding about the product.
//
// A store the engine cannot read with SQL is read through a registered,
// READ-ONLY capability instead (`via`): the same window, the same count and
// nothing else. The map does not say that store is the one the control writes,
// so what it shows missing is a suspicion, never a confirmation (findings.mjs).
// Every check first passes the investigation's own gate table -- a cancelled
// investigation reads nothing -- with its browser and action-budget rows silent.
import { Blocked, Refused } from "../errors.mjs";
import { invokeCapability } from "../capability/invoke.mjs";
import { gate } from "./gates.mjs";
import { readOnlyProblem } from "../dsl/sql-text.mjs";
import { encode } from "../dsl/escape.mjs";
import { pollUntil } from "../run/poll.mjs";
import { scrub } from "../scrub.mjs";
import { withJournal, worldOf } from "./act.mjs";
import { actionOf, chainOf, modelOf, nextId } from "./model.mjs";
import { controlOf, mappedTables, tablesOf } from "./surfaces.mjs";

const PART = String.raw`(?:\[[^\]]+\]|"[^"]+"|[\w$#@]+)`;
const TABLE = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(${PART}(?:\.${PART})*)`, "gi");
// A common table expression's own name: `WITH mine AS (` or `, more AS (`.
const CTE = new RegExp(String.raw`(?:\bWITH|,)\s*(${PART})\s+AS\s*\(`, "gi");

const unquoted = (part) => part.replace(/^[["]|[\]"]$/g, "");

// A table name as a schema and a name, lower-cased; the schema is null when the
// text names none. `dbo.Things` and `Things` share a name; `audit.Things` and
// `dbo.Things` do not share a table.
export function nameOf(text) {
  const parts = String(text).split(".").map(unquoted);
  return { name: parts.at(-1).toLowerCase(), schema: parts.length > 1 ? parts.at(-2).toLowerCase() : null };
}

// Every table a query reads, as written (quoting dropped), without the names
// of its own CTEs -- those are not tables anybody writes.
export function tableRefsIn(sql) {
  const ctes = new Set([...String(sql).matchAll(CTE)].map((m) => unquoted(m[1]).toLowerCase()));
  return [...new Set([...String(sql).matchAll(TABLE)].map((m) => m[1].split(".").map(unquoted).join(".")))].filter((t) => !(ctes.has(nameOf(t).name) && !nameOf(t).schema));
}

// The bare name a query uses for each table: what a finding's key and a check's
// record carry, stable across `dbo.Things` and `Things`.
export const tablesIn = (sql) => [...new Set(tableRefsIn(sql).map((t) => t.split(".").at(-1)))];

// A table the map records, by name, and by schema when both sides name one.
const mapped = (ref, known) => known.some((m) => m.name === ref.name && (!m.schema || !ref.schema || m.schema === ref.schema));

// w: { ctx (db, graph, config, now), store, id, settings, io }
// spec: { action, query, expect (rows), within? }
// spec: { action, query, expect (rows), within? } -- or { action, via, input, … }
export function checkData(w, spec) {
  const model = modelOf(w.store.read(w.id));
  const action = actionOf(model, spec.action);
  if (!action) throw new Refused(`${spec.action} is not an action of ${w.id} — a data check belongs to the action it witnesses`);
  gate({ ...worldOf(w, model, {}, null, undefined), acting: false });
  return spec.via ? viaCapability(w, model, action, spec) : viaSql(w, model, action, spec);
}

function viaSql(w, model, action, spec) {
  const query = heldTo(w, fillTc(spec.query, model, action));
  return recorded(w, { ...spec, action, query: spec.query, tables: tablesIn(query), provenance: provenanceOf(w, action, tablesIn(query)), result: answered(w, action, spec, sqlReader(w, query)) });
}

function viaCapability(w, model, action, spec) {
  const cap = readOnly(w, spec.via);
  const input = Object.fromEntries(Object.entries(spec.input ?? {}).map(([k, v]) => [k, typeof v === "string" ? fillTc(v, model, action, cap.inputSchema?.[k]?.esc ?? "text") : v]));
  const kept = Object.fromEntries(Object.entries(spec.input ?? {}).map(([k, v]) => [k, typeof v === "string" ? scrub(v) : v]));
  return recorded(w, { ...spec, action, query: null, tables: [], provenance: `capability ${cap.id}: the map does not say it reads what ${action.on ?? action.id} writes`, via: cap.id, input: kept, result: answered(w, action, spec, capabilityReader(w, cap, input)) });
}

function readOnly(w, id) {
  const cap = w.ctx.capabilities.resolve(id);
  if (cap.mutates) throw new Refused(`${id} declares that it can change external state — a data check only reads`);
  return cap;
}

// ${TC} is what THIS chain typed. With one distinct value it is that value;
// with more, a bare ${TC} would be a guess at which one the query means --
// the last one typed, silently, is how a missing row got reported about the
// wrong field -- so it is refused and ${TC:<screen/via>} names the field.
const TC = /\$\{TC(?::([^}]+))?\}/g;

// `esc`: the language the value lands in -- SQL for a query, and for a
// capability's input whatever its own schema declares for that key.
export function fillTc(template, model, action, esc = "sql") {
  const typed = typedIn(model, action);
  [...String(template).matchAll(TC)].forEach((m) => unambiguous(typed, m[1], action));
  return String(template).replace(TC, (_, on) => encode(valueFor(typed, on), esc));
}

const typedIn = (model, action) => chainOf(model, action.id).flatMap((a) => Object.entries(a.synthetic ?? {}).map(([on, value]) => ({ on, value })));

const distinct = (typed) => [...new Set(typed.map((t) => t.value))];

const valueFor = (typed, on) => (on ? typed.filter((t) => t.on === on).at(-1)?.value : distinct(typed)[0]) ?? "";

function unambiguous(typed, on, action) {
  if (on && !typed.some((t) => t.on === on)) throw new Refused(`\${TC:${on}}: ${action.id}'s chain typed nothing into ${on} — it typed into ${[...new Set(typed.map((t) => t.on))].join(", ") || "nothing"}`);
  if (!on && !typed.length) throw new Refused(`\${TC} is the synthetic value ${action.id}'s chain typed, and it typed none`);
  if (!on && distinct(typed).length > 1) throw new Refused(`${action.id}'s chain typed ${distinct(typed).length} synthetic values (into ${typed.map((t) => t.on).join(", ")}) — name the one the query means with \${TC:<screen/via>}`);
}

function heldTo(w, query) {
  const problem = readOnlyProblem(query);
  if (problem) throw new Refused(`refusing this query — it ${problem}`);
  const unknown = unmappedIn(w.ctx.graph, query);
  if (unknown.length) throw new Refused(`the map records no control writing ${unknown.join(", ")} — record the effect (orbit-ui-map) before an investigation reads it; a table is never guessed (two schemas are two tables)`);
  return query;
}

function unmappedIn(graph, query) {
  const known = [...mappedTables(graph)].map(nameOf);
  return tableRefsIn(query).filter((t) => !mapped(nameOf(t), known));
}

// Did the map say THIS control writes the table, or another one?
function provenanceOf(w, action, tables) {
  const edge = action.on ? w.ctx.graph.edgeOn.get(action.on) : null;
  const own = edge ? tablesOf(controlOf(w.ctx.graph, edge)).map((t) => nameOf(t).name) : [];
  return tables.every((t) => own.includes(nameOf(t).name)) ? "map: this control's effect" : "map: another control's effect";
}

// The consistency window: stated, or the one declared for the control's timing.
function windowOf(w, action, spec) {
  if (Number.isInteger(spec.within)) return spec.within;
  const timing = action.on ? w.ctx.graph.effectOn.get(action.on)?.timing : null;
  return timing ? w.settings.consistency?.[timing] ?? 0 : 0;
}

// reader: { what, unavailable (why nothing can be read here, or null), read }
// where read() -> { ok, count } | { ok: false, error }.
function answered(w, action, spec, reader) {
  const within = windowOf(w, action, spec);
  if (reader.unavailable) return { state: "blocked", why: reader.unavailable, rows: null, attempts: 0, ms: 0, within };
  const t0 = w.ctx.now();
  const got = polled(w, reader, spec.expect, within);
  return { ...got, ms: w.ctx.now() - t0, within };
}

function polled(w, reader, expect, within) {
  const seen = { attempts: 0, last: null };
  const budget = { tries: within > 0 ? 1000 : 1, timeoutSec: within };
  const hit = pollUntil(w.ctx, budget, (i) => probe(w, reader, expect, seen, i));
  return hit ?? outcomeOf(seen, reader);
}

function probe(w, reader, expect, seen, i) {
  if (i > 1) w.io.sleep?.(w.pace ?? 1000);
  seen.attempts = i;
  seen.last = reader.read();
  return !seen.last.ok || !Number.isInteger(expect) || seen.last.count >= expect ? outcomeOf(seen, reader) : null;
}

const sqlReader = (w, query) => ({ what: "the database", unavailable: w.ctx.config?.sql?.command ? null : "project.json has no sql.command — the data layer cannot be read on this machine", read: () => sqlRead(w, query) });

function sqlRead(w, query) {
  const got = w.ctx.db.query(query);
  return got.ok ? { ok: true, count: countOf(got.rows, query) } : { ok: false, error: got.error };
}

// Asked with NO page behind it (src/extensions/context-v1.mjs refuses the
// browser), and with no case, so the capability gate refuses one that mutates.
const capabilityReader = (w, cap, input) => ({ what: `capability ${cap.id}`, unavailable: null, read: () => capabilityRead(w, cap, input) });

function capabilityRead(w, cap, input) {
  try { return { ok: true, count: countOfAnswer(cap, invokeCapability(w.ctx, { c: { id: w.id }, page: false, values: {} }, { capability: cap.id, input })) }; }
  catch (e) { return blockedOr(e); }
}

// A capability that could not be asked is the check BLOCKED, as a database that
// could not be read is; anything else it threw stays what it was.
function blockedOr(e) {
  if (e instanceof Blocked) return { ok: false, error: e.message };
  throw e;
}

// What a capability's answer counts as: a number, { count | n }, a list, or
// { rows: [...] }. Anything else is refused -- a check keeps a count, never data.
const COUNTED_AS = [(v) => v, (v) => v?.count, (v) => v?.n, (v) => (Array.isArray(v) ? v.length : undefined), (v) => (Array.isArray(v?.rows) ? v.rows.length : undefined)];

function countOfAnswer(cap, value) {
  const n = COUNTED_AS.map((f) => f(value)).find((x) => Number.isInteger(x) && x >= 0);
  if (n === undefined) throw new Refused(`${cap.id} answered something that is not a count (a number, { count | n }, a list, or { rows: [...] }) — a data check keeps a count and nothing else`);
  return n;
}

// Rows are counted. A `SELECT COUNT(*) …` answers ONE row holding the number,
// and that number is the count -- the shape the engine's own cases use.
function countOf(rows, query) {
  const single = rows.length === 1 && Object.values(rows[0]).length === 1 ? Number(Object.values(rows[0])[0]) : NaN;
  return /\bCOUNT\s*\(/i.test(query) && Number.isInteger(single) ? single : rows.length;
}

function outcomeOf(seen, reader) {
  if (!seen.last?.ok) return { state: "blocked", why: `${reader.what} could not be read — ${scrub(seen.last?.error ?? "no answer").slice(0, 200)}`, rows: null, attempts: seen.attempts };
  return { state: seen.last.count ? "observed" : "empty", why: null, rows: seen.last.count, attempts: seen.attempts };
}

// The id is taken under the journal lock, from the journal as it is NOW: the
// database was polled outside it, and another command may have written since.
function recorded(w, c) {
  return withJournal(w, () => appendedCheck(w, modelOf(w.store.read(w.id)), c));
}

function appendedCheck(w, model, c) {
  const check = { id: nextId(model, "check"), action: c.action.id, layer: "data", state: c.result.state, why: c.result.why, query: c.query, tables: c.tables, provenance: c.provenance, expect: c.expect ?? null, rows: c.result.rows, attempts: c.result.attempts, ms: c.result.ms, within: c.result.within, via: c.via, input: c.input };
  w.store.append(w.id, "check", check);
  return check;
}
