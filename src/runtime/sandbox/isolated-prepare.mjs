// Preparing an ISOLATED sandbox (ADR 0038, 0039): the steps src/runtime/sandbox/prepare.mjs runs in their place when
// a person's policy says `isolation.mode: required`, and that do nothing otherwise.
//
//   PLACEMENTS     every component that starts runs in a container of its own on the task's network
//   CONNECTIVITY   a server outside the sandbox cannot be reached from an internal network: a component that needs
//                  one is a person's to settle, never a hole in the network
//   TOPOLOGY       what runs from what, composed from discovery (src/runtime/sandbox/topology.mjs), under a usable
//                  isolation provider and a worker image pinned by digest -- autonomously (0.2.0): the topology's and
//                  the worker's fingerprints are kept as evidence of exactly what ran, never waited on
//   NETWORK        the task's internal network, labelled, receipted as an operation before it exists
//   SERVICES       the pod (a project configured against localhost), the images a component is built from, and
//                  the servers the project is defined with -- a session receipt per container, BEFORE it exists
//   READINESS      each server answers on the task's network, asked from inside it; ready is never a verdict
//   ATTEST         the isolation profile holds of everything that runs (src/runtime/sandbox/isolation.mjs)
//
// Each step answers `go` or `halt` with who has to act, the way every preparation step does.
import { targetsOf } from "../connectivity/targets.mjs";
import { parseYaml } from "../discover/yaml-lite.mjs";
import { isCompose, isDockerfile } from "../environment/container-files.mjs";
import { usableIsolation } from "../isolation/index.mjs";
import { look } from "../understanding.mjs";
import { startsKind } from "../vocab.mjs";
import { attestedNow, unattested } from "./isolation.mjs";
import { START_WAIT_MS, builtImage, ensuredNetwork, readyNode, specOf, startedNode } from "./network.mjs";
import { effectivePolicy } from "./policy.mjs";
import { buildScopes, composed, imageRefs } from "./topology.mjs";

const policyOf = (c) => effectivePolicy(c.state.settings).policy;

// ---- what the workspace's own files say -------------------------------------------------------------------------------

const modelOf = (ctx) => look(ctx).model ?? {};

export const composeOf = (ctx) => (modelOf(ctx).inventory ?? []).filter(isCompose).map((path) => ({ path, doc: parseYaml(ctx.source.read(path) ?? "").value }));

export const dockerfilesOf = (ctx) => (modelOf(ctx).inventory ?? []).filter(isDockerfile).map((path) => ({ path }));

// ---- PLACEMENTS and CONNECTIVITY ---------------------------------------------------------------------------------------

function placed(c, { go, halt }) {
  const keys = c.state.view.components.filter((x) => startsKind(x.kind)).map((x) => x.key);
  if (!keys.length && !composeOf(c.ctx).length) return halt("capability", "this workspace declares nothing to start: a library or a command-line tool has no application to run and verify live");
  return go({ placements: Object.fromEntries(keys.map((k) => [k, "isolated"])) });
}

const OUTSIDE = (targets) => `${targets.map((t) => t.label ?? t.id).join(", ")} ${targets.length === 1 ? "is a server" : "are servers"} outside the sandbox that a component needs, and an isolated sandbox reaches nothing beyond its own network — a person runs it as a service of the workspace (a compose service), or prepares this task's sandbox without isolation`;

function reached(c, { go, halt }) {
  const outside = targetsOf(c.state.settings).filter((t) => t.requiredBy.some((k) => k in (c.state.placements ?? {})));
  return outside.length ? halt("person", OUTSIDE(outside)) : go();
}

// ---- TOPOLOGY -----------------------------------------------------------------------------------------------------------

const namesOf = (ctx) => ({ task: ctx.task, checkout: ctx.checkout, envId: ctx.envId });

// What the workspace's index says of every file a build would be made from, asked fresh each time: a scope the
// source port cannot answer for is absent, and a build resting on it is a gap.
const fingerprintsOf = (ctx, scopes) => (scopes.length ? (ctx.source.fingerprints?.(scopes) ?? {}) : {});

function inputOf(c, policy) {
  const input = { view: c.state.view, catalog: c.ctx.catalog, settings: c.state.settings, policy, names: namesOf(c.ctx), closure: c.closure, compose: composeOf(c.ctx), dockerfiles: dockerfilesOf(c.ctx) };
  return { ...input, fingerprints: fingerprintsOf(c.ctx, buildScopes(input)) };
}

const resolvedOf = (iso, input, deps) => Object.fromEntries(imageRefs(input).map((ref) => [ref, iso.imageDigest(ref, deps)]));

