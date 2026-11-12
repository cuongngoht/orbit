// THE PROBE of ORBIT-HLD-002, run in a container of its own over the target: it imports the target's own API, store and
// drop box, and for each input it is handed it plays the input in a store of its own under the container's /tmp -- one
// or two copies of a title lent out, holds placed in the input's order on that title or another, the copies brought
// back one day apart at the desk or through the drop box, then a member with no hold and the input's `collector` asking
// to borrow the first copy -- and says as ids what every copy, hold and notice came to. It is handed inputs only, never
// what they should come to.
//
//   node probe.mjs <target>     stdin  { inputs: [{ id, out, back, via, format, holds: [same|other], returns, collector }] }
//   stdout { answers: [{ id, got: [ids] } | { id, threw }] } | { error: { code, names?, message? } }
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDS = [["src/api.mjs", "handle"], ["src/store.mjs", "openStore"], ["src/dropbox.mjs", "consume"]];

const TENANT = "harbor";

const DAY_MS = 86400000;

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const said = (doc) => process.stdout.write(`${JSON.stringify(doc)}\n`);

const failed = (code, e) => ({ error: { code, message: String(e?.message ?? e).slice(0, 300) } });

// ---- one input, played through the target's own API ------------------------------------------------------------------

const callOf = (app, store) => (method, path, body, today) => app.handle(store, { method, path, tenant: TENANT, today, body });

const memberOf = (w, name) => w.call("POST", "/members", { name }, w.input.out).body;

// The titles, the copies lent out, the members waiting in the input's order, and one member with no hold.
function setUp(w) {
  const [same, other] = [w.input.format, "book"].map((format, i) => w.call("POST", "/titles", { name: `Title ${i}`, format }, w.input.out).body);
  const copies = Array.from({ length: w.input.returns }, () => w.call("POST", "/copies", { title: same.id, replacementCents: 2000 }, w.input.out).body);
  const loans = copies.map((c, i) => w.call("POST", "/loans", { copy: c.id, member: memberOf(w, `Borrower ${i}`).id }, w.input.out).body);
  const waiters = w.input.holds.map((_, j) => memberOf(w, `Waiter ${j}`));
  return { ...w, copies, loans, waiters, stranger: memberOf(w, "Stranger"), holds: w.input.holds.map((on, j) => w.call("POST", "/holds", { title: (on === "same" ? same : other).id, member: waiters[j].id }, w.input.out).body) };
}

const BACK = {
  desk: (w, i, day) => w.call("POST", `/loans/${w.loans[i].id}/return`, {}, day),
  dropbox: (w, i, day) => w.app.consume(w.store, { id: `scan-${i}`, tenant: TENANT, copy: w.copies[i].id, at: day }),
};

const lastDay = (w) => addDays(w.input.out, w.input.back + w.input.returns);

const indexIn = (list, id) => list.findIndex((x) => x.id === id);

const holdIds = (w, h, j) => [`hold:${j}:${h.state}`, ...(indexIn(w.copies, h.copy) >= 0 ? [`ready-copy:${j}:${indexIn(w.copies, h.copy)}`] : []), ...(h.pickupBy ? [`pickup:${j}:${h.pickupBy}`] : [])];

const noticeIds = (w, j) => (w.call("GET", `/members/${w.waiters[j].id}/notices`, undefined, lastDay(w)).body.notices ?? []).map((n) => `notice:${j}:${n.kind}:${indexIn(w.holds, n.hold)}:${indexIn(w.copies, n.copy)}:${n.pickupBy}`);

const countOf = (w) => [...w.waiters, w.stranger].reduce((n, m) => n + (w.call("GET", `/members/${m.id}/notices`, undefined, lastDay(w)).body.notices ?? []).length, 0);

// What the copies, holds and notices came to once every copy was back.
const readBack = (w) => [...w.copies.map((c, i) => `copy:${i}:${w.call("GET", `/copies/${c.id}`, undefined, lastDay(w)).body.status}`), ...w.holds.flatMap((h, j) => holdIds(w, w.call("GET", `/holds/${h.id}`, undefined, lastDay(w)).body, j)), ...w.waiters.flatMap((_, j) => noticeIds(w, j)), `notices:${countOf(w)}`];

const borrowed = (w, member) => ((r) => [String(r.status), ...(r.body?.error ? [`${r.status}:${r.body.error}`] : [])])(w.call("POST", "/loans", { copy: w.copies[0].id, member: member.id }, lastDay(w)));

// A member with no hold asks for the first copy, then the input's collector does, and what their hold came to.
const collectIds = (w) => [...borrowed(w, w.stranger).map((x) => `borrow-other:${x}`), ...(w.input.collector === null ? [] : [...borrowed(w, w.waiters[w.input.collector]).map((x) => `borrow-holder:${x}`), `after:${w.input.collector}:${w.call("GET", `/holds/${w.holds[w.input.collector].id}`, undefined, lastDay(w)).body.state}`])];

function played(app, store, input) {
  const w = setUp({ app, store, input, call: callOf(app, store) });
  w.copies.forEach((_, i) => BACK[input.via](w, i, addDays(input.out, input.back + i)));
  const seen = readBack(w);
  return [...seen, ...collectIds(w)];
}

function answered(app, input) {
  const dir = mkdtempSync(join(tmpdir(), "hld-002-"));
  try { return { id: input.id, got: played(app, app.openStore(join(dir, "store")), input) }; }
  catch (e) { return { id: input.id, threw: String(e?.message ?? e).slice(0, 300) }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- the target, and what it was handed ----------------------------------------------------------------------------

function inputOf() {
  try { return ((j) => (Array.isArray(j?.inputs) ? j : failed("INPUT", "no inputs")))(JSON.parse(readFileSync(0, "utf8"))); }
  catch (e) { return failed("INPUT", e); }
}

async function modulesOf(target) {
  try { return { mods: await Promise.all(NEEDS.map(([rel]) => import(pathToFileURL(join(target, rel)).href))) }; }
  catch (e) { return failed("IMPORT", e); }
}

const missingOf = (mods) => NEEDS.filter(([, name], i) => typeof mods[i][name] !== "function").map(([rel, name]) => `${name} (${rel})`);

async function appOf(target) {
  const m = await modulesOf(target);
  if (m.error) return m;
  const missing = missingOf(m.mods);
  return missing.length ? { error: { code: "MISSING_EXPORT", names: missing } } : { handle: m.mods[0].handle, openStore: m.mods[1].openStore, consume: m.mods[2].consume };
}

async function main() {
  const input = inputOf();
  const app = input.error ? null : await appOf(process.argv[2]);
  return said(input.error ? input : app.error ? app : { answers: input.inputs.map((x) => answered(app, x)) });
}

await main();
