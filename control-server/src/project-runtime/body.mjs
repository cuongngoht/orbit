// What a runtime operation's JSON body may say: an object of KNOWN fields, each of a stated kind.
// An unknown field is refused BY NAME -- a field that did nothing would read as a setting in force
// -- and no field can be a command, a path or a flag: the operation builds its own arguments from
// the few fields it names, so a body is a choice among things that exist and never a way to say
// something new.
import { invalid } from "../errors.mjs";

const KINDS = {
  boolean: { is: (v) => typeof v === "boolean", says: "true or false" },
  name: { is: (v) => typeof v === "string" && /^[^\u0000-\u001f]{1,200}$/.test(v), says: "a name, at most 200 characters" },
  seconds: { is: (v) => Number.isInteger(v) && v >= 0 && v <= 600, says: "a whole number of seconds from 0 to 600" },
  provider: { is: (v) => v === "native" || v === "devcontainer", says: "native or devcontainer" },
  revision: { is: (v) => Number.isInteger(v) && v >= 0, says: "the whole-number revision the page read" },
  trustKind: { is: (v) => v === "restore" || v === "definition", says: "restore or definition" },
  fingerprint: { is: (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v), says: "a fingerprint: 64 lowercase hexadecimal characters (a SHA-256)" },
  settingsRevision: { is: (v) => v === null || (typeof v === "string" && /^[a-f0-9]{16}$/.test(v)), says: "the settings revision the page read: 16 hexadecimal characters, or null when nothing was saved yet" },
  text: { is: (v) => typeof v === "string" && v.length <= 240 && !/[\u0000-\u0008\u000b-\u001f]/.test(v), says: "a sentence, at most 240 characters" },
};

const asObject = (body) => (body === undefined || body === null ? {} : body);

// A field is the operation's OWN: `constructor` and `__proto__` are not fields of anything, and
// `in` would say they are.
const owns = (spec, key) => Object.hasOwn(spec, key);

function problems(given, spec) {
  const unknown = Object.keys(given).filter((k) => !owns(spec, k)).map((k) => `${k} is not a field of this operation (${Object.keys(spec).join(", ") || "it takes none"})`);
  const wrong = Object.entries(given).filter(([k, v]) => owns(spec, k) && !KINDS[spec[k]].is(v)).map(([k]) => `${k} must be ${KINDS[spec[k]].says}`);
  return [...unknown, ...wrong];
}

// spec: { field: "boolean" | "name" | "seconds" | "provider" | "revision" | "text" | "trustKind" | "fingerprint" | "settingsRevision" } -> the body, once it is
// known to be only that. `code` is what a refusal is called on the page asking (a task's body is not a
// runtime's).
export function fieldsOf(body, spec, code = "RUNTIME_BODY_INVALID") {
  const given = asObject(body);
  if (typeof given !== "object" || Array.isArray(given)) throw invalid(code, "send a JSON object");
  const found = problems(given, spec);
  if (found.length) throw invalid(code, found.join("; "));
  return given;
}

// A flag for each field that is set: true is the bare flag, anything else is name=value.
export const flagsOf = (given, spec) => Object.keys(spec).filter((k) => given[k] !== undefined && given[k] !== false).map((k) => (given[k] === true ? `--${k}` : `--${k}=${given[k]}`));
