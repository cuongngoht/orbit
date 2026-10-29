// The REAL world behind the resource manager, bound in one place for the
// composition roots that act on it: Orbit Control (control-server/src/main.mjs,
// through core.mjs), cli/resources.mjs and cli/mcp.mjs.
//
// Concrete on purpose, which is why it lives here and not in src/: the host is
// Claude Code (skills/orbit-learn/hosts/claude-mcp.mjs, read-only), Control's
// Node comes from nodejs.org, and the store is the machine store ORBIT_STORE_DIR
// relocates. src/ only ever sees the ports: an MCP host, the Process port, a
// detection context, installers, a secret source.
//
// The ACCOUNT is whoever is signed in to Claude Code on THIS machine, read from
// this machine's own Claude configuration each time it is asked -- a profile
// (name, email, organization, role), never a token (hosts/claude-account.mjs).
//
// Two probes, on purpose. The HOST's servers are tested as the host would run
// them, with the host's environment. A MANAGED server is tested -- and called
// -- with BASE_ENV and the variables it declared (src/process/env.mjs), so no
// other secret this process can see ever reaches its child.
//
// Nothing here runs anything by being imported or called: binding a world reads
// no file, spawns no process and opens no connection. Each effect happens when
// an operation over the world asks for it.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { required, supported } from "../../control-server/src/runtime.mjs";
import { baseEnv } from "../../src/process/env.mjs";
import { MCP_INSTALLERS } from "../../src/mcp/install.mjs";
import { mcpHost } from "../../src/mcp/port.mjs";
import { createProbe } from "../../src/mcp/probe.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { secretSource } from "../../src/secrets.mjs";
import { contained } from "../../src/project/boundary.mjs";
import { repositoryPaths, storeBase } from "../../src/project/repository.mjs";
import { effectiveOf, readAutomation } from "../../src/automation/settings.mjs";
import { projectSkillsOf } from "../orbit-help/factory.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";
import { archiveInstaller } from "../../src/tools/archive.mjs";
import { pythonLockInstaller } from "../../src/tools/pylock.mjs";
import { detectionContext } from "../../src/tools/context.mjs";
import { realInstallIo } from "../../src/tools/real.mjs";
import { engineName } from "../../src/version.mjs";
import { createClaudeAccount } from "../orbit-learn/hosts/claude-account.mjs";
import { createClaudeMcpHost } from "../orbit-learn/hosts/claude-mcp.mjs";
import { DETECTORS as RUNTIME_DETECTORS } from "../../src/runtime/machine.mjs";
import { controlNodeDetector, nodeDistInstaller } from "./tools.mjs";
import { connectionReader, readerResources } from "../orbit-requirements/bind.mjs";
import { osVault } from "./vault.mjs";

// { pluginRoot, projectRoot, env, log? }
export function realWorld({ pluginRoot, projectRoot, env, log = () => {}, nativeFactory = () => ({}) }) {
  const [io, installIo] = [realIo(), realInstallIo(log)];
  const processes = createProcess({ spawn: spawnSync });
  const native = nativeFactory(processes, projectRoot);
  const host = mcpHost(native.hostPort ?? createClaudeMcpHost({ env, home: homedir(), projectRoot, io, probe: createProbe({ fetch, start: processes.start, env }) }));
  return { ...native, pluginRoot, projectRoot, env, io, installIo, host, account: () => createClaudeAccount({ env, home: homedir(), io }).account(), detection: detectionOf(env, projectRoot), storeBase: storeBase(env), rooms: stateRooms(storeBase(env)), installers: installersOf(installIo, log), process: processes, lockFile: lockFileAt(pluginRoot), mcpInstallers: Object.fromEntries(MCP_INSTALLERS.map((i) => [i.strategy, i])), managedProbe: createProbe({ fetch, start: processes.start, env: baseEnv(env) }), session: { fetch, start: processes.start, env: baseEnv(env) }, secrets: secretsOf(env, processes, io), packCapabilities: packCapabilitiesOf(env, io), projectSkills: projectSkillsAt(env, projectRoot, io), node: process.execPath, plugin: engineName(), platform: process.platform, arch: process.arch, log };
}

// The secret port connections read through: environment references, and this
// machine's OS secret store where it has one (./vault.mjs). Nothing reads a
// credential by binding it.
const secretsOf = (env, processes, io) => secretSource({ env, vault: osVault({ platform: process.platform, env, process: processes, io, dir: join(stateRooms(storeBase(env)).connections, "vault") }) });

// This checkout's generated playbooks (src/skill-factory/), as rows of the skills family -- read from the
// project's own room when something asks, under the automation settings a person set. A checkout with no
// store, or one that cannot be read, has none: it never fails the registry.
const projectSkillsAt = (env, projectRoot, io) => () => {
  try { return playbookRows(env, projectRoot, io); }
  catch { return []; }
};

function playbookRows(env, projectRoot, io) {
  const storeRoot = repositoryPaths(projectRoot, env)?.storeRoot;
  if (!storeRoot) return [];
  const values = effectiveOf([{ by: "machine", content: readAutomation(io, join(stateRooms(storeBase(env)).automation, "settings.json")).content }, { by: "project", content: readAutomation(io, join(storeRoot, "automation", "settings.json")).content }]).values;
  return projectSkillsOf({ paths: { storeRoot }, io }, values)();
}

// The readers a skill's pack ships, as registry rows: ready when a connection with a
// credential is set up. Listing them reads the connection store and nothing else --
// no credential, no network.
const packCapabilitiesOf = (env, io) => () => readerResources(connectionReader(stateRooms(storeBase(env)), io));

const detectionOf = (env, projectRoot) => detectionContext({ env, projectRoot, detectors: { ...RUNTIME_DETECTORS, "control-node": controlNodeDetector({ home: homedir(), list, supported, required }) } });

// A lock is a file the plugin ships under catalog/: read from there, by a path the catalog row named relative to it
// (src/tools/catalog.mjs pinnedLock), which stays inside.
const lockFileAt = (pluginRoot) => (rel) => {
  const path = contained(join(pluginRoot, "catalog"), join(pluginRoot, "catalog", rel));
  return { path, text: readFileSync(path, "utf8") };
};

const installersOf = (installIo, log) => ({ [archiveInstaller.strategy]: archiveInstaller, [pythonLockInstaller.strategy]: pythonLockInstaller, "node-dist": nodeDistInstaller({ supported, fetchJson: async (u) => (await got(u)).json(), fetchText: async (u) => (await got(u)).text(), fetchBytes: async (u) => Buffer.from(await (await got(u)).arrayBuffer()), io: installIo, log }) });

async function got(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}

function list(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}
