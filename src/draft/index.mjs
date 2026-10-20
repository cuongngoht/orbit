import { basename, dirname, join } from "node:path";
import { caseFile, caseFiles } from "../tests-tree.mjs";
import { writeAtomic } from "../store/atomic.mjs";
import { loadCase } from "../dsl/load.mjs";
import { draftPaths } from "./store.mjs";
import { ROOT_FIELDS } from "../dsl/fields.mjs";
import { checkedId } from "../store/id.mjs";
import { contained } from "../project/boundary.mjs";
import { withLock } from "../store/lock.mjs";
import { Refused } from "../errors.mjs";

export function createDrafts(root, io) {
  const paths = draftPaths(root);
  const c = { paths, io };
  return { root, paths, host: io.host, ...draftApi(c) };
}

const draftApi = (c) => ({
  all: () => allDrafts(c),
  find: (id) => allDrafts(c).find((d) => d.id === id) ?? null,
  save: (d) => saveDraft(c, d),
  remove: (id) => removeDraft(c, id),
  promote: (id, targetDir, io, expected) => promoteDraft(c, id, targetDir, io, expected),
});

const draftFile = (c, id) => contained(c.paths.cases, join(c.paths.cases, `${checkedId(id, ROOT_FIELDS.id)}.json`));

function locked(c, fn) {
  c.io.ensureDir(c.paths.state);
  return withLock(c.paths.state, fn, c.io);
}

function saveDraft(c, draft) {
  const file = draftFile(c, draft.id);
  const before = c.io.read(file);
  return locked(c, () => unchangedSave(c, file, before, draft));
}

function unchangedSave(c, file, before, draft) {
  if (c.io.read(file) !== before) throw new Refused(`${file} changed since it was read — reload before writing`);
  return writeAtomic(file, `${JSON.stringify(draft, null, 2)}\n`, c.io);
}

function allDrafts(c) {
  const files = c.io.list(c.paths.cases).filter((n) => n.endsWith(".json"));
  return files.map((n) => oneDraft(c, n)).filter(Boolean);
}

function oneDraft(c, name) {
  const draft = loadCase(join(c.paths.cases, name));
  if (draft._broken) reportUnreadable(c, name, draft._broken);
  return draft._broken ? null : draft;
}

function reportUnreadable(c, name, broken) {
  c.io.note({ kind: "unreadable-draft", say: `${name} is not readable: ${broken}` });
}

function removeDraft(c, id) {
  const file = draftFile(c, id);
  if (!c.io.exists(file)) return false;
  c.io.removeFile(file);
  return true;
}

// Into the folder of the screen the case starts on (src/tests-tree.mjs), and
// never beside a case that already holds the id in ANOTHER screen's folder: an
// id is found anywhere in the tree, so a second file with it is a second case.
function promoteDraft(c, id, targetDir, io, expected) {
  const file = draftFile(c, id);
  if (!c.io.exists(file)) return false;
  const target = contained(targetDir, caseFile(targetDir, { ...(expected ?? JSON.parse(c.io.read(file))), id }));
  return locked(c, () => promoteChecked(c, file, unclaimed(targetDir, id, target), io, expected));
}

function unclaimed(dir, id, target) {
  const other = caseFiles(dir).find((f) => basename(f, ".json") === id && f !== target);
  if (other) throw new Refused(`${other} already holds ${id} — promotion never makes a second case with one id`);
  return target;
}

function promoteChecked(c, file, target, io, expected) {
  const current = JSON.stringify(JSON.parse(c.io.read(file)));
  if (expected && current !== JSON.stringify(Object.fromEntries(Object.entries(expected).filter(([key]) => !key.startsWith("_"))))) throw new Refused("draft changed after validation — reload before promoting");
  return promoted(c, file, target, io);
}

function promoted(c, file, target, io) {
  if (io.exists(target)) throw new Refused(`${target} already exists — promotion never overwrites a case`);
  io.ensureDir(dirname(target));
  io.copy(file, target);
  c.io.removeFile(file);
  return true;
}
