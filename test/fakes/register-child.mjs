// One SESSION registering a draft, as its own process (AC-13): the factory's real lock, store and validation over the
// store directory it is handed, with the providers the workflow's steps need answered as provided. It waits for the
// moment it is told, so two of these meet at the lock, and prints what registering came to as one JSON line.
//
//   node register-child.mjs <storeRoot> <draftId> <startAtMs>
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveOf } from "../../src/automation/settings.mjs";
import { realIo } from "../../src/store/io.mjs";
import { factoryPort } from "../../skills/orbit-help/factory.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [storeRoot, id, at] = process.argv.slice(2);

// The test runner loads every module under test/; run without its arguments, this is nobody's session and does nothing.
if (!storeRoot || !id) process.exit(0);

const PROVIDERS = { "release.evidence.read": { kind: "capability", id: "acme.evidence", key: "acme:acme.evidence", ownership: "project" }, "release.notes.search": { kind: "mcp", id: "corp", key: "managed:corp", ownership: "orbit-managed" } };

const resolve = (capability) => (PROVIDERS[capability] ? { capability, outcome: "provided", status: "selected", provider: PROVIDERS[capability], why: "provided" } : { capability, outcome: "gap", remedy: "prepare", why: "nothing provides it" });

const factory = factoryPort({ paths: { storeRoot }, io: realIo() }, () => effectiveOf([]).values, resolve, { pluginRoot: REPO });

setTimeout(async () => {
  try { console.log(JSON.stringify(await factory.register(id, { by: `session-${process.pid}` }))); }
  catch (e) { console.log(JSON.stringify({ ok: false, code: e.code ?? null, message: e.message })); }
}, Math.max(0, Number(at) - Date.now()));
