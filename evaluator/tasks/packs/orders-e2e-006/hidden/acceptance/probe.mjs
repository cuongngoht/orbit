// THE PROBE of ORBIT-E2E-006: the one piece of the verifier that runs the TARGET's code. It is handed the target's root
// as its argument and the inputs on stdin, imports the target's own API, store and view, and for each input -- over a
// store directory of its own under this container's /tmp, removed once answered -- creates the order, reads it back
// through a store opened again on that directory, and draws what it read. It answers the note each time, the note
// paragraph the view drew (`none` when it drew none) and the customer, total and state paragraphs. It judges nothing.
//
//   node probe.mjs <target-root>   < { "inputs": [{ id, call: "note", customer, lines, note? }] }
//   -> { "answers": [{ id, got: ["status=…", "created=…", "read=…", "view=…", "customer=…", "total=…", "state=…"] } | { id, threw }] }
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { api: ["src/api.mjs", ["handle"]], store: ["src/store.mjs", ["openStore"]], ui: ["src/ui.mjs", ["renderOrder"]] };

const stdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d)).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const missingOf = (mods) => Object.entries(NEEDED).flatMap(([k, [file, names]]) => names.filter((n) => typeof mods[k]?.[n] !== "function").map((n) => `${file}#${n}`));

async function loaded(root) {
  try { return ((mods) => (missingOf(mods).length ? { error: { code: "MISSING_EXPORT", names: missingOf(mods) } } : mods))(Object.fromEntries(await Promise.all(Object.entries(NEEDED).map(async ([k, [file]]) => [k, await import(pathToFileURL(join(root, file)).href)])))); }
  catch (e) { return { error: { code: "IMPORT", message: String(e?.message ?? e).slice(0, 300) } }; }
}

function inStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const bodyOf = (i) => ({ customer: i.customer, lines: i.lines, ...(Object.hasOwn(i, "note") ? { note: i.note } : {}) });

// The inner text of the first paragraph of a class the view drew, or `none`.
const paragraph = (html, cls) => new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`).exec(String(html))?.[1] ?? "none";

const heading = (html) => /<h2>([\s\S]*?)<\/h2>/.exec(String(html))?.[1] ?? "none";

const drawn = (html) => [`view=${paragraph(html, "note")}`, `customer=${heading(html)}`, `total=${paragraph(html, "total")}`, `state=${paragraph(html, "state")}`];

function noted(m, i, dir) {
  const made = m.api.handle(m.store.openStore(dir), { method: "POST", path: "/orders", body: bodyOf(i) });
  const read = m.api.handle(m.store.openStore(dir), { method: "GET", path: `/orders/${made.body?.id}` }).body;
  return [`status=${made.status}`, `created=${made.body?.note}`, `read=${read?.note}`, ...drawn(m.ui.renderOrder(read))];
}

const CALLS = {
  note: (m, i) => inStore((dir) => noted(m, i, dir)),
};

const answered = (m, i) => {
  try { return { id: i.id, got: CALLS[i.call](m, i) }; }
  catch (e) { return { id: i.id, threw: String(e?.message ?? e).slice(0, 200) }; }
};

function inputsOf(text) {
  try { return JSON.parse(text).inputs.filter((i) => Object.hasOwn(CALLS, i?.call)); }
  catch { return null; }
}

async function main() {
  const inputs = inputsOf(await stdin());
  const m = inputs ? await loaded(process.argv[2]) : { error: { code: "INPUT", message: "the inputs could not be read" } };
  process.stdout.write(`${JSON.stringify(m.error ? { error: m.error } : { answers: inputs.map((i) => answered(m, i)) })}\n`);
}

main();
