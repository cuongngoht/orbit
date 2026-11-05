// THE REGISTRY HERE, composed ONE way for the two hooks that read it (0.5.0, B22 M3): the prompt router on every prompt
// (cli/router-hook.mjs) and a session's start (cli/learn-hook.mjs, the capability line). The plugin's catalogs and tree,
// Orbit's records in the machine store (the MCP servers it manages, the host's configuration as last observed, the last
// tool detection), the project's registered capabilities, its generated playbooks and the readers its packs bind --
// so a session's capability line and a prompt's routing can never count two registries. Not an entry point: a
// composition helper, loaded by each hook when it needs the registry and not before.
//
// Local reads only: no network, no MCP handshake, no child process, no Control server, and nothing written. A protocol-2
// host has no native agents, so there only a skill is runtime-ready.
//
// Beside the registry, the facts the strategy table reads (src/routing/strategy.mjs) -- automation's own `workflowOf`
// answer, the host's row of catalog/hosts.json, this checkout's open work -- for the router's hook and for a command that
// asks the router explicitly (`resources.mjs route`, Antigravity's routing), so both decide over the same facts.
import { join } from "node:path";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { routedWorkflow } from "../src/automation/workflows.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { realIo } from "../src/store/io.mjs";
import { createWorks } from "../src/work/store.mjs";
import { openWorkOf } from "../src/work/track/open.mjs";
import { projectSkillsOf } from "../skills/orbit-help/factory.mjs";
import { connectionReader, readerResources } from "../skills/orbit-requirements/bind.mjs";

// The automation settings a person set, machine then project, narrowed -- read, never written.
export function automationValues(rooms, storeRoot) {
  const io = realIo();
  const docs = [{ by: "machine", content: readAutomation(io, join(rooms.automation, "settings.json")).content }, ...(storeRoot ? [{ by: "project", content: readAutomation(io, join(storeRoot, "automation", "settings.json")).content }] : [])];
  return effectiveOf(docs).values;
}

// This project's generated playbooks, as the skills family lists them -- the same rows Control and a workflow see.
const playbooksOf = (storeRoot, values) => (storeRoot && values ? projectSkillsOf({ paths: { storeRoot }, io: realIo() }, values)() : []);

// ---- the strategy's facts ----------------------------------------------------------------------------------------

// Automation's own answer for a classification: which coordinated workflow would take it (its id), or "none".
export const workflowOf = (classification) => routedWorkflow(classification).id;

// The host's row (catalog/hosts.json): an agent is dispatched only where the host has native agents.
export const hostRowOf = (pluginRoot, id) => readCatalog(realIo(), catalogFile(pluginRoot, "hosts")).hosts.find((h) => h.id === id) ?? null;

// This checkout's open work the prompt could mean -- only when it names a reference or says to continue: an ordinary
// prompt reads no journal. at: { storeRoot, checkout, session (the hashed host session) }
export const openWorkHere = (at, ask) => (at.checkout && at.storeRoot && (ask.refs.length || ask.continued) ? openWorkOf(createWorks(at.storeRoot, realIo()), { ...ask, session: taskSessionMark(at.session), checkout: at.checkout }) : null);

// b: { pluginRoot, rooms, env, plugin, protocol, caps, storeRoot, automation }
export const resourcesHere = (b) => effectiveResourcesOf({ pluginRoot: b.pluginRoot, rooms: b.rooms, io: realIo(), env: b.env, plugin: b.plugin, platform: process.platform, arch: process.arch, componentReady: b.protocol === 2 ? (c) => c.kind === "skill" : undefined, capabilities: () => b.caps ?? [], projectSkills: () => playbooksOf(b.storeRoot, b.automation), packCapabilities: () => readerResources(connectionReader(b.rooms, realIo())) });
