// The REAL binding of a project report, done once for the two composition roots
// that use it -- cli/project-report.mjs and Orbit Control -- so neither can wire
// a different secret port, a different Python or a different set of sources.
//
// Binding reads files and asks git and an interpreter their version; it opens
// no connection and reads no credential. A credential is read by the collector
// at the moment it is used (src/project-report/collect.mjs), and by a
// connection test when a person asks for one.
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../../src/catalog.mjs";
import { createConnections } from "../../src/connections/manage.mjs";
import { connectionStore } from "../../src/connections/store.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { reportExtensions, reportProject } from "../../src/project-report/context.mjs";
import { resolvePython } from "../../src/project-report/runtime.mjs";
import { readSettings } from "../../src/project-report/settings.mjs";
import { within } from "../../src/project/boundary.mjs";
import { fromEnv } from "../../src/project/env.mjs";
import { gitValue, storeBase } from "../../src/project/repository.mjs";
import { secretSource } from "../../src/secrets.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { toolCatalog } from "../../src/tools/catalog.mjs";
import { createToolState } from "../../src/tools/state.mjs";
import { detectionContext } from "../../src/tools/context.mjs";
import { engineVersion } from "../../src/version.mjs";
import { osVault } from "../orbit-control/vault.mjs";
import { KIT_DIR, SHIM, kitVersion, providers, renderAssets, standardParts, standardSections } from "./pack.mjs";
import { renderReport } from "./render.mjs";
import { azureDevOpsSource } from "./sources/azure-devops.mjs";
import { githubSource } from "./sources/github.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SOURCES = { github: githubSource(), "azure-devops": azureDevOpsSource() };

let assets;
export const packBinding = () => ({ parts: standardParts(), sections: standardSections(), providers: providers(), shim: SHIM, kitDir: KIT_DIR, kitVersion: kitVersion(), pythonRequires: ">=3.11", render: (input) => renderReport(input, (assets ??= renderAssets())) });

// The secret port every caller shares: environment references, and this
// machine's OS secret store where there is one.
export function secretsFor(env, rooms, processes = createProcess()) {
  return secretSource({ env, vault: osVault({ platform: process.platform, env, process: processes, io: realIo(), dir: connectionStore(rooms, realIo()).vaultDir }) });
}

export function connectionsFor(env, rooms, secrets = secretsFor(env, rooms)) {
  return createConnections({ store: connectionStore(rooms, realIo()), secrets, providers: providers(), now: () => new Date().toISOString() });
}

// ORBIT_PYTHON, else the private copy Orbit installed, else a system one new
// enough; the catalog's row says what "new enough" is.
export function pythonFor(env, rooms) {
  const row = toolCatalog(readCatalog(realIo(), catalogFile(PLUGIN_ROOT, "tools"))).find((t) => t.id === "python");
  const ctx = detectionContext({ env, receipts: createToolState(rooms, realIo()).receipts(), rooms, now: () => new Date().toISOString() });
  return resolvePython(row, ctx, fromEnv(env, "PYTHON") ?? null);
}

// { env, cwd, log } -> { rctx, deps, connections, rooms, probe }
// A composition root may hand in what it already bound -- Orbit Control its
// rooms and secret port, a test its sources and fetch.
export async function boundReport({ env, cwd, log = () => {}, rooms = stateRooms(storeBase(env)), secrets = null, sources = SOURCES, fetch = globalThis.fetch }) {
  const found = reportProject(env, cwd);
  const kept = secrets ?? secretsFor(env, rooms);
  const rctx = await contextOf(found, env, rooms);
  return { rctx, deps: depsOf(kept, log, sources, fetch), connections: connectionsFor(env, rooms, kept), rooms, probe: probeFor(rctx, sources, fetch) };
}

async function contextOf(found, env, rooms) {
  const read = readSettings(found.room, found.io);
  const python = pythonFor(env, rooms);
  const connection = read.settings.connection ? connectionStore(rooms, realIo()).get(read.settings.connection) : null;
  return { project: found.project, store: found.store, room: found.room, io: found.io, outputIo: realIo(), settings: read.settings, revision: read.revision, settingsExist: read.exists, connection, python: python.file ? python : null, pythonProblem: python.file ? null : python, extensions: await reportExtensions(found.store.root, found.io), pack: packBinding(), engine: engineVersion(), env, reportsDir: found.project.reportsDir, ignored: (path) => ignoredByGit(found.project.root, path) };
}

const depsOf = (secrets, log, sources, fetch) => ({ sources, secrets, fetch, process: createProcess(), nowMs: Date.now, entropy: () => randomBytes(2).toString("hex"), log });

// A connection tested against THIS project's scope when it is this project's
// provider -- the reads its report would make, and nothing more.
export const probeFor = (rctx, sources = SOURCES, fetch = globalThis.fetch) => (connection, credential) => sources[connection.provider].probe({ connection, scope: rctx?.settings.provider === connection.provider ? rctx.settings.scope ?? {} : {}, credential, fetch, nowMs: Date.now });

// Outside the checkout, or ignored by it: nothing to warn about.
function ignoredByGit(root, path) {
  if (!within(root, path)) return true;
  return gitValue(root, ["check-ignore", "-q", path]) !== null;
}

// Connections over rooms a composition root already bound (Orbit Control's).
export const connectionsOver = (rooms, secrets) => createConnections({ store: connectionStore(rooms, realIo()), secrets, providers: providers(), now: () => new Date().toISOString() });

// What a page may show of the providers: the fields a connection and a scope
// ask for, the credential advice and its official pages -- not the token shapes.
export const publicProviders = () => providers().map((p) => ({ id: p.id, label: p.label, connection: p.connection, scope: p.scope, credential: { kind: p.credential.kind, advice: p.credential.advice, docs: p.credential.docs }, capabilities: p.capabilities }));

// The store a project's report extensions live in, as the lifecycle asks for it.
export function reportStore(env, cwd) {
  const found = reportProject(env, cwd);
  return { found, ctx: { store: (write = false) => (write && found.prepare(), found.store.root) } };
}
