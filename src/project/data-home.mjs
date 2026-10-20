// A project reads and writes one data home. Only an explicit stamp selects the checkout.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "./boundary.mjs";

export const DATA_DIR = "ui-tests";
export const DATA_HOMES = ["store", "checkout"];

// Ordered; the first row that matches decides, and the last always does.
export const DATA_HOME = [
  { by: "stamped", when: (f) => DATA_HOMES.includes(f.stamp), home: (f) => f.stamp },
  { by: "store", when: () => true, home: () => "store" },
];

// A checkout's committed test data, when it has some: ui-tests/project.json at its root.
export const checkoutDataRoot = (root) => (existsSync(join(root, DATA_DIR, "project.json")) ? join(root, DATA_DIR) : null);

// -> { dataHome: "store" | "checkout", dataHomeBy: "stamped" | "store" }
export function dataHomeOf(root, storeRoot) {
  const facts = { stamp: stampedHome(storeRoot) };
  const row = DATA_HOME.find((r) => r.when(facts));
  return { dataHome: row.home(facts), dataHomeBy: row.by };
}

// The directory the test data is read from and written to, held inside its home through links too.
export const dataRootOf = (root, storeRoot, home) => (home === "checkout" ? contained(root, join(root, DATA_DIR)) : contained(storeRoot, join(storeRoot, DATA_DIR)));

// Whether a project.json sits where this checkout's test data lives: plain file reads, no git call, for a reader
// that must stay cheap (a viewer asked every two seconds, an adapter listing tools).
export const configuredAt = (root, storeRoot) => existsSync(join(dataRootOf(root, storeRoot, dataHomeOf(root, storeRoot).dataHome), "project.json"));

function stampedHome(storeRoot) {
  const file = join(storeRoot, "store.json");
  if (!existsSync(file)) return null;
  const doc = stampDocument(file);
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || Object.keys(doc).some((k) => !["layout", "key", "at", "dataHome"].includes(k)) || doc.layout !== 3 || (doc.dataHome !== undefined && !DATA_HOMES.includes(doc.dataHome))) throw new Refused(`unsupported store configuration at ${file}`);
  return doc.dataHome ?? null;
}

function stampDocument(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Refused(`invalid store configuration at ${file}`); }
}
