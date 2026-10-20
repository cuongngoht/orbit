// A DECLARED PLAYBOOK's whole world, for a test (0.0.4): the coordinator on the real task door (automationWorld), the
// REAL skill factory on a temp store, the REAL resource registry and resolver over it, the REAL capability pipeline
// with a project's own capabilities, and the REAL MCP broker in front of a managed server whose far end is a function.
// Nothing between a workflow step and the provider is faked: what a test makes up is only what answers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapabilityRegistry } from "../../src/capability/registry.mjs";
import { resolved } from "../../src/knowledge/verify.mjs";
import { setEnabled } from "../../src/mcp/manage.mjs";
import { PROVIDERS } from "../../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../../src/resources/registry.mjs";
import { scaffold } from "../../src/skill-factory/lifecycle.mjs";
import { realIo } from "../../src/store/io.mjs";
import { fingerprintOf, resourceOf } from "../../src/work/bind.mjs";
import { engineVersion } from "../../src/version.mjs";
import { invokeBound } from "../../src/work/invoke.mjs";
import { factoryPort, gapPort, projectSkillsOf } from "../../skills/orbit-help/factory.mjs";
import { automationWorld } from "./automation.mjs";
import { fakeContext } from "./context.mjs";
import { managedMcp } from "./managed-mcp.mjs";
import { fakeProcess } from "./process.mjs";
import { fakeTools } from "./tools.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SKILL_ID = "release-readiness-verification";
export const PROVIDES = "release.readiness.verification";

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {} } });

// A managed server listing one read-only `search` tool and one that writes, answering `reply(args)`; it keeps every
// tools/call it was sent, so a test can see what a step bound into it.
export function notesServer({ reply = (args) => ({ hits: [{ title: `notes for ${args.query}`, url: "https://notes.example/r/1" }] }), hang = false } = {}) {
  const calls = [];
  const state = { hang };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!body.id) return response("");
    if (body.method === "initialize") return response({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }, { name: "publish" }] } });
    calls.push(body.params);
    if (state.hang) return new Promise(() => {});
    return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(reply(body.params.arguments ?? {})) }] } });
  };
  return { fetch, calls, state };
}

// The moment a process dies: every port the run it carried still holds refuses from now on, so nothing it would
// still do reaches the store -- and the ports of the NEXT process, over the same store, are handed back, with nothing
// alive behind the room's runner.
export function crashed(s) {
  const alive = { ...s.ports, liveness: () => false };
  const gone = () => {
    throw new Error("the process that ran this is gone");
  };
  Object.assign(s.ports, { task: { ...s.ports.task, apply: gone }, roomOf: () => ({ read: gone, write: gone, remove: gone }), lock: gone });
  return { ...s, ports: alive };
}

// A project capability that reads release evidence: how many items, the first one's id, and -- when asked -- the
// record an owner keeps for it. It counts what it was asked.
export function evidenceCapability({ items = ["REL-7"], record = null, mutates = false, fail = null } = {}) {
  const asked = [];
  return { asked, cap: { id: "acme.evidence", apiVersion: "orbit.capability/v1", doc: "release evidence", provides: ["release.evidence.read"], ...(mutates ? { mutates: true } : {}), inputSchema: { q: { type: "string", esc: "text", doc: "what the evidence is for" } }, required: ["q"], invoke: (ext, input) => {
    asked.push(input);
    if (fail) throw fail;
    return { count: items.length, first: items[0] ?? null, ...(record ? { record } : {}) };
  } } };
}

export const SKILL_MD = `---
name: ${SKILL_ID}
description: Check a release is ready by reading its evidence and the release notes it names, and say what still needs a person.
user-invocable: false
---

# Release readiness verification

The engine runs this playbook's declared workflow step by step:

1. Read the release evidence for the objective.
2. Search the release notes for the first item the evidence names.

Each step is reported as its receipt shows it; nothing here is verified unless an owner's record proves it.
`;

