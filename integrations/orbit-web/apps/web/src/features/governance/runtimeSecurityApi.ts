// RUNTIME SECURITY'S ROUTES (ADR 0063), as the page reads them: the account's own, from the session.
import type { EmployeeRuntimeSecurityView, IncidentDecision, IncidentList, IncidentView, RuntimeEventPage, RuntimeSecurityOverview, RuntimeWorkloadList } from "@orbit-web/contracts";
import { get, ifMatch, send } from "../../services/api";

const BASE = "/api/governance/runtime-security";

export const runtimeOverview = (): Promise<RuntimeSecurityOverview> => get(BASE);

export const runtimeWorkloads = (live: boolean): Promise<RuntimeWorkloadList> => get(`${BASE}/workloads${live ? "?live=1" : ""}`);

export function runtimeEvents(q: { outcome?: string; kind?: string; severity?: string; run?: string; before?: string }): Promise<RuntimeEventPage> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, v);
  const qs = p.toString();
  return get(`${BASE}/events${qs === "" ? "" : `?${qs}`}`);
}

export const runtimeIncidents = (open: boolean): Promise<IncidentList> => get(`${BASE}/incidents${open ? "?open=1" : ""}`);

export const runtimeIncident = (id: string): Promise<IncidentView> => get(`${BASE}/incidents/${encodeURIComponent(id)}`);

export const reviewIncident = (id: string, version: number, decision: IncidentDecision, note: string): Promise<IncidentView> => send("POST", `${BASE}/incidents/${encodeURIComponent(id)}/review`, { decision, note }, ifMatch(version));

export const employeeRuntime = (employeeId: string): Promise<EmployeeRuntimeSecurityView> => get(`/api/office/employees/${encodeURIComponent(employeeId)}/runtime-security`);
