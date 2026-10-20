// What a PERSON may do to Orbit's managed MCP servers -- the control plane's
// operations, over the state port (src/mcp/state.mjs) and nothing else. Orbit
// Control reaches these behind its mutation token; the command a session can
// run (cli/mcp.mjs) reaches none of them, so nothing a model does can add,
// enable, approve or re-police a server for itself.
//
//   add        from the catalog (a recommended row's definition, copied in) or
//              custom (validated: src/mcp/managed.mjs) -- into managed.json,
//              never into a host's configuration
//   update     a new definition for the same id; who added it and when is kept
//   remove     the record, its check, its policy and its approval -- a RUNTIME
//              Orbit installed stays until removed on purpose (src/mcp/install.mjs)
//   enable · selection · policy · workflows · approve
//
// Every write is one locked read-modify-write of one document. A refusal is
// Refused with the sentence a person needs; nothing is half written.
import { Refused } from "../errors.mjs";
import { recognised } from "./catalog.mjs";
import { keyOf } from "./identity.mjs";
import { managedProblems, managedRecord, SELECTIONS } from "./managed.mjs";
import { resourcePolicyProblems, withoutResourcePolicy, withResourcePolicy, withWorkflows, workflowProblems } from "./policy.mjs";
import { checkedAs, uncheckedAs, withoutServer, withServer } from "./state.mjs";

export const APPROVAL_MINUTES = { default: 60, max: 24 * 60 };

// ctx: { state, catalog, now () -> ISO }
export function addFromCatalog(ctx, id) {
  const entry = ctx.catalog.find((e) => e.id === id && e.recommended);
  if (!entry) throw new Refused(`the Orbit catalog recommends no MCP server named ${id}`);
  unclaimed(ctx, entry.id);
  const record = managedRecord({ ...entry.definition, id: entry.id, name: entry.name, description: entry.description, provides: entry.provides, signals: entry.signals, requiresSignal: entry.requiresSignal }, { origin: "catalog", catalog: entry.id, at: ctx.now() });
  return saved(ctx, record);
}

export function addCustom(ctx, input) {
  const record = managedRecord(withRouting(ctx, validated(input, "the server was not added")), { origin: "custom", at: ctx.now() });
  unclaimed(ctx, record.id);
  return saved(ctx, record);
}

export function updateManaged(ctx, id, input) {
  const before = existing(ctx, id);
  if (input?.id !== undefined && input.id !== id) throw new Refused("a server cannot be renamed; add a new one and remove this one");
  const record = managedRecord(validated({ ...routingOf(before), ...input, id }, "the server was not changed", before.origin === "catalog"), { origin: before.origin, catalog: before.catalog, at: ctx.now(), createdAt: before.createdAt });
  return saved(ctx, { ...record, enabled: input?.enabled === undefined ? before.enabled : input.enabled === true });
}

export function removeManaged(ctx, id) {
  existing(ctx, id);
  ctx.state.change("managed", (doc) => withoutServer(doc, id));
  for (const [name, fn] of [["checks", (d) => uncheckedAs(d, keyOf("orbit-managed", id))], ["policies", (d) => withoutResourcePolicy(d, keyOf("orbit-managed", id))], ["approvals", (d) => withoutGrant(d, keyOf("orbit-managed", id))]]) ctx.state.change(name, fn);
  return { id, removed: true };
}

export const setEnabled = (ctx, id, enabled) => changedRecord(ctx, id, (r) => ({ ...r, enabled: enabled === true }));

export function setSelection(ctx, id, selection) {
  if (!SELECTIONS.includes(selection)) throw new Refused(`selection is one of ${SELECTIONS.join(", ")}`);
  return changedRecord(ctx, id, (r) => ({ ...r, selection }));
}

export function setPolicy(ctx, id, policy) {
  existing(ctx, id);
  const problems = resourcePolicyProblems(policy);
  if (problems.length) throw new Refused(`the policy was not saved: ${problems.join("; ")}`);
  return ctx.state.change("policies", (doc) => withResourcePolicy(doc, keyOf("orbit-managed", id), policy));
}

export function setWorkflows(ctx, workflows) {
  const problems = workflowProblems(workflows);
  if (problems.length) throw new Refused(`the workflow exceptions were not saved: ${problems.join("; ")}`);
  return ctx.state.change("policies", (doc) => withWorkflows(doc, workflows));
}

// A person's approval, for a while: Orbit Control grants it, the invocation
// gate honours it until it runs out, and nothing else can create one.
export function approve(ctx, id, minutes = APPROVAL_MINUTES.default) {
  existing(ctx, id);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > APPROVAL_MINUTES.max) throw new Refused(`an approval lasts 1 to ${APPROVAL_MINUTES.max} minutes`);
  const until = new Date(Date.parse(ctx.now()) + minutes * 60_000).toISOString();
  ctx.state.change("approvals", (doc) => ({ ...doc, grants: { ...(doc.grants ?? {}), [keyOf("orbit-managed", id)]: { until, grantedAt: ctx.now() } } }));
  return { id, until };
}

export const revokeApproval = (ctx, id) => (existing(ctx, id), ctx.state.change("approvals", (doc) => withoutGrant(doc, keyOf("orbit-managed", id))), { id, revoked: true });

export function recordCheck(ctx, key, check) {
  ctx.state.change("checks", (doc) => checkedAs(doc, key, check));
  return check;
}

// ---- small ---------------------------------------------------------------------------

// `runtime`: only a server added from the catalog may run a runtime Orbit
// installs -- the row is what says how to install it.
function validated(input, what, runtime = false) {
  const problems = managedProblems(input);
  if (problems.length) throw Object.assign(new Refused(`${what}: ${problems.length} problem${problems.length > 1 ? "s" : ""} -- ${problems.join("; ")}`), { problems });
  if (input.commandRef && !runtime) throw new Refused(`${what}: a Orbit-managed runtime comes from a catalog row that says how to install it; a custom server names its own command`);
  return input;
}

// A custom server a catalog row recognises (by id, url or command) gains the
// row's routing words unless the person gave their own -- data, never a guess.
function withRouting(ctx, input) {
  const row = recognised(ctx.catalog, { id: input.id, url: input.url, command: input.command, args: input.args });
  return row ? { provides: row.provides, signals: row.signals, requiresSignal: row.requiresSignal, ...input } : input;
}

const routingOf = (r) => ({ name: r.name, description: r.description, provides: r.provides, signals: r.signals, requiresSignal: r.requiresSignal, selection: r.selection, priority: r.priority, enabled: r.enabled, ...r.definition });

function unclaimed(ctx, id) {
  if (ctx.state.read("managed").servers?.[id]) throw Object.assign(new Refused(`Orbit already manages an MCP server named ${id}`), { conflict: true });
}

function existing(ctx, id) {
  const record = ctx.state.read("managed").servers?.[id];
  if (!record) throw Object.assign(new Refused(`Orbit manages no MCP server named ${id}`), { missing: true });
  return record;
}

function changedRecord(ctx, id, fn) {
  const record = fn(existing(ctx, id));
  return saved(ctx, { ...record, updatedAt: ctx.now() });
}

function saved(ctx, record) {
  ctx.state.change("managed", (doc) => withServer(doc, record.id, record));
  return record;
}

function withoutGrant(doc, key) {
  const { [key]: _gone, ...rest } = doc.grants ?? {};
  return { ...doc, grants: rest };
}
