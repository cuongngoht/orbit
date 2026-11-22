// What the API answers about the virtual office, AI connections and resources, for the web app's tests. Ids are UUIDs,
// as the contract's validators require them.
import {
  DEFAULT_PRESETS,
  type AiConnectionsView,
  type AssignmentView,
  type Department,
  type EmployeeCard,
  type EmployeeDetail,
  type ExecutionProfile,
  type HandoffView,
  type Inbox,
  type InboxItem,
  type MissionDetail,
  type MissionList,
  type MissionSummary,
  type OccurrenceView,
  type ResourcePreset,
  type ResourceProfile,
  type ResourceSummary,
  type Roster,
  type RunView,
  type RuntimeCapabilities,
  type RuntimeConnection,
  type ScheduleView,
} from "@orbit-web/contracts";

export const AS_OF = "2026-11-21T09:00:00.000Z";
export const DEPT_ACCOUNTING = "d1000000-0000-4000-8000-000000000001";
export const DEPT_LEGAL = "d1000000-0000-4000-8000-000000000002";
export const EMP_ANA = "e1000000-0000-4000-8000-000000000001";
export const EMP_BAO = "e1000000-0000-4000-8000-000000000002";
export const CONN_CLAUDE = "c1000000-0000-4000-8000-000000000001";
export const CONN_CLAUDE_KEY = "c1000000-0000-4000-8000-000000000003";
export const CONN_CODEX = "c1000000-0000-4000-8000-000000000002";
export const MISSION_ID = "a1000000-0000-4000-8000-000000000001";
export const HELD_MISSION_ID = "a1000000-0000-4000-8000-000000000002";
export const ASSIGNMENT_ID = "b1000000-0000-4000-8000-000000000001";
export const SCHEDULE_ID = "f1000000-0000-4000-8000-000000000001";
export const PLUGIN_DIGEST = "9".repeat(64);
export const HANDOFF_DIGEST = "ab".repeat(32);
export const HANDOFF_DIGEST_1 = "cd".repeat(32);

export const department = (over: Partial<Department> = {}): Department => ({ id: DEPT_ACCOUNTING, name: "Accounting", position: 0, archived: false, version: 1, members: 1, ...over });

export const execution = (over: Partial<ExecutionProfile> = {}): ExecutionProfile => ({ runtime: "claude", connectionId: CONN_CLAUDE, model: "sonnet", effort: "medium", webSearch: false, orbitPlugin: false, ...over });

export function employeeCard(over: Partial<EmployeeCard> = {}): EmployeeCard {
  return {
    id: EMP_ANA,
    name: "Ana",
    title: "Accountant",
    kind: "permanent",
    departmentId: DEPT_ACCOUNTING,
    managerId: null,
    employment: "active",
    availability: "available",
    workLabel: "ready",
    notReadyReason: null,
    holding: null,
    queued: 0,
    execution: execution(),
    connectionWarning: null,
    expiresAt: null,
    version: 4,
    updatedAt: "2026-11-21T08:30:00.000Z",
    ...over,
  };
}

// Bao works on a quarterly report, with one more piece of work queued behind it.
export const busyBao = (over: Partial<EmployeeCard> = {}): EmployeeCard =>
  employeeCard({
    id: EMP_BAO,
    name: "Bao",
    title: "Legal analyst",
    departmentId: DEPT_LEGAL,
    availability: "busy",
    workLabel: "working",
    holding: { assignmentId: "b1000000-0000-4000-8000-000000000009", missionId: HELD_MISSION_ID, title: "Quarterly contracts review", state: "RUNNING", since: "2026-11-21T07:00:00.000Z" },
    queued: 1,
    ...over,
  });

export function roster(over: Partial<Roster> = {}): Roster {
  return {
    office: { id: "0ff1ce00-0000-4000-8000-000000000001", name: "Octo office", version: 7, createdAt: "2026-11-20T00:00:00.000Z" },
    departments: [department(), department({ id: DEPT_LEGAL, name: "Legal", position: 1 })],
    employees: [employeeCard(), busyBao()],
    nextCursor: null,
    version: 7,
    asOf: AS_OF,
    counts: { employees: 2, ready: 1, busy: 1, notReady: 0, queued: 1, inbox: 2 },
    ...over,
  };
}

