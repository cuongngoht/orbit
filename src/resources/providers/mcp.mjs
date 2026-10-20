// MCP servers, as resources: the EFFECTIVE list src/mcp/effective.mjs derives
// from Orbit's own records (managed), the host's observed configuration
// (external). This provider only reshapes
// it; it never reads a host's configuration format, and it never connects to
// anything.
//
// Each keeps its OWNER and its compound key, so a `github` Orbit manages and a
// `github` the host has are two resources the resolver can never collapse --
// and only the first can ever be eligible.
//
// `context.mcp()` answers that list.
import { resource } from "../model.mjs";

export const mcpProvider = {
  family: "mcp",
  list: (context) => (context.mcp() ?? []).map(server),
};

const SOURCE = { "orbit-managed": (m) => m.origin ?? "orbit", external: (m) => m.host ?? "host", catalog: () => "orbit-catalog" };

const server = (m) =>
  resource("mcp", { id: m.id, key: m.key, source: (SOURCE[m.ownership] ?? (() => "unknown"))(m), ownership: m.ownership, enabled: m.enabled, runtimeReady: m.runtimeReady, available: m.available, eligible: m.eligible, selection: m.selection, priority: m.priority, state: m.state, why: m.why, summary: m.description || m.name, provides: m.provides, signals: m.signals, requiresSignal: m.requiresSignal, policy: m.policy, detail: { name: m.name, transport: m.transport ?? null, status: m.status, checkedAt: m.checkedAt ?? null, catalog: m.catalog ?? null, runtime: m.runtime?.kind ?? null, stale: m.stale === true } });
