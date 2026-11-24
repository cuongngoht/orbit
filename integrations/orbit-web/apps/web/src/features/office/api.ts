// The office's routes, typed: the roster and its departments, employees, missions and the commands on an assignment,
// what needs the owner, the schedules and deliveries, and the company's organization -- its appointments, execution
// defaults and delegation grants. A change names the version it was made against (`If-Match`); a
// mission names the request once (`Idempotency-Key`). Reads follow `office.changed`: an invalidation, never content --
// the page reads what it may read again, and reads everything again when the app stream reopens.
import type {
  AppointRequest,
  AppointmentChangeRequest,
  AppointmentView,
  ArchiveDepartmentRequest,
  CommandResult,
  CreateMissionRequest,
  CreateScheduleRequest,
  DelegationGrantView,
  Department,
  DeliveryView,
  EmployeeDetail,
  EmployeeProfile,
  EmployeeTemplate,
  EmploymentRequest,
  ExecutionDefaults,
  GrantDelegationRequest,
  HandOverRequest,
  HireEmployeeRequest,
  Inbox,
  MissionAccepted,
  MissionDetail,
  MissionList,
  MissionTarget,
  MissionTargetPreview,
  OccurrenceView,
  Office,
  OfficeArea,
  ReplaceAppointmentRequest,
  ResolveDeliveryRequest,
  ResourcePreset,
  Roster,
  ScheduleRule,
  ScheduleRun,
  ScheduleView,
  SetUpOfficeRequest,
  UpdateEmployeeRequest,
  UpdateResourcesRequest,
  UpdateScheduleRequest,
  TeamRoomChange,
  WorkLabel,
} from "@orbit-web/contracts";
import { useState } from "react";
import { useResource, type Resource } from "../../hooks/useResource";
import { ApiError, get, idempotent, ifMatch, send } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";

export interface RosterQuery {
  // A department's id, "none" for Unassigned, or null for all.
  department: string | null;
  q: string;
  status: WorkLabel | null;
  cursor?: string | null;
}

