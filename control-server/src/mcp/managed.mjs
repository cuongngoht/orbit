// What a person does to a Orbit-MANAGED MCP server from Orbit Control -- every
// one a POST, PUT or DELETE behind the mutation token, and every one an
// operation of src/mcp/manage.mjs over Orbit's own records in the machine store.
// No host configuration is written by anything here:
//
//   add          { "catalog": "<id>" }  a recommended catalog row, added to Orbit
//                { "definition": {…} }  a custom server (secrets NAMED, never held)
//   update       a new definition for the same server; it cannot be renamed
//   remove       from Orbit: the record, its check, its policy, its approval. A
//                runtime Orbit installed stays until it is deleted on purpose
//   enable / disable · selection · policy · approve / revoke
import { addCustom, addFromCatalog, approve, removeManaged, revokeApproval, setEnabled, setPolicy, setSelection, updateManaged } from "../core.mjs";
import { invalid } from "../errors.mjs";
import { entryOf, manageCtx, operated, publicMcp } from "./view.mjs";

export async function addManaged(ctx, body) {
  const record = await operated("MCP_ADD_FAILED", () => (body?.catalog !== undefined ? addFromCatalog(manageCtx(ctx), String(body.catalog)) : addCustom(manageCtx(ctx), definitionOf(body))));
  ctx.log(`added MCP server ${record.id} to Orbit (${record.origin})`);
  return publicMcp(entryOf(ctx, record.id));
}

export async function updateManagedServer(ctx, id, body) {
  entryOf(ctx, id);
  await operated("MCP_UPDATE_FAILED", () => updateManaged(manageCtx(ctx), id, definitionOf(body)));
  return publicMcp(entryOf(ctx, id));
}

export async function removeManagedServer(ctx, id) {
  const entry = entryOf(ctx, id);
  await operated("MCP_REMOVE_FAILED", () => removeManaged(manageCtx(ctx), id));
  ctx.log(`removed MCP server ${id} from Orbit`);
  return { id, removed: true, runtimeKept: entry.runtime?.receipt ? true : false };
}

export async function setManagedEnabled(ctx, id, enabled) {
  entryOf(ctx, id);
  await operated("MCP_UPDATE_FAILED", () => setEnabled(manageCtx(ctx), id, enabled));
  return publicMcp(entryOf(ctx, id));
}

export async function setManagedSelection(ctx, id, body) {
  entryOf(ctx, id);
  await operated("INVALID_SELECTION", () => setSelection(manageCtx(ctx), id, body?.selection));
  return publicMcp(entryOf(ctx, id));
}

export async function setManagedPolicy(ctx, id, body) {
  entryOf(ctx, id);
  await operated("INVALID_POLICY", () => setPolicy(manageCtx(ctx), id, body?.policy));
  return publicMcp(entryOf(ctx, id));
}

// An approval is a person's, given here, for a while -- the one way a server
// in `approval` mode, or under an `approval` policy, can be called.
export async function approveManaged(ctx, id, body) {
  entryOf(ctx, id);
  const granted = await operated("INVALID_APPROVAL", () => approve(manageCtx(ctx), id, body?.minutes ?? 60));
  ctx.log(`approved MCP server ${id} until ${granted.until}`);
  return { ...granted, server: publicMcp(entryOf(ctx, id)) };
}

export async function revokeManaged(ctx, id) {
  entryOf(ctx, id);
  await operated("MCP_UPDATE_FAILED", () => revokeApproval(manageCtx(ctx), id));
  return publicMcp(entryOf(ctx, id));
}

function definitionOf(body) {
  const definition = body?.definition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw invalid("INVALID_MCP_DEFINITION", "send { \"definition\": { … } } or { \"catalog\": \"<id>\" }");
  return definition;
}
