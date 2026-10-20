// The TENANT-ISOLATION matrix, run -- only over what a person declared
// (src/investigation/tenancy.mjs), only in an approved security-test mode, one
// identity at a time, and against approved SYNTHETIC records only.
//
// Per row:
//   1. switch    the identity's own signed-in session (src/run/identity.mjs
//                enterIdentity -- the SAME claims gate a case passes), then hold
//                its token to the contract: its tenant claim must be one of the
//                tenants the contract says it acts in, and no two identities may
//                read as one principal. A profile NAME is never evidence of who
//                is signed in; the token's claims are
//   2. probe     through the channels the resource declares:
//                  ui    go to its route (an action, with the whole boundary),
//                        then ask whether its marker is on the screen
//                  api   the identity's OWN session asks the path from inside the
//                        page -- no credential is read, copied or replayed; what
//                        comes back is a status and whether the marker was in the
//                        body, never the body
//   3. data      for update / unchanged: a read-only snapshot of the resource
//                before the matrix and after the row, compared by FINGERPRINT
//
// It records what it saw, row by row. Whether a row is a vulnerability is
// src/investigation/findings.mjs's to say -- including the rule that a denial
// proves nothing unless the same channel showed access where it is allowed.
import { enterIdentity } from "../run/identity.mjs";
import { sha } from "../hash.mjs";
import { canonical } from "../network/fingerprint.mjs";
import { scrub } from "../scrub.mjs";
import { act, current, withJournal, worldOf } from "./act.mjs";
import { gate } from "./gates.mjs";
import { nextId } from "./model.mjs";
import { belongs, matrixOf } from "./tenancy.mjs";

// w: { ctx, store, id, settings, environment, mode, on, io }
export function runMatrix(w, only = null) {
  const t = w.settings.tenancy;
  if (!t) return [record(w, { row: 0, operation: "contract", state: "not-observed", why: "no accepted tenancy contract in settings — nothing to hold a tenant check to" })];
  gated(w);
  const rows = matrixOf(t).filter((r) => !only || only.includes(r.row));
  return rows.flatMap((row, _, all) => rowResults(w, runOf(w, t, all), row));
}

// Asked before the matrix AND before every row: the API channel probes from
// inside the page without going through act, so a cancel, a spent budget or a
// deadline that lands mid-matrix has to be seen here or not at all.
const gated = (w) => gate({ ...worldOf(w, current(w), {}, null, w.ctx.browser.state()), mode: w.mode });

// One per matrix run: the baselines taken before any row, and the principals
// seen so far. Memoised on the row list, so every row shares one.
const RUNS = new WeakMap();
function runOf(w, t, rows) {
  if (!RUNS.has(rows)) RUNS.set(rows, { baseline: baselines(w, rows), principals: new Map(), claim: t.claim ?? "tid", tenants: t.tenants });
  return RUNS.get(rows);
}

function rowResults(w, run, row) {
  gated(w);
  if (belongs(row) && ["denied", "excluded"].includes(row.expect)) return [record(w, base(row, { state: "not-observed", why: `contradiction: the contract lets ${row.identity} act in ${row.resourceOf.tenant} and expects it ${row.expect} — a person fixes the contract` }))];
  const who = w.settings.identities.includes(row.identity) ? entered(w, run, row) : { why: `identity "${row.identity}" is not one a person approved (settings identities)` };
  if (who.why) return [record(w, base(row, { state: "blocked", why: who.why }))];
  return OPERATIONS[row.operation](w, run, row, who).map((r) => record(w, base(row, { ...r, claims: { tenant: who.tenant } })));
}

const base = (row, more) => ({ row: row.row, identity: row.identity, resource: row.resource, operation: row.operation, expect: row.expect, ...more });

function record(w, r) {
  return withJournal(w, () => w.store.append(w.id, "security", { ...r, id: nextId(current(w), "security") }));
}

// The identity's own session, and its token held to the contract.
function entered(w, run, row) {
  try { return heldTo(w, run, row, enterIdentity(w.ctx, fakeRun(w, row), { as: row.identity })); }
  catch (e) { return { why: scrub(String(e.message)).split("\n").slice(0, 2).join(" ").slice(0, 300) }; }
}

const fakeRun = (w, row) => ({ c: { id: w.id, identities: { [row.identity]: { as: row.identity } } }, log: { record: () => {} }, identities: [], print: { say: () => {} } });