const query = (params: Record<string, string | null | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

const id = (v: string): string => encodeURIComponent(v);

// The command a page asks of an assignment, as its route names it.
export type AssignmentCommand = "accept" | "request-revision" | "cancel" | "pause" | "resume" | "retry" | "answer";

// A revision of an employee's profile, as a restore copies it.
export interface ProfileRevisionContent {
  revision: number;
  profile: EmployeeProfile;
}

// What a person may do to an appointment that has an incumbent, besides replacing it, as its route names it.
export type AppointmentChange = "suspend" | "reinstate" | "revoke";

export const office = {
  roster: (r: RosterQuery) => get<Roster>(`/api/office/roster${query({ department: r.department, q: r.q.trim(), status: r.status, cursor: r.cursor ?? null })}`),
  setUp: (body: SetUpOfficeRequest) => send<Office>("POST", "/api/office/setup", body),
  createDepartment: (name: string) => send<Department>("POST", "/api/office/departments", { name }),
  renameDepartment: (d: Department, name: string) => send<Department>("PATCH", `/api/office/departments/${id(d.id)}`, { name }, ifMatch(d.version)),
  archiveDepartment: (d: Department, body: ArchiveDepartmentRequest) => send<Department>("POST", `/api/office/departments/${id(d.id)}/archive`, body, ifMatch(d.version)),
  // Execution defaults, saved whole: the company's against the office's version, a department's against its own.
  setCompanyDefaults: (o: Office, defaults: ExecutionDefaults) => send<Office>("PATCH", "/api/office/defaults", { defaults }, ifMatch(o.version)),
  setDepartmentDefaults: (d: Department, defaults: ExecutionDefaults) => send<Department>("PATCH", `/api/office/departments/${id(d.id)}`, { defaults }, ifMatch(d.version)),
  // The company's authority: an empty slot is appointed to; an incumbent is replaced, suspended, reinstated or revoked
  // against the version of the appointment read.
  appoint: (body: AppointRequest) => send<AppointmentView>("POST", "/api/office/appointments", body),
  replaceAppointment: (appointmentId: string, version: number, body: ReplaceAppointmentRequest) => send<AppointmentView>("POST", `/api/office/appointments/${id(appointmentId)}/replace`, body, ifMatch(version)),
  changeAppointment: (appointmentId: string, version: number, change: AppointmentChange, body: AppointmentChangeRequest) => send<AppointmentView>("POST", `/api/office/appointments/${id(appointmentId)}/${change}`, body, ifMatch(version)),
  // Whom an employee who holds no appointment may give work to.
  grantDelegation: (employeeId: string, body: GrantDelegationRequest) => send<DelegationGrantView>("POST", `/api/employees/${id(employeeId)}/delegation-grants`, body),
  revokeDelegation: (g: DelegationGrantView) => send<{ ok: true }>("POST", `/api/delegation-grants/${id(g.id)}/revoke`, {}, ifMatch(g.version)),
  templates: () => get<EmployeeTemplate[]>("/api/office/templates"),
  presets: () => get<ResourcePreset[]>("/api/office/resource-presets"),
  hire: (body: HireEmployeeRequest) => send<EmployeeDetail>("POST", "/api/employees", body),
  employee: (employeeId: string) => get<EmployeeDetail>(`/api/employees/${id(employeeId)}`),
  profileRevision: (employeeId: string, revision: number) => get<ProfileRevisionContent>(`/api/employees/${id(employeeId)}/revisions/${revision}`),
  updateEmployee: (e: EmployeeDetail, body: UpdateEmployeeRequest) => send<EmployeeDetail>("PATCH", `/api/employees/${id(e.id)}`, body, ifMatch(e.version)),
  updateResources: (e: EmployeeDetail, body: UpdateResourcesRequest) => send<EmployeeDetail>("PATCH", `/api/employees/${id(e.id)}/resources`, body, ifMatch(e.version)),
  moveEmployee: (e: EmployeeDetail, departmentId: string | null) => send<EmployeeDetail>("POST", `/api/employees/${id(e.id)}/department`, { departmentId }, ifMatch(e.version)),
  employment: (e: EmployeeDetail, body: EmploymentRequest) => send<EmployeeDetail>("POST", `/api/employees/${id(e.id)}/employment`, body, ifMatch(e.version)),
  // Who a target would go to now -- an employee, a department's manager in office, the CEO -- or why nobody would: what a
  // new mission then names as its `expectedAssignee`.
  targetPreview: (target: MissionTarget) =>
    get<MissionTargetPreview>(`/api/missions/target${query({ kind: target.kind, employeeId: target.kind === "employee" ? target.employeeId : null, departmentId: target.kind === "department" ? target.departmentId : null })}`),
  createMission: (body: CreateMissionRequest, key: string) => send<MissionAccepted>("POST", "/api/missions", body, idempotent(key)),
  missions: (state: "open" | "closed", cursor: string | null = null) => get<MissionList>(`/api/missions${query({ state, cursor })}`),
  mission: (missionId: string) => get<MissionDetail>(`/api/missions/${id(missionId)}`),
  teamRoom: (missionId: string) => get<TeamRoomChange[]>(`/api/missions/${id(missionId)}/team-room`),
  command: (assignmentId: string, version: number, command: AssignmentCommand, body?: unknown) => send<CommandResult>("POST", `/api/assignments/${id(assignmentId)}/${command}`, body ?? {}, ifMatch(version)),
  // Open work handed to another employee, and blocked or paused work continued on its employee's profile in effect now --
  // each against the version of the assignment read.
  handOver: (assignmentId: string, version: number, body: HandOverRequest) => send<CommandResult>("POST", `/api/assignments/${id(assignmentId)}/hand-over`, body, ifMatch(version)),
  repin: (assignmentId: string, version: number) => send<CommandResult>("POST", `/api/assignments/${id(assignmentId)}/repin`, {}, ifMatch(version)),
  // What a lead shared with a part of its team, taken back: every attempt that holds it is stopped.
  revokeShare: (shareId: string) => send<{ id: string; revokedAt: string }>("POST", `/api/data-shares/${id(shareId)}/revoke`, {}),
  inbox: (state: "open" | "history", cursor: string | null = null) => get<Inbox>(`/api/inbox${query({ state, cursor })}`),
  schedules: () => get<ScheduleView[]>("/api/schedules"),
  createSchedule: (body: CreateScheduleRequest) => send<ScheduleView>("POST", "/api/schedules", body),
  previewSchedule: (rule: ScheduleRule) => send<ScheduleRun[]>("POST", "/api/schedules/preview", { rule }),
  updateSchedule: (s: ScheduleView, body: UpdateScheduleRequest) => send<ScheduleView>("PATCH", `/api/schedules/${id(s.id)}`, body, ifMatch(s.version)),
  occurrences: (scheduleId: string) => get<OccurrenceView[]>(`/api/schedules/${id(scheduleId)}/occurrences`),
  resolveDelivery: (deliveryId: string, body: ResolveDeliveryRequest) => send<DeliveryView>("POST", `/api/deliveries/${id(deliveryId)}/resolve`, body),
  artifactHref: (artifactId: string) => `/api/artifacts/${id(artifactId)}/content`,
};

// How many pages of the roster a choice among every employee reads at most (a page holds 100 of them).
const MAX_ROSTER_PAGES = 20;

// The roster unfiltered -- one department's, or the whole office's -- with every page of its employees: whom to appoint,
// or to give work to, is chosen among all of them, never among the first page or what the overview's filters show.
export async function wholeRoster(department: string | null = null): Promise<Roster> {
  const first = await office.roster({ department, q: "", status: null });
  const employees = [...first.employees];
  let cursor = first.nextCursor;
  for (let pages = 1; cursor !== null && pages < MAX_ROSTER_PAGES; pages++) {
    const next = await office.roster({ department, q: "", status: null, cursor });
    employees.push(...next.employees);
    cursor = next.nextCursor;
  }
  return { ...first, employees, nextCursor: cursor };
}

// A route this Orbit Web does not serve (yet): schedules and deliveries come after the rest of the office, and until then
// their routes answer 404 -- said as such by the page, never a crash and never "nothing scheduled".
export const NOT_SERVED = "not_served" as const;
export const isNotServed = (err: unknown): boolean => err instanceof ApiError && err.status === 404;
export const unlessNotServed = (err: unknown): typeof NOT_SERVED => {
  if (isNotServed(err)) return NOT_SERVED;
  throw err;
};

// A read of the office, read again when the office says one of `areas` changed (or the mission it shows), and whenever
// the app stream reopens -- nothing is replayed, so a page that was away reads again.
export function useOfficeRead<T>(load: (() => Promise<T>) | null, deps: unknown[], areas: readonly OfficeArea[], missionId: string | null = null): Resource<T> {
  const { generation } = useAppStream();
  const [changed, setChanged] = useState(0);
  useAppEvent("office.changed", (e) => {
    if (e.data.areas.some((a) => areas.includes(a)) || (missionId !== null && e.data.missionId === missionId)) setChanged((n) => n + 1);
  });
  return useResource<T>(load, [...deps, generation, changed]);
}
