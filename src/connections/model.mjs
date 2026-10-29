// What a CONNECTION is: which source, where, and a REFERENCE to the credential
// that reads it -- never the credential. One connection is one account's
// access to one organization; several projects may bind the same one.
//
// Which fields a connection has is the PROVIDER's to say (a descriptor handed
// in: its `connection.fields`, with their defaults and which are required), so
// this file knows no provider, no host and no token format. The credential is a
// reference src/secrets.mjs understands: an environment variable NAME, or
// { vault: <id> } for an item a person put in this machine's OS secret store.
//
// HOW a connection gets in is its `auth`: { strategy, ...options }, the strategy one of those the provider's descriptor
// offers (`authentication.strategies`) and the options only those that strategy declares. A connection with no `auth`
// is a credential connection -- which is what every connection made before sign-in existed is -- so no record is ever
// migrated. A `credential` strategy needs a reference to a secret; a `broker` strategy needs none, because what it
// uses is a session a tool holds (src/connections/auth.mjs), which this file never sees.
import { isVaultRef, referenceProblem } from "../secrets.mjs";

export const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

const KNOWN = new Set(["id", "provider", "label", "host", "organization", "credential", "auth", "note", "createdAt", "updatedAt", "lastTest"]);

// A host is https, or plain http to this machine's loopback (a test server).
const HOST = /^(https:\/\/[^\s/?#]+(\/[^\s?#]*)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s?#]*)?)$/;

export function connectionProblems(rec, providers) {
  const provider = providers.find((p) => p.id === rec?.provider);
  const unknown = Object.keys(rec ?? {}).filter((k) => !KNOWN.has(k)).map((k) => `unknown field "${k}"`);
  return [...unknown, ...RULES.filter((r) => r.fails(rec ?? {}, provider)).map((r) => r.says(rec ?? {}, provider, providers))];
}

const fieldsOf = (provider) => provider?.connection?.fields ?? [];

const strategiesOf = (provider) => provider?.authentication?.strategies ?? [];

// What a strategy with no descriptor is: a credential, sent the way a bearer is.
const CREDENTIAL = { id: "credential", kind: "credential", request: "bearer" };

// The strategy a connection uses: the one it names, else `credential`.
export const strategyOf = (rec, provider) => strategiesOf(provider).find((s) => s.id === (rec?.auth?.strategy ?? "credential")) ?? CREDENTIAL;

// Can this connection be used at all? A credential connection needs the reference; one that signs in needs nothing
// until it is used. Pure -- it never asks a tool anything, so a list of readers is drawn without starting a process.
export const configured = (rec, provider) => (strategyOf(rec, provider).kind === "credential" ? Boolean(rec?.credential) : true);

// auth is { strategy, ...options }; the sentence never echoes a value it was given.
function authProblem(auth, provider) {
  if (auth === undefined) return null;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return "auth is { strategy, ...the options that strategy declares }";
  const strategy = strategiesOf(provider).find((s) => s.id === auth.strategy);
  if (!strategy) return `auth.strategy must be one of ${strategiesOf(provider).map((s) => s.id).join(", ") || "(this provider offers none)"}`;
  return Object.entries(auth).filter(([k]) => k !== "strategy").map(([k, v]) => optionProblem(strategy, k, v)).find(Boolean) ?? null;
}

function optionProblem(strategy, name, value) {
  const option = (strategy.options ?? []).find((o) => o.name === name);
  if (!option) return `auth.${name} is not an option of ${strategy.id}`;
  if (option.type === "boolean") return typeof value === "boolean" ? null : `auth.${name} is true or false`;
  const fits = typeof value === "string" && value.length <= 200 && (!option.pattern || new RegExp(option.pattern).test(value));
  return fits ? null : `auth.${name} is not in the form ${option.label ?? name} takes`;
}

const RULES = [
  { fails: (r) => !CONNECTION_ID.test(String(r.id ?? "")), says: () => "id is 2 to 48 lower-case letters, digits and dashes, e.g. source-acme" },
  { fails: (r, p) => !p, says: (r, p, all) => `provider must be one of ${all.map((x) => x.id).join(", ")}` },
  { fails: (r, p) => fieldsOf(p).some((f) => f.required && !String(r[f.name] ?? "").trim()), says: (r, p) => `a ${p.label} connection needs ${fieldsOf(p).filter((f) => f.required).map((f) => f.label).join(", ")}` },
  { fails: (r) => r.host !== undefined && !HOST.test(String(r.host)), says: () => "host is an https:// URL" },
  { fails: (r) => r.organization !== undefined && !/^[\w.-]{1,100}$/.test(String(r.organization)), says: () => "organization is a name, not a URL" },
  { fails: (r) => r.credential !== undefined && r.credential !== null && referenceProblem(r.credential) !== null, says: (r) => referenceProblem(r.credential) },
  { fails: (r, p) => authProblem(r.auth, p) !== null, says: (r, p) => authProblem(r.auth, p) },
  { fails: (r, p) => /\b(Bearer|Basic) /.test(JSON.stringify(r)) || shapesOf(p).some((re) => re.test(JSON.stringify(r))), says: () => "a credential is never a field of a connection; set it through the credential action, which keeps it in the OS secret store" },
];

// The token shapes the provider publishes (its descriptor's), so a token pasted
// into the wrong field is refused -- and never echoed back.
const shapesOf = (p) => (p?.credential?.shapes ?? []).map((s) => new RegExp(s));

// A new record: the provider's defaults under what was given -- and the provider's preferred way in, spelled out, so a
// record says how it gets in instead of leaving it to be inferred.
export function shapedConnection(input, provider) {
  const defaults = Object.fromEntries(fieldsOf(provider).filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
  const given = Object.fromEntries(Object.entries(input).filter(([k, v]) => KNOWN.has(k) && v !== undefined));
  return { ...defaults, ...(provider?.authentication?.default ? { auth: { strategy: provider.authentication.default } } : {}), ...given };
}

// What any page or answer may SHOW about a connection: where its credential
// comes from, never what it is. A vault item says only that it is set.
export const publicConnection = (rec) => (rec ? { ...rec, credential: credentialView(rec.credential), auth: rec.auth ?? { strategy: "credential" } } : null);

function credentialView(ref) {
  if (!ref) return { set: false, from: null };
  return isVaultRef(ref) ? { set: true, from: "vault" } : { set: true, from: "env", name: ref };
}