function heldTo(w, run, row, rec) {
  const value = w.ctx.identity.claims().claims?.[run.claim];
  const tenant = Object.entries(run.tenants).find(([, v]) => v === value)?.[0] ?? null;
  if (!tenant || !row.tenantsOf.includes(tenant)) return { why: `${row.identity}'s session is signed in to ${tenant ? `tenant ${tenant}` : "a tenant the contract does not name"}, and the contract says it acts in ${row.tenantsOf.join(", ")}` };
  return unmixed(run, row, rec, tenant);
}

// Two identities reading as ONE principal is a contaminated session -- a
// shared profile, a cookie that survived a switch -- and every row after it
// would be a result nobody observed. Refused, loudly.
function unmixed(run, row, rec, tenant) {
  const other = [...run.principals].find(([as, oid]) => as !== row.identity && oid === rec.oid)?.[0];
  if (other) return { why: `session contamination: ${row.identity} and ${other} read as the same principal — separate browser sessions are required` };
  run.principals.set(row.identity, rec.oid);
  return { tenant };
}

const OPERATIONS = {
  read: (w, run, row) => [...(row.resourceOf.route ? [viaUi(w, row)] : []), ...(row.resourceOf.api ? [viaApi(w, row, row.resourceOf.api, "GET")] : [])],
  search: (w, run, row) => [viaApi(w, row, row.resourceOf.search, "GET")],
  update: (w, run, row) => [{ ...viaApi(w, row, row.resourceOf.write.api, row.resourceOf.write.method, row.resourceOf.write.body), ...changed(w, run, row) }],
  unchanged: (w, run, row) => [{ channel: "data", state: "observed", ...changed(w, run, row) }],
};

// The route, as an action: the whole boundary, and then one question.
function viaUi(w, row) {
  const done = act({ ...w, identity: row.identity }, { kind: "goto", url: row.resourceOf.route, identity: row.identity, surface: row.resource });
  if (done.action.state !== "done") return { channel: "ui", state: "blocked", why: done.action.why };
  const seen = w.ctx.browser.truthy(`document.body.innerText.includes(${JSON.stringify(row.resourceOf.marker)})`);
  return { channel: "ui", state: "observed", leaked: seen === true, status: null };
}

// The identity's own session asks from inside the page. Only a status and a
// boolean come back out of it.
export const probeJs = (path, method, body, marker) => `fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},credentials:'include',headers:{'content-type':'application/json'}${body === undefined ? "" : `,body:${JSON.stringify(JSON.stringify(body))}`}}).then(async r=>{const t=await r.text();return JSON.stringify({status:r.status,contains:t.includes(${JSON.stringify(marker)})})}).catch(e=>JSON.stringify({status:null,error:String(e&&e.message||e).slice(0,120)}))`;

function viaApi(w, row, path, method, body) {
  const said = parsed(w.ctx.browser.ev(probeJs(path, String(method).toUpperCase(), body, row.resourceOf.marker)));
  if (!Number.isInteger(said?.status)) return { channel: "api", state: "blocked", why: `the probe got no answer — ${scrub(String(said?.error ?? "no reply")).slice(0, 160)}` };
  return { channel: "api", state: "observed", status: said.status, leaked: said.contains === true };
}

function parsed(text) {
  try { return typeof text === "string" ? JSON.parse(text) : text; }
  catch { return null; }
}

// Snapshots are fingerprints of what a read-only query returns: whether the
// data moved is knowable, what the data IS never leaves the database port.
function baselines(w, rows) {
  const queries = [...new Set(rows.filter((r) => r.resourceOf.data).map((r) => r.resource))];
  return new Map(queries.map((id) => [id, snapshot(w, w.settings.tenancy.resources[id].data.query)]));
}

function snapshot(w, query) {
  if (!w.ctx.config?.sql?.command) return { blocked: "project.json has no sql.command — whether the data moved cannot be shown" };
  const got = w.ctx.db.query(query);
  return got.ok ? { fp: sha(canonical(got.rows)).slice(0, 16) } : { blocked: `the database could not be read — ${scrub(String(got.error ?? "")).slice(0, 160)}` };
}

function changed(w, run, row) {
  const before = run.baseline.get(row.resource);
  const after = before && !before.blocked ? snapshot(w, row.resourceOf.data.query) : before;
  if (!after || after.blocked) return { changed: null, state: "blocked", why: after?.blocked ?? "no snapshot" };
  return { changed: after.fp !== before.fp };
}