// An account with no office yet.
export const notSetUp = (): Roster => roster({ office: null, departments: [], employees: [], counts: { employees: 0, ready: 0, busy: 0, notReady: 0, queued: 0, inbox: 0 } });

export const capabilities = (over: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({ start: "yes", stream: "yes", cancel: "yes", resume: "yes", usage: "yes", webSearch: "yes", toolPlaneSplit: "yes", pluginObservation: "yes", ...over });

// A Claude Code subscription connection, connected, with its account's catalog and the Orbit plugin approved for employees.
export function connection(over: Partial<RuntimeConnection> = {}): RuntimeConnection {
  return {
    id: CONN_CLAUDE,
    runtime: "claude",
    label: "Claude subscription",
    isDefault: true,
    reasonCode: null,
    method: "subscription",
    auth: "connected",
    reason: null,
    identity: "ann@example.com",
    checkedAt: "2026-11-21T08:59:00.000Z",
    catalog: {
      source: "account",
      models: [
        { id: "sonnet", label: "Sonnet 5.5", description: null, efforts: ["low", "medium", "high"], autoMode: true },
        { id: "opus", label: "Opus 5.5", description: null, efforts: ["low", "medium", "high", "max"], autoMode: true },
        { id: "haiku", label: "Haiku 5.5", description: null, efforts: [], autoMode: true },
      ],
      recommended: "sonnet",
      checkedAt: "2026-11-21T08:59:00.000Z",
    },
    capabilities: capabilities(),
    terminalCommand: `docker compose exec orbit-web node /opt/orbit-web/apps/api/dist/cli/connect.js ${CONN_CLAUDE}`,
    signInHere: true,
    plugins: { plugin: "orbit", installed: true, version: "0.6.0", digest: PLUGIN_DIGEST, useCases: { chat: { approved: false, needsConfirmation: false, decidedAt: null }, employee: { approved: true, needsConfirmation: false, decidedAt: "2026-11-21T08:00:00.000Z" } }, revision: 2 },
    employees: 2,
    version: 5,
    createdAt: "2026-11-20T00:00:00.000Z",
    ...over,
  };
}

export function connectionsView(over: Partial<AiConnectionsView> = {}): AiConnectionsView {
  return {
    installations: [
      { runtime: "claude", state: "installed", version: "2.1.330", detail: null, checkedAt: "2026-11-21T08:58:00.000Z" },
      { runtime: "codex", state: "not_installed", version: null, detail: "codex was not found on this server's PATH.", checkedAt: "2026-11-21T08:58:00.000Z" },
      { runtime: "agy", state: "installed", version: "1.4.0", detail: null, checkedAt: "2026-11-21T08:58:00.000Z" },
    ],
    connections: [connection()],
    methods: [
      { runtime: "claude", method: "subscription", state: "supported", note: "Signed in by the unmodified Claude Code binary, in a terminal of the server.", source: "https://code.claude.com/docs/en/legal-and-compliance" },
      { runtime: "claude", method: "api_key", state: "supported", note: "Your own Claude Console API key.", source: "https://code.claude.com/docs/en/authentication" },
      { runtime: "claude", method: "cloud", state: "blocked", note: "Bedrock, Vertex and Foundry are not verified here.", source: null },
      { runtime: "codex", method: "subscription", state: "not_verified", note: "Codex's official page could not be read: not verified.", source: null },
      { runtime: "codex", method: "api_key", state: "not_verified", note: "Codex's official page could not be read: not verified.", source: null },
      { runtime: "agy", method: "subscription", state: "not_permitted", note: "A Google sign-in relayed for an unattended employee is not permitted by the provider's terms.", source: "https://antigravity.google/terms" },
      { runtime: "agy", method: "api_key", state: "supported", note: "The documented Gemini API key mode.", source: null },
    ],
    canHire: true,
    asOf: AS_OF,
    ...over,
  };
}

export function resourceSummary(over: Partial<ResourceSummary> = {}): ResourceSummary {
  const ceiling = { cpuMillis: 4000, memoryMiB: 8192, deskStorageMiB: 30720, scratchStorageMiB: 20480, cacheStorageMiB: 10240 };
  return {
    capacity: {
      source: "detected",
      total: { cpuMillis: 8000, memoryMiB: 16384, storageMiB: 204800 },
      headroom: { cpuMillis: 2000, memoryMiB: 4096, storageMiB: 20480 },
      usable: { cpuMillis: 6000, memoryMiB: 12288, storageMiB: 184320 },
      storage: { mechanism: "xfs-loop-pool", perArea: "HARD_ENFORCED", hostProtection: "HARD_ENFORCED", evidence: "An over-quota write was refused by the kernel.", probedAt: AS_OF },
      checkedAt: AS_OF,
    },
    budget: { cpuMillis: 6000, memoryMiB: 12288, storageMiB: 102400, maxConcurrent: 3, perEmployee: ceiling, authorized: { cpuMillis: 6000, memoryMiB: 12288, storageMiB: 184320, maxConcurrent: 4, perEmployee: ceiling }, version: 2, updatedAt: AS_OF },
    reserved: { cpuMillis: 2500, memoryMiB: 5120, scratchMiB: 5120 },
    available: { cpuMillis: 3500, memoryMiB: 7168 },
    storage: {
      budgetMiB: 102400,
      committedMiB: 30720,
      usedMiB: 4096,
      byCategory: {
        desk: { committedMiB: 25600, usedMiB: 2048 },
        cache: { committedMiB: 5120, usedMiB: 1024 },
        team: { committedMiB: 0, usedMiB: 0 },
        scratch: { committedMiB: 5120, usedMiB: 512 },
        artifacts: { committedMiB: 0, usedMiB: 256 },
        research: { committedMiB: 0, usedMiB: 200 },
        logs: { committedMiB: 0, usedMiB: 56 },
      },
      measuredAt: AS_OF,
    },
    running: 1,
    waiting: 1,
    unschedulable: 0,
    modelPlane: [{ runtime: "claude", cpuMillis: 500, memoryMiB: 1024 }],
    asOf: AS_OF,
    ...over,
  };
}

export const presets = (): ResourcePreset[] => DEFAULT_PRESETS.map((p) => ({ ...p, profile: { ...p.profile } }));

export const profile = (over: Partial<ResourceProfile> = {}): ResourceProfile => ({ ...(DEFAULT_PRESETS[0] as ResourcePreset).profile, ...over });

export function runView(over: Partial<RunView> = {}): RunView {
  return {
    id: "71000000-0000-4000-8000-000000000001",
    attemptNo: 1,
    state: "running",
    requested: { model: "opus", effort: "high" },
    resolved: execution({ model: "opus", effort: "high" }),
    observed: { model: "claude-opus-5-5", effort: "unknown", plugins: "unknown", runtimeVersion: "2.1.330", nativeSession: null },
    modelUsage: { costUsd: null, turns: null, durationMs: null },
    sandbox: { provider: "container", state: "attested", shell: true, detail: "Filesystem, process, network and credential scope checked from outside the shell.", checks: [{ name: "sibling attempt canary absent", ok: true, detail: null }], checkedAt: AS_OF },
    resources: {
      requested: { ...profile(), modelPlane: { cpuMillis: 500, memoryMiB: 1024 } },
      applied: { cpuMillis: 1000, memoryMiB: 2048, pidsLimit: 256, readBackAt: AS_OF },
      observed: { cpuQuota: "100000 100000", memoryLimit: null, pidsMax: "256", storage: [{ area: "scratch", level: "HARD_ENFORCED", evidence: "over-quota write refused" }], at: AS_OF },
    },
    usage: { modelPlane: null, toolPlane: { cpuSeconds: 42, memoryCurrentMiB: 900, memoryPeakMiB: 1900, oomKilled: false, pidsPeak: 30, diskUsedMiB: 300, networkBytesIn: null, networkBytesOut: null, sampledAt: AS_OF } },
    waitingReason: null,
    startedAt: "2026-11-21T08:40:00.000Z",
    endedAt: null,
    detail: null,
    ...over,
  };
}

export function employeeDetail(over: Partial<EmployeeDetail> = {}): EmployeeDetail {
  const card = employeeCard();
  return {
    ...card,
    profile: { title: card.title, duties: "Books and reconciles.", instructions: "Cite every figure.", skills: ["bookkeeping"], languages: ["English"], knowledge: [], execution: card.execution, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
    profileRevision: 2,
    revisions: [
      { revision: 2, note: "Clearer duties", basedOn: 1, createdBy: "Ann Owner", createdAt: "2026-11-21T07:00:00.000Z" },
      { revision: 1, note: "Hired", basedOn: null, createdBy: "Ann Owner", createdAt: "2026-11-20T07:00:00.000Z" },
    ],
    desk: { id: "de5c0000-0000-4000-8000-000000000001", version: 3, files: 12 },
    queue: [],
    history: [],
    sandbox: {
      id: "5b000000-0000-4000-8000-000000000001",
      state: "READY",
      reason: null,
      provider: "container",
      areas: [
        { area: "desk", quotaMiB: 5120, usedMiB: 300, level: "HARD_ENFORCED", evidence: "over-quota write refused" },
        { area: "scratch", quotaMiB: 5120, usedMiB: null, level: "SOFT_MONITORED", evidence: "measured every 30 s" },
      ],
      resourceRevision: 1,
      resources: profile(),
      version: 1,
    },
    resourceRevisions: [{ revision: 1, profile: profile(), note: "At hire", createdBy: "Ann Owner", createdAt: "2026-11-20T07:00:00.000Z" }],
    activeRun: null,
    ...over,
  };
}

export function handoff(over: Partial<HandoffView> = {}): HandoffView {
  return {
    id: "4a000000-0000-4000-8000-000000000002",
    assignmentId: ASSIGNMENT_ID,
    revision: 2,
    digest: HANDOFF_DIGEST,
    summary: "The Q3 report, corrected.",
    status: "submitted",
    artifacts: [{ id: "a7000000-0000-4000-8000-000000000001", name: "q3-report.pdf", kind: "deliverable", mediaType: "application/pdf", size: 2 * 1048576, sha256: "e".repeat(64) }],
    claims: [
      { text: "Revenue was 2,000,000 VND.", sources: [{ label: "S1", sourceId: "s", revisionId: "r", locator: "page 3", excerpt: "Total: 2,000,000" }], supported: true },
      { text: "Costs fell by a tenth.", sources: [], supported: false },
    ],
    missing: ["summary.xlsx"],
    submittedAt: "2026-11-21T08:50:00.000Z",
    submittedBy: "Ana",
    review: null,
    ...over,
  };
}

export function assignmentView(over: Partial<AssignmentView> = {}): AssignmentView {
  return {
    id: ASSIGNMENT_ID,
    missionId: MISSION_ID,
    title: "Q3 report",
    employeeId: EMP_ANA,
    employeeName: "Ana",
    state: "AWAITING_ACCEPTANCE",
    reason: null,
    waitingOn: null,
    deadline: null,
    version: 9,
    updatedAt: "2026-11-21T08:50:00.000Z",
    parentId: null,
    unitKey: null,
    brief: { goal: "Write the Q3 report.", deliverables: [{ name: "q3-report.pdf", required: true }], acceptanceCriteria: ["Totals match the ledger"], dependsOn: [] },
    handoffRevision: 2,
    reworkCount: 1,
    pinned: { profileRevision: 2, departmentId: DEPT_ACCOUNTING, departmentName: "Accounting", execution: execution() },
    lastRun: runView({ state: "succeeded", endedAt: "2026-11-21T08:49:00.000Z" }),
    attempts: 2,
    claimedAt: "2026-11-21T08:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-11-21T08:00:00.000Z",
    actions: ["accept", "request_revision", "cancel"],
    ...over,
  };
}

export function missionDetail(over: Partial<MissionDetail> = {}): MissionDetail {
  const a = assignmentView();
  return {
    id: MISSION_ID,
    title: "Q3 report",
    goal: "Write the Q3 report.",
    state: "open",
    assignment: { id: a.id, missionId: a.missionId, title: a.title, employeeId: a.employeeId, employeeName: a.employeeName, state: a.state, reason: a.reason, waitingOn: a.waitingOn, deadline: a.deadline, version: a.version, updatedAt: a.updatedAt },
    deadline: null,
    nextAction: "Review revision 2",
    scheduleId: null,
    createdAt: "2026-11-21T08:00:00.000Z",
    updatedAt: "2026-11-21T08:50:00.000Z",
    createdBy: "Ann Owner",
    acceptanceMode: "owner_review",
    acceptanceCriteria: ["Totals match the ledger"],
    deliverables: [{ name: "q3-report.pdf", required: true }],
    workspaceId: null,
    sourceRevisionIds: [],
    planRevision: 1,
    assignments: [a],
    handoffs: [handoff({ id: "4a000000-0000-4000-8000-000000000001", revision: 1, digest: HANDOFF_DIGEST_1, status: "revision_requested", summary: "The Q3 report.", review: { by: "Ann Owner", at: "2026-11-21T08:20:00.000Z", note: "Totals are off" } }), handoff()],
    timeline: [{ seq: 1, at: "2026-11-21T08:00:00.000Z", type: "MissionCreated", actor: "Ann Owner", summary: "Ann Owner assigned it to Ana.", assignmentId: ASSIGNMENT_ID }],
    deliveries: [],
    resourceVersion: 12,
    ...over,
  };
}

export function missionSummary(over: Partial<MissionSummary> = {}): MissionSummary {
  const m = missionDetail();
  return { id: m.id, title: m.title, goal: m.goal, state: m.state, assignment: m.assignment, deadline: m.deadline, nextAction: m.nextAction, scheduleId: null, createdAt: m.createdAt, updatedAt: m.updatedAt, ...over };
}

export const missionList = (missions: MissionSummary[], over: Partial<MissionList> = {}): MissionList => ({ missions, nextCursor: null, version: 7, asOf: AS_OF, ...over });

export function inboxItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "1b000000-0000-4000-8000-000000000001",
    kind: "unschedulable",
    state: "open",
    missionId: MISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    title: "Q3 report cannot start",
    reason: "It needs 8 GiB of memory; the account's budget is 6 GiB.",
    waiting: "Ana",
    deadline: null,
    pin: { assignmentVersion: 9, handoffDigest: null, deliveryId: null },
    createdAt: "2026-11-21T08:55:00.000Z",
    resolvedAt: null,
    resolution: null,
    ...over,
  };
}