export const digestOf = (ref) => /sha256:([0-9a-f]{64})/.exec(String(ref ?? ""))?.[1] ?? null;

// What the provider says it cannot hand a container of the environment each node names.
const envRefusals = (iso, t) => t.nodes.flatMap((n) => iso.envProblems(n.env ?? {}).map((why) => `${n.key}: ${why}`));

const TOPOLOGY_GATES = [
  { fails: (t) => t.gaps.length > 0, needs: (t) => (t.gaps.some((g) => g.needs === "person") ? "person" : "capability"), say: (t) => t.gaps.map((g) => g.say).join("\n") },
  { fails: (t) => !t.nodes.length, needs: () => "capability", say: () => "nothing in the workspace runs in a container: no component starts and no compose service names an image" },
  { fails: (t, p, iso) => envRefusals(iso, t).length > 0, needs: () => "person", say: (t, p, iso) => `a container would be handed an environment it may not be: ${envRefusals(iso, t).join("; ")} — a person sets the names differently, or the file names a literal` },
  { fails: (t, p) => !p.isolation.workerImage, needs: () => "person", say: () => "no test worker image is set: a person names one, pinned by digest, in Orbit Control (Runtime → Sandbox policy → isolation)" },
];

const attestOf = (c, policy, t) => ({ network: t.network.name, podId: null, labels: t.network.labels, forbidden: [c.ctx.storeBase, c.ctx.env?.HOME, c.ctx.primaryRoot].filter(Boolean), pluginTarget: c.ctx.catalog.isolation.worker.plugin, egress: policy.isolation.egress });

export const placeOf = (c, policy, t) => ({ names: namesOf(c.ctx), paths: { workspace: c.ctx.root, plugin: c.ctx.pluginRoot ?? null }, policy, catalog: c.ctx.catalog, fingerprint: t.fingerprint, tree: c.state.tree ?? c.ctx.sandboxDoc?.()?.source?.tree ?? null, attest: attestOf(c, policy, t), specs: [] });

export const endpointsOf = (t) => t.nodes.filter((n) => n.role === "component" && n.ports.length).map((n) => ({ component: n.key, kind: "tcp", alias: n.alias, port: n.ports[0], source: "network" }));

// The topology as the workspace and a person's policy say it NOW, gated: -> { iso, topology, place } | { needs, say }.
// What preparing composes, and what a start and a dispatch compose again to be sure they act on the same thing.
export function composedNow(c) {
  const policy = policyOf(c);
  const usable = usableIsolation(policy.isolation.provider, c.ctx.isolation, c.deps);
  if (!usable.provider) return { needs: "capability", say: usable.gap };
  const input = inputOf(c, policy);
  return gated(c, policy, usable.provider, composed({ ...input, resolved: resolvedOf(usable.provider, input, c.deps) }));
}

function gated(c, policy, iso, t) {
  const gate = TOPOLOGY_GATES.find((g) => g.fails(t, policy, iso));
  return gate ? { needs: gate.needs(t), say: gate.say(t, policy, iso) } : { iso, topology: t, place: placeOf(c, policy, t) };
}

function topology(c, { go, halt }) {
  const now = composedNow(c);
  return now.needs ? halt(now.needs, now.say) : go({ iso: now.iso, topology: now.topology, place: now.place, endpoints: endpointsOf(now.topology) });
}

// ---- NETWORK ------------------------------------------------------------------------------------------------------------

function network(c, { go, halt }) {
  const op = c.ops.begin("network");
  const r = ensuredNetwork(c.state.iso, c.state.topology, c.deps);
  c.ops.settle(op, r.ok ? "DONE" : "FAILED", r.because ?? null);
  return r.ok ? go() : halt("environment", r.because);
}

// ---- SERVICES -----------------------------------------------------------------------------------------------------------

const podNode = (c) => ({ key: "pod", role: "pod", alias: "pod", image: { pinned: c.state.place.policy.isolation.workerImage }, argv: c.ctx.catalog.isolation.pod.argv, env: { names: [], values: {} }, ports: [], readiness: { kind: "running", port: null } });

// What a container may hold in its environment: the names its image sets and the names its spec declared.
const withAllowed = (iso, node, spec, deps) => ({ name: spec.name, key: node.key, role: node.role, mounts: spec.mounts, allowedEnv: [...iso.imageEnv(spec.image, deps), ...spec.env.names, ...Object.keys(spec.env.values)] });

