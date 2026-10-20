import type { ActionState, ApprovalState, Evidence, HealthLevel, HealthLink, Lifecycle, TaskEvent, TaskRef, VerificationState } from "./mission.types";

// The engine's words for a task, and what each means in a sentence. The words, their order and what
// makes a task reach one are the engine's (src/task/model.mjs); this only names them. Every status
// carries its WORD -- a colour is never the only signal -- and nothing here says "thinking": a task
// records a decision, not a chain of thought.

export const MISSION_PATH = "/mission-control";

export const APPROVALS_ROUTE = "approvals";

export const APPROVALS_PATH = `${MISSION_PATH}/${APPROVALS_ROUTE}`;

export const HEALTH_PATH = `${MISSION_PATH}/health`;

/** The route below Mission Control that names one task: both identities of its checkout, and its own. */
export const TASK_ROUTE = ":key/checkouts/:checkout/tasks/:task";

const part = encodeURIComponent;

export const taskPath = (ref: TaskRef) => `${MISSION_PATH}/${part(ref.key)}/checkouts/${part(ref.checkout)}/tasks/${part(ref.task)}`;

/** Each Health level in a word as well as a colour: a colour is never the only signal. */
export const HEALTH_LEVEL: Record<HealthLevel, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "OK" },
  info: { tone: "informative", label: "Info" },
  attention: { tone: "warning", label: "Needs a person" },
  problem: { tone: "danger", label: "Problem" },
};

export const AREA_LABEL: Record<string, string> = { automation: "Automation", tasks: "Tasks", resources: "Tools and MCP servers", hosts: "Agentic hosts" };

/** Where a Health row's link goes: the approvals queue, one task, or a page of this app the server named. */
export function healthLinkPath(link: HealthLink): string | null {
  if (link.task) return taskPath(link.task);
  if (link.to === "approvals") return APPROVALS_PATH;
  return link.to ? `/${link.to.split("/").map(part).join("/")}` : null;
}

export const taskApiPath = (ref: TaskRef) => `/api/v1/projects/${part(ref.key)}/checkouts/${part(ref.checkout)}/tasks/${part(ref.task)}`;

export type Tone = "brand" | "success" | "warning" | "danger" | "informative" | "subtle";

export const LIFECYCLE: Record<Lifecycle, { tone: Tone; say: string }> = {
  QUEUED: { tone: "subtle", say: "Nothing has started yet." },
  PREPARING: { tone: "informative", say: "Getting ready: the requirement, the context, the environment, the workspace." },
  EXECUTING: { tone: "brand", say: "Working on the change." },
  VERIFYING: { tone: "brand", say: "Checking what it changed." },
  WAITING_APPROVAL: { tone: "warning", say: "An action it asked for waits for a person." },
  PAUSED: { tone: "warning", say: "A person paused it. Nothing new starts until it is resumed; something already running may still finish." },
  BLOCKED: { tone: "danger", say: "It cannot go on, for the reason it records." },
  COMPLETED: { tone: "success", say: "It finished." },
  FAILED: { tone: "danger", say: "It stopped, for the reason it records." },
  CANCELLED: { tone: "subtle", say: "A person cancelled it. Nothing new starts; nothing running was stopped by the cancel." },
};

export const TERMINAL: readonly Lifecycle[] = ["COMPLETED", "FAILED", "CANCELLED"];

export const STOP_SAY: Record<string, string> = {
  REQUIREMENT_BLOCKED: "the requirement cannot be worked on as it stands",
  ENVIRONMENT_BLOCKED: "the environment it needs is not available",
  HUMAN_APPROVAL_REQUIRED: "it waits for a person to approve one action",
  NO_PROGRESS: "its attempts keep ending the same way",
  BUDGET_EXHAUSTED: "its budget is spent",
  UNSAFE_CHANGE: "the next change would not be safe to make",
  VERIFICATION_FAILED: "what it changed could not be verified",
  EXECUTION_FAILED: "an action it needed could not be carried out",
  CANCELLED_BY_HUMAN: "a person cancelled it",
};

export const stopSay = (stop: string | null) => (stop ? (STOP_SAY[stop] ?? stop) : null);

/** IMPLEMENTING -> Implementing: a stage read as a word in a sentence. */
export const stageLabel = (stage: string | null) => (stage ? `${stage.charAt(0)}${stage.slice(1).toLowerCase()}` : "no stage yet");

export const APPROVAL: Record<ApprovalState, { tone: Tone; label: string }> = {
  pending: { tone: "warning", label: "waits for a person" },
  granted: { tone: "success", label: "approved once" },
  rejected: { tone: "danger", label: "rejected" },
  expired: { tone: "subtle", label: "expired" },
  consumed: { tone: "subtle", label: "used" },
};

