// The office's routes, typed: the roster and its departments, employees, missions and the commands on an assignment,
// what needs the owner, the schedules and deliveries. A change names the version it was made against (`If-Match`); a
// mission names the request once (`Idempotency-Key`). Reads follow `office.changed`: an invalidation, never content --
// the page reads what it may read again, and reads everything again when the app stream reopens.
import type {
  ArchiveDepartmentRequest,
  CommandResult,
  CreateMissionRequest,
  CreateScheduleRequest,
  Department,
  DeliveryView,
  EmployeeDetail,
  EmployeeProfile,
  EmployeeTemplate,
  EmploymentRequest,
  HireEmployeeRequest,
  Inbox,
  MissionAccepted,
  MissionDetail,
  MissionList,
  OccurrenceView,
  Office,
  OfficeArea,
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

export const office = {
  roster: (r: RosterQuery) => get<Roster>(`/api/office/roster${query({ department: r.department, q: r.q.trim(), status: r.status, cursor: r.cursor ?? null })}`),
  setUp: (body: SetUpOfficeRequest) => send<Office>("POST", "/api/office/setup", body),
  createDepartment: (name: string) => send<Department>("POST", "/api/office/departments", { name }),
  renameDepartment: (d: Department, name: string) => send<Department>("PATCH", `/api/office/departments/${id(d.id)}`, { name }, ifMatch(d.version)),
  archiveDepartment: (d: Department, body: ArchiveDepartmentRequest) => send<Department>("POST", `/api/office/departments/${id(d.id)}/archive`, body, ifMatch(d.version)),
  templates: () => get<EmployeeTemplate[]>("/api/office/templates"),
  presets: () => get<ResourcePreset[]>("/api/office/resource-presets"),
  hire: (body: HireEmployeeRequest) => send<EmployeeDetail>("POST", "/api/employees", body),
  employee: (employeeId: string) => get<EmployeeDetail>(`/api/employees/${id(employeeId)}`),
  profileRevision: (employeeId: string, revision: number) => get<ProfileRevisionContent>(`/api/employees/${id(employeeId)}/revisions/${revision}`),
  updateEmployee: (e: EmployeeDetail, body: UpdateEmployeeRequest) => send<EmployeeDetail>("PATCH", `/api/employees/${id(e.id)}`, body, ifMatch(e.version)),
  updateResources: (e: EmployeeDetail, body: UpdateResourcesRequest) => send<EmployeeDetail>("PATCH", `/api/employees/${id(e.id)}/resources`, body, ifMatch(e.version)),
  moveEmployee: (e: EmployeeDetail, departmentId: string | null) => send<EmployeeDetail>("POST", `/api/employees/${id(e.id)}/department`, { departmentId }, ifMatch(e.version)),
  employment: (e: EmployeeDetail, body: EmploymentRequest) => send<EmployeeDetail>("POST", `/api/employees/${id(e.id)}/employment`, body, ifMatch(e.version)),
  createMission: (body: CreateMissionRequest, key: string) => send<MissionAccepted>("POST", "/api/missions", body, idempotent(key)),
  missions: (state: "open" | "closed", cursor: string | null = null) => get<MissionList>(`/api/missions${query({ state, cursor })}`),
  mission: (missionId: string) => get<MissionDetail>(`/api/missions/${id(missionId)}`),
  teamRoom: (missionId: string) => get<TeamRoomChange[]>(`/api/missions/${id(missionId)}/team-room`),
  command: (assignmentId: string, version: number, command: AssignmentCommand, body?: unknown) => send<CommandResult>("POST", `/api/assignments/${id(assignmentId)}/${command}`, body ?? {}, ifMatch(version)),
  inbox: (state: "open" | "history", cursor: string | null = null) => get<Inbox>(`/api/inbox${query({ state, cursor })}`),
  schedules: () => get<ScheduleView[]>("/api/schedules"),
  createSchedule: (body: CreateScheduleRequest) => send<ScheduleView>("POST", "/api/schedules", body),
  previewSchedule: (rule: ScheduleRule) => send<ScheduleRun[]>("POST", "/api/schedules/preview", { rule }),
  updateSchedule: (s: ScheduleView, body: UpdateScheduleRequest) => send<ScheduleView>("PATCH", `/api/schedules/${id(s.id)}`, body, ifMatch(s.version)),
  occurrences: (scheduleId: string) => get<OccurrenceView[]>(`/api/schedules/${id(scheduleId)}/occurrences`),
  resolveDelivery: (deliveryId: string, body: ResolveDeliveryRequest) => send<DeliveryView>("POST", `/api/deliveries/${id(deliveryId)}/resolve`, body),
  artifactHref: (artifactId: string) => `/api/artifacts/${id(artifactId)}/content`,
};

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
