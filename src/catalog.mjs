// The plugin's own CATALOGS: immutable data shipped in <plugin>/catalog/, read
// and never written.
//
// A catalog is where product knowledge is allowed to live -- which MCP server a
// vendor publishes, which SHA-256 a release carries, which words make a skill
// relevant -- because it is DATA the plugin ships, not something src/ knows.
// Nothing under src/ names a row; a row is read, validated and handed on.
//
// Versioned like every persistent format here: `schema` is compared, and a
// catalog this engine cannot read is REFUSED with a sentence rather than
// half-understood. An upgrade that ships a newer catalog ships the reader too.
import { join } from "node:path";

export const CATALOG_DIR = "catalog";
export const CATALOG_SCHEMA = 1;

export const catalogFile = (pluginRoot, name) => join(pluginRoot, CATALOG_DIR, `${name}.json`);

export function readCatalog(io, file) {
  const data = parsed(io.read(file), file);
  if (data?.schema !== CATALOG_SCHEMA) throw new Error(`${file} is catalog schema ${data?.schema}; this engine reads ${CATALOG_SCHEMA}`);
  return data;
}

function parsed(text, file) {
  if (text === null || text === undefined) throw new Error(`${file} is not there`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${file} is not readable JSON`); }
}

// A catalog row that is not an object with a string id is not a row. Dropped,
// never guessed at -- one bad row must not cost the others.
export const rowsOf = (list) => (Array.isArray(list) ? list.filter((r) => r && typeof r === "object" && typeof r.id === "string" && r.id) : []);