// What an action came to. "running" is a word, never an animation: the page shows what the journal
// holds, and a progress bar would be a guess.
export const ACTION: Record<ActionState, { tone: Tone; label: string }> = {
  running: { tone: "informative", label: "running" },
  succeeded: { tone: "success", label: "✓ succeeded" },
  failed: { tone: "danger", label: "✗ failed" },
  abandoned: { tone: "subtle", label: "abandoned" },
  error: { tone: "danger", label: "could not run" },
  ended: { tone: "subtle", label: "ended" },
};

export const EVIDENCE: Record<Evidence, string> = {
  receipt: "receipt",
  reported: "reported by the agent",
};

export const VERIFICATION: Record<VerificationState, { tone: Tone; label: string }> = {
  satisfied: { tone: "success", label: "satisfied" },
  violated: { tone: "danger", label: "violated" },
  "not-verified": { tone: "subtle", label: "not verified" },
  blocked: { tone: "warning", label: "blocked" },
  "needs-requirement": { tone: "warning", label: "needs requirement" },
  "not-applicable": { tone: "subtle", label: "not applicable" },
};

/** Readiness words come from three places (the journal, a receipt, the registry): one tone table for all. */
const READY_TONES: readonly (readonly [readonly string[], Tone])[] = [
  [["READY", "RUNNING", "CURRENT", "LINKED", "APPLIED", "PASSED", "PASS"], "success"],
  [["BLOCKED", "FAILED", "STOPPED_UNEXPECTEDLY", "UNREACHABLE"], "danger"],
  [["UNKNOWN", "PARTIAL", "STALE"], "warning"],
];

export const readinessTone = (word: string): Tone => READY_TONES.find(([words]) => words.includes(word))?.[1] ?? "informative";

// ---- the timeline: one line per journal record, in words ------------------------------------------

const text = (event: TaskEvent, key: string): string | null => {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const numberOf = (id: string | null) => (id ? (id.split("-").at(-1) ?? id) : "?");

/** What each line of the journal says, given the actions' labels by id. Unknown kinds say their kind. */
export function eventLine(event: TaskEvent, labels: ReadonlyMap<string, string>): string {
  const id = text(event, "id");
  const label = (id && labels.get(id)) ?? text(event, "label") ?? text(event, "type") ?? id ?? "an action";
  const lines: Record<string, () => string> = {
    created: () => "Task created",
    stage: () => `Stage: ${stageLabel(text(event, "stage"))}`,
    "attempt-started": () => `Attempt ${numberOf(id)} started${text(event, "cause") ? ` (${text(event, "cause")})` : ""}`,
    "attempt-completed": () => `Attempt ${numberOf(id)} ended: ${text(event, "outcome") ?? "?"}`,
    decision: () => `Decision recorded: ${text(event, "observed") ?? ""} → ${text(event, "nextAction") ?? ""}`,
    "action-started": () => `${label} started`,
    "action-completed": () => `${label}  ${text(event, "outcome") === "succeeded" ? "✓" : text(event, "outcome") === "failed" ? "✗" : (text(event, "outcome") ?? "")}${text(event, "summary") ? ` ${text(event, "summary")}` : ""}`,
    "action-failed": () => `${label} could not run${text(event, "reason") ? `: ${text(event, "reason")}` : ""}`,
    workspace: () => `Workspace ${text(event, "workspace") ?? ""} linked`,
    "file-changed": () => `${text(event, "path") ?? "a file"} ${text(event, "change") ?? "changed"}`,
    receipt: () => `Receipt ${text(event, "domain") ?? ""}:${text(event, "ref") ?? ""}${text(event, "outcome") ? ` — ${text(event, "outcome")}` : ""}`,
    verification: () => `Verification: ${text(event, "obligation") ?? ""} — ${text(event, "state") ?? ""}`,
    "approval-requested": () => `Approval ${id ?? ""} asked: ${text(event, "action") ?? ""} on ${text(event, "environment") ?? "?"}`,
    "approval-granted": () => `Approval ${id ?? ""} approved once by a person`,
    "approval-rejected": () => `Approval ${id ?? ""} rejected by a person`,
    "approval-consumed": () => `Approval ${id ?? ""} used by ${text(event, "action") ?? "an action"}`,
    "approval-expired": () => `Approval ${id ?? ""} expired`,
    paused: () => "Paused by a person",
    resumed: () => "Resumed by a person",
    cancelled: () => "Cancelled by a person",
    blocked: () => `Blocked: ${stopSay(text(event, "stop")) ?? ""}`,
    unblocked: () => "Unblocked",
    completed: () => "Completed",
    failed: () => `Failed: ${stopSay(text(event, "stop")) ?? ""}`,
  };
  return Object.hasOwn(lines, event.kind) ? lines[event.kind]() : event.kind;
}

const FAILED_KINDS = ["action-failed", "failed", "blocked", "approval-rejected"];

const ENDING_KINDS = ["action-completed", "attempt-completed"];

/** A line that says something went wrong. The page marks it in words as well as in colour. */
export const eventFailed = (event: TaskEvent) => FAILED_KINDS.includes(event.kind) || (ENDING_KINDS.includes(event.kind) && event.outcome === "failed");
