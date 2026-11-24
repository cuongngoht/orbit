// CEO CHAT (ADR 0062): the company owner's conversations with the AI CEO -- the actual employee holding the CEO's
// appointment, never a virtual one. A conversation belongs to the COMPANY (not to a CEO): each CEO message keeps who
// wrote it (its employee, appointment and revision), so a replaced CEO's answers stay theirs.
//
//   talk      the composer talks to the CEO: a short answer with no tool, on the CEO's own connection, model and
//             effort, admitted like any run of the CEO and never at the same time as another (a TURN);
//   records   a quick action asks Orbit's own records: a deterministic report (no model), labelled as Orbit's, available
//             while the CEO is busy or unavailable;
//   work      an answer may PROPOSE a mission; it is inert until the owner gives it to the CEO in one click (the
//             existing mission creation, `target: { kind: "ceo" }`, held to the responsible the owner saw).
import type { Checked } from "./validate.js";
import { checkCreateMission, isWorkforceId, type CreateMissionRequest, type Deliverable, type Employment, type ExecutionSources, type ExpectedAssignee } from "./workforce.js";

export const EXECUTIVE_LIMITS = {
  textLength: 8000,
  titleLength: 120,
  // Messages a page of history holds, and how many of the last ones a turn is given.
  pageSize: 50,
  historyMessages: 20,
} as const;

// A: no company -- CEO Chat does not exist; B: a company without a CEO; C: a CEO (free, or busy with a run: an answer
// waits for it); D: a CEO that cannot answer now (suspended, not working, its connection or profile unusable).
export const EXECUTIVE_STATES = ["no_company", "no_ceo", "available", "busy", "unavailable"] as const;
export type ExecutiveStateKind = (typeof EXECUTIVE_STATES)[number];

// Whether something can be done now, and why not (a code a page can act on, and the sentence it shows).
export interface ExecutiveCapability {
  ok: boolean;
  code: string | null;
  reason: string | null;
}

export interface ExecutiveCeo {
  employeeId: string;
  name: string;
  title: string;
  employment: Employment;
  appointment: { id: string; revision: number; state: "active" | "suspended"; since: string };
  // What its answers run on, field by field (the existing precedence: its profile, its department, the company).
  execution: { runtime: string; connectionId: string | null; connectionName: string | null; model: string | null; effort: string | null; sources: ExecutionSources };
  // What it holds now: the mission it works on (`running`: an attempt runs now -- an answer waits for it) or waits for
  // its departments on; null: free.
  holding: { missionId: string; title: string; running: boolean } | null;
}

// GET /api/executive: what CEO Chat is for this account now -- the one probe that answers without a company.
export interface ExecutiveState {
  company: { id: string; name: string } | null;
  state: ExecutiveStateKind;
  ceo: ExecutiveCeo | null;
  // Whether the CEO answers a message (now, or once its run ends), and whether work can be given to it now.
  converse: ExecutiveCapability;
  assign: ExecutiveCapability;
}

export interface ExecutiveConversationSummary {
  id: string;
  title: string;
  messages: number;
  createdAt: string;
  lastMessageAt: string | null;
}

export interface ExecutiveConversationList {
  conversations: ExecutiveConversationSummary[];
  nextCursor: string | null;
}

export type ExecutiveRole = "owner" | "ceo" | "system";

// What the CEO proposed: a mission's own fields, checked like a mission (an invalid one is not kept).
export interface MissionProposal {
  title: string;
  goal: string;
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  deadline: string | null;
  priority: number;
}

