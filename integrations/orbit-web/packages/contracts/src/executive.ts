// CEO CHAT (ADR 0062): the company owner's conversations with the AI CEO -- the actual employee holding the CEO's
// appointment, never a virtual one. A conversation belongs to the COMPANY (not to a CEO): each CEO message keeps who
// wrote it (its employee, appointment and revision), so a replaced CEO's answers stay theirs.
//
//   talk      the composer talks to the CEO: a short answer with no tool, on the CEO's own connection, model and
//             effort, admitted like any run of the CEO and never at the same time as another (a TURN);
//   records   a quick action asks Orbit's own records: a deterministic report (no model), labelled as Orbit's, available
//             while the CEO is busy or unavailable;
//   work      an answer may PROPOSE a mission; it is inert until the owner gives it to the CEO in one click (the
//             existing mission creation, `target: { kind: "ceo" }`, held to the responsible the owner saw);
//   staff     the owner's HIRING REQUEST: the CEO plans who to hire (and the departments to make), and Orbit carries the
//             plan out at once on the owner's authority, within the request's bounds (POST /api/executive/staffing);
//   draft     a PROFILE DRAFT: the CEO drafts one employee's profile from the owner's description of the job; it only
//             fills a form the owner reviews (Hire, an employee's profile), and hires nobody (POST /api/executive/drafts).
import { checkResourceProfile, type ResourceProfile } from "./resources.js";
import type { Checked } from "./validate.js";
import { checkCreateMission, checkExecutionProfile, isWorkforceId, WORKFORCE_LIMITS, type CreateMissionRequest, type Deliverable, type Employment, type ExecutionProfile, type ExecutionSources, type ExpectedAssignee } from "./workforce.js";

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
  // Whether a hiring request can be sent now: the CEO answers, and a connection can run employees.
  recruit: ExecutiveCapability;
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

// A report from Orbit's own records (never a model's words): facts, and the items they are about. `staffing`: what a
// hiring request carried out (Orbit's report of its own act, never asked for as a quick action).
export interface ExecutiveReport {
  kind: ExecutiveReportKind | "staffing";
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

// What a turn asks of the CEO: an answer to the owner, the plan of a hiring request (carried out once it ends), or the
// draft of one profile (never carried out: it only fills a form). Only an answer is asked again; a hiring request or a
// draft is sent again.
export const EXECUTIVE_TURN_KINDS = ["answer", "staffing", "profile"] as const;
export type ExecutiveTurnKind = (typeof EXECUTIVE_TURN_KINDS)[number];

// One answer of the CEO: to the owner's messages since its last one, by the CEO in office when they were sent.
export interface ExecutiveTurn {
  id: string;
  conversationId: string;
  kind: ExecutiveTurnKind;
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

// ---- staffing: a hiring request, the CEO's plan, what was carried out -------------------------------------------------

export const STAFFING_LIMITS = {
  requirementLength: 4000,
  // A plan's bounds: what one request may hire and the departments it may make.
  hires: 10,
  departments: 3,
  dutiesLength: 2000,
  instructionsLength: 4000,
} as const;

export const STAFFING_ROLES = ["member", "manager"] as const;
export type StaffingRole = (typeof STAFFING_ROLES)[number];

export const STAFFING_STATES = ["planning", "hired", "refused", "failed"] as const;
export type StaffingState = (typeof STAFFING_STATES)[number];

// POST /api/executive/staffing: the owner's hiring request. What every new hire runs on and holds is the OWNER's choice
// (the CEO never picks a connection, a model or resources); the scope is one department, or the whole company.
export interface HiringRequest {
  requirement: string;
  departmentId: string | null;
  execution: ExecutionProfile;
  resources: ResourceProfile;
}

// One employee of the CEO's plan: only what describes the person -- never what it runs on, holds or may do.
export interface StaffingHire {
  name: string;
  // A live department's name, or one the plan makes.
  department: string;
  role: StaffingRole;
  title: string;
  duties: string;
  instructions: string;
  skills: string[];
  languages: string[];
}

export interface StaffingPlan {
  departments: { name: string }[];
  hires: StaffingHire[];
}

export interface StaffingOutcome {
  hired: { employeeId: string; name: string; departmentId: string; departmentName: string; role: StaffingRole }[];
  departmentsCreated: { id: string; name: string }[];
  appointed: { employeeId: string; name: string; departmentName: string }[];
  // Why nothing was carried out (a refused or failed request).
  problems: string[];
}

export interface StaffingView {
  id: string;
  state: StaffingState;
  requirement: string;
  departmentId: string | null;
  departmentName: string | null;
  execution: ExecutionProfile;
  resources: ResourceProfile;
  // The most this request may hire: the plan's bound and the storage budget's room, whichever is less.
  maxHires: number;
  conversationId: string;
  turnId: string;
  plan: StaffingPlan | null;
  outcome: StaffingOutcome | null;
  createdAt: string;
  endedAt: string | null;
}

// What sending a hiring request answers: the request, and the CEO's turn that plans it.
export interface StaffingAccepted {
  staffingId: string;
  conversationId: string;
  message: ExecutiveMessage;
  turn: ExecutiveTurn;
}

const oneLine = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max && !CONTROL.test(v) && !v.includes("\n") ? v.trim() : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max && !CONTROL.test(v) ? v.replace(/\r\n?/g, "\n").trim() : null);
const items = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= WORKFORCE_LIMITS.listItems && v.every((x) => oneLine(x, WORKFORCE_LIMITS.itemLength) !== null) ? v.map((x) => (x as string).trim()) : null);

