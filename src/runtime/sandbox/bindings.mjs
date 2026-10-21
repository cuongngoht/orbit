// The SEALED binding table a generated test's worker is handed (ADR 0036; doc §6.1 step 5): every
// logical ref the frozen version names -- an endpoint, a channel, an observer, a fixture, a
// schedule, a clock, a workload, an identity -- resolved ONCE, by the host, before dispatch, to what
// the task's OWN sandbox holds, and to nothing else. A case never names an address, a port or a
// credential, and a model never chose one: the value comes from a declaration (`declarationOf`, the
// system graph's or a person's, handed in), the topology Runtime composed (which node, its alias on
// the task's network, its ports) and the catalog's service rows (which transport a service speaks,
// on which port, and where its credential is declared). What a test OWNS for its run -- an
// observer, a fixture -- is named inside the run's NAMESPACE by templates its adapter declares
// (`bind`), so two runs never share one.
//
// A credential is NAMED in the value (`credential.userEnv` ...) and its value is kept apart, in
// `secrets`, which the worker hands only to a helper's environment (src/run/worker.mjs). Anything
// that cannot be bound is a GAP with its reason -- never a guess, never a host's address.

const SECRET = (alias, what) => `ORBIT_BIND_${String(alias).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${what}`;
const HOOKS_TOKEN = "ORBIT_BIND_HOOKS_TOKEN";

// in: { refs: [{kind, alias}], declarationOf(kind, alias), topology, services: {id: row}, namespace,
//       adapterFor(transport) -> adapter declaration, minted: { hooksToken?, identities?: {alias: {principal, token}} } }
export function sealedBindings(input) {
  const out = { bindings: {}, secrets: {}, gaps: [] };
  for (const ref of uniqueRefs(input.refs)) bound(out, ref, input);
  return out;
}

const uniqueRefs = (refs) => [...new Map((refs ?? []).map((r) => [`${r.kind}:${r.alias}`, r])).values()];

function bound(out, ref, input) {
  const row = KINDS[ref.kind];
  const got = row ? row(ref, input) : { why: `"${ref.kind}" is not a kind of binding this table answers (${Object.keys(KINDS).join(", ")})` };
  if (got.why) return void out.gaps.push({ kind: ref.kind, alias: ref.alias, why: got.why });
  out.bindings[ref.kind] = { ...(out.bindings[ref.kind] ?? {}), [ref.alias]: got.value };
  Object.assign(out.secrets, got.secrets ?? {});
}

// ── where a declaration's node is ──────────────────────────────────────────

const nodeOf = (input, name) => (input.topology?.nodes ?? []).find((n) => n.name === name || n.key === name || n.alias === name) ?? null;

const hostOf = (node, topology) => (topology?.mode === "pod" ? "localhost" : node.alias);

function declared(ref, input) {
  const decl = input.declarationOf?.(ref.kind, ref.alias) ?? null;
  if (!decl) return { why: `nothing declares what ${ref.alias} is as a ${ref.kind} — the system graph or a person's binding names it` };
  const node = decl.node ? nodeOf(input, decl.node) : null;
  return decl.node && !node ? { why: `${ref.alias} is declared on ${decl.node}, which this sandbox's topology does not run` } : { decl, node };
}

// ── one row per kind ───────────────────────────────────────────────────────

// The origin is the node's alias on the task's network and a port; a base path is only ever a plain
// path, so nothing a declaration says can become a userinfo, a host or a scheme.
const PATH = /^\/(?![\/\\])[A-Za-z0-9/_.~-]{0,200}$/;

// A port is a whole number a TCP port can be, or nothing: a value that is anything else never
// reaches an origin, where "80@another.host" would be a userinfo and another host.
const portNumber = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 && /^\d+$/.test(String(v)) ? Number(v) : null);

function endpoint(ref, input) {
  const d = declared(ref, input);
  if (d.why) return d;
  const port = portNumber(d.decl.port ?? d.node?.ports?.[0]);
  if (!port) return { why: `${ref.alias} names no port, and ${d.decl.node} declares none` };
  return d.decl.path === undefined || PATH.test(String(d.decl.path)) ? { value: { alias: ref.alias, transport: "http", origin: `http://${hostOf(d.node, input.topology)}:${port}${d.decl.path ?? ""}` } } : { why: `${ref.alias} declares a base path that is not a plain path` };
}

// A service's transport and port from the catalog row of what the node runs; its credential from
// where that row says the node declares one.
function channel(ref, input) {
  const d = declared(ref, input);
  if (d.why) return d;
  const service = input.services?.[d.node?.service] ?? null;
  const transport = d.decl.transport ?? service?.transports?.[0]?.id;
  return transport ? withCredential(ref, d, service, channelValue(ref, d, input, service, transport)) : { why: `${ref.alias} is on ${d.decl.node}, and nothing says which transport it speaks` };
}

// What an address may say is the resource's own names -- an exchange, a key, a subject, a stream --
// and never where to connect or as whom: those are the HOST's, from the topology and the sandbox,
// and they are laid over whatever an address said, so a declaration read from a checkout can
// never point a helper somewhere else or hand it another credential.
const RESERVED = new Set(["alias", "transport", "endpoint", "host", "port", "origin", "credential", "adapter", "namespace", "env"]);

const addressOf = (address) => Object.fromEntries(Object.entries(address ?? {}).filter(([k]) => !RESERVED.has(k)));

const channelValue = (ref, d, input, service, transport) => ({ ...addressOf(d.decl.address), alias: ref.alias, transport, endpoint: { host: hostOf(d.node, input.topology), port: portNumber(d.decl.port ?? portOf(service, transport, d.node)) } });

const portOf = (service, transport, node) => service?.transports?.find((t) => t.id === transport)?.port ?? node?.ports?.[0];

