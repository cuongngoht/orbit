// What a provider DESCRIPTOR may say, and what a reference means against one.
//
// A descriptor (providers.json) is the only place a work item system's words live:
// what a link to one looks like, which connection reads it, what its relation names
// mean in the engine's four words, and which tools and servers can already do the
// reading. This module holds a row to its shape and asks the one question the rows
// exist to answer -- "is this reference one of yours, and whose item is it?" -- with
// no network and no credential: recognising a link is not reading it.
import { identityFindings } from "../../src/sources/model.mjs";
import { ACQUISITION_IDS, SOURCE_KIND_NAMES } from "../../src/sources/contract-v1.mjs";
import { mcpMappingProblems } from "../../src/sources/readers/mcp.mjs";

const SLUG = /^[a-z][a-z0-9-]{0,47}$/;
const ENV = /^[A-Z][A-Z0-9_]{1,63}$/;
const RELATION_WORDS = ["parent", "child", "related", "implements"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A pattern that compiles and names the parts of an identity it must find.
function patternProblems(source, groups, where) {
  try { new RegExp(source); }
  catch { return [`${where}: is not a regular expression`]; }
  return groups.filter((g) => !String(source).includes(`(?<${g}>`)).map((g) => `${where}: must capture (?<${g}>…)`);
}

function matchProblems(match, where) {
  if (!isObject(match) || !Array.isArray(match.urls) || !match.urls.length) return [`${where}: match.urls needs at least one pattern`];
  const urls = match.urls.flatMap((u, i) => patternProblems(u, ["organization", "id"], `${where}: match.urls[${i}]`));
  return [...urls, ...(match.bareId === undefined ? [] : patternProblems(match.bareId, ["id"], `${where}: match.bareId`))];
}

const tableProblems = (table, allowed, where) => (isObject(table) ? Object.entries(table).filter(([, v]) => !allowed.includes(v)).map(([k]) => `${where}: "${k}" must mean one of ${allowed.join(", ")}`) : [`${where} must be an object`]);

function toolProblems(tool, where) {
  if (!isObject(tool) || !SLUG.test(tool.catalog ?? "") || typeof tool.bin !== "string" || !tool.bin) return [`${where}: needs a catalog id and a bin`];
  const d = tool.defaults;
  if (d === undefined) return [];
  return isObject(d) && Array.isArray(d.argv) && d.argv.every((a) => typeof a === "string") ? patternProblems(d.parse, ["organization"], `${where}: defaults.parse`) : [`${where}: defaults needs argv (strings) and parse`];
}

const mcpProblems = (mcp, where) => (mcp === null ? [] : isObject(mcp) && SLUG.test(mcp.catalog ?? "") ? mcpMappingProblems(mcp.tools, `${where}: mcp.tools`) : [`${where}: mcp is null, or a catalog id and tools`]);

export function descriptorProblems(d, where = "descriptor") {
  if (!isObject(d)) return [`${where} must be an object`];
  const at = `${where} ${d.id ?? "?"}`;
  const shape = [...(SLUG.test(d.id ?? "") ? [] : [`${at}: id must be a lowercase slug`]), ...(typeof d.label === "string" && d.label ? [] : [`${at}: needs a label`]), ...(SLUG.test(d.connection ?? "") ? [] : [`${at}: connection must be a connection provider id`]), ...(ENV.test(d.credentialEnv ?? "") ? [] : [`${at}: credentialEnv must be an environment variable NAME`])];
  const provides = Array.isArray(d.provides) && d.provides.length && d.provides.every((p) => ACQUISITION_IDS.includes(p)) ? [] : [`${at}: provides must list acquisition capabilities`];
  return [...shape, ...provides, ...matchProblems(d.match, at), ...tableProblems(d.relations, RELATION_WORDS, `${at}: relations`), ...tableProblems(d.kinds, SOURCE_KIND_NAMES, `${at}: kinds`), ...mcpProblems(d.mcp, at), ...(Array.isArray(d.tools) ? d.tools.flatMap((t, i) => toolProblems(t, `${at}: tools[${i}]`)) : [`${at}: tools must be a list`])];
}

const decoded = (v) => {
  try { return decodeURIComponent(v); }
  catch { return v; }
};

function identityOf(d, groups) {
  const identity = { provider: d.id, organization: decoded(groups.organization), ...(groups.project ? { project: decoded(groups.project) } : {}), id: groups.id };
  return identityFindings(identity).length ? null : identity;
}

// Whose item is this link? Only a link this descriptor recognises answers; a bare id
// is nobody's, and a link to anywhere else is not this provider's to read.
export function matchRef(d, ref) {
  const text = String(ref ?? "").trim();
  const hit = d.match.urls.map((u) => new RegExp(u).exec(text)).find((m) => m?.groups);
  return hit ? identityOf(d, hit.groups) : null;
}

// A bare id as this provider spells one (`4312`, `#88`), or null -- the engine's own reading
// of a descriptor, so there is one definition of what a bare id is.
export { bareIdOf } from "../../src/sources/descriptors.mjs";
