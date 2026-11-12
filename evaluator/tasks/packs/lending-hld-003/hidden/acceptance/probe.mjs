// THE PROBE of ORBIT-HLD-003, run in a container of its own over the target: it imports the target's own API, store and
// drop box, and for each input it is handed it lends one copy of a title in a store of its own under the container's
// /tmp and takes the input's steps in order -- a renewal on its day, a hold another member places on the title or on
// another title, the loan brought back -- and says as ids what each renewal answered and whether a refusal left the
// due date where it was. It is handed inputs only, never what they should come to.
//
//   node probe.mjs <target>     stdin  { inputs: [{ id, out, format, steps: [{ do: renew|hold|hold-other|return, day? }] }] }
//   stdout { answers: [{ id, got: [ids] } | { id, threw }] } | { error: { code, names?, message? } }
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDS = [["src/api.mjs", "handle"], ["src/store.mjs", "openStore"], ["src/dropbox.mjs", "consume"]];

const TENANT = "harbor";

const said = (doc) => process.stdout.write(`${JSON.stringify(doc)}\n`);

const failed = (code, e) => ({ error: { code, message: String(e?.message ?? e).slice(0, 300) } });

// ---- one input, played through the target's own API ------------------------------------------------------------------

const callOf = (app, store) => (method, path, body, today) => app.handle(store, { method, path, tenant: TENANT, today, body });

// The loan the steps are about, and another title a hold may be placed on.
function setUp(call, input) {
  const [title, other] = [input.format, "book"].map((format, i) => call("POST", "/titles", { name: `Title ${i}`, format }, input.out).body);
  const copy = call("POST", "/copies", { title: title.id, replacementCents: 2000 }, input.out).body;
  const member = call("POST", "/members", { name: "Borrower" }, input.out).body;
  return { call, input, title, other, loan: call("POST", "/loans", { copy: copy.id, member: member.id }, input.out).body, renewals: 0, ids: [] };
}

const heldBy = (w, titleId) => w.call("POST", "/holds", { title: titleId, member: w.call("POST", "/members", { name: "Waiter" }, w.input.out).body.id }, w.input.out);

const dueNow = (w) => w.call("GET", `/loans/${w.loan.id}`, undefined, w.input.out).body.due;

const answerIds = (k, r, kept) => [`renew:${k}:${r.status}`, ...(r.body?.error ? [`renew:${k}:${r.status}:${r.body.error}`] : []), ...(r.status === 200 ? [`renew:${k}:due:${r.body.due}`, `renew:${k}:renewals:${r.body.renewals}`] : kept ? [`renew:${k}:kept-due`] : [])];

function renewed(w, day) {
  const before = dueNow(w);
  const r = w.call("POST", `/loans/${w.loan.id}/renew`, {}, day);
  return { ...w, renewals: w.renewals + 1, ids: [...w.ids, ...answerIds(w.renewals, r, dueNow(w) === before)] };
}

const STEPS = {
  hold: (w) => (heldBy(w, w.title.id), w),
  "hold-other": (w) => (heldBy(w, w.other.id), w),
  return: (w) => (w.call("POST", `/loans/${w.loan.id}/return`, {}, w.input.out), w),
  renew: (w, step) => renewed(w, step.day),
};

const played = (app, store, input) => input.steps.reduce((w, step) => STEPS[step.do](w, step), setUp(callOf(app, store), input)).ids;

function answered(app, input) {
  const dir = mkdtempSync(join(tmpdir(), "hld-003-"));
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
