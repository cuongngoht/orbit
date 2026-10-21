// The current Orbit extension contract. The loader validates it directly.
// An unsupported apiVersion is refused before any module is imported.

export const EXTENSION_API = "orbit.extension/v2";
export { CAPABILITY_API } from "../capability/contract-v1.mjs";

// The only accepted extension API.
export const SUPPORTED_EXTENSION_APIS = [EXTENSION_API];

// The modules an extension MAY declare. Each is optional: an extension that adds
// one capability and nothing else declares one key. A module named here is
// loaded, held to its own shape, and registered -- and one that is named but
// absent is REFUSED, because half a declared extension is worse than none.
//
export const MODULES = ["capabilities", "dsl", "executors", "validators", "knowledge", "reporting", "adapters"];

// What FORM each module takes. Code is imported; DATA is parsed and never run.
// `reporting` joined in 1.6.0 as data on purpose: a report extension's only code
// is a script the report runner starts as its own process, so nothing a project
// generated for its report ever executes inside the engine, where this process's
// environment -- and every credential in it -- lives.
export const MODULE_FORMS = { capabilities: "mjs", dsl: "mjs", executors: "mjs", validators: "mjs", knowledge: "mjs", reporting: "json", adapters: "json" };

// A tool this extension shells out to -- `psql`, a vendor CLI. Declared so
// `query doctor` can say it is missing BEFORE a QC run fails somewhere that
// reads like a product defect, which is the whole reason src/tools/ exists.
export const MANIFEST_FIELDS = {
  id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", doc: "This extension's name, unique within the project. Also its directory." },
  version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(-[\\w.]+)?$", doc: "This extension's own version, for a human reading the registry." },
  apiVersion: { type: "string", enum: SUPPORTED_EXTENSION_APIS, doc: "Which published contract it was written against. This, not the engine version, is what decides whether it loads." },
  engine: { type: "string", doc: "Which engine versions it was tested against, e.g. \">=0.0.1 <1\". Checked, and reported when it does not hold." },
  status: { type: "string", enum: ["draft", "verified", "active", "stale", "retired", "broken"], doc: "Where it is in its life. Only verified/active are loaded — a draft is never trusted as permanent runtime." },
  createdFor: { type: "string", doc: "Why it exists. \"QC\" for anything orbit-qc-builder made." },
  tools: { type: "array", items: { type: "string" }, doc: "External commands it needs on PATH. query doctor reports a missing one before a run does." },
  mutates: { type: "boolean", doc: "true if anything it offers can change external state. A read-only verification is what QC should prefer, and saying so is how a reader can tell." },
  note: { type: "string", doc: "What it is for, and every trap that cost someone an afternoon." },
  capabilities: { type: "string", doc: "Module exporting this extension's capabilities. Relative to the extension directory." },
  dsl: { type: "string", doc: "Module exporting { verbs, fields } this extension adds. The last resort — a provider belongs behind a capability, not a verb." },
  executors: { type: "string", doc: "Module exporting the behaviours for the verbs its dsl declares." },
  validators: { type: "string", doc: "Module exporting extra validation rules over a case." },
  knowledge: { type: "string", doc: "Module exporting { relations, interpreters } this extension teaches project knowledge: relation rows as data (src/extensions/knowledge-v1.mjs) and code that understands a relation. Relative to the extension directory." },
  reporting: { type: "string", doc: "A JSON file ({ parts: [...] }) declaring this extension's project-report parts (src/extensions/reporting-v1.mjs): scripts the report runner starts, and playbooks a host reads. Parsed, never imported. Relative to the extension directory." },
  adapters: { type: "string", doc: "A JSON file ({ adapters: [...] }) declaring this extension's backend ADAPTERS (orbit.adapter/v1, src/adapters/contract-v1.mjs): which family and transports each answers, its operations, effects, outputs and semantics, and the helper program it is reached through. Parsed, never imported. Relative to the extension directory." },
};

export const MANIFEST_REQUIRED = ["id", "version", "apiVersion", "status"];

// Only these run. A `draft` has been generated but not proved, and the rule that
// it is never loaded as permanent runtime is what makes "generate in scratch,
// verify, then register" more than advice -- src/extensions/loader.mjs enforces
// it, so a builder that skipped the middle step produces something inert rather
// than something that silently works.
export const LOADABLE = ["verified", "active"];

export const MANIFEST_FILE = "extension.json";
