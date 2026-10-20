// Connections and PO Reports as control-server answers them, in memory -- for
// the pages that configure a project's report. Like the real server, no answer
// ever carries a credential: one sent to …/credential is kept here only so a
// test can prove where it went.
import type { Connection, ConnectionTest, Provider } from "../features/connections/connections.types";
import type { PartsView, ReportSettings, ReportsOverview, SettingsView, Unavailable } from "../features/reports/reports.types";
import { reply, type Call } from "./fakeServer";

export const PROVIDERS: Provider[] = [
  { id: "github", label: "GitHub", connection: { fields: [{ name: "host", label: "API host", default: "https://api.github.com" }, { name: "organization", label: "Owner", required: true }] }, scope: { fields: [{ name: "repositories", label: "Repositories", type: "list", required: true }, { name: "issues", label: "Issues", type: "boolean", default: true }] }, credential: { kind: "fine-grained personal access token", advice: "Read-only: Metadata, Pull requests, Issues.", docs: ["https://docs.github.com/en/authentication"] }, capabilities: [] },
  { id: "azure-devops", label: "Azure DevOps", connection: { fields: [{ name: "host", label: "Organization URL", default: "https://dev.azure.com" }, { name: "organization", label: "Organization", required: true }] }, scope: { fields: [{ name: "project", label: "Project", required: true }] }, credential: { kind: "organization-scoped personal access token", advice: "Read scopes only.", docs: ["https://learn.microsoft.com/azure/devops"] }, capabilities: [] },
];

const DEFAULTS: ReportSettings = { provider: null, connection: null, scope: {}, docs: null, period: { months: 2 }, timezone: null, output: { dir: null, formats: ["html"] }, sections: {}, mapping: {}, assumptions: {}, parts: {}, retention: 20 };

const SECTIONS = [{ id: "orbit.report.section.summary", title: "Summary", enabled: true }, { id: "orbit.report.section.contributors", title: "Contributors", enabled: false }, { id: "orbit.report.section.coverage", title: "Data coverage & method", enabled: true, locked: true }];

const connection = (id: string, over: Partial<Connection> = {}): Connection => ({ id, provider: "github", host: "https://api.github.com", organization: "acme", credential: { set: false, from: null }, ...over });