export function checkHiringRequest(body: unknown): Checked<HiringRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = Object.keys(body).filter((k) => !["requirement", "departmentId", "execution", "resources"].includes(k)).map((k) => `${k} is not a field of this request`);
  const requirement = typeof body.requirement === "string" ? body.requirement.replace(/\r\n?/g, "\n").trim() : null;
  if (requirement === null || requirement.length === 0 || requirement.length > STAFFING_LIMITS.requirementLength || CONTROL.test(requirement)) errors.push(`requirement must be 1-${STAFFING_LIMITS.requirementLength} printable characters`);
  if (!(body.departmentId === null || body.departmentId === undefined || isWorkforceId(body.departmentId))) errors.push("departmentId must be a department's id, or null for the whole company");
  const execution = checkExecutionProfile(body.execution);
  if (!execution.ok) errors.push(...execution.errors.map((e) => `execution: ${e}`));
  const resources = checkResourceProfile(body.resources);
  if (!resources.ok) errors.push(...resources.errors.map((e) => `resources: ${e}`));
  if (errors.length > 0 || !execution.ok || !resources.ok) return { ok: false, errors };
  return { ok: true, value: { requirement: requirement as string, departmentId: (body.departmentId as string | null | undefined) ?? null, execution: execution.value, resources: resources.value } };
}

// The CEO's plan as Orbit takes it: its own fields only, each within its bounds. What a plan MEANS against the company
// (which departments exist, who manages them, the budget) is decided where those are known.
export function checkStaffingPlan(v: unknown): Checked<StaffingPlan> {
  if (!isRecord(v)) return { ok: false, errors: ["the plan must be { departments, hires }"] };
  const errors = Object.keys(v).filter((k) => k !== "departments" && k !== "hires").map((k) => `${k} is not a field of a staffing plan`);
  const departments = v.departments === undefined ? [] : v.departments;
  if (!Array.isArray(departments) || departments.length > STAFFING_LIMITS.departments) errors.push(`departments must be a list of at most ${STAFFING_LIMITS.departments}`);
  const made = (Array.isArray(departments) ? departments : []).map((d, i) => {
    const name = isRecord(d) ? oneLine(d.name, WORKFORCE_LIMITS.nameLength) : null;
    if (!isRecord(d) || Object.keys(d).some((k) => k !== "name") || name === null) errors.push(`departments[${i}] must be { name } of 1-${WORKFORCE_LIMITS.nameLength} characters`);
    return { name: name ?? "" };
  });
  const hires = v.hires;
  if (!Array.isArray(hires) || hires.length === 0 || hires.length > STAFFING_LIMITS.hires) errors.push(`hires must be a list of 1-${STAFFING_LIMITS.hires}`);
  const KEYS = ["name", "department", "role", "title", "duties", "instructions", "skills", "languages"];
  const people = (Array.isArray(hires) ? hires : []).map((h, i): StaffingHire => {
    const at = `hires[${i}]`;
    if (!isRecord(h)) {
      errors.push(`${at} must be an object`);
      return { name: "", department: "", role: "member", title: "", duties: "", instructions: "", skills: [], languages: [] };
    }
    for (const k of Object.keys(h).filter((k) => !KEYS.includes(k))) errors.push(`${at}.${k} is not a field Orbit takes from a plan`);
    const name = oneLine(h.name, WORKFORCE_LIMITS.nameLength);
    const department = oneLine(h.department, WORKFORCE_LIMITS.nameLength);
    const title = oneLine(h.title, WORKFORCE_LIMITS.titleLength);
    const duties = h.duties === undefined ? "" : text(h.duties, STAFFING_LIMITS.dutiesLength);
    const instructions = h.instructions === undefined ? "" : text(h.instructions, STAFFING_LIMITS.instructionsLength);
    const skills = h.skills === undefined ? [] : items(h.skills);
    const languages = h.languages === undefined ? [] : items(h.languages);
    const role = h.role === undefined ? "member" : h.role;
    if (name === null) errors.push(`${at}.name must be 1-${WORKFORCE_LIMITS.nameLength} characters on one line`);
    if (department === null) errors.push(`${at}.department must name a department`);
    if (title === null) errors.push(`${at}.title must be 1-${WORKFORCE_LIMITS.titleLength} characters on one line`);
    if (duties === null) errors.push(`${at}.duties must be at most ${STAFFING_LIMITS.dutiesLength} characters`);
    if (instructions === null) errors.push(`${at}.instructions must be at most ${STAFFING_LIMITS.instructionsLength} characters`);
    if (skills === null) errors.push(`${at}.skills must be at most ${WORKFORCE_LIMITS.listItems} items of ${WORKFORCE_LIMITS.itemLength} characters`);
    if (languages === null) errors.push(`${at}.languages must be at most ${WORKFORCE_LIMITS.listItems} items of ${WORKFORCE_LIMITS.itemLength} characters`);
    if (!(STAFFING_ROLES as readonly unknown[]).includes(role)) errors.push(`${at}.role must be member or manager`);
    return { name: name ?? "", department: department ?? "", role: role as StaffingRole, title: title ?? "", duties: duties ?? "", instructions: instructions ?? "", skills: skills ?? [], languages: languages ?? [] };
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { departments: made, hires: people } };
}

// ---- a profile draft: one employee's profile, drafted by the CEO for a form ------------------------------------------

export const DRAFT_LIMITS = { descriptionLength: 2000 } as const;

export const DRAFT_STATES = ["drafting", "ready", "failed"] as const;
export type DraftState = (typeof DRAFT_STATES)[number];

// POST /api/executive/drafts: what the job is, in the owner's words, for a form being filled (its title and department,
// when known). Nothing is hired: the draft fills the form, and the owner decides.
export interface ProfileDraftRequest {
  description: string;
  title: string;
  departmentId: string | null;
}

// What a draft fills: a person's own description, never what it runs on, holds or may do.
export interface ProfileDraft {
  title: string;
  duties: string;
  instructions: string;
  skills: string[];
  languages: string[];
  handoffStandard: string;
}

export interface ProfileDraftView {
  id: string;
  state: DraftState;
  description: string;
  conversationId: string;
  turnId: string;
  draft: ProfileDraft | null;
  // Why there is no draft (a failed one).
  problems: string[];
  createdAt: string;
  endedAt: string | null;
}

export interface ProfileDraftAccepted {
  draftId: string;
  conversationId: string;
  message: ExecutiveMessage;
  turn: ExecutiveTurn;
}

export function checkProfileDraftRequest(body: unknown): Checked<ProfileDraftRequest> {
  if (!isRecord(body)) return NOT_OBJECT;
  const errors = Object.keys(body).filter((k) => !["description", "title", "departmentId"].includes(k)).map((k) => `${k} is not a field of this request`);
  const description = typeof body.description === "string" ? body.description.replace(/\r\n?/g, "\n").trim() : null;
  if (description === null || description.length === 0 || description.length > DRAFT_LIMITS.descriptionLength || CONTROL.test(description)) errors.push(`description must be 1-${DRAFT_LIMITS.descriptionLength} printable characters`);
  const title = body.title === undefined ? "" : typeof body.title === "string" && body.title.length <= WORKFORCE_LIMITS.titleLength && !CONTROL.test(body.title) ? body.title.trim() : null;
  if (title === null) errors.push(`title must be at most ${WORKFORCE_LIMITS.titleLength} printable characters`);
  if (!(body.departmentId === null || body.departmentId === undefined || isWorkforceId(body.departmentId))) errors.push("departmentId must be a department's id, or null");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { description: description as string, title: title as string, departmentId: (body.departmentId as string | null | undefined) ?? null } };
}

