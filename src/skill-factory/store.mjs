// The skill factory's ROOM, one per project, in the machine store -- never in a repository and never in the
// plugin, so replacing the plugin on an upgrade takes none of it along, and project A never reads project B's.
//
//   <storeRoot>/generated-skills/
//     registry.json                       an INDEX of what was registered; each playbook's own files are the truth
//     drafts/<id>/                        what a workflow drafted and a host wrote, never offered to anything
//     <id>/                               the registered version in place, with .registered.json (its digest)
//     .versions/<id>/<version>-<digest8>/ every earlier registration, whole: a task that pinned one still reads it
//     archived/<id>/<version>-<digest8>/  what a person archived; the engine never deletes a playbook
//
// Reading creates nothing. Every id is checked against its pattern and every path kept inside the room.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { contained } from "../project/boundary.mjs";
import { DIR, ID, MANIFEST, SIDECAR } from "./vocab.mjs";

export const REGISTRY_SCHEMA = 2;

const parsed = (text) => {
  try { return text === null ? null : JSON.parse(text); }
  catch { return null; }
};

function checkedId(id) {
  if (!ID.test(String(id ?? ""))) throw Object.assign(new Refused(`${id} is not a playbook id (lower case letters, digits and dashes)`), { code: "SF_ID_INVALID" });
  return id;
}

const fileRow = (io, dir) => (name) => ({ name, kind: io.kind(join(dir, name)), bytes: io.size(join(dir, name)) ?? 0, text: io.kind(join(dir, name)) === "file" ? io.read(join(dir, name)) : null });

// The files a playbook directory holds, as validation reads them: every entry but the engine's own dot files.
export const filesIn = (io, dir) => io.list(dir).filter((n) => !n.startsWith(".")).sort().map(fileRow(io, dir));

// What a playbook IS, as one hash: every file's name and text, and the manifest without what the engine stamps
// and without its provenance -- the same playbook drafted by two tasks is one playbook, registered once.
const STAMPED_KEYS = ["status", "digest", "version", "createdAt", "verifiedAt", "engineVersion", "registeredBy", "sourceTask", "generationReason"];

const contentOf = (f) => (f.name === MANIFEST ? canonicalJson(Object.fromEntries(Object.entries(parsed(f.text) ?? {}).filter(([k]) => !STAMPED_KEYS.includes(k)))) : f.text ?? "");

export const digestOf = (files) => sha(files.filter((f) => f.kind === "file").map((f) => `${f.name}\n${contentOf(f)}`).join("\n----\n"));

export function createGeneratedSkills(storeRoot, io) {
  const room = join(storeRoot, DIR);
  const inRoom = (...parts) => contained(room, join(room, ...parts));
  const paths = { room, registry: join(room, "registry.json"), drafts: join(room, "drafts"), versions: join(room, ".versions"), archived: join(room, "archived") };
  return { io, paths, inRoom, draftDir: (id) => inRoom("drafts", checkedId(id)), dirOf: (id) => inRoom(checkedId(id)), versionDir: (id, version, digest) => inRoom(".versions", checkedId(id), `${version}-${digest.slice(0, 8)}`), archivedDir: (id, version, digest) => inRoom("archived", checkedId(id), `${version}-${digest.slice(0, 8)}`), registry: () => registryRows(io, paths.registry), saveRegistry: (rows) => io.write(paths.registry, `${JSON.stringify({ schema: REGISTRY_SCHEMA, skills: rows }, null, 2)}\n`), sidecar: (id) => parsed(io.read(join(inRoom(checkedId(id)), SIDECAR))), drafts: () => io.list(paths.drafts).filter((n) => ID.test(n)) };
}

function registryRows(io, file) {
  const text = io.read(file);
  if (text === null) return [];
  const doc = parsed(text);
  if (!doc || doc.schema !== REGISTRY_SCHEMA || !Array.isArray(doc.skills) || Object.keys(doc).some((k) => !["schema", "skills"].includes(k))) throw new Refused("Unsupported generated-playbook registry schema; file unchanged");
  return doc.skills;
}
