// THE PROBE of ORBIT-E2E-005: the one piece of the verifier that runs the TARGET's code. It is handed the target's root
// as its argument and the inputs on stdin, imports the target's own orders, store and payments consumer, and for each
// input -- over a store directory of its own under this container's /tmp, removed once answered -- creates the orders,
// then delivers each message in turn: through a store opened again on that directory when the delivery is a restart,
// else through the store the last delivery used. It answers every acknowledgement, the invoices at the end, and the
// order and amount each invoice is for. It judges nothing.
//
//   node probe.mjs <target-root>   < { "inputs": [{ id, call: "deliveries", orders, messages: [{ id, type, order, restart }] }] }
//   -> { "answers": [{ id, got: ["<n>:ack=<a>", "invoices=<k>", "invoice=<order>:<amount>"] } | { id, threw }] }
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NEEDED = { orders: ["src/orders.mjs", ["createOrder"]], store: ["src/store.mjs", ["openStore"]], worker: ["src/worker.mjs", ["consume"]] };

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

const messageOf = (msg, ids) => ({ id: msg.id, type: msg.type, orderId: ids[msg.order - 1] ?? "ord-9999" });

// One delivery: through a store opened again when it is a restart, else through the one the last delivery used.
const deliveredIn = (m, dir, ids) => (acc, msg, n) => ((store) => ({ store, out: [...acc.out, `${n + 1}:ack=${m.worker.consume(store, messageOf(msg, ids))?.ack}`] }))(msg.restart ? m.store.openStore(dir) : acc.store);

const invoicesOf = (m, dir, ids) => ((all) => [`invoices=${all.length}`, ...all.map((inv) => `invoice=${ids.indexOf(inv.orderId) + 1}:${inv.amountMinor}`)])(m.store.openStore(dir).list("invoices"));

function delivered(m, i, dir) {
  const store = m.store.openStore(dir);
  const ids = i.orders.map((lines) => m.orders.createOrder(store, { lines }).id);
  const end = i.messages.reduce(deliveredIn(m, dir, ids), { store, out: [] });
  return [...end.out, ...invoicesOf(m, dir, ids)];
}

const CALLS = {
  deliveries: (m, i) => inStore((dir) => delivered(m, i, dir)),
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
