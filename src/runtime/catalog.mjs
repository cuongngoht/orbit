// catalog/runtimes.json, read as DATA and held to a shape.
//
// The catalog is where a runtime, a package manager, a service or a container
// feature is NAMED, so nothing in src/runtime/ has to know one. This module
// turns the file into the rows every other module asks questions of, and drops
// what is not a row -- one malformed entry must cost that entry, never the
// others, the rule src/catalog.mjs `rowsOf` and src/tools/catalog.mjs follow.
//
// It answers four kinds of question and holds no opinion about any of them:
// what does a requirement id mean (`requirement`), which requirement does an
// image or a dependency name imply (`byImage`, `byDependency`), how is a
// declared command run (`launcherFor`), and what is a version file (`versionFile`).
import { posix } from "node:path";
import { rowsOf } from "../catalog.mjs";
import { canonicalJson, short } from "../hash.mjs";

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

const ID = /^[a-z][a-z0-9-]*$/;

export function runtimeCatalog(data) {
  const requirements = rowsOf(data?.requirements).filter((r) => ID.test(r.id)).map(requirementOf);
  return { digest: short(canonicalJson(data ?? {}), 12), requirements, launchers: launchersOf(data?.launchers), versionFiles: versionFilesOf(data?.versionFiles), services: rowsOf(data?.services).map(serviceOf), scripts: scriptsOf(data?.scripts), ci: ciOf(data?.ci), shells: shellsOf(data?.shells), platforms: platformsOf(data?.platforms), environment: environmentOf(data?.environment), connectivity: connectivityOf(data?.connectivity), isolation: isolationOf(data?.isolation) };
}

// A pattern a catalog row carries is compiled once, and a row whose pattern does
// not compile is dropped: one bad row costs that row.
function compiled(source) {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

const withPattern = (key) => (row) => ({ ...row, re: typeof row?.[key] === "string" ? compiled(row[key]) : null });

const scriptsOf = (rows) => (Array.isArray(rows) ? rows : []).map(withPattern("file")).filter((r) => r.re && typeof r.format === "string" && typeof r.runner === "string").map((r) => ({ re: r.re, format: r.format, runner: r.runner, argv: list(r.argv) }));

function ciOf(ci) {
  const runners = (Array.isArray(ci?.runners) ? ci.runners : []).map(withPattern("match")).filter((r) => r.re && typeof r.os === "string");
  return { files: list(ci?.files).map(compiled).filter(Boolean), runners: runners.map((r) => ({ re: r.re, os: r.os })) };
}

const requirementOf = (r) => ({ id: r.id, name: String(r.name ?? r.id), tool: typeof r.tool === "string" ? r.tool : null, os: Array.isArray(r.os) ? list(r.os) : null, container: r.container !== false, feature: featureOf(r.feature), with: typeof r.with === "string" ? r.with : null, images: list(r.images), dependencies: list(r.dependencies), doc: typeof r.doc === "string" ? r.doc : null });

// Which scripts hint at the systems a checkout is run on: where they must sit, and what each kind is written for.
function shellsOf(s) {
  const kinds = rowsOf(s?.kinds).map(withPattern("match")).filter((k) => k.re && list(k.os).length);
  return { places: list(s?.places).map(compiled).filter(Boolean), kinds: kinds.map((k) => ({ re: k.re, os: list(k.os), name: String(k.name ?? k.match) })) };
}

// The operating systems a component's matrix is drawn over: the id a machine reports, the name a person reads.
const platformsOf = (rows) => rowsOf(rows).filter((r) => typeof r.id === "string" && typeof r.name === "string").map((r) => ({ id: r.id, name: r.name }));

const featureOf = (f) => (f && typeof f.id === "string" && typeof f.option === "string" ? { id: f.id, tag: String(f.tag ?? ""), option: f.option } : null);

const serviceOf = (s) => ({ id: s.id, name: String(s.name ?? s.id), images: list(s.images), ports: (Array.isArray(s.ports) ? s.ports : []).filter(Number.isInteger), transports: transportsOf(s.transports), ...credentialsOf(s.credentials) });

// Which transport tokens a service speaks, and where: what an adapter's declaration is matched against (ADR 0035).
// A token, never interpreted here.
const TOKEN = /^[a-z][a-z0-9.+-]{0,47}$/;

// Where a service's credential is DECLARED when a project starts it -- an environment variable its
// image reads, or an argument flag -- so a sandbox's binder can hand a helper the synthetic value
// the sandbox started it with (src/runtime/sandbox/bindings.mjs). A name, never a value.
const SPEC = (v) => (typeof v?.env === "string" && /^[A-Z_][A-Z0-9_]*$/.test(v.env) ? { env: v.env } : typeof v?.flag === "string" && /^--?[a-z][a-z0-9-]*$/.test(v.flag) ? { flag: v.flag } : null);
const credentialsOf = (c) => (SPEC(c?.user) && SPEC(c?.password) ? { credentials: { user: SPEC(c.user), password: SPEC(c.password) } } : {});

const transportsOf = (rows) => (Array.isArray(rows) ? rows : []).filter((t) => TOKEN.test(String(t?.id)) && Number.isInteger(t?.port)).map((t) => ({ id: t.id, port: t.port }));

// What an ISOLATED sandbox runs in the containers it starts for itself (ADR 0038): argument lists and mount points as
// data. A path is an absolute container path or the row is not one; an argument list is strings or nothing.
const CONTAINER_PATH = /^\/[A-Za-z0-9._/-]{0,200}$/;

const pathOr = (v, fallback) => (typeof v === "string" && CONTAINER_PATH.test(v) ? v : fallback);

const workerOf = (w) => ({ argv: list(w?.argv), plugin: pathOr(w?.plugin, null), in: pathOr(w?.in, null), out: pathOr(w?.out, null), home: pathOr(w?.home, null), store: pathOr(w?.store, null), project: pathOr(w?.project, null) });

const isolationOf = (i) => ({ worker: workerOf(i?.worker), pod: { argv: list(i?.pod?.argv) }, probe: typeof i?.probe === "string" ? i.probe : null, appMount: pathOr(i?.appMount, null) });

// `restore` is how a unit's dependencies are fetched, by the same tool the lock file names: an argument list a
// sandbox runs only under a person's trust (src/runtime/sandbox/restore.mjs).
const viaOf = (v) => ({ file: typeof v?.file === "string" ? v.file : null, argv: list(v?.argv), requires: typeof v?.requires === "string" ? v.requires : null, restore: list(v?.restore) });

function launchersOf(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.ecosystem === "string").map((r) => ({ ecosystem: r.ecosystem, mode: r.mode === "script" ? "script" : "line", kind: typeof r.kind === "string" ? r.kind : null, purpose: typeof r.purpose === "string" ? r.purpose : null, every: r.every === true, argv: list(r.argv), requires: typeof r.requires === "string" ? r.requires : null, via: (Array.isArray(r.via) ? r.via : []).map(viaOf) }));
}

