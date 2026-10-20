// A PERSON's operations on connections -- create, change, delete, set or clear
// the credential, test -- the same for Orbit Control and the CLI.
//
// A credential VALUE passes through here exactly once, on its way into the OS
// secret store: `setCredential` hands it to the secret port and keeps the
// reference. It is never returned, never written into connections.json, never
// logged; an answer about a connection is its public view (model.mjs), which
// says only whether a credential is set and where it comes from. With no OS
// store on this machine the answer is BLOCKED -- the person references an
// environment variable instead, and nothing falls back to a file.
//
// `test` asks the source's own probe, handed in by the composition root:
// authentication first, then every capability the project's scope would read,
// each answered ok · forbidden (with the permission it lacks) · not-found ·
// error. What it found is kept as `lastTest`, and holds no secret.
import { Refused } from "../errors.mjs";
import { maskValues, scrub } from "../scrub.mjs";
import { isVaultRef } from "../secrets.mjs";
import { CONNECTION_ID, connectionProblems, publicConnection, shapedConnection } from "./model.mjs";

// deps: { store (connectionStore), secrets (secretSource), providers, now }
export function createConnections(deps) {
  return { list: () => deps.store.list().map(publicConnection), get: (id) => publicConnection(found(deps, id)), create: (input) => create(deps, input), update: (id, patch) => update(deps, id, patch), remove: (id) => remove(deps, id), setCredential: (id, input) => setCredential(deps, id, input), clearCredential: (id) => clearCredential(deps, id), test: (id, probe) => tested(deps, id, probe), record: (id) => found(deps, id) };
}

function found(deps, id) {
  const rec = CONNECTION_ID.test(String(id)) ? deps.store.get(id) : null;
  if (!rec) throw new Refused(`no connection "${id}" on this machine`);
  return rec;
}

function create(deps, input) {
  const rec = { ...shapedConnection({ ...input, credential: undefined }, deps.providers.find((p) => p.id === input?.provider)), createdAt: deps.now(), updatedAt: deps.now() };
  held(deps, rec);
  deps.store.change((list) => (list.some((c) => c.id === rec.id) ? taken(rec.id) : [...list, rec]));
  return publicConnection(rec);
}

const taken = (id) => { throw new Refused(`a connection named ${id} already exists`); };

function held(deps, rec) {
  const wrong = connectionProblems(rec, deps.providers);
  if (wrong.length) throw new Refused(`this connection does not hold: ${wrong.join("; ")}`);
  return rec;
}

// Where the source is, or which one it is, changes what a past test proved --
// so a change to either forgets the last test.
function update(deps, id, patch) {
  const was = found(deps, id);
  const next = held(deps, { ...was, ...pick(patch, ["label", "host", "organization", "note"]), updatedAt: deps.now(), lastTest: moved(was, patch) ? undefined : was.lastTest });
  deps.store.change((list) => list.map((c) => (c.id === id ? next : c)));
  return publicConnection(next);
}

const pick = (o, keys) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => keys.includes(k) && v !== undefined));
const moved = (was, patch) => ["host", "organization"].some((k) => patch?.[k] !== undefined && patch[k] !== was[k]);

// Deleting a connection deletes the credential Orbit kept for it; an environment
// variable is the person's own, and stays.
async function remove(deps, id) {
  const was = found(deps, id);
  if (isVaultRef(was.credential)) await deps.secrets.remove(was.credential);
  deps.store.change((list) => list.filter((c) => c.id !== id));
  return { id, removed: true };
}

// input: { value } -> kept in the OS store under this connection's own item ·
//        { env: NAME } -> a reference to a variable the person sets
async function setCredential(deps, id, input) {
  const was = found(deps, id);
  const ref = input?.env !== undefined ? String(input.env) : { vault: `connection-${id}` };
  if (input?.env === undefined) await deps.secrets.store(ref, input?.value);
  return saved(deps, { ...was, credential: ref, updatedAt: deps.now(), lastTest: undefined }, was);
}

async function clearCredential(deps, id) {
  const was = found(deps, id);
  if (isVaultRef(was.credential)) await deps.secrets.remove(was.credential);
  return saved(deps, { ...was, credential: null, updatedAt: deps.now(), lastTest: undefined }, was);
}

// A vault item this connection no longer references is removed, so replacing a
// stored credential with an environment reference leaves nothing behind.
async function saved(deps, next, was) {
  held(deps, next);
  deps.store.change((list) => list.map((c) => (c.id === next.id ? next : c)));
  if (isVaultRef(was.credential) && !isVaultRef(next.credential)) await deps.secrets.remove(was.credential);
  return publicConnection(next);
}

// probe(connection, credential) -> { ok, identity, checks: [{ id, status, permission, message }] }
async function tested(deps, id, probe) {
  const rec = found(deps, id);
  const result = await probed(deps, rec, probe);
  const lastTest = { at: deps.now(), ok: Boolean(result.ok), identity: result.identity ?? null, checks: result.checks };
  deps.store.change((list) => list.map((c) => (c.id === id ? { ...c, lastTest } : c)));
  return lastTest;
}

// Whatever the probe says passes through the masks before it is kept: its
// words are about the source, and the credential is never one of them.
async function probed(deps, rec, probe) {
  const credential = rec.credential ? await deps.secrets.read(rec.credential) : null;
  if (!credential) return { ok: false, identity: null, checks: [{ id: "credential", status: "missing", permission: null, message: rec.credential ? "the credential this connection references is not set on this machine" : "no credential is set for this connection" }] };
  const result = await probe(rec, credential);
  return { ...result, identity: result.identity ? scrub(maskValues(String(result.identity), [credential])) : null, checks: (result.checks ?? []).map((c) => checkLine(c, credential)) };
}

const checkLine = (c, credential) => ({ id: String(c.id), status: String(c.status), permission: c.permission ?? null, message: c.message ? scrub(maskValues(String(c.message), [credential])).slice(0, 300) : null });
