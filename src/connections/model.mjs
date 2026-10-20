// What a CONNECTION is: which source, where, and a REFERENCE to the credential
// that reads it -- never the credential. One connection is one account's
// access to one organization; several projects may bind the same one.
//
// Which fields a connection has is the PROVIDER's to say (a descriptor handed
// in: its `connection.fields`, with their defaults and which are required), so
// this file knows no provider, no host and no token format. The credential is a
// reference src/secrets.mjs understands: an environment variable NAME, or
// { vault: <id> } for an item a person put in this machine's OS secret store.
import { isVaultRef, referenceProblem } from "../secrets.mjs";

export const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

const KNOWN = new Set(["id", "provider", "label", "host", "organization", "credential", "note", "createdAt", "updatedAt", "lastTest"]);

// A host is https, or plain http to this machine's loopback (a test server).
const HOST = /^(https:\/\/[^\s/?#]+(\/[^\s?#]*)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s?#]*)?)$/;

export function connectionProblems(rec, providers) {
  const provider = providers.find((p) => p.id === rec?.provider);
  const unknown = Object.keys(rec ?? {}).filter((k) => !KNOWN.has(k)).map((k) => `unknown field "${k}"`);
  return [...unknown, ...RULES.filter((r) => r.fails(rec ?? {}, provider)).map((r) => r.says(rec ?? {}, provider, providers))];
}

const fieldsOf = (provider) => provider?.connection?.fields ?? [];

const RULES = [
  { fails: (r) => !CONNECTION_ID.test(String(r.id ?? "")), says: () => "id is 2 to 48 lower-case letters, digits and dashes, e.g. source-acme" },
  { fails: (r, p) => !p, says: (r, p, all) => `provider must be one of ${all.map((x) => x.id).join(", ")}` },
  { fails: (r, p) => fieldsOf(p).some((f) => f.required && !String(r[f.name] ?? "").trim()), says: (r, p) => `a ${p.label} connection needs ${fieldsOf(p).filter((f) => f.required).map((f) => f.label).join(", ")}` },
  { fails: (r) => r.host !== undefined && !HOST.test(String(r.host)), says: () => "host is an https:// URL" },
  { fails: (r) => r.organization !== undefined && !/^[\w.-]{1,100}$/.test(String(r.organization)), says: () => "organization is a name, not a URL" },
  { fails: (r) => r.credential !== undefined && r.credential !== null && referenceProblem(r.credential) !== null, says: (r) => referenceProblem(r.credential) },
  { fails: (r, p) => /\b(Bearer|Basic) /.test(JSON.stringify(r)) || shapesOf(p).some((re) => re.test(JSON.stringify(r))), says: () => "a credential is never a field of a connection; set it through the credential action, which keeps it in the OS secret store" },
];

// The token shapes the provider publishes (its descriptor's), so a token pasted
// into the wrong field is refused -- and never echoed back.
const shapesOf = (p) => (p?.credential?.shapes ?? []).map((s) => new RegExp(s));

// A new record: the provider's defaults under what was given.
export function shapedConnection(input, provider) {
  const defaults = Object.fromEntries(fieldsOf(provider).filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
  return { ...defaults, ...Object.fromEntries(Object.entries(input).filter(([k]) => KNOWN.has(k))) };
}

// What any page or answer may SHOW about a connection: where its credential
// comes from, never what it is. A vault item says only that it is set.
export const publicConnection = (rec) => (rec ? { ...rec, credential: credentialView(rec.credential) } : null);

function credentialView(ref) {
  if (!ref) return { set: false, from: null };
  return isVaultRef(ref) ? { set: true, from: "vault" } : { set: true, from: "env", name: ref };
}