// The two-step workflow: evidence through a project capability, then the notes through a managed server, the
// second reading what the first answered.
export const workflowOf = (over = {}) => ({
  api: "orbit.skill-workflow/v1",
  bounds: { maxCalls: 8 },
  steps: [
    { id: "evidence", capability: "release.evidence.read", input: { q: { from: "context.objective" } }, outputs: { count: { type: "number", path: "count" }, first: { type: "string", path: "first" } }, success: [{ output: "count", op: "gte", value: 1 }], ...(over.evidence ?? {}) },
    { id: "notes", capability: "release.notes.search", tool: "search", after: ["evidence"], input: { query: { from: "steps.evidence.first" } }, outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }], ...(over.notes ?? {}) },
    ...(over.more ?? []),
  ],
});

// opts: server · evidence (evidenceCapability) · settings · investigations · project · session · base (a factory room
// another world already holds: a second session of the same project) · mcpProvides · mcpEnv
export function skillWorld(t, opts = {}) {
  const o = automationWorld(t, { settings: opts.settings, project: opts.project, investigations: opts.investigations, session: opts.session });
  const base = opts.base ?? mkdtempSync(join(tmpdir(), "orbit-skill-run-"));
  if (!opts.base) t.after(() => rmSync(base, { recursive: true, force: true }));
  const server = opts.server ?? notesServer();
  const mcp = managedMcp(t, { server, provides: opts.mcpProvides ?? ["release.notes.search"], ...(opts.mcpEnv ? { env: opts.mcpEnv } : {}) });
  const evidence = opts.evidence ?? evidenceCapability();
  const registry = createCapabilityRegistry();
  registry.register(evidence.cap, "acme");
  const h = { paths: { storeRoot: base }, io: realIo() };
  const values = () => o.ports.settings().values;
  const effective = () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => registry.list(), packCapabilities: () => [], tools: () => [], mcp: () => mcp.entries(), projectSkills: projectSkillsOf(h, values) }, PROVIDERS);
  const resolve = (cap) => resolved([{ capability: cap, proves: { subject: cap } }], effective()).results[0];
  const factory = factoryPort(h, values, resolve, { pluginRoot: REPO });
  const w = { effective, get mcp() { return mcp.context(); }, capabilityContext: { ...fakeContext(), capabilities: registry, process: fakeProcess(), tools: fakeTools({}) }, host: "laptop-a", session: "sess-1" };
  const calls = [];
  Object.assign(o.ports, { resolve, gapOf: gapPort(h, resolve), factory, invoke: { bind: (r) => ((res) => (res ? { provider: r.provider, fingerprint: fingerprintOf(res) } : null))(resourceOf(effective(), r?.provider)), call: async (binding, ask) => (calls.push({ provider: binding.provider.key, ask }), invokeBound(w, binding, ask)) } });
  return { ...o, base, h, mcp, server, evidence, registry, effective, resolve, factory, calls, disable: (id) => setEnabled(mcp.manage, id, false) };
}

// A declared playbook registered the way a workflow's own steps would: scaffolded for its capability, its SKILL.md
// and workflow.json put into the draft, then held to the contract and registered.
export async function declared(s, { wf = workflowOf(), text = SKILL_MD, values = null } = {}) {
  const v = values ?? s.ports.settings().values;
  const draft = scaffold(s.factory.store, { provides: PROVIDES, values: v, engineVersion: engineVersion() });
  s.factory.put({ id: draft.id, name: "SKILL.md", text });
  s.factory.put({ id: draft.id, name: "workflow.json", text: JSON.stringify(wf, null, 2) });
  return s.factory.register(draft.id);
}

// The settings that let a test register a second version over an active first one: reuse-first off.
export const again = (s) => ({ ...s.ports.settings().values, skillFactory: { ...s.ports.settings().values.skillFactory, reuseFirst: false } });

export const spec = { objective: "Check the release is ready", intent: "release", capabilities: [PROVIDES] };

export const receiptsOf = (s, id, domain) => s.w.view(id).receipts.filter((r) => r.domain === domain);

export const eventsOf = (s, id, domain) => s.ports.task.events(id).filter((e) => e.kind === "receipt" && e.domain === domain);
