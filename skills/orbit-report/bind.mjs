// The REAL binding of a project report, done once for the two composition roots
// that use it -- cli/project-report.mjs and Orbit Control -- so neither can wire
// a different secret port, a different Python, a different set of sources or a
// different way in to them.
//
// Binding reads files and asks git and an interpreter their version; it opens
// no connection, reads no credential and starts no sign-in. How a connection is
// AUTHORIZED is its `auth` (skills/orbit-report/auth, bound once here): the
// collector resolves a RequestAuth when a run begins and asks it for a header at
// every request (src/project-report/collect.mjs), and a connection test does the
// same when a person asks for one.
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
import { authFor } from "./auth/index.mjs";
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

// The AUTH every report root shares, bound once: one adapter per strategy, over this machine's tools, secrets and rooms, so
// no caller can wire a different tool, a different profile or a different adapter. Binding reads and starts nothing.
// w: { env, rooms, secrets, log?, emit?, next? }
const authOver = (w) => authFor({ pluginRoot: PLUGIN_ROOT, env: w.env ?? {}, rooms: w.rooms, io: realIo(), process: createProcess(), secrets: w.secrets, providers: providers(), log: w.log, emit: w.emit, next: w.next });

// The connections of this machine, WITH the auth that signs in, tests and reads them.
export function connectionsFor(env, rooms, secrets = secretsFor(env, rooms), auth = authOver({ env, rooms, secrets })) {
  return createConnections({ store: connectionStore(rooms, realIo()), secrets, providers: providers(), auth, now: () => new Date().toISOString() });
}

// ORBIT_PYTHON, else the private copy Orbit installed, else a system one new
// enough; the catalog's row says what "new enough" is.
export function pythonFor(env, rooms) {
  const row = toolCatalog(readCatalog(realIo(), catalogFile(PLUGIN_ROOT, "tools"))).find((t) => t.id === "python");
  const ctx = detectionContext({ env, receipts: createToolState(rooms, realIo()).receipts(), rooms, now: () => new Date().toISOString() });
  return resolvePython(row, ctx, fromEnv(env, "PYTHON") ?? null);
}

// { env, cwd, log } -> { rctx, deps, connections, rooms, auth, probe }
// A composition root may hand in what it already bound -- Orbit Control its
// rooms and secret port, a test its sources and fetch -- and say how a run may
// reach a person who must sign in: `interactive` ("when-required" · "never" · "force")
// and `notify` (where the sign-in prompt is shown, the root's `log` unless said); `next` and
// `emit` are the auth's own (the command that signs in; a phase and its outcome, never a value).
export async function boundReport(w) {
  const { env, cwd, log = () => {}, rooms = stateRooms(storeBase(w.env)), secrets = null, sources = SOURCES, fetch = globalThis.fetch } = w;
  const kept = secrets ?? secretsFor(env, rooms);
  const auth = authOver({ env, rooms, secrets: kept, log, emit: w.emit, next: w.next });
  const rctx = await contextOf(reportProject(env, cwd), env, rooms);
  return { rctx, deps: depsOf({ secrets: kept, auth, log, sources, fetch, interactive: w.interactive, notify: w.notify ?? log }), connections: connectionsFor(env, rooms, kept, auth), rooms, auth, probe: probeFor(rctx, sources, fetch) };
}

async function contextOf(found, env, rooms) {
  const read = readSettings(found.room, found.io);
  const python = pythonFor(env, rooms);
  const connection = read.settings.connection ? connectionStore(rooms, realIo()).get(read.settings.connection) : null;
  return { project: found.project, store: found.store, room: found.room, io: found.io, outputIo: realIo(), settings: read.settings, revision: read.revision, settingsExist: read.exists, connection, python: python.file ? python : null, pythonProblem: python.file ? null : python, extensions: await reportExtensions(found.store.root, found.io), pack: packBinding(), engine: engineVersion(), env, reportsDir: found.project.reportsDir, ignored: (path) => ignoredByGit(found.project.root, path) };
}

const depsOf = (d) => ({ sources: d.sources, secrets: d.secrets, auth: d.auth, interactive: d.interactive, notify: d.notify, fetch: d.fetch, process: createProcess(), nowMs: Date.now, entropy: () => randomBytes(2).toString("hex"), log: d.log });

// A connection tested against THIS project's scope when it is this project's
// provider -- the reads its report would make, and nothing more -- with the
// RequestAuth the connection's test resolved: the probe never starts a sign-in.
export const probeFor = (rctx, sources = SOURCES, fetch = globalThis.fetch) => (connection, auth) => sources[connection.provider].probe({ connection, scope: rctx?.settings.provider === connection.provider ? rctx.settings.scope ?? {} : {}, auth, fetch, nowMs: Date.now });

// Outside the checkout, or ignored by it: nothing to warn about.
function ignoredByGit(root, path) {
  if (!within(root, path)) return true;
  return gitValue(root, ["check-ignore", "-q", path]) !== null;
}

// Connections over rooms a composition root already bound (Orbit Control's), with the auth that signs in, tests and reads them.
export const connectionsOver = (rooms, secrets, env = {}) => connectionsFor(env, rooms, secrets);

// What a page may show of the providers: the fields a connection and a scope
// ask for, how each way in works (its strategies, what a person may set on one),
// the credential advice and its official pages -- not the token shapes.
export const publicProviders = () => providers().map((p) => ({ id: p.id, label: p.label, connection: p.connection, scope: p.scope, authentication: p.authentication ?? null, credential: { kind: p.credential.kind, advice: p.credential.advice, docs: p.credential.docs }, capabilities: p.capabilities }));

// The store a project's report extensions live in, as the lifecycle asks for it.
export function reportStore(env, cwd) {
  const found = reportProject(env, cwd);
  return { found, ctx: { store: (write = false) => (write && found.prepare(), found.store.root) } };
}
