// THE PROBE of ORBIT-HLD-004, run in a container of its own over the target: it imports the target's own API, store and
// drop box, and for each input it is handed it sets two library systems up in a store of its own under the container's
// /tmp -- `theirs` and `mine` -- has `mine` take the input's one act, and says as ids what the act answered and whether
// anything of theirs moved, as `theirs` itself reads its records before and after. It is handed inputs only, never
// what they should come to.
//
//   node probe.mjs <target>     stdin  { inputs: [{ id, day, theirs, mine, theirTitles, mineTitles, act }] }
//   stdout { answers: [{ id, got: [ids] } | { id, threw }] } | { error: { code, names?, message? } }
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDS = [["src/api.mjs", "handle"], ["src/store.mjs", "openStore"], ["src/dropbox.mjs", "consume"]];

const said = (doc) => process.stdout.write(`${JSON.stringify(doc)}\n`);

const failed = (code, e) => ({ error: { code, message: String(e?.message ?? e).slice(0, 300) } });

// ---- one input, played through the target's own API ------------------------------------------------------------------

const asOf = (app, store, day) => (tenant) => (method, path, body) => app.handle(store, { method, path, tenant, today: day, body });

// One library system's records: titles, a copy lent to a member, a copy on the shelf, and another member.
function systemOf(call, name, titles) {
  const made = Array.from({ length: titles }, (_, i) => call("POST", "/titles", { name: `${name} ${i}`, format: "book" }).body);
  const [lent, shelf] = [0, 1].map(() => call("POST", "/copies", { title: made[0].id, replacementCents: 2000 }).body);
  const [member, other] = ["Borrower", "Other"].map((who) => call("POST", "/members", { name: `${name} ${who}` }).body);
  return { call, titles: made, lent, shelf, member, other, loan: call("POST", "/loans", { copy: lent.id, member: member.id }).body };
}

const withHold = (s) => ({ ...s, hold: s.call("POST", "/holds", { title: s.titles[0].id, member: s.other.id }).body });

// What `theirs` reads of its own records: its copies, its loan, its hold and how many titles it lists.
const theirsSeen = (t) => JSON.stringify([t.call("GET", `/copies/${t.lent.id}`).body.status, t.call("GET", `/copies/${t.shelf.id}`).body.status, t.call("GET", `/loans/${t.loan.id}`).body.returned, t.call("GET", `/loans/${t.loan.id}`).body.due, t.call("GET", `/holds/${t.hold.id}`).body.state, t.call("GET", "/titles").body.titles?.length]);

const countIn = (titles, s) => (titles ?? []).filter((x) => s.titles.some((y) => y.id === x.id)).length;

const listed = (w) => ((titles) => [`list:theirs:${countIn(titles, w.t)}`, `list:mine:${countIn(titles, w.m)}`])(w.m.call("GET", "/titles").body.titles);

const status = (act, r) => [`${act}:${r.status}`];

const scanned = (w, act, copy) => [`${act}:${w.app.consume(w.store, { id: `scan-${act}`, tenant: w.input.mine, copy: copy.id, at: w.input.day }).outcome}`];

const ACT = {
  "read-their-title": (w, a) => status(a, w.m.call("GET", `/titles/${w.t.titles[0].id}`)),
  "read-their-copy": (w, a) => status(a, w.m.call("GET", `/copies/${w.t.shelf.id}`)),
  "read-their-member": (w, a) => status(a, w.m.call("GET", `/members/${w.t.member.id}`)),
  "read-their-notices": (w, a) => status(a, w.m.call("GET", `/members/${w.t.member.id}/notices`)),
  "read-their-loan": (w, a) => status(a, w.m.call("GET", `/loans/${w.t.loan.id}`)),
  "read-their-hold": (w, a) => status(a, w.m.call("GET", `/holds/${w.t.hold.id}`)),
  "list-titles": (w) => listed(w),
  "borrow-their-copy": (w, a) => status(a, w.m.call("POST", "/loans", { copy: w.t.shelf.id, member: w.m.other.id })),
  "lend-to-their-member": (w, a) => status(a, w.m.call("POST", "/loans", { copy: w.m.shelf.id, member: w.t.member.id })),
  "hold-their-title": (w, a) => status(a, w.m.call("POST", "/holds", { title: w.t.titles[0].id, member: w.m.other.id })),
  "hold-for-their-member": (w, a) => status(a, w.m.call("POST", "/holds", { title: w.m.titles[0].id, member: w.t.member.id })),
  "copy-of-their-title": (w, a) => status(a, w.m.call("POST", "/copies", { title: w.t.titles[0].id, replacementCents: 100 })),
  "return-their-loan": (w, a) => status(a, w.m.call("POST", `/loans/${w.t.loan.id}/return`, {})),
  "renew-their-loan": (w, a) => status(a, w.m.call("POST", `/loans/${w.t.loan.id}/renew`, {})),
  "scan-their-copy": (w, a) => scanned(w, a, w.t.lent),
  "own-read-copy": (w, a) => status(a, w.m.call("GET", `/copies/${w.m.shelf.id}`)),
  "own-read-loan": (w, a) => status(a, w.m.call("GET", `/loans/${w.m.loan.id}`)),
  "own-list": (w, a) => [`${a}:${countIn(w.m.call("GET", "/titles").body.titles, w.m)}`],
  "own-borrow": (w, a) => status(a, w.m.call("POST", "/loans", { copy: w.m.shelf.id, member: w.m.other.id })),
  "own-hold": (w, a) => status(a, w.m.call("POST", "/holds", { title: w.m.titles[0].id, member: w.m.other.id })),
  "own-scan": (w, a) => scanned(w, a, w.m.lent),
};

function played(app, store, input) {
  const as = asOf(app, store, input.day);
  const w = { app, store, input, t: withHold(systemOf(as(input.theirs), "Theirs", input.theirTitles)), m: systemOf(as(input.mine), "Mine", input.mineTitles) };
  const before = theirsSeen(w.t);
  const ids = ACT[input.act](w, input.act);
  return [...ids, theirsSeen(w.t) === before ? "theirs:untouched" : "theirs:changed"];
}

function answered(app, input) {
  const dir = mkdtempSync(join(tmpdir(), "hld-004-"));
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
