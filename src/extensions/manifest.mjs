// Is this manifest one this engine will load, and if not, WHY.
//
// Findings, never a throw -- the same shape src/project/config.mjs uses, for the
// same reason: `query extensions` wants to LIST what is wrong with every one of
// them, while a run that needs a broken one turns the same list into a Refused.
// A validator that threw could only ever report the first.
//
// Nothing here reads the filesystem. Whether a declared module is actually there
// is the loader's question, because the loader is what has a directory.
import { constraintFindings, missingFindings } from "../constraints.mjs";
import { LOADABLE, MANIFEST_FIELDS, MANIFEST_REQUIRED, MODULE_FORMS, SUPPORTED_EXTENSION_APIS, MODULES } from "./contract.mjs";

const KNOWN = new Set(Object.keys(MANIFEST_FIELDS));

export function manifestFindings(raw, where) {
  if (!isObject(raw)) return [`${where}: an extension manifest must be a JSON object`];
  const declared = [...missingFindings(MANIFEST_REQUIRED, raw, where), ...constraintFindings(MANIFEST_FIELDS, raw, where)];
  const own = [...unknownKeys(raw, where), ...apiFindings(raw, where), ...moduleFindings(raw, where)];
  return [...declared, ...own];
}

const unknownKeys = (raw, where) => Object.keys(raw).filter((k) => !KNOWN.has(k)).map((k) => `${where}: unknown key "${k}"`);

// The enum on the row already refuses an apiVersion this engine never published.
// What it cannot say is the useful half -- which ones it CAN serve -- and an
// extension written for a version that does not exist yet is the case where a
// person needs to be told to upgrade rather than to edit their file.
function apiFindings(raw, where) {
  if (raw.apiVersion === undefined || SUPPORTED_EXTENSION_APIS.includes(raw.apiVersion)) return [];
  return [`${where}: apiVersion ${raw.apiVersion} is not one this engine serves (${SUPPORTED_EXTENSION_APIS.join(", ")}) — upgrade the engine, or write the extension against one of these`];
}

// A relative path INSIDE the extension's own directory, always. An absolute path
// or a `..` is how an extension reaches code nobody reviewed, and refusing the
// shape here means the loader never has to resolve a hostile one to find out.
function moduleFindings(raw, where) {
  return MODULES.filter((k) => raw[k] !== undefined).flatMap((k) => onePath(raw[k], k, where));
}

function onePath(value, key, where) {
  if (typeof value !== "string") return [];
  const form = MODULE_FORMS[key] ?? "mjs";
  if (!new RegExp(`^\\./[\\w./-]+\\.${form}$`).test(value) || value.includes("..")) return [`${where}: ${key} must be a relative .${form} path inside this extension, e.g. "./${key}.${form}"`];
  return [];
}

// Loadable is a narrower question than valid: a manifest can be perfectly well
// formed and still be a draft nobody has proved. Separated so `query extensions`
// can show a draft as a draft instead of as an error.
export const isLoadable = (m) => LOADABLE.includes(m?.status);

export const notLoadableWhy = (m) =>
  `status is ${m?.status ?? "unset"} — only ${LOADABLE.join(" or ")} is loaded, so verify it first (a draft is generated, not proved)`;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
