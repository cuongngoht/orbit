// Rules about the TREE of cases rather than any one case: where each file sits,
// and that an id means one file.
//
// A case is found by id anywhere under screens/, so two files with one id are
// two cases and `run-case <id>` silently picks whichever sorts first. A case in
// another screen's folder is one nobody finds when its screen changes. Both are
// demonstrable from paths alone, so both are findings. (A folder named after a
// screen the map lost needs no rule here: the case in it starts on that screen,
// and head.mjs already says the screen is unknown.)
import { relative } from "node:path";
import { folderOf, placedIn } from "../../tests-tree.mjs";

export const placeFindings = (cases, dir) => (!dir ? [] : [...duplicateFindings(cases, dir), ...cases.flatMap((c) => misplaced(c, dir))]);

function duplicateFindings(cases, dir) {
  const files = (id) => cases.filter((c) => c.id === id).map((c) => relative(dir, c._file));
  const ids = [...new Set(cases.map((c) => c.id).filter((id) => typeof id === "string"))];
  return ids.map((id) => [id, files(id)]).filter(([, all]) => all.length > 1).map(([id, all]) => `${id}: one id, ${all.length} files (${all.join(", ")}) — an id is unique across screens/`);
}

function misplaced(c, dir) {
  if (!c._file || c._broken) return [];
  if (folderOf(c) === null) return [`${c.id}: starts on ${JSON.stringify(c.start)}, which cannot be a folder name — rename the screen in the map`];
  const folder = placedIn(dir, c._file);
  return folder === folderOf(c) ? [] : [`${c.id}: sits in ${folder ?? "the tree's root"} but starts on ${folderOf(c)} — move it to screens/${folderOf(c)}/cases/`];
}