function withCredential(ref, d, service, value) {
  const found = credentialOf(service, d.node);
  if (!found) return { value };
  return { value: { ...value, credential: { userEnv: SECRET(ref.alias, "USER"), passwordEnv: SECRET(ref.alias, "PASSWORD") } }, secrets: { [SECRET(ref.alias, "USER")]: found.user, [SECRET(ref.alias, "PASSWORD")]: found.password } };
}

// The credential a node was STARTED with, where its catalog row says it is declared: compose
// environment names, or argument flags. A synthetic value of the sandbox's own -- never this
// machine's environment.
function credentialOf(service, node) {
  const c = service?.credentials;
  if (!c || !node) return null;
  const read = (spec) => (spec?.env ? Object.fromEntries(node.compose?.env ?? [])[spec.env] ?? node.env?.values?.[spec.env] : flagOf(node.argv ?? [], spec?.flag));
  const pair = { user: read(c.user), password: read(c.password) };
  return pair.user !== undefined && pair.password !== undefined ? pair : null;
}

const flagOf = (argv, flag) => (flag && argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);

// An observer of its OWN: the channel it watches, with the resources its adapter names inside the
// run's namespace, and the adapter it is pinned to so an await goes back through the same one.
function observer(ref, input) {
  const decl = input.declarationOf?.("observer", ref.alias) ?? null;
  const ch = decl?.channel ? channel({ kind: "channel", alias: decl.channel }, input) : { why: `the observer ${ref.alias} names no channel it watches` };
  return ch.why ? ch : ownObserver(ref, input, ch);
}

function ownObserver(ref, input, ch) {
  const adapter = input.adapterFor?.(ch.value.transport) ?? null;
  if (!adapter?.bind?.observer) return { why: `no adapter for ${ch.value.transport} says how an observer of its own is named` };
  return { value: { ...ch.value, alias: ref.alias, adapter: adapter.id, ...filledFrom(adapter.bind.observer, { ns: input.namespace, alias: ref.alias, channel: ch.value }) }, secrets: ch.secrets };
}

function fixture(ref, input) {
  const decl = input.declarationOf?.("fixture", ref.alias) ?? {};
  const base = decl.channel ? channel({ kind: "channel", alias: decl.channel }, input) : { value: {} };
  if (base.why) return base;
  return { value: { ...base.value, ...addressOf(filledFrom(decl.resources ?? {}, { ns: input.namespace, alias: ref.alias, channel: base.value })), alias: ref.alias, namespace: input.namespace }, secrets: base.secrets };
}

// The test hooks a component exposes, reached at its hooks port with the token the SANDBOX minted.
function hooked(protocol) {
  return (ref, input) => {
    const d = declared(ref, input);
    if (d.why) return d;
    if (!input.minted?.hooksToken) return { why: `${ref.alias} is reached through test hooks, and this sandbox minted no hooks token` };
    const port = portNumber(d.decl.port ?? d.node.ports?.[0]);
    return port ? { value: { ...addressOf(d.decl.address), alias: ref.alias, transport: protocol, origin: `http://${hostOf(d.node, input.topology)}:${port}`, credential: { tokenEnv: HOOKS_TOKEN } }, secrets: { [HOOKS_TOKEN]: input.minted.hooksToken } } : { why: `${ref.alias}'s hooks name no port a TCP port can be` };
  };
}

function identity(ref, input) {
  const issued = input.minted?.identities?.[ref.alias];
  if (!issued?.token) return { why: `no identity named ${ref.alias} was issued for this run` };
  return { value: { alias: ref.alias, principal: issued.principal ?? ref.alias, env: SECRET(ref.alias, "TOKEN") }, secrets: { [SECRET(ref.alias, "TOKEN")]: issued.token } };
}

function asDeclared(ref, input) {
  const decl = input.declarationOf?.(ref.kind, ref.alias) ?? null;
  return decl ? { value: { ...addressOf(decl.address ?? decl), alias: ref.alias } } : { why: `nothing declares what ${ref.alias} is as a ${ref.kind}` };
}

// The open test-hook protocol each hooked kind is reached by (ADR 0035): the transport its value carries, so the
// adapter that speaks that protocol is the one chosen.
export const HOOK_PROTOCOLS = { schedule: "orbit-scheduler-v1", clock: "orbit-clock-v1", workload: "orbit-workload-v1" };

const KINDS = { endpoint, channel, queue: channel, observer, fixture, schedule: hooked(HOOK_PROTOCOLS.schedule), clock: hooked(HOOK_PROTOCOLS.clock), workload: hooked(HOOK_PROTOCOLS.workload), identity, schema: asDeclared, occurrence: asDeclared, state: asDeclared };

// ── templates ──────────────────────────────────────────────────────────────

// {ns}, {alias} and {channel.<field>} filled into a template, every string at any depth; a field the
// channel does not have fills nothing, and the value is dropped rather than guessed.
function filledFrom(template, vars) {
  return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, vars)]).filter(([, v]) => v !== undefined));
}

function fill(v, vars) {
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (v && typeof v === "object") return filledFrom(v, vars);
  return typeof v === "string" ? filledText(v, vars) : v;
}

function filledText(text, vars) {
  const missing = [...text.matchAll(/\{([a-z]+(?:\.[A-Za-z0-9_]+)?)\}/g)].some((m) => lookup(vars, m[1]) === undefined);
  return missing ? undefined : text.replace(/\{([a-z]+(?:\.[A-Za-z0-9_]+)?)\}/g, (_, path) => String(lookup(vars, path)));
}

const lookup = (vars, path) => path.split(".").reduce((at, k) => (at !== null && typeof at === "object" && Object.hasOwn(at, k) ? at[k] : undefined), vars);