const versionFilesOf = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => typeof r?.file === "string").map((r) => ({ file: r.file, requirement: typeof r.requirement === "string" ? r.requirement : null, format: r.format === "pairs" ? "pairs" : "line", aliases: r.aliases && typeof r.aliases === "object" ? r.aliases : {} }));

const environmentOf = (e) => ({ directory: typeof e?.directory === "string" ? e.directory : ".devcontainer", baseImage: typeof e?.baseImage === "string" ? e.baseImage : null, containerPlatforms: e?.containerPlatforms && typeof e.containerPlatforms === "object" ? e.containerPlatforms : {} });

// How a container is asked whether a server answers from inside it: a tool and a fixed argument list
// whose placeholders are WHOLE elements. A row that puts a placeholder inside another element -- where
// a value would land in a script's text -- is dropped, and so is one that does not ask about a host
// and a port: a bad row costs that row, never the check.
const PLACEHOLDERS = ["${HOST}", "${PORT}", "${TIMEOUT_MS}"];
const PLACEHOLDER_INSIDE = /\$\{(HOST|PORT|TIMEOUT_MS)\}/;

const wellPlaced = (argv) => argv.includes("${HOST}") && argv.includes("${PORT}") && argv.every((a) => PLACEHOLDERS.includes(a) || !PLACEHOLDER_INSIDE.test(a));

const connectivityOf = (c) => ({ primitives: rowsOf(c?.primitives).map((p) => ({ tool: p.id, argv: list(p.argv), doc: typeof p.doc === "string" ? p.doc : null })).filter((p) => p.argv.length && wellPlaced(p.argv)) });

// The argument list for one ask: each placeholder element replaced by its value, as an element of
// its own. Nothing is spliced into a string, so a value is an argument and never script.
export const primitiveArgv = (primitive, values) => primitive.argv.map((a) => (Object.hasOwn(values, a) ? String(values[a]) : a));

export const requirement = (catalog, id) => catalog.requirements.find((r) => r.id === id) ?? null;