export const inbox = (items: InboxItem[], over: Partial<Inbox> = {}): Inbox => ({ items, open: items.filter((i) => i.state === "open").length, nextCursor: null, version: 7, asOf: AS_OF, ...over });

export function occurrence(over: Partial<OccurrenceView> = {}): OccurrenceView {
  return { id: "0c000000-0000-4000-8000-000000000001", scheduleId: SCHEDULE_ID, periodKey: "2026-Q3", dueAt: "2026-10-01T01:00:00.000Z", scheduleRevision: 1, state: "created", missionId: MISSION_ID, assignmentState: "COMPLETED", delivery: "SENDING", createdAt: "2026-10-01T01:00:00.000Z", ...over };
}

export function scheduleView(over: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: SCHEDULE_ID,
    name: "Quarterly report",
    rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" },
    employeeId: EMP_ANA,
    employeeName: "Ana",
    recipients: [{ address: "ann@example.com", channel: "inbox" }],
    missedPolicy: "catch_up_each",
    catchUpLimit: 4,
    state: "active",
    revision: 1,
    version: 3,
    next: [{ dueAt: "2027-01-01T01:00:00.000Z", local: "2027-01-01 08:00", periodKey: "2026-Q4", periodStart: "2026-10-01", periodEnd: "2026-12-31" }],
    lastOccurrence: occurrence(),
    ...over,
  };
}
