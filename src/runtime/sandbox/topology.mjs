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
//                  content-addressed reference ALREADY on this machine, else a gap a person settles. A build is
//                  only ever from the workspace's own TRACKED files (BUILD_GAPS), fingerprinted by content
//   NETWORK_MODES  how nodes find each other: by the names compose gave them (aliases on the task's internal
//                  network), or one shared namespace (a pod) for a project configured against localhost
//   READINESS      how "ready" is asked: a person's probe, the catalog's service port, the port a command declares,
//                  else only that it runs
//
// What is fingerprinted is what a person TRUSTS (`topology`): every node's pinned image (or the definition it is
// built from: its Dockerfile and the ignore files that decide what the build is sent, by CONTENT, and how the build
// may reach a network), its argument list, its mounts and its environment NAMES -- never a value, and never the
// task's code, EXCEPT that a build a person let reach a network is trusted with every tracked file it is sent.
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

const buildOf = (path, b) => (typeof b === "string" ? { context: b, dockerfile: null, inline: false } : b && typeof b === "object" ? { context: String(b.context ?? "."), dockerfile: b.dockerfile ? String(b.dockerfile) : null, inline: b.dockerfile_inline !== undefined } : null);

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

// A compose build in the WORKSPACE's words: its context relative to the compose file, its Dockerfile relative to the
// context, each normalized -- so `deploy/../app` and `app` are one directory, and one that leaves is said to leave.
const contextOf = (s) => posix.normalize(posix.join(posix.dirname(s.file), s.build.context));

const composeBuildDef = (s) => ((context) => ({ context, dockerfile: posix.isAbsolute(s.build.dockerfile ?? "") ? s.build.dockerfile : posix.normalize(posix.join(context, s.build.dockerfile ?? "Dockerfile")), file: s.file, inline: s.build.inline }))(contextOf(s));

// The compose service that BUILDS this component: its build context is the component's directory.
const composeBuildOf = (node, input) => composeServices(input.compose).find((s) => s.build && contextOf(s) === posix.normalize(node.component.dir));

// A Dockerfile in the component's own directory -- `Dockerfile` itself before any other, and never an ignore file a
// build reads beside one.
const dockerfileIn = (node, input) => ((mine) => mine.find((d) => posix.basename(d.path) === "Dockerfile") ?? mine[0])(listOf(input.dockerfiles).filter((d) => posix.dirname(d.path) === posix.normalize(node.component.dir) && !d.path.endsWith(".dockerignore")));

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
  { name: "compose-build", for: ["component"], source: (n, input) => ((s) => (s ? { source: "compose-build", build: composeBuildDef(s) } : null))(composeBuildOf(n, input)) },
  { name: "dockerfile", for: ["component"], source: (n, input) => ((d) => (d ? { source: "dockerfile", build: { context: posix.normalize(n.component.dir), dockerfile: d.path, file: d.path, inline: false } } : null))(dockerfileIn(n, input)) },
  { name: "catalog", for: ["component"], source: (n, input) => asRef(catalogImageOf(n, input), "catalog") },
  { name: "none", for: ["component", "service"], source: () => ({ source: "none" }) },
];

const imageSourceOf = (node, input) => IMAGE_SOURCES.filter((r) => r.for.includes(node.role)).map((r) => r.source(node, input)).find(Boolean);

const nodesOf = (input) => [...serviceNodes(input), ...componentNodes(input)];

// The refs a topology would run, for the caller to resolve to what is ALREADY on this machine (src/runtime/isolation/
// docker.mjs imageDigest): pure here, so the composition below is too.
export const imageRefs = (input) => [...new Set(nodesOf(input).map((n) => imageSourceOf(n, input)).filter((s) => s.ref).map((s) => s.ref))];

// ---- what a build is made from ------------------------------------------------------------------------------------

const escapes = (rel) => posix.isAbsolute(String(rel)) || rel === ".." || String(rel).startsWith("../");

const ignoreOf = (context) => (context === "." ? ".dockerignore" : `${context}/.dockerignore`);

// The scopes a caller fingerprints for a build (src/frontend fingerprints: mode, blob and path of every tracked file
// under each, and how many edits the index has not taken): its Dockerfile, the two ignore files that decide what the
// build is sent, the context, and the Dockerfile's own directory.
const scopesOf = (b) => [b.dockerfile, ignoreOf(b.context), `${b.dockerfile}.dockerignore`, b.context, posix.dirname(b.dockerfile)];

export const buildScopes = (input) => [...new Set(nodesOf(input).map((n) => imageSourceOf(n, input).build).filter((b) => b && !escapes(b.context) && !escapes(b.dockerfile)).flatMap(scopesOf))];

