// GOVERNANCE → RUNTIME SECURITY (ADR 0063): what the page may say, and what it never says -- no green without proof that is
// still fresh, an unknown never healthy, a detection never called a prevention, a review that names the version it read.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IncidentView, RuntimeEventView, RuntimeSecurityOverview, WorkloadProtectionView } from "@orbit-web/contracts";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { rememberSession } from "../../services/account";
import { fakeApi } from "../../testing/fakeApi";
import { authSession } from "../../testing/fixtures";
import { renderLive } from "../../testing/render";
import { RuntimeSecurityPage } from "./RuntimeSecurityPage";

beforeEach(() => rememberSession(authSession()));
afterEach(() => rememberSession(null));

const overview = (over: Partial<RuntimeSecurityOverview> = {}): RuntimeSecurityOverview => ({
  configured: { mode: "disabled", controls: ["exec.shared-areas"] },
  effective: { mode: "disabled", controls: ["exec.shared-areas"], floor: "disabled", from: "company" },
  host: { backend: "disabled", backendVersion: null, backendImage: null, hostKind: "unknown", kernel: null, arch: null, sensor: { state: "DISABLED", generation: null, since: null, detail: "No runtime security backend is configured on this host.", cpuPercent: null, memoryMiB: null }, capabilities: [], probedAt: null, floor: "disabled", telemetry: { lastEventAt: null, lost: 0, unattributed: 0, retentionDays: 14 } },
  coverage: { protected: 0, observing: 0, degraded: 0, contained: 0, unprotected: 0, running: 0 },
  openIncidents: 0,
  prevented24h: 0,
  detected24h: 0,
  sessions: "not_observed",
  ...over,
});
const workload = (over: Partial<WorkloadProtectionView> = {}): WorkloadProtectionView => ({ runId: "r1000000-0000-4000-8000-000000000001", assignmentId: "a1", missionId: null, employeeId: "e1", employeeName: "Lan", departmentId: null, attempt: 1, runState: "running", state: "PROTECTED", mode: "enforce", controls: ["exec.shared-areas"], detail: "", verifiedAt: "2026-11-26T10:00:00.000Z", freshUntil: "2999-01-01T00:00:00.000Z", planes: [], checks: [], updatedAt: "2026-11-26T10:00:00.000Z", ...over });
const ev = (over: Partial<RuntimeEventView> = {}): RuntimeEventView => ({ id: "1", occurredAt: "2026-11-26T10:00:00.000Z", kind: "control.match", outcome: "OPERATION_PREVENTED", severity: "MEDIUM", runKind: "assignment", plane: "tool-plane", runId: "r1", employeeId: "e1", binary: "/usr/bin/sh", parentBinary: null, path: "/team/x.sh", control: "exec.shared-areas", execId: null, parentExecId: null, exitCode: null, signal: null, dropped: null, ...over });
const incident = (over: Partial<IncidentView> = {}): IncidentView => ({ id: "inc-1", category: "unexpected_process", severity: "HIGH", state: "CONTAINED", title: "A program was executed from memory (no file on disk)", runId: "r1", assignmentId: "a1", missionId: null, employeeId: "e1", employeeName: "Lan", firstSeen: "2026-11-26T10:00:00.000Z", lastSeen: "2026-11-26T10:00:00.000Z", count: 1, blocksRetry: true, evidence: { kind: "exec.fileless" }, review: null, actions: [], version: 3, ...over });

const routes = (o: RuntimeSecurityOverview, w: WorkloadProtectionView[] = [], e: RuntimeEventView[] = [], i: IncidentView[] = []) =>
  fakeApi()
    .on("GET", "/api/governance/runtime-security", () => o)
    .on("GET", "/api/governance/runtime-security/workloads", () => ({ workloads: w }))
    .on("GET", "/api/governance/runtime-security/events", () => ({ events: e, next: null }))
    .on("GET", "/api/governance/runtime-security/incidents", () => ({ incidents: i }));

describe("Governance → Runtime security", () => {
  test("disabled says plainly that kernel runtime protection is off, and claims nothing", async () => {
    routes(overview());
    renderLive(<RuntimeSecurityPage />);
    expect(await screen.findByText(/Kernel runtime protection is not enabled/)).toBeTruthy();
    expect(screen.queryByText(/^protected$/)).toBeNull();
  });

  test("a PROTECTED attempt is green only on fresh proof; on stale proof it is unknown, never protected", async () => {
    routes(overview({ effective: { mode: "enforce", controls: ["exec.shared-areas"], floor: "disabled", from: "company" } }), [workload(), workload({ runId: "r2000000-0000-4000-8000-000000000002", employeeName: "Minh", freshUntil: "2000-01-01T00:00:00.000Z" })]);
    renderLive(<RuntimeSecurityPage />);
    const fresh = await screen.findByTestId("workload-r1000000-0000-4000-8000-000000000001");
    const stale = await screen.findByTestId("workload-r2000000-0000-4000-8000-000000000002");
    expect(within(fresh).getByText("protected")).toBeTruthy();
    expect(within(stale).getByText("unknown")).toBeTruthy();
    expect(within(stale).queryByText("protected")).toBeNull();
  });

  test("enforce on a host that has not proven prevention is said as an error, never shown as protected", async () => {
    routes(overview({ effective: { mode: "enforce", controls: [], floor: "disabled", from: "company" }, host: { ...overview().host, backend: "tetragon", sensor: { ...overview().host.sensor, state: "HEALTHY" }, capabilities: [{ capability: "prevent.exec", state: "UNSUPPORTED", detail: "no BPF LSM", checkedAt: null }] } }));
    renderLive(<RuntimeSecurityPage />);
    expect(await screen.findByText(/has not proven it can prevent/)).toBeTruthy();
  });

  test("observe is said to be observation, not prevention; a detection is never labelled a prevention", async () => {
    routes(overview({ effective: { mode: "observe", controls: ["exec.shared-areas"], floor: "disabled", from: "company" } }), [], [ev({ id: "1", outcome: "OPERATION_PREVENTED" }), ev({ id: "2", outcome: "VIOLATION_DETECTED" })]);
    renderLive(<RuntimeSecurityPage />);
    expect(await screen.findByText(/Observation is not prevention/)).toBeTruthy();
    expect(within(await screen.findByTestId("event-1")).getByText("prevented")).toBeTruthy();
    expect(within(await screen.findByTestId("event-2")).getByText("detected")).toBeTruthy();
    expect(within(await screen.findByTestId("event-2")).queryByText("prevented")).toBeNull();
  });

  test("a review names the version read; authorizing a retry needs a reason", async () => {
    const api = routes(overview(), [], [], [incident()]).on("GET", "/api/governance/runtime-security/incidents/inc-1", () => incident()).on("POST", "/api/governance/runtime-security/incidents/inc-1/review", () => incident({ state: "RESOLVED", blocksRetry: false, version: 4 }));
    renderLive(<RuntimeSecurityPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Decision" }), "authorize_retry");
    const submit = screen.getByRole("button", { name: "Submit review" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Why" }), "Reviewed the process tree.");
    await userEvent.click(submit);
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const post = api.calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ decision: "authorize_retry", note: "Reviewed the process tree." });
    expect(Object.entries(post?.headers ?? {}).some(([k, v]) => k.toLowerCase() === "if-match" && v === '"3"')).toBe(true);
  });
});
