// What the API answers, for the web app's tests.
import type { AzureStatus, ClaudeStatus, GitHubStatus, LoginSnapshot, OrbitPanel, SessionDetail, SetupStatus } from "@orbit-web/contracts";

export const idleFlow = (): LoginSnapshot => ({ state: "idle", url: null, code: null, needsCode: false, message: null, startedAt: null, updatedAt: "2026-11-19T00:00:00.000Z" });

const ok = { ok: true, detail: null };

export function setupStatus(claude: Partial<ClaudeStatus> = {}, github: Partial<GitHubStatus> = {}, azure: Partial<AzureStatus> = {}): SetupStatus {
  const c: ClaudeStatus = { state: "not_connected", method: null, source: null, detail: null, flow: idleFlow(), ...claude };
  const g: GitHubStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), ...github };
  const a: AzureStatus = { state: "not_connected", account: null, detail: null, flow: idleFlow(), availableToClaude: false, ...azure };
  return {
    versions: { web: "0.7.0", orbit: "0.6.0", orbitCommit: "6c36207cd57204f6f50deb3431a5db516b27f4bc", claude: "2.1.328", gh: "2.89.0", git: "2.43.0", az: "2.91.0", node: "24.11.0" },
    claude: c,
    github: g,
    azure: a,
    health: { status: "ok", api: ok, claude: { ok: true, detail: "2.1.328" }, gh: { ok: true, detail: "2.89.0" }, git: ok, az: { ok: true, detail: "2.91.0" }, orbitPlugin: { ok: true, detail: "0.6.0" }, storage: ok },
    ready: c.state === "connected" && g.state === "connected",
  };
}

export const SESSION_ID = "0b6c2f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";

export function sessionDetail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SESSION_ID,
    title: "Fix sum",
    repository: "octo/sum-fixture",
    branch: "main",
    workBranch: "orbit-web/0b6c2f5e",
    model: "sonnet",
    status: "ready",
    statusReason: null,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    baseCommit: "a".repeat(40),
    claudeSessionId: null,
    turns: 0,
    lastSeq: 0,
    messages: [],
    ...over,
  };
}

export function orbitPanel(over: Partial<OrbitPanel> = {}): OrbitPanel {
  return {
    state: "available",
    reason: null,
    checkedAt: "2026-11-19T00:00:00.000Z",
    association: { how: "none", taskId: null },
    presentation: "IDLE",
    task: null,
    work: null,
    planWord: null,
    checks: [],
    missing: [],
    verification: [],
    completion: null,
    approvals: [],
    sessionChecks: [],
    failure: null,
    stop: null,
    verdict: { word: "unknown", label: "Unknown", source: "No Orbit task is linked to this session, so Orbit has given no verdict." },
    ...over,
  };
}