// The CEO's draft as Orbit takes it: a profile's own descriptive fields, each within the profile's own bounds.
export function checkProfileDraft(v: unknown): Checked<ProfileDraft> {
  if (!isRecord(v)) return { ok: false, errors: ["the draft must be { title, duties, instructions, skills, languages, handoffStandard }"] };
  const errors = Object.keys(v).filter((k) => !["title", "duties", "instructions", "skills", "languages", "handoffStandard"].includes(k)).map((k) => `${k} is not a field Orbit takes from a draft`);
  const title = oneLine(v.title, WORKFORCE_LIMITS.titleLength);
  const duties = v.duties === undefined ? "" : text(v.duties, WORKFORCE_LIMITS.textLength);
  const instructions = v.instructions === undefined ? "" : text(v.instructions, WORKFORCE_LIMITS.textLength);
  const handoffStandard = v.handoffStandard === undefined ? "" : text(v.handoffStandard, WORKFORCE_LIMITS.noteLength);
  const skills = v.skills === undefined ? [] : items(v.skills);
  const languages = v.languages === undefined ? [] : items(v.languages);
  if (title === null) errors.push(`title must be 1-${WORKFORCE_LIMITS.titleLength} characters on one line`);
  if (duties === null) errors.push(`duties must be at most ${WORKFORCE_LIMITS.textLength} characters`);
  if (instructions === null) errors.push(`instructions must be at most ${WORKFORCE_LIMITS.textLength} characters`);
  if (handoffStandard === null) errors.push(`handoffStandard must be at most ${WORKFORCE_LIMITS.noteLength} characters`);
  if (skills === null) errors.push(`skills must be at most ${WORKFORCE_LIMITS.listItems} items of ${WORKFORCE_LIMITS.itemLength} characters`);
  if (languages === null) errors.push(`languages must be at most ${WORKFORCE_LIMITS.listItems} items of ${WORKFORCE_LIMITS.itemLength} characters`);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title: title as string, duties: duties as string, instructions: instructions as string, skills: skills as string[], languages: languages as string[], handoffStandard: handoffStandard as string } };
}
