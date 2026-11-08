// THE PROBE of ORBIT-HLD-005, run in a container of its own over the target: it imports the target's own API, store and
// drop box, and for each input it is handed it adds a member from the input's name and whatever else the input's body
// carries, in a store of its own under the container's /tmp, has them borrow copies one after another -- and, when the
// input says so, bring the first back and ask for two more -- and says as ids what each request answered. It is handed
// inputs only, never what they should come to.
//
//   node probe.mjs <target>     stdin  { inputs: [{ id, day, name, extra, borrow, returnOne }] }
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

const callOf = (app, store, day) => (method, path, body) => app.handle(store, { method, path, tenant: TENANT, today: day, body });

const answerIds = (prefix, r) => [`${prefix}:${r.status}`, ...(r.body?.error ? [`${prefix}:${r.status}:${r.body.error}`] : [])];

const copyOf = (call, title) => call("POST", "/copies", { title: title.id, replacementCents: 1500 }).body;

const borrow = (call, title, member) => call("POST", "/loans", { copy: copyOf(call, title).id, member: member.id });

// The first loan brought back, and two more asked for: one more may go out, and no sixth at once.
function again(call, title, member, first) {
  call("POST", `/loans/${first.body.id}/return`, {});
  return [...answerIds("again", borrow(call, title, member)), ...answerIds("again", borrow(call, title, member))];
}

function played(app, store, input) {
  const call = callOf(app, store, input.day);
  const title = call("POST", "/titles", { name: "Class set", format: "book" }).body;
  const added = call("POST", "/members", { ...input.extra, name: input.name });
  const loans = Array.from({ length: input.returnOne ? 5 : input.borrow }, () => borrow(call, title, added.body));
  return [...answerIds("member", added), ...(added.body?.name === input.name ? ["member:named"] : []), ...loans.flatMap((r, i) => answerIds(`borrow:${i}`, r)), ...(input.returnOne ? again(call, title, added.body, loans[0]) : [])];
}

function answered(app, input) {
  const dir = mkdtempSync(join(tmpdir(), "hld-005-"));
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
