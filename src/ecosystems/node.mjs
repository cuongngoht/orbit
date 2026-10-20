// The Node package manifest, as an ecosystem adapter.
//
// What it reads: the dependency NAMES under `dependencies` and
// `devDependencies`, the `scripts`, and `engines`. It is here to prove the core
// is not written for one ecosystem -- not to know what a web framework or an ORM
// looks like in this one. That is a later iteration's analyser, and a
// registration when it comes.
//
// Until 1.7.6 only the manifest at the ROOT of a checkout was read, and the
// reason was written down here: a workspace's nested packages had never been
// read, and starting to was a behaviour change of its own that deserved its own
// case. This is that case. A repository that keeps its web client and its api in
// `apps/web` and `apps/api` is two buildable units, and runtime discovery
// (src/runtime/) cannot tell what each needs, builds and starts if only the
// shared root is visible. A manifest under a `node_modules` directory is somebody
// else's package, vendored, and is still never a unit of THIS project.
//
// What `workspaces` means is said, not guessed: the packages it names are read as
// the manifests they are, and how a workspace is started as a whole is not read.
import { posix } from "node:path";

const VENDORED = /(^|\/)node_modules\//;

export const node = {
  id: "node",
  doc: "a Node package manifest, wherever it sits outside node_modules",
  detects: (path) => posix.basename(String(path)) === "package.json" && !VENDORED.test(String(path)),
  parseManifest: (path, text) => nodeManifest(text),
};

function nodeManifest(text) {
  const json = parsed(text);
  if (!isObject(json)) return null;
  return { unit: true, ...(typeof json.name === "string" && json.name ? { name: json.name } : {}), references: localOf(json), dependencies: [...named(json.dependencies, "runtime"), ...named(json.devDependencies, "development")], requires: isObject(json.engines) ? json.engines : {}, commands: Object.entries(isObject(json.scripts) ? json.scripts : {}), unknowns: workspaceNote(json) };
}

const WORKSPACES = "this package declares workspaces: the packages under them are read as their own manifests, and how the workspace is started as a whole is not read";

const workspaceNote = (json) => (json.workspaces === undefined ? [] : [WORKSPACES]);

// A dependency declared by PATH (`file:`, `link:`, `portal:`) is another unit of this tree, named where it
// lives -- a relation between components even when its name matches nothing.
const LOCAL = /^(file|link|portal):(.+)$/;

const localOf = (json) => [json.dependencies, json.devDependencies].flatMap((block) => Object.values(isObject(block) ? block : {})).map((spec) => LOCAL.exec(String(spec))?.[2]).filter(Boolean).map((path) => ({ path }));

const named = (block, role) => Object.keys(isObject(block) ? block : {}).map((name) => ({ name, relationship: "direct", role }));

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