const buildNetworkOf = (input) => input.policy?.isolation?.buildNetwork ?? "none";

// Ordered: the first reason an image cannot be built from what a person would trust. A file outside the workspace, an
// inline Dockerfile, one the index does not hold, or an edit nobody recorded (an unknown count is not none) would all
// build something no fingerprint covers.
const BUILD_GAPS = [
  { fails: (b) => b.inline, needs: "person", say: (n) => `${n.key}: its compose build writes its Dockerfile inline, and a sandbox builds only from a file the workspace holds` },
  { fails: (b) => escapes(b.context) || escapes(b.dockerfile), needs: "person", say: (n, b) => `${n.key}: its build reaches outside the workspace (${b.context}, ${b.dockerfile}), and a sandbox builds only from the workspace's own files` },
  { fails: (b, fp) => !fp(b.dockerfile), needs: "environment", say: (n, b) => `${n.key}: ${b.dockerfile} is not a file the workspace's index holds, so what would be built cannot be fingerprinted — the change that made it is recorded first` },
  { fails: (b, fp) => !fp(b.context) || [b.context, posix.dirname(b.dockerfile)].some((sc) => fp(sc)?.dirty !== 0), needs: "environment", say: (n, b) => `${n.key}: ${b.context} holds an edit the workspace has not recorded (or its state cannot be read), so what would be built is not the tree this sandbox names — the change is recorded first` },
];

// What a person trusts of a build: its Dockerfile and ignore files by content and -- only when the build may reach a
// network -- every tracked file it is sent, because a build that can reach out can send any of them anywhere.
const buildDigest = (b, fp, input) => ({ dockerfile: fp(b.dockerfile)?.hash ?? null, ignores: [fp(ignoreOf(b.context))?.hash ?? null, fp(`${b.dockerfile}.dockerignore`)?.hash ?? null], context: buildNetworkOf(input) === "none" ? null : (fp(b.context)?.hash ?? null), network: buildNetworkOf(input) });

function builtFrom(node, src, input) {
  const fp = (scope) => input.fingerprints?.[scope] ?? null;
  const gap = BUILD_GAPS.find((g) => g.fails(src.build, fp));
  const image = { ...src, build: { ...src.build, digest: buildDigest(src.build, fp, input) } };
  return gap ? { ...node, image, gap: { needs: gap.needs, say: gap.say(node, src.build) } } : { ...node, image };
}

const pinnedOf = (ref, input) => (PINNED.test(String(ref)) ? ref : (input.resolved?.[ref] ?? null));

const NO_IMAGE = (node) => `${node.key}: nothing says what to run it from — no compose image or build, no Dockerfile in ${node.component?.dir ?? "its directory"}, no catalog image for what it requires; a person sets one (runtime configure --component=${node.key} …) or adds a Dockerfile`;

const NOT_HERE = (node, ref) => `${node.key}: ${ref} is not on this machine, and a sandbox never pulls behind a person's back — a person pulls it (or pins it by digest), then prepares again`;

function imaged(node, input) {
  const src = imageSourceOf(node, input);
  if (src.source === "none") return { ...node, image: src, gap: { needs: "person", say: NO_IMAGE(node) } };
  if (src.build) return builtFrom(node, src, input);
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

// What a person TRUSTS, as one print: each node's image (or what it is built from, by content), argv, mounts and env
// NAMES.
const imagePrint = (image) => image.pinned ?? (image.build ? { context: image.build.context, dockerfile: image.build.dockerfile, digest: image.build.digest ?? null } : null);

export const topologyFingerprint = (t) => sha(canonicalJson({ mode: t.mode, nodes: t.nodes.map((n) => ({ key: n.key, role: n.role, image: imagePrint(n.image), argv: n.argv, mounts: n.mountsWorkspace ? ["workspace"] : [], env: [...n.env.names, ...Object.keys(n.env.values)].sort() })) }));

// -> { mode, network, nodes, gaps, fingerprint }. `input`: { view, catalog, settings, policy, names, closure, compose,
// dockerfiles, resolved, fingerprints } -- `fingerprints` what the source port said of `buildScopes(input)`.
export function composed(input) {
  const mode = NETWORK_MODES.find((r) => r.when(input)).mode(input);
  const nodes = nodesOf(input).map((n) => shaped(n, input));
  const gaps = [...nodes.filter((n) => n.gap).map((n) => ({ key: n.key, ...n.gap })), ...(mode === "pod" ? collisions(nodes) : [])];
  const t = { mode, network: { name: networkNameOf(input.names.envId), labels: labelsOf(input.names) }, nodes, gaps };
  return { ...t, fingerprint: topologyFingerprint(t) };
}