export function fakeReports() {
  const connections = new Map<string, Connection>([["github-acme", connection("github-acme", { credential: { set: true, from: "vault" } })]]);
  const received: { id: string; body: unknown }[] = [];
  const state = { backend: "macos-keychain" as string | null, settings: { ...DEFAULTS }, revision: null as string | null, n: 0, inCheckout: true, pythonReady: false };
  const test: ConnectionTest = { at: "2026-09-25T04:00:00.000Z", ok: false, identity: "lan", checks: [{ id: "authentication", status: "ok", permission: null, message: "signed in as lan" }, { id: "acme/web · actions", status: "forbidden", permission: "actions: read", message: "the credential may not read this (HTTP 403)" }] };
  const unavailable: Unavailable = { available: false, why: "Start Orbit Control from the project's checkout: a project report is about the repository it was started in." };

  const overview = (): ReportsOverview => ({ available: true, project: { name: "portal", root: "/work/portal", initialized: false }, provider: state.settings.provider, connection: state.settings.connection ? connections.get(state.settings.connection) ?? null : null, connectionMissing: false, python: state.pythonReady ? { ready: true, version: "3.12.4", from: "orbit-managed" } : { ready: false, reason: "no Python 3.11 or newer was found" }, revision: state.revision, output: "/work/portal/ui-tests/reports/project-reports", runs: [], latest: null });
  const settingsView = (): SettingsView => ({ available: true, settings: state.settings, revision: state.revision, exists: state.revision !== null, providers: PROVIDERS, sections: SECTIONS, connections: [...connections.values()], machineTimezone: "Asia/Ho_Chi_Minh" });
  const parts = (): PartsView => ({ available: true, revision: state.revision, standard: [{ id: "orbit.report.forecast", version: "1.0.0", kind: "metric", source: "builtin", from: "orbit", doc: "A throughput Monte Carlo", provides: ["report.forecast"], needs: ["report.model"], provider: null, metrics: 0, enabled: state.settings.parts["orbit.report.forecast"]?.enabled !== false, last: null }], project: [{ id: "demo.forecast", version: "0.1.0", kind: "metric", source: "store", from: "demo", doc: "A forecast by story points", provides: ["report.forecast"], needs: ["report.model"], provider: null, metrics: 1, enabled: true, last: null, replaces: "orbit.report.forecast", approved: state.settings.parts["demo.forecast"]?.replace === true, basedOn: [], section: null, extension: { id: "demo", version: "0.1.0", status: "active", createdFor: "PO wants points", fingerprint: "ok", versions: [] } }], refused: [], contested: [], would: { run: ["orbit.report.metrics", "orbit.report.forecast"], skipped: [] } });

  const saveSettings = (call: Call): Response => {
    const body = call.body as { settings: ReportSettings; revision: string | null };
    if (body.revision !== state.revision) return reply(409, { error: { code: "STALE_REVISION", message: "These settings were changed since you opened them. Reload, then make your change again." } });
    state.settings = body.settings;
    state.revision = `rev-${++state.n}`;
    return reply(200, { saved: { ...state.settings, revision: state.revision } });
  };

  const switchPart = (action: string, call: Call): Response => {
    const body = call.body as { part: string; revision: string | null };
    const was = state.settings.parts[body.part] ?? {};
    const next = { enable: { ...was, enabled: true }, disable: { ...was, enabled: false }, approve: { ...was, enabled: true, replace: true }, unapprove: { ...was, replace: false } }[action] ?? was;
    return saveSettings({ ...call, body: { settings: { ...state.settings, parts: { ...state.settings.parts, [body.part]: next } }, revision: body.revision } });
  };

  const connectionCall = (call: Call): Response | null => {
    const [, id, action] = /^\/api\/v1\/connections\/([^/]+)(?:\/(\w+))?$/.exec(call.path) ?? [];
    const found = id ? connections.get(decodeURIComponent(id)) : undefined;
    if (!found) return reply(404, { error: { code: "CONNECTION_NOT_FOUND", message: "there is no connection by that name on this machine" } });
    if (action === "credential" && call.method === "PUT") return credential(found, call);
    if (action === "test") return (connections.set(found.id, { ...found, lastTest: test }), reply(200, test));
    if (call.method === "DELETE" && !action) return (connections.delete(found.id), reply(200, { id: found.id, removed: true }));
    return reply(200, found);
  };

  const credential = (found: Connection, call: Call): Response => {
    received.push({ id: found.id, body: call.body });
    const body = call.body as { value?: string; env?: string };
    if (body.value !== undefined && !state.backend) return reply(503, { error: { code: "CREDENTIAL_NOT_SET", message: "no OS secret store is available on this machine" } });
    const next = { ...found, credential: body.env ? { set: true, from: "env" as const, name: body.env } : { set: true, from: "vault" as const } };
    connections.set(found.id, next);
    return reply(200, { connection: next, backend: state.backend });
  };

  const handle = (call: Call): Response | null => {
    if (call.path === "/api/v1/connections" && call.method === "GET") return reply(200, { connections: [...connections.values()], providers: PROVIDERS, backend: state.backend });
    if (call.path === "/api/v1/connections" && call.method === "POST") return created(call);
    if (call.path.startsWith("/api/v1/connections/")) return connectionCall(call);
    if (!call.path.startsWith("/api/v1/reports/")) return null;
    if (!state.inCheckout) return reply(200, unavailable);
    return reports(call);
  };

  const created = (call: Call): Response => {
    const body = call.body as { id: string; provider: string; organization: string };
    const made = connection(body.id, { provider: body.provider, organization: body.organization });
    connections.set(made.id, made);
    return reply(200, made);
  };

  const reports = (call: Call): Response | null => {
    if (call.path === "/api/v1/reports/overview") return reply(200, overview());
    if (call.path === "/api/v1/reports/settings") return call.method === "PUT" ? saveSettings(call) : reply(200, settingsView());
    if (call.path === "/api/v1/reports/parts") return reply(200, parts());
    const action = /^\/api\/v1\/reports\/parts\/(\w+)$/.exec(call.path)?.[1];
    if (action === "verify") return reply(200, { extension: "demo", ok: true, findings: [], fingerprint: "ok" });
    return action ? switchPart(action, call) : null;
  };

  return { handle, connections, received, state };
}