// An image reference is `name[:tag][@digest]`, with a registry host and path in
// the name. It matches a row whose image prefix is the whole name or the name
// minus the tag: `node:22-alpine` and `node` are the same image family, and
// `nodemon:1` is not `node`.
const nameOf = (image) => String(image).split("@")[0].replace(/:[^/:]*$/, "").toLowerCase();

const imageIs = (image, prefixes) => prefixes.some((p) => nameOf(image) === p.toLowerCase());

export const byImage = (catalog, image) => catalog.requirements.find((r) => imageIs(image, r.images)) ?? null;

export const serviceByImage = (catalog, image) => catalog.services.find((s) => imageIs(image, s.images)) ?? null;

export const byDependency = (catalog, name) => catalog.requirements.filter((r) => r.dependencies.includes(name));

export const versionFile = (catalog, path) => catalog.versionFiles.find((f) => posix.basename(path) === f.file) ?? null;

// The tag of an image, when it is a plain version: `22`, `3.13`, `8.0.1`, and a
// variant of one (`22-alpine`, `8.0-bookworm`). `bookworm` and `latest` name no
// version, and neither does `1-8.0-bookworm`, whose leading number is the image
// template's own version and not the runtime's -- reading it as one would say a
// project needs version 1 of something.
export function tagOf(image) {
  const tag = String(image).split("@")[0].match(/:([^/:]+)$/)?.[1] ?? "";
  if (/^\d+-\d/.test(tag)) return null;
  return /^(\d+(?:\.\d+){0,2})(?:-[a-z0-9.-]+)?$/i.exec(tag)?.[1] ?? null;
}

// How a command a unit's manifest declares is RUN. A `script` ecosystem
// declares the BODY of a script and needs a runner chosen by evidence in the
// tree (a lock file); every other ecosystem declares a command line as written.
// -> { mode: "line" } | { mode: "script", via } | { mode: "script", via: null, why }
export function launcherFor(catalog, ecosystem, dir, has) {
  const row = catalog.launchers.find((l) => l.ecosystem === ecosystem && l.mode === "script");
  if (!row) return { mode: "line", via: null };
  const found = row.via.map((v) => ({ via: v, lock: v.file === null ? null : locatedFile(dir, v.file, has) })).find((f) => f.via.file === null || f.lock !== null);
  return found ? { mode: "script", via: found.via, lock: found.lock } : { mode: "script", via: null, why: `${ecosystem} scripts are declared here, but nothing in the tree says which tool runs them (none of ${row.via.map((v) => v.file).filter(Boolean).join(", ")} is there)` };
}

// A file in this directory or any directory above it, WHERE it is (or null): a lock file at the root
// of a workspace serves every package beneath, and a restore is trusted by what that lock file says.
function locatedFile(dir, file, has) {
  for (let at = dir; ; at = posix.dirname(at)) {
    const path = at === "." ? file : posix.join(at, file);
    if (has(path)) return path;
    if (at === "." || at === "/") return null;
  }
}

// How a unit's dependencies are restored, when the catalog says so: the lock file's own tool (the launcher row's `via`),
// or a row that holds for EVERY unit of an ecosystem. -> { argv, requires } | null
export function restoreFor(catalog, ecosystem, launcher) {
  if (launcher?.via?.restore?.length) return { argv: launcher.via.restore, requires: launcher.via.requires };
  const row = catalog.launchers.find((l) => l.ecosystem === ecosystem && l.every === true && l.purpose === "restore");
  return row ? { argv: row.argv, requires: row.requires } : null;
}

// What a unit's declared KIND implies it can do (a test project runs its tests).
export const impliedBy = (catalog, ecosystem, kind) => catalog.launchers.find((l) => l.ecosystem === ecosystem && l.kind === kind) ?? null;

// A script file (a Makefile, a task runner's file), by its file NAME.
export const scriptFile = (catalog, path) => catalog.scripts.find((s) => s.re.test(posix.basename(path))) ?? null;

// A pipeline definition, by its whole path.
export const pipelineFile = (catalog, path) => catalog.ci.files.some((re) => re.test(path));

// A script kind (`{ os, name }`) for a path where the catalog says scripts are run from, else null.
export const shellOf = (catalog, path) => ((catalog.shells?.places ?? []).some((re) => re.test(path)) ? (catalog.shells.kinds.find((k) => k.re.test(path)) ?? null) : null);

// The platform a pipeline's runner label names, or null for a label this says
// nothing about -- `self-hosted`, or an expression nobody evaluated.
export const platformOfRunner = (catalog, label) => catalog.ci.runners.find((r) => r.re.test(String(label).toLowerCase()))?.os ?? null;
