// Where the plan FILE sits: in the folder of the screen it names, or -- for a
// plan about no screen -- in screens/_no-screen/, naming the feature it is about.
//
// A plan in the wrong screen folder is a plan the next team does not find when
// that screen changes -- the one reason the tree is organised by screen at all.
// Demonstrable from the file's own path and the map, so it is an error. A plan
// read from anywhere outside the tree (a fixture, a path on the command line)
// has no folder to be wrong about, and `world.dir` absent means nobody asked. A
// DRAFT lives in the machine store's flat drafts room and has no folder either.
import { NO_SCREEN, placedIn, planFolderOf } from "../../tests-tree.mjs";
import { error } from "../finding.mjs";
import { filled } from "./common.mjs";

export const placeFindings = (p, world) => (world?.dir && p._file && !p._draft ? [...namedFindings(p, world), ...folderFindings(p, world)] : []);

function namedFindings(p, world) {
  if (typeof p.screen !== "string" || !p.screen) return filled(p.feature) ? [] : [error(null, `${p.id} names no screen and no feature — a plan about a screen names it; one about no screen names its "feature" and sits in screens/${NO_SCREEN}/`)];
  return world.graph?.screens?.has(p.screen) === false ? [error(null, `${p.id} names screen ${p.screen}, which the map does not have`)] : [];
}

function folderFindings(p, world) {
  const folder = placedIn(world.dir, p._file);
  const want = planFolderOf(p);
  return folder === want || want === null ? [] : [error(null, `${p.id} sits in ${folder ?? "the tree's root"} but ${p.screen ? `names screen ${p.screen}` : "names no screen"} — move it to screens/${want}/`)];
}
