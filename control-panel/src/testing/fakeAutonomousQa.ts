// Autonomous QA as control-server answers it, in memory. Like the real server,
// a save names the revision it read and a stale one is a 409, a writing mode on
// production is refused, and the report is always the redacted page.
import type { AqaOverview, AqaSettings, InvestigationSummary, Unavailable } from "../features/autonomous-qa/aqa.types";
import { reply, type Call } from "./fakeServer";

const DEFAULTS: AqaSettings = {
  enabled: false,
  environments: [],
  identities: [],
  limits: { actions: 25, requestsPerAction: 40, minutes: 20, pollSeconds: 30, decisions: 50, noProgress: 4 },
  network: { details: true, fingerprints: true, correlationHeaders: [], idempotencyHeaders: ["idempotency-key"], ignoreFields: [] },
  duplicates: { polling: [], retries: [], idempotent: [], intentional: [], contracts: [] },
  consistency: {},
  tenancy: null,
  reports: { internal: false },
  memory: { project: true },
};

const INVESTIGATION: InvestigationSummary = { id: "inv-20260925-120000-ab12", at: "2026-09-25T12:00:00.000Z", objective: "why Save sends two requests", mode: "explore-write", environment: "test", actions: 4, findings: { CONFIRMED_DEFECT: 1, OBSERVED_EXPECTED_BEHAVIOR: 2 }, cancelled: false, lifecycle: "paused", stop: "needs-requirement", inputMode: "hybrid", openQuestions: 1 };

interface SettingsBody {
  settings: AqaSettings;
  revision: string | null;
}

const isSettingsBody = (v: unknown): v is SettingsBody => typeof v === "object" && v !== null && "settings" in v && "revision" in v;

export function fakeAutonomousQa() {
  const state = { settings: { ...DEFAULTS }, revision: null as string | null, n: 0, inCheckout: true, investigations: [INVESTIGATION], reports: [] as string[] };
  const unavailable: Unavailable = { available: false, why: "Start Orbit Control from the project's checkout: an investigation is about the application that checkout tests." };
  const blockers = () => [{ environment: state.settings.environments[0]?.id ?? null, blockers: [...(state.settings.enabled ? [] : [{ id: "DISABLED", stop: "refused" as const, say: "autonomous QA is off for this project" }]), ...(state.settings.environments.length ? [] : [{ id: "NO_ENVIRONMENT", stop: "refused" as const, say: "no environment is approved" }])] }];
  const overview = (): AqaOverview => ({ available: true, version: 1, project: { name: "portal", root: "/work/portal" }, settings: state.settings, revision: state.revision, exists: state.revision !== null, unreadable: null, modes: [{ id: "observe", mutates: false, crossIdentity: false, production: true, say: "read-only" }], switchedOn: true, blockers: blockers(), investigations: state.investigations });

  const save = (call: Call): Response => {
    if (!isSettingsBody(call.body)) return reply(400, { error: { code: "AQA_SETTINGS_INVALID", message: "send { settings, revision }" } });
    if (call.body.revision !== state.revision) return reply(409, { error: { code: "STALE_REVISION", message: "These settings were changed since you opened them. Reload, then make your change again." } });
    if (call.body.settings.environments.some((e) => e.kind === "production" && e.modes.some((m) => m !== "observe" && m !== "regression"))) return reply(400, { error: { code: "AQA_SETTINGS_INVALID", message: "no approval buys explore-write on a production environment" } });
    state.settings = call.body.settings;
    state.revision = `rev-${++state.n}`;
    return reply(200, { saved: { ...state.settings, revision: state.revision } });
  };

  const handle = (call: Call): Response | null => {
    if (!call.path.startsWith("/api/v1/autonomous-qa")) return null;
    if (!state.inCheckout) return reply(200, unavailable);
    if (call.path === "/api/v1/autonomous-qa") return reply(200, overview());
    if (call.path === "/api/v1/autonomous-qa/settings" && call.method === "PUT") return save(call);
    const report = /^\/api\/v1\/autonomous-qa\/investigations\/([^/]+)\/report$/.exec(call.path);
    if (report) return (state.reports.push(decodeURIComponent(report[1] ?? "")), reply(200, { version: 1, html: "<!doctype html><title>Investigation</title>REDACTED" }));
    return reply(404, { error: { code: "NOT_FOUND", message: `no endpoint at ${call.path}` } });
  };

  return { handle, state };
}
