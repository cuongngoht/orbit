// The sandbox answers, in words. Short, and never a path: a sentence says what stands, who has to act, and what
// is next.
const list = (items, say, none = "none") => (items?.length ? items.map(say).join("\n") : `  ${none}`);

const tree = (t) => (t ? String(t).slice(0, 12) : "none");

const endpoint = (e) => `  ${e.component}: ${e.kind} on 127.0.0.1:${e.port} (${e.source})`;

// A component of the view says where it answers as one string already.
const at = (c) => (c.endpoint ? ` at ${c.endpoint}` : "");

export function saySandboxes(r) {
  return [`SANDBOXES  ${r.sandboxes.length}`, list(r.sandboxes, (s) => `  ${s.id}  ${s.state}${s.stale ? " (stale)" : ""}  ${s.owner.id}  tree ${tree(s.tree)}  ${s.components} component(s)  ports ${s.leases.join(", ") || "none"}`), `LEASES  ${r.leases.length} on this machine`, list(r.leases, (l) => `  ${l.port}  ${l.env}  ${l.component}`)].join("\n");
}

export function saySandbox(v) {
  return [`SANDBOX  ${v.environment}  ${v.state}${v.stale ? ` — ${v.because}` : ""}`, `  task ${v.owner.id} · workspace ${v.workspace} · built from tree ${tree(v.tree)}, the workspace is at ${tree(v.currentTree)}`, ...(v.blocked ? [`  BLOCKED: needs ${v.blocked.needs} — ${v.blocked.because}`] : []), "COMPONENTS", list(v.components, (c) => `  ${c.component} (${c.execution}): ${c.state}, ${c.readiness.state}${at(c)}`), `OWNS  ${v.ownership.processes} process(es), ${v.ownership.containers} container(s); depends on ${v.ownership.external} server(s) outside it · data: ${v.dataIsolation.state}`, ...(v.reconcile ? [`  ${v.reconcile.outcome}: ${v.reconcile.say}`] : [])].join("\n");
}

export function sayPrepared(r) {
  return [`SANDBOX  ${r.environment}  ${r.state}  tree ${tree(r.tree)}${r.reused ? "  (already prepared)" : ""}`, ...(r.blocked ? [`  needs ${r.blocked.needs}: ${r.blocked.because}`] : [list(r.endpoints, endpoint)]), ...(r.notes ?? []).map((n) => `  note: ${n}`)].join("\n");
}

export function sayLaunched(r) {
  return [`SANDBOX  ${r.environment}  tree ${tree(r.tree)}`, ...r.started.map((s) => `  started ${s.component} (${s.executionProvider ?? "?"}) ${s.session}`), ...r.replaced.map((s) => `  replaced ${s.component} (${s.session}): it ran another tree`), ...r.exited.map((s) => `  EXITED ${s.component}: ${s.lines.at(-1) ?? "no output"}`), ...r.blocked.map((b) => `  blocked ${b.component}: needs ${b.needs} — ${b.because}`), ...r.notReady.map((n) => `  not ready ${n.component}: ${n.because}`)].join("\n");
}

export function sayStopped(r) {
  return [`STOPPED  ${r.stopped.length}  GONE  ${r.gone.length}  REFUSED  ${r.refused.length}`, ...r.refused.map((x) => `  ${x.component}: ${x.why}`)].join("\n");
}

export const sayReleased = (r) => (r.released ? `RELEASED  ${r.environment}  stopped ${r.stopped.length}, leases freed ${r.leases.length}${r.refused.length ? `, ${r.refused.length} session(s) would not stop` : ""}` : `NOT RELEASED  ${r.why}`);

export const sayLogs = (r) => [`LOG  ${r.session}  ${r.stream}${r.truncated ? "  (the end of it)" : ""}`, ...r.lines].join("\n");

export const sayTrusted = (r) => `TRUST  kept; revision ${r.saved.revision}`;

export const sayDispatched = (r) => `DISPATCHED  ${r.run}  ${r.timedOut ? "its deadline passed and it was stopped" : `ended with status ${r.status ?? "none"}`}${r.envelope ? "" : "  (no envelope was written)"}`;

export const sayDispatchState = (r) => `DISPATCH  ${r.run}  worker ${r.worker}${r.session ? ` (${r.session})` : ""}  ${r.envelope ? "an envelope was left — the host judges it" : "no envelope"}`;

export const saySignalled = (r) => `SIGNAL  ${r.signal.signal} #${r.signal.seq} for ${r.environment}`;

// The topology in words: which node runs where and on which ports -- never an environment value.
export const sayTopology = (t) => (t.needs ? `TOPOLOGY ${t.environment}  needs ${t.needs}: ${t.say}` : [`TOPOLOGY ${t.environment}  ${t.mode}  fingerprint ${String(t.fingerprint).slice(0, 16)}`, ...t.nodes.map((n) => `  ${n.role.padEnd(9)} ${n.key.padEnd(28)} ${n.alias}${n.ports.length ? `:${n.ports.join(",")}` : ""}${n.service ? `  (${n.service})` : ""}`)].join("\n"));
