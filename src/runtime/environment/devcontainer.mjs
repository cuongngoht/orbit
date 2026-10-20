// What a dev container DEFINITION says, summarised -- the one place the shape of
// `devcontainer.json` is known.
//
// Both halves of this subject read it: discovery reads the committed one as
// evidence (src/runtime/discover/readers/devcontainer.mjs), and the designer
// reads the one on the disk now, which may differ, to decide what a proposal has
// to change. They must read it the same way, so it is read here, once.
//
// The summary is what the definition PROVIDES, by name, and nothing it RUNS or
// SETS: lifecycle hooks are recorded as the names of the hooks that are present
// (a hook is a command that executes inside a container a person has not been
// asked about yet, and discovery never runs one -- or even keeps its text), and
// environment variables as their NAMES, never their values. A definition that is
// not an object, or not JSONC at all, has no summary and says why.
import { posix } from "node:path";
import { parse } from "../jsonc.mjs";
import { isDockerfile, stagesOf } from "./container-files.mjs";

export const HOOKS = ["initializeCommand", "onCreateCommand", "updateContentCommand", "postCreateCommand", "postStartCommand", "postAttachCommand"];

const DEFINITIONS = [/^\.devcontainer\/devcontainer\.json$/, /^\.devcontainer\/[^/]+\/devcontainer\.json$/, /^\.devcontainer\.json$/];

export const isDefinition = (path) => DEFINITIONS.some((re) => re.test(String(path)));

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v) => (typeof v === "string" && v ? v : null);

const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((s) => typeof s === "string" && s);

// A feature is named by an OCI reference with an optional tag -- or by a path or
// a URL, which has no tag. Its value is its options, or a bare string meaning its
// version. `version` is what was asked for, as written (a string or a number).
const REFERENCE = /^(.*?)(?::([^/:]+))?$/;

function featureOf(key, value) {
  const [, id, tag] = REFERENCE.exec(key);
  const asked = isObject(value) ? value.version : value;
  return { id, tag: tag ?? null, version: typeof asked === "string" || typeof asked === "number" ? String(asked) : null };
}

const featuresOf = (features) => (isObject(features) ? Object.entries(features).map(([k, v]) => featureOf(k, v)) : []);

// The summary of a parsed definition, or null when it is not an object.
export function summarize(value) {
  if (!isObject(value)) return null;
  return { image: text(value.image), dockerFile: text(value.dockerFile ?? value.build?.dockerfile), composeFiles: list(value.dockerComposeFile), service: text(value.service), workspaceFolder: text(value.workspaceFolder), ...provided(value) };
}

const provided = (v) => ({ features: featuresOf(v.features), forwardPorts: (Array.isArray(v.forwardPorts) ? v.forwardPorts : []).filter((p) => Number.isInteger(p) || typeof p === "string"), appPort: publishedOf(v.appPort), hooks: HOOKS.filter((k) => v[k] !== undefined), containerEnv: names(v.containerEnv), remoteEnv: names(v.remoteEnv), mounts: Array.isArray(v.mounts) ? v.mounts.length : 0, elevated: elevatedOf(v) });

// The HOST ports an `appPort` publishes. A number is that port, which the Dev Containers CLI publishes
// on this machine's loopback only; a string is Docker's own `host:container` or `ip:host:container`,
// whose host part is what this machine can reach. A port Docker would pick itself (`ip::container`)
// is one nobody can name, and a UDP one answers no connection: neither is counted.
const publishedOf = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(hostPort).filter((p) => Number.isInteger(p) && p > 0);

const hostPort = (p) => (Number.isInteger(p) ? p : tcpHost(String(p).match(/^(.*?)(?:\/(\w+))?$/)));

const tcpHost = ([, spec, protocol]) => (!protocol || protocol.toLowerCase() === "tcp" ? hostPart(spec.split(":")) : NaN);

const hostPart = (parts) => Number(parts.length > 1 ? parts.at(-2) : parts[0]);

// What widens what the container may touch, by name: a privileged container, added capabilities, a
// relaxed security option, arguments handed to the container runtime, mounts of the host.
const ELEVATED = [["privileged", (v) => v.privileged === true], ["capAdd", (v) => Array.isArray(v.capAdd) && v.capAdd.length > 0], ["securityOpt", (v) => Array.isArray(v.securityOpt) && v.securityOpt.length > 0], ["runArgs", (v) => Array.isArray(v.runArgs) && v.runArgs.length > 0], ["mounts", (v) => Array.isArray(v.mounts) && v.mounts.length > 0]];

const elevatedOf = (v) => ELEVATED.filter(([, present]) => present(v)).map(([name]) => name);

// The one hook that does NOT run in the container: it runs on the machine that brings it up.
export const HOST_HOOK = "initializeCommand";

const names = (env) => (isObject(env) ? Object.keys(env).sort() : []);

// The files a definition points at, as repo-relative paths: a path that climbs
// out of the repository is not a reference this reads.
export function references(path, summary) {
  const dir = posix.dirname(path);
  const refs = [summary.dockerFile, ...summary.composeFiles].filter(Boolean);
  return refs.map((r) => posix.normalize(posix.join(dir, r))).filter((p) => !p.startsWith("..") && !posix.isAbsolute(p));
}

// A container image that is a Windows one. A local container runtime on a
// machine that is not Windows runs Linux containers, so an image with one of
// these in its name cannot be started there -- and nothing here assumes the
// opposite for an image that does not say.
const WINDOWS_IMAGE = /(^|[/:._-])(windows|nanoserver|servercore)([/:._-]|$)/i;

export const windowsImage = (image) => WINDOWS_IMAGE.test(String(image ?? ""));

// The definitions on the DISK now. `tree` is the working-tree port
// (src/frontend/worktree.mjs). Each definition carries the base images it builds
// from, followed one step into the build file it points at.
// -> { definitions: [{ path, text, summary, parsed, images }], problems: [{ path, why }] }
export function inspect(tree) {
  const paths = [".devcontainer/devcontainer.json", ".devcontainer.json", ...tree.list(".devcontainer").map((n) => `.devcontainer/${n}/devcontainer.json`)];
  const asked = [...new Set(paths)].map((path) => ({ path, text: tree.read(path), there: tree.exists(path) }));
  const read = asked.filter((d) => d.text !== null).map((d) => ({ ...d, ...summarised(d.text) }));
  return { definitions: read.filter((d) => d.summary).map((d) => ({ ...d, images: imagesOf(tree, d) })), problems: [...read.filter((d) => !d.summary).map((d) => ({ path: d.path, why: d.why })), ...unreadable(asked)] };
}

// A path that IS there and reads as nothing -- a link, a file past the size cap, text in an encoding
// this does not read -- is not an absence: calling it one would propose to create a file over it.
const unreadable = (asked) => asked.filter((d) => d.text === null && d.there).map((d) => ({ path: d.path, why: "is there and cannot be read as text (a link, too large, or not text), so it is not replaced" }));

function imagesOf(tree, d) {
  const built = references(d.path, d.summary).filter(isDockerfile).flatMap((p) => stagesOf(tree.read(p) ?? "").images.map((s) => s.image));
  return [d.summary.image, ...built].filter(Boolean);
}

function summarised(source) {
  const doc = parse(source);
  if (!doc.ok) return { summary: null, why: `it does not parse (${doc.error})` };
  const summary = summarize(doc.value);
  return summary ? { summary, parsed: doc } : { summary: null, why: "it is not a JSON object" };
}
