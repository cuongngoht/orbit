// A sandbox TOPOLOGY composed from discovery (ADR 0039): which containers an ISOLATED sandbox runs, from what each
// is made, what it is called on the task's network, and how its readiness is asked -- as a PLAN, pure, over what the
// project's own files already said.
//
// Nothing is invented and nothing a project's file says is RUN: a compose file is READ (its services' images,
// environment, commands and build contexts), never handed to a compose tool, so a host mount, a published port, a
// privilege, a network mode or a device it declares simply has no way to reach a container -- the spec this builds
// cannot express one. Three ordered tables decide, each first match wins and the last always answers:
//
//   IMAGE_SOURCES  what a node's image is: a person's setting, a compose image, a compose build, a Dockerfile in the
//                  component's directory, the catalog's image for what the component requires -- resolved to a
//                  content-addressed reference ALREADY on this machine, else a gap a person settles
//   NETWORK_MODES  how nodes find each other: by the names compose gave them (aliases on the task's internal
//                  network), or one shared namespace (a pod) for a project configured against localhost
//   READINESS      how "ready" is asked: a person's probe, the catalog's service port, the port a command declares,
//                  else only that it runs
//
// What is fingerprinted is what a person TRUSTS (`topology`): every node's pinned image (or the definition it is
// built from), its argument list, its mounts and its environment NAMES -- never a value, never the task's code.
import { posix } from "node:path";
import { canonicalJson, sha, short } from "../../hash.mjs";
import { startCommand } from "../components.mjs";
import { tokenize } from "../discover/commands.mjs";
import { portsOpenedBy } from "../readiness.mjs";
import { requirement, serviceByImage } from "../catalog.mjs";
import { startsKind } from "../vocab.mjs";