export const PROPOSAL_STATES = ["open", "given", "dismissed"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const EXECUTIVE_REPORT_KINDS = ["status", "missions", "departments", "resources", "decisions"] as const;
export type ExecutiveReportKind = (typeof EXECUTIVE_REPORT_KINDS)[number];

// A report from Orbit's own records (never a model's words): facts, and the items they are about.
export interface ExecutiveReport {
  kind: ExecutiveReportKind;
  title: string;
  at: string;
  facts: { label: string; value: string }[];
  items: { title: string; detail: string; href: string | null; tone: "ok" | "warning" | "danger" | null }[];
}

export interface ExecutiveMessage {
  id: string;
  conversationId: string;
  // Its place in the conversation (stable; pages are cut by it).
  position: number;
  role: ExecutiveRole;
  // Who wrote it, as it was then: the owner (a user), the CEO (its employee, appointment and revision -- `current`
  // says whether that is still the CEO in office), Orbit's records.
  author: { name: string; userId: string | null; employeeId: string | null; appointmentId: string | null; appointmentRevision: number | null; current: boolean };
  text: string;
  // An answer cut off (stopped, failed, restarted).
  partial: boolean;
  model: string | null;
  report: ExecutiveReport | null;
  proposal: MissionProposal | null;
  proposalState: ProposalState | null;
  // Why a proposal the CEO wrote was not kept (it did not read as a mission).
  proposalNote: string | null;
  missionId: string | null;
  turnId: string | null;
  createdAt: string;
}

export const EXECUTIVE_TURN_STATES = ["queued", "waiting", "running", "completed", "failed", "interrupted", "cancelled"] as const;
export type ExecutiveTurnState = (typeof EXECUTIVE_TURN_STATES)[number];

// One answer of the CEO: to the owner's messages since its last one, by the CEO in office when they were sent.
export interface ExecutiveTurn {
  id: string;
  conversationId: string;
  state: ExecutiveTurnState;
  requestMessageId: string;
  responseMessageId: string | null;
  employeeId: string;
  authorName: string;
  appointmentId: string;
  appointmentRevision: number;
  // Why it waits (queued behind the CEO's run, or for resources), or why it ended so.
  waitingReason: string | null;
  code: string | null;
  detail: string | null;
  // The records it was given, line by line: what its answer stands on.
  records: string[];
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ExecutiveMissionLink {
  missionId: string;
  messageId: string;
  title: string;
  linkedAt: string;
}

export interface ExecutiveConversationDetail {
  conversation: ExecutiveConversationSummary;
  // Its last page, oldest first.
  messages: ExecutiveMessage[];
  hasOlder: boolean;
  // The turns not ended, and the last one that ended.
  turns: ExecutiveTurn[];
  links: ExecutiveMissionLink[];
  // The conversation's stream head when this was read: follow it after this sequence number.
  lastSeq: number;
}

export interface ExecutiveMessagePage {
  messages: ExecutiveMessage[];
  hasOlder: boolean;
}

// What sending a message answers: the message kept, and the turn that answers it.
export interface ExecutiveSent {
  conversationId: string;
  message: ExecutiveMessage;
  turn: ExecutiveTurn;
}

export type ExecutiveMissionFields = Pick<Required<CreateMissionRequest>, "goal" | "deliverables" | "acceptanceCriteria" | "deadline" | "priority"> & { title: string };

// POST …/missions: a mission for the CEO from this conversation -- its proposal (or the owner's own words: no proposal),
// held to the responsible the owner saw.
export interface ExecutiveMissionRequest {
  proposalMessageId: string | null;
  mission: ExecutiveMissionFields;
  expectedAssignee: ExpectedAssignee;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NOT_OBJECT: Checked<never> = { ok: false, errors: ["the body must be a JSON object"] };
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function checkExecutiveText(body: unknown): Checked<{ text: string }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const extra = Object.keys(body).filter((k) => k !== "text");
  const t = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n").trim() : null;
  const errors = extra.map((k) => `${k} is not a field of this request`);
  if (t === null || t.length === 0 || t.length > EXECUTIVE_LIMITS.textLength || CONTROL.test(t)) errors.push(`text must be 1-${EXECUTIVE_LIMITS.textLength} printable characters`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { text: t as string } };
}

export function checkExecutiveReport(body: unknown): Checked<{ kind: ExecutiveReportKind }> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = Object.keys(body).filter((k) => k !== "kind").map((k) => `${k} is not a field of this request`);
  if (!(EXECUTIVE_REPORT_KINDS as readonly unknown[]).includes(body.kind)) errors.push(`kind must be one of ${EXECUTIVE_REPORT_KINDS.join(", ")}`);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { kind: body.kind as ExecutiveReportKind } };
}

// A mission's fields, checked as the mission itself will be (checkCreateMission, the CEO as its target).
export function checkMissionFields(v: unknown): Checked<ExecutiveMissionFields> {
  if (!isRecord(v)) return { ok: false, errors: ["mission must be { title, goal, deliverables, acceptanceCriteria, deadline, priority }"] };
  const extra = Object.keys(v).filter((k) => !["title", "goal", "deliverables", "acceptanceCriteria", "deadline", "priority"].includes(k));
  if (extra.length > 0) return { ok: false, errors: extra.map((k) => `mission.${k} is not a field of a mission given from CEO Chat`) };
  const c = checkCreateMission({ ...v, target: { kind: "ceo" } });
  if (!c.ok) return c;
  return { ok: true, value: { title: c.value.title, goal: c.value.goal, deliverables: c.value.deliverables, acceptanceCriteria: c.value.acceptanceCriteria, deadline: c.value.deadline, priority: c.value.priority } };
}

export function checkExecutiveMission(body: unknown): Checked<ExecutiveMissionRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = Object.keys(body).filter((k) => !["proposalMessageId", "mission", "expectedAssignee"].includes(k)).map((k) => `${k} is not a field of this request`);
  if (!(body.proposalMessageId === null || body.proposalMessageId === undefined || isWorkforceId(body.proposalMessageId))) errors.push("proposalMessageId must be a message id or null");
  const mission = checkMissionFields(body.mission);
  if (!mission.ok) errors.push(...mission.errors);
  const e = body.expectedAssignee;
  const expected = isRecord(e) && isWorkforceId(e.employeeId) && (e.appointmentId === null || isWorkforceId(e.appointmentId)) && (e.appointmentRevision === null || (Number.isInteger(e.appointmentRevision) && (e.appointmentRevision as number) >= 1));
  if (!expected) errors.push("expectedAssignee must be { employeeId, appointmentId, appointmentRevision }: who the owner saw responsible");
  if (errors.length > 0 || !mission.ok) return { ok: false, errors };
  const x = e as { employeeId: string; appointmentId: string | null; appointmentRevision: number | null };
  return { ok: true, value: { proposalMessageId: (body.proposalMessageId as string | null | undefined) ?? null, mission: mission.value, expectedAssignee: { employeeId: x.employeeId, appointmentId: x.appointmentId, appointmentRevision: x.appointmentRevision } } };
}
