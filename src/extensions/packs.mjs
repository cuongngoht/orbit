// The capability PACKS this plugin ships, as a room the loader reads (ADR 0034).
//
// A pack is an extension directory under skills/ -- an orbit.extension/v2 manifest and the
// modules it names -- that a project loads ONLY by listing its id in project.json `packs`.
// Until then it is inert: present in the plugin, registered nowhere. It is read where it sits,
// never copied into a store, so an upgraded plugin is an upgraded pack (a copy would freeze one
// version and drift from the engine it was shipped with), and it is held to exactly the
// contract and the refusals a project's own QC tool is: the same loader, one set of checks.
//
// What a pack registers is registered FROM `pack:<id>`, which is what lets the capability
// registry keep `orbit.*` ids for the engine and its packs alone. An id the catalog does not
// list is refused and said; nothing is looked for anywhere else.
import { join } from "node:path";
import { catalogFile, readCatalog, rowsOf } from "../catalog.mjs";
import { contained } from "../project/boundary.mjs";
import { MANIFEST_FILE } from "./contract.mjs";

export const PACK_ID = /^[a-z][a-z0-9-]*$/;

export const packFrom = (id) => `pack:${id}`;

// `ids` are what a project asked for. The answer is a room the loader walks, plus what was
// refused before any manifest was read.
export function packRoom(pluginRoot, ids, io) {
  const listed = catalogRows(pluginRoot, io);
  const wanted = [...new Set(ids ?? [])].sort();
  const known = wanted.filter((id) => PACK_ID.test(String(id)) && listed.rows.has(id));
  const refused = wanted.filter((id) => !known.includes(id)).map((id) => ({ id: packFrom(String(id)), why: listed.problem ?? `${String(id).slice(0, 60)} is not a pack this plugin ships — catalog/packs.json lists ${[...listed.rows.keys()].join(", ") || "none"}` }));
  return { room: roomOver(pluginRoot, listed.rows, known, io), refused };
}

function catalogRows(pluginRoot, io) {
  try { return { rows: new Map(rowsOf(readCatalog(io, catalogFile(pluginRoot, "packs")).packs).map((r) => [r.id, r])), problem: null }; }
  catch (e) { return { rows: new Map(), problem: `the plugin's pack catalog could not be read — ${e.message}` }; }
}

function roomOver(pluginRoot, rows, ids, io) {
  const dirOf = (id) => contained(pluginRoot, join(pluginRoot, String(rows.get(id)?.dir ?? "")));
  return { ids: () => [...ids], dirOf, readManifest: (id) => io.read(join(dirOf(id), MANIFEST_FILE)), readFile: (file) => io.read(file), fromOf: packFrom };
}
