// CONNECTIONS, shared by every project on this machine: which source, where,
// and where the credential comes from -- a person's to create, change, test
// and delete. The same operations the CLI performs (src/connections/manage.mjs,
// through core.mjs), over the machine store's control room.
//
// A credential VALUE arrives exactly once, in the body of PUT …/credential, and
// goes straight to the OS secret store through the secret port. No answer ever
// carries it -- an answer is a connection's public view, which says only
// whether a credential is set and where it comes from -- and no error repeats
// it: every sentence here is written from the request's shape, never its text.
// With no OS store on this machine the answer is 503 and nothing is kept.
import { connectionsOver, probeFor, publicProviders } from "../core.mjs";
import { guarded, invalid, missing } from "../errors.mjs";
import { settingsOf } from "../reports/project.mjs";

const managerOf = (ctx) => connectionsOver(ctx.world.rooms, ctx.world.secrets);

// A connection the request names that is not on this machine is a 404, before
// anything is asked of it.
function known(ctx, id) {
  if (typeof id !== "string" || !managerOf(ctx).list().some((c) => c.id === id)) throw missing("CONNECTION_NOT_FOUND", "there is no connection by that name on this machine");
  return managerOf(ctx);
}

export const listConnections = (ctx) => ({ connections: managerOf(ctx).list(), providers: publicProviders(), backend: ctx.world.secrets?.backend() ?? null });

export const readConnection = (ctx, id) => known(ctx, id).get(id);

export const createConnection = (ctx, body) => guarded("CONNECTION_INVALID", () => managerOf(ctx).create(fieldsOf(body, ["id", "provider", "label", "host", "organization", "note"])));

export const updateConnection = (ctx, id, body) => guarded("CONNECTION_INVALID", () => known(ctx, id).update(id, fieldsOf(body, ["label", "host", "organization", "note"])));

export const removeConnection = (ctx, id) => guarded("CONNECTION_NOT_REMOVED", () => known(ctx, id).remove(id));

// { value } is kept in the OS secret store; { env } references a variable the
// person sets themselves. Exactly one of them.
export async function setCredential(ctx, id, body) {
  const input = credentialOf(body);
  const connection = await guarded("CREDENTIAL_NOT_SET", () => known(ctx, id).setCredential(id, input));
  ctx.log(`credential for connection ${id} set (${connection.credential.from})`);
  return { connection, backend: ctx.world.secrets?.backend() ?? null };
}

export const clearCredential = (ctx, id) => guarded("CREDENTIAL_NOT_CLEARED", () => known(ctx, id).clearCredential(id));

// Authentication, then the reads THIS project's report would make when it
// uses this provider -- and nothing more.
export const testConnection = (ctx, id) => guarded("CONNECTION_TEST_FAILED", () => known(ctx, id).test(id, probeFor(settingsOf(ctx), ctx.world.reportSources, ctx.world.fetch)));

function fieldsOf(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("CONNECTION_INVALID", "the body is a JSON object");
  return Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, typeof body[k] === "string" ? body[k].trim() : body[k]]));
}

function credentialOf(body) {
  const given = ["value", "env"].filter((k) => typeof body?.[k] === "string" && body[k].length > 0);
  if (given.length !== 1 || Object.keys(body ?? {}).some((k) => !["value", "env"].includes(k))) throw invalid("CREDENTIAL_INVALID", "send exactly one of { value } (kept in this machine's OS secret store) or { env } (the name of an environment variable you set)");
  return given[0] === "env" ? { env: body.env.trim() } : { value: body.value };
}
