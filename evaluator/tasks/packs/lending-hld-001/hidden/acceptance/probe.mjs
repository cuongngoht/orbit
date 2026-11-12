// THE PROBE of ORBIT-HLD-001, run in a container of its own over the target: it imports the target's own API, store and
// drop box, and for each input it is handed it lends the loans the input names to one member, in a store of its own
// under the container's /tmp, brings each back so many days before or after the due date the service gave it -- at the
// desk or through the drop box -- and says as ids what came back: each loan's fine, and what the member owes. It is
// handed inputs only, never what they should come to.
//
//   node probe.mjs <target>     stdin  { inputs: [{ id, out, via, loans: [{ format, replacementCents, lateBy }] }] }
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

function lend(call, out, member, l, i) {
  const title = call("POST", "/titles", { name: `Title ${i}`, format: l.format }, out).body;
  const copy = call("POST", "/copies", { title: title.id, replacementCents: l.replacementCents }, out).body;
  return { copy, loan: call("POST", "/loans", { copy: copy.id, member: member.id }, out).body };
}

const BACK = {
  desk: (app, store, call, x, day) => call("POST", `/loans/${x.loan.id}/return`, {}, day),
  dropbox: (app, store, call, x, day, i) => app.consume(store, { id: `scan-${i}`, tenant: TENANT, copy: x.copy.id, at: day }),
};

const cents = (v) => (Number.isInteger(v) ? String(v) : "none");

function played(app, store, input) {
  const call = callOf(app, store);
  const member = call("POST", "/members", { name: "Probe Member" }, input.out).body;
  const lent = input.loans.map((l, i) => lend(call, input.out, member, l, i));
  lent.forEach((x, i) => BACK[input.via](app, store, call, x, addDays(x.loan.due, input.loans[i].lateBy), i));
  return [...lent.map((x, i) => `fine:${i}:${cents(call("GET", `/loans/${x.loan.id}`, undefined, input.out).body.fineCents)}`), `balance:${cents(call("GET", `/members/${member.id}`, undefined, input.out).body.balanceCents)}`];
}

function answered(app, input) {
  const dir = mkdtempSync(join(tmpdir(), "hld-001-"));
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