const PINNED = /(^sha256:[0-9a-f]{64}$)|(@sha256:[0-9a-f]{64}$)/;
const INTERPOLATED = /\$\{?[A-Za-z_]/;
const SLUG = /[^a-z0-9-]+/g;

export const slugOf = (text) => String(text).toLowerCase().replace(SLUG, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "node";

// ---- the compose services, read -------------------------------------------------------------------------------

const listOf = (v) => (Array.isArray(v) ? v : []);

// A compose `environment` is a mapping or a list of `NAME=value`; each entry is kept as a name and a literal value.
const envPairs = (env) => (Array.isArray(env) ? env.map((e) => String(e).split(/=(.*)/s).slice(0, 2)) : Object.entries(env ?? {}).map(([k, v]) => [k, v === null ? "" : String(v)]));

const commandOf = (cmd) => (Array.isArray(cmd) ? { argv: cmd.map(String) } : typeof cmd === "string" ? tokenize(cmd) : { argv: [] });

const buildOf = (path, b) => (typeof b === "string" ? { context: b, dockerfile: null } : b && typeof b === "object" ? { context: String(b.context ?? "."), dockerfile: b.dockerfile ? String(b.dockerfile) : null } : null);

const composeServiceOf = (path, name, svc) => ({ name, file: path, image: typeof svc?.image === "string" ? svc.image : null, build: buildOf(path, svc?.build), env: envPairs(svc?.environment), command: commandOf(svc?.command), dependsOn: Array.isArray(svc?.depends_on) ? svc.depends_on.map(String) : Object.keys(svc?.depends_on ?? {}) });

// -> every service every compose file declares, read from the parsed documents a caller hands in.
export const composeServices = (compose) => listOf(compose).flatMap((c) => Object.entries(c.doc?.services ?? {}).map(([name, svc]) => composeServiceOf(c.path, name, svc)));

// ---- nodes before images ----------------------------------------------------------------------------------------

const inClosure = (closure, list, key) => !closure || (closure[list] ?? []).includes(key);

const catalogPorts = (catalog, image) => serviceByImage(catalog, image ?? "")?.ports ?? [];

const serviceNode = (s, input) => ({ key: `service:${s.name}`, role: "service", name: s.name, alias: slugOf(s.name), service: serviceByImage(input.catalog, s.image ?? "")?.id ?? null, ports: catalogPorts(input.catalog, s.image), compose: s, component: null });

// A compose service with an image is a SERVER the project is defined with; one that only BUILDS is the project's own
// code, which discovery already knows as a component -- it is that component's image source, not a server.
const serviceNodes = (input) => composeServices(input.compose).filter((s) => s.image && inClosure(input.closure, "services", s.name)).map((s) => serviceNode(s, input));

const startable = (c) => startsKind(c.kind);

const componentNode = (c, input) => ({ key: c.key, role: "component", name: c.name, alias: slugOf(c.dir === "." ? c.name : c.dir), service: null, ports: portsOpenedBy(c, startCommand(c, input.settings.components?.[c.key]?.command ?? null).command ?? null), compose: null, component: c });

const componentNodes = (input) => input.view.components.filter((c) => startable(c) && inClosure(input.closure, "components", c.key)).map((c) => componentNode(c, input));

// ---- IMAGE_SOURCES ------------------------------------------------------------------------------------------------

// The compose service that BUILDS this component: its build context is the component's directory.
const composeBuildOf = (node, input) => composeServices(input.compose).find((s) => s.build && posix.normalize(posix.join(posix.dirname(s.file), s.build.context)) === posix.normalize(node.component.dir));

const dockerfileIn = (node, input) => listOf(input.dockerfiles).find((d) => posix.dirname(d.path) === posix.normalize(node.component.dir));

// What the catalog says an image for the component's runtime is: the requirement's row image, at its version.
function catalogImageOf(node, input) {
  const req = node.component.requirements.find((r) => requirement(input.catalog, r.requirement)?.images?.length && r.range);
  const row = req ? requirement(input.catalog, req.requirement) : null;
  return row ? `${row.images[0]}:${String(req.range).replace(/^[^0-9]*/, "").split(/[.\s<>=^~|-]/)[0]}` : null;
}

const asRef = (ref, source) => (ref ? { source, ref } : null);

export const IMAGE_SOURCES = [
  { name: "setting", for: ["component", "service"], source: (n, input) => asRef(input.settings.components?.[n.key]?.image ?? null, "setting") },
  { name: "compose-image", for: ["service"], source: (n) => asRef(n.compose?.image ?? null, "compose-image") },
  { name: "compose-build", for: ["component"], source: (n, input) => ((s) => (s ? { source: "compose-build", build: { context: s.build.context, dockerfile: s.build.dockerfile, file: s.file } } : null))(composeBuildOf(n, input)) },
  { name: "dockerfile", for: ["component"], source: (n, input) => ((d) => (d ? { source: "dockerfile", build: { context: n.component.dir, dockerfile: posix.basename(d.path), file: d.path, digest: d.digest ?? null } } : null))(dockerfileIn(n, input)) },
  { name: "catalog", for: ["component"], source: (n, input) => asRef(catalogImageOf(n, input), "catalog") },
  { name: "none", for: ["component", "service"], source: () => ({ source: "none" }) },
];

const imageSourceOf = (node, input) => IMAGE_SOURCES.filter((r) => r.for.includes(node.role)).map((r) => r.source(node, input)).find(Boolean);

// The refs a topology would run, for the caller to resolve to what is ALREADY on this machine (src/runtime/isolation/
// docker.mjs imageDigest): pure here, so the composition below is too.
export const imageRefs = (input) => [...new Set([...serviceNodes(input), ...componentNodes(input)].map((n) => imageSourceOf(n, input)).filter((s) => s.ref).map((s) => s.ref))];

const pinnedOf = (ref, input) => (PINNED.test(String(ref)) ? ref : (input.resolved?.[ref] ?? null));

const NO_IMAGE = (node) => `${node.key}: nothing says what to run it from — no compose image or build, no Dockerfile in ${node.component?.dir ?? "its directory"}, no catalog image for what it requires; a person sets one (runtime configure --component=${node.key} …) or adds a Dockerfile`;

const NOT_HERE = (node, ref) => `${node.key}: ${ref} is not on this machine, and a sandbox never pulls behind a person's back — a person pulls it (or pins it by digest), then prepares again`;

function imaged(node, input) {
  const src = imageSourceOf(node, input);
  if (src.source === "none") return { ...node, image: src, gap: { needs: "person", say: NO_IMAGE(node) } };
  if (src.build) return { ...node, image: src };
  const pinned = pinnedOf(src.ref, input);
  return pinned ? { ...node, image: { ...src, pinned } } : { ...node, image: src, gap: { needs: "person", say: NOT_HERE(node, src.ref) } };
}

// ---- what each node runs and is handed ---------------------------------------------------------------------------

const envProblem = (node) => node.compose?.env.find(([, v]) => INTERPOLATED.test(String(v)));

const INTERPOLATION = (node, name) => `${node.key}: ${name} is interpolated from this machine's environment in ${node.compose.file}, and a sandbox never hands a container this machine's environment — a person sets it (runtime configure --component=… --env=${name}) or the file names a literal`;

function environment(node, input) {
  const bad = envProblem(node);
  const names = input.settings.components?.[node.key]?.env ?? [];
  if (bad) return { ...node, gap: node.gap ?? { needs: "person", say: INTERPOLATION(node, bad[0]) }, env: { names, values: {} } };
  return { ...node, env: { names, values: Object.fromEntries(node.compose?.env ?? []) } };
}

// A component runs from a catalog image over the task's workspace, with the command its files declare; one with an
// image or a build of its own runs what that image says to run. A service runs its image's own command unless compose
// names one.
const ARGV = [
  { when: (n) => n.role === "component" && ["catalog", "setting"].includes(n.image?.source), argv: (n, input) => startCommand(n.component, input.settings.components?.[n.key]?.command ?? null).command?.argv ?? null, mount: true },
  { when: (n) => n.role === "service" && n.compose?.command?.argv?.length, argv: (n) => n.compose.command.argv, mount: false },
  { when: () => true, argv: () => [], mount: false },
];

const UNSAFE = (node) => `${node.key}: its compose command cannot be run without a shell (${node.compose.command.unsafe}), and a sandbox never uses one`;

function commanded(node, input) {
  const row = ARGV.find((r) => r.when(node));
  const argv = row.argv(node, input);
  if (node.compose?.command?.unsafe) return { ...node, argv: [], gap: node.gap ?? { needs: "person", say: UNSAFE(node) } };
  return argv === null ? { ...node, argv: [], gap: node.gap ?? { needs: "person", say: `${node.key}: no file declares how to start it` } } : { ...node, argv, mountsWorkspace: row.mount, workdir: row.mount ? workdirOf(node, input) : null };
}

const workdirOf = (node, input) => posix.join(input.catalog.isolation.appMount ?? "/work/app", startCommand(node.component, input.settings.components?.[node.key]?.command ?? null).command?.cwd ?? ".");

// ---- NETWORK_MODES and READINESS ----------------------------------------------------------------------------------

export const NETWORK_MODES = [
  { name: "setting", when: (input) => input.policy.isolation.networkMode !== "auto", mode: (input) => input.policy.isolation.networkMode },
  { name: "compose", when: (input) => composeServices(input.compose).length > 0, mode: () => "aliases" },
  { name: "localhost", when: () => true, mode: () => "pod" },
];

export const READINESS = [
  { name: "person", when: (n, input) => Boolean(input.settings.components?.[n.key]?.readiness), probe: (n, input) => ({ kind: input.settings.components[n.key].readiness.kind, port: Number(input.settings.components[n.key].readiness.target) || null, source: "human" }) },
  { name: "catalog", when: (n) => n.role === "service" && n.ports.length > 0, probe: (n) => ({ kind: "tcp", port: n.ports[0], source: "catalog" }) },
  { name: "declared", when: (n) => n.role === "component" && n.ports.length > 0, probe: (n) => ({ kind: "tcp", port: n.ports[0], source: "discovered" }) },
  { name: "running", when: () => true, probe: () => ({ kind: "running", port: null, source: "none" }) },
];

const readied = (node, input) => ({ ...node, readiness: READINESS.find((r) => r.when(node, input)).probe(node, input) });

// In a pod every node shares one network namespace, so two that listen on one port cannot both start: BLOCKED,
// both named, never a port moved.
function collisions(nodes) {
  const by = new Map();
  for (const n of nodes) for (const p of n.ports) by.set(p, [...(by.get(p) ?? []), n.key]);
  return [...by.entries()].filter(([, keys]) => keys.length > 1).map(([port, keys]) => ({ needs: "person", say: `${keys.join(" and ")} both listen on port ${port}, and in one shared namespace only one can — a person gives one of them another port, or sets the isolation network mode to aliases` }));
}

// ---- the topology --------------------------------------------------------------------------------------------------

const labelsOf = (names) => ({ "orbit.task": names.task, "orbit.checkout": names.checkout, "orbit.env": names.envId });

export const networkNameOf = (envId) => `orbit-${short(envId, 12)}`;

const shaped = (node, input) => readied(commanded(environment(imaged(node, input), input), input), input);

// What a person TRUSTS, as one print: each node's image (or the file it is built from), argv, mounts and env NAMES.
export const topologyFingerprint = (t) => sha(canonicalJson({ mode: t.mode, nodes: t.nodes.map((n) => ({ key: n.key, role: n.role, image: n.image.pinned ?? n.image.build ?? null, argv: n.argv, mounts: n.mountsWorkspace ? ["workspace"] : [], env: [...n.env.names, ...Object.keys(n.env.values)].sort() })) }));

// -> { mode, network, nodes, gaps, fingerprint }. `input`: { view, catalog, settings, policy, names, closure, compose,
// dockerfiles, resolved }.
export function composed(input) {
  const mode = NETWORK_MODES.find((r) => r.when(input)).mode(input);
  const nodes = [...serviceNodes(input), ...componentNodes(input)].map((n) => shaped(n, input));
  const gaps = [...nodes.filter((n) => n.gap).map((n) => ({ key: n.key, ...n.gap })), ...(mode === "pod" ? collisions(nodes) : [])];
  const t = { mode, network: { name: networkNameOf(input.names.envId), labels: labelsOf(input.names) }, nodes, gaps };
  return { ...t, fingerprint: topologyFingerprint(t) };
}