// One container of the topology up, its receipt written first, its spec kept for the attestation.
function oneUp(c, node, kind) {
  const spec = specOf(node, c.state.topology, c.state.place);
  const op = c.ops.begin("service");
  const r = startedNode(c.ctx, c.state.iso, node, spec, { kind, tree: c.state.tree, topology: c.state.topology.fingerprint }, c.deps);
  c.ops.settle(op, r.ok ? "DONE" : "FAILED", r.because ?? null);
  return r.ok ? { ok: true, session: r.session, spec: withAllowed(c.state.iso, node, spec, c.deps) } : { ok: false, because: r.because };
}

function podded(c) {
  if (c.state.topology.mode !== "pod") return { ok: true, podId: null, specs: [] };
  const up = oneUp(c, podNode(c), "pod");
  return up.ok ? { ok: true, podId: up.session.container.id, specs: [up.spec] } : up;
}

function builtAll(c) {
  const nodes = [];
  for (const n of c.state.topology.nodes) nodes.push(builtImage(c.state.iso, n, c.state.place, c.deps));
  const failed = nodes.find((r) => !r.ok);
  return failed ? { ok: false, because: failed.because } : { ok: true, topology: { ...c.state.topology, nodes: nodes.map((r) => r.node) } };
}

function servicesUp(c) {
  const specs = [];
  for (const n of c.state.topology.nodes.filter((x) => x.role === "service")) {
    const up = oneUp(c, n, "service");
    if (!up.ok) return up;
    specs.push(up.spec);
  }
  return { ok: true, specs };
}

function services(c, { go, halt }) {
  const pod = podded(c);
  if (!pod.ok) return halt("environment", pod.because);
  const built = builtAll(c);
  if (!built.ok) return halt("environment", built.because);
  return servicesThen(c, { ...c.state.place, attest: { ...c.state.place.attest, podId: pod.podId }, specs: pod.specs }, built.topology, { go, halt });
}

function servicesThen(c, place, topology, { go, halt }) {
  c.state = { ...c.state, place, topology };
  const up = servicesUp(c);
  return up.ok ? go({ place: { ...place, specs: [...place.specs, ...up.specs] } }) : halt("environment", up.because);
}

// ---- READINESS and ATTEST ---------------------------------------------------------------------------------------------

const readyOf = (c) => ({ ctx: c.ctx, iso: c.state.iso, topology: c.state.topology, place: c.state.place, deps: c.deps });

async function readiness(c, { go, halt }) {
  const answers = [];
  for (const n of c.state.topology.nodes.filter((x) => x.role === "service")) answers.push(await readyNode(n, readyOf(c), c.deps.waitMs ?? START_WAIT_MS));
  const stuck = answers.filter((a) => a.state !== "READY");
  return stuck.length ? halt("environment", stuck.map((a) => `${a.key} is not ready on the task's network: ${a.because}`).join("\n")) : go({ readiness: answers });
}

const nodesKept = (t) => t.nodes.map((n) => ({ key: n.key, role: n.role, alias: n.alias, ports: n.ports, image: n.image.pinned ?? n.image.built ?? null, readiness: n.readiness }));

const recordOf = (c, result) => ({ mode: "required", provider: c.state.iso.id, attested: result.ok, at: result.at, because: result.ok ? "every row of the isolation profile holds" : unattested(result), network: c.state.topology.network, podId: c.state.place.attest.podId, topology: { mode: c.state.topology.mode, fingerprint: c.state.topology.fingerprint, nodes: nodesKept(c.state.topology) }, rows: result.rows.length, egress: result.egress });

// What every container of the topology was created FROM, for the attestation: the pod and the services this
// preparation started, and each component as its node says it starts -- so a component already running (a sandbox is
// prepared again at every start) is held to its own declared mounts and names, never to none.
const specsOf = (c) => [...c.state.place.specs, ...c.state.topology.nodes.filter((n) => n.role === "component").map((n) => withAllowed(c.state.iso, n, specOf(n, c.state.topology, c.state.place), c.deps))];

async function attest(c, { go, halt }) {
  const op = c.ops.begin("attest");
  const result = await attestedNow(c.ctx, c.state.iso, c.state.topology, { ...c.state.place, specs: specsOf(c) }, c.deps);
  c.ops.settle(op, result.ok ? "DONE" : "FAILED", result.ok ? null : unattested(result));
  return result.ok ? go({ isolation: recordOf(c, result) }) : halt("environment", `the isolation profile does not hold, so no generated test may run here: ${unattested(result)}`);
}

export const isolatedSteps = { placed, reached, topology, network, services, readiness, attest };
