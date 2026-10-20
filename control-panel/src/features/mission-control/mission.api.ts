import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { runtimeKeys } from "../runtime/runtime.api";
import type { LogStream, SandboxLogPage, SandboxLogs, SandboxOperationResult, SandboxReleaseResult, SandboxStopResult } from "../runtime/sandbox.types";
import type { ActivityResponse } from "./live/live.types";
import { isUnreadable, type ApprovalQueue, type HealthView, type MachineView, type TaskDecision, type TaskEvents, type TaskRef, type TaskResponse, type TaskSandboxResponse } from "./mission.types";
import { taskApiPath } from "./missionWords";

// Mission Control's reads are one projection of the machine and one task at a time; its only writes
// are a person's decisions, each a POST that names the revision the person saw. The server judges
// it (a moved task is a 409) and the page shows what the server answered -- never a guess first.

const decisionPath = (ref: TaskRef, decision: TaskDecision) => (decision.kind === "approve" || decision.kind === "reject" ? `${taskApiPath(ref)}/approvals/${encodeURIComponent(decision.approval)}/${decision.kind}` : `${taskApiPath(ref)}/${decision.kind}`);

function bodyOf(decision: TaskDecision) {
  if (decision.kind === "approve") return { human: true, expectedRevision: decision.expectedRevision };
  if (decision.kind === "reject") return { human: true, expectedRevision: decision.expectedRevision, ...(decision.reason ? { reason: decision.reason } : {}) };
  return { human: true, expectedRevision: decision.expectedRevision, ...(decision.because ? { because: decision.because } : {}) };
}

export const missionApi = {
  overview: () => api.get<MachineView>("/api/v1/mission-control"),
  approvals: () => api.get<ApprovalQueue>("/api/v1/mission-control/approvals"),
  health: () => api.get<HealthView>("/api/v1/mission-control/health"),
  task: (ref: TaskRef) => api.get<TaskResponse>(taskApiPath(ref)),
  events: (ref: TaskRef) => api.get<TaskEvents>(`${taskApiPath(ref)}/events`),
  // Orbit Live: the task's lines, its QA activity and the task as of now, from a cursor -- what a page
  // paints first, replays a finished task from, and reads every few seconds when a stream cannot stay open.
  activity: (ref: TaskRef, since: string | null) => api.get<ActivityResponse>(`${taskApiPath(ref)}/activity?since=${encodeURIComponent(since ?? "t=0")}`),
  // A log from a byte offset on: only what the page does not hold yet.
  sandboxLogPage: (ref: TaskRef, session: string, stream: LogStream, from: number) => api.get<SandboxLogPage>(`${taskApiPath(ref)}/sandbox/logs/${encodeURIComponent(session)}?stream=${stream}&from=${from}`),
  // A person's, relayed from the button they pressed and confirmed.
  decide: (ref: TaskRef, decision: TaskDecision) => api.post<TaskResponse>(decisionPath(ref, decision), bodyOf(decision)),
  // The task's own sandbox, found by the server from the task's journal. A read starts nothing.
  sandbox: (ref: TaskRef) => api.get<TaskSandboxResponse>(`${taskApiPath(ref)}/sandbox`),
  // One session's output, bounded and scrubbed by the runtime: the one way a process's words reach a page.
  sandboxLogs: (ref: TaskRef, session: string, stream: LogStream) => api.get<SandboxLogs>(`${taskApiPath(ref)}/sandbox/logs/${encodeURIComponent(session)}?stream=${stream}`),
  // A person's, relayed from the button they pressed and confirmed: `{ human: true }` and nothing else.
  sandboxStop: (ref: TaskRef) => api.post<SandboxOperationResult<SandboxStopResult>>(`${taskApiPath(ref)}/sandbox/stop`, { human: true }),
  sandboxRelease: (ref: TaskRef) => api.post<SandboxOperationResult<SandboxReleaseResult>>(`${taskApiPath(ref)}/sandbox/release`, { human: true }),
};

/** Where a page opens a live stream: an EventSource is a GET of its own, outside the fetch wrapper. */
export const missionPaths = {
  stream: (ref: TaskRef, since: string | null) => `${taskApiPath(ref)}/events/stream${since ? `?since=${encodeURIComponent(since)}` : ""}`,
  logStream: (ref: TaskRef, session: string, stream: LogStream, from: number) => `${taskApiPath(ref)}/sandbox/logs/${encodeURIComponent(session)}/stream?stream=${stream}&from=${from}`,
};

export const missionKeys = {
  all: ["mission-control"] as const,
  overview: () => [...missionKeys.all, "overview"] as const,
  approvals: () => [...missionKeys.all, "approvals"] as const,
  health: () => [...missionKeys.all, "health"] as const,
  task: (ref: TaskRef) => [...missionKeys.all, "task", ref.key, ref.checkout, ref.task] as const,
  events: (ref: TaskRef) => [...missionKeys.all, "events", ref.key, ref.checkout, ref.task] as const,
  sandbox: (ref: TaskRef) => [...missionKeys.all, "sandbox", ref.key, ref.checkout, ref.task] as const,
  logs: (ref: TaskRef, session: string, stream: LogStream) => [...missionKeys.all, "logs", ref.key, ref.checkout, ref.task, session, stream] as const,
};

/** How often a view that shows something still going reads again. A finished one does not. */
export const MISSION_REFRESH_MS = 5000;

const whileActive = (active: boolean) => (active ? MISSION_REFRESH_MS : false);

export const useMissionControl = () =>
  useQuery({ queryKey: missionKeys.overview(), queryFn: missionApi.overview, refetchInterval: (query) => whileActive(query.state.data?.tasks.some((row) => !isUnreadable(row) && !row.terminal) ?? false) });

// The queue is the page a person keeps open to answer; it reads again while it is open.
export const useMissionApprovals = () => useQuery({ queryKey: missionKeys.approvals(), queryFn: missionApi.approvals, refetchInterval: MISSION_REFRESH_MS });

// Health reads what Orbit already keeps; it is read again while open, never probed.
export const useMissionHealth = () => useQuery({ queryKey: missionKeys.health(), queryFn: missionApi.health, refetchInterval: MISSION_REFRESH_MS * 3 });

// `polling: false` while a live stream holds the task: the stream writes each view it receives into this
// query, so every card reads ONE truth, and reading it again on a timer would be a second, older one.
export const useTask = (ref: TaskRef, { polling = true }: { polling?: boolean } = {}) => useQuery({ queryKey: missionKeys.task(ref), queryFn: () => missionApi.task(ref), refetchInterval: (query) => (polling ? whileActive(query.state.data ? !query.state.data.task.terminal : false) : false) });

export const useTaskEvents = (ref: TaskRef, active: boolean) => useQuery({ queryKey: missionKeys.events(ref), queryFn: () => missionApi.events(ref), refetchInterval: whileActive(active) });

export interface DecisionRequest {
  ref: TaskRef;
  decision: TaskDecision;
}

// After a decision -- granted or refused -- the task, the machine's view and the queue are read
// again, including those a page visited earlier and is not showing now, so going back never shows
// the state from before the decision. What the server answered for the task is shown at once; nothing is
// shown before it answers.
export function useDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ref, decision }: DecisionRequest) => missionApi.decide(ref, decision),
    onSuccess: (result, { ref }) => {
      if (client.getQueryData(missionKeys.task(ref))) client.setQueryData(missionKeys.task(ref), result);
    },
    onSettled: () => client.invalidateQueries({ queryKey: missionKeys.all, refetchType: "all" }),
  });
}

const alive = (data: TaskSandboxResponse | undefined) => data?.sandbox != null && data.sandbox.state !== "RELEASED";

/** The task's sandbox is its own query: a task still going may ask for one at any moment, and a live one moves under it. */
export const useTaskSandbox = (ref: TaskRef, taskActive: boolean) => useQuery({ queryKey: missionKeys.sandbox(ref), queryFn: () => missionApi.sandbox(ref), refetchInterval: (query) => whileActive(taskActive || alive(query.state.data)) });

// A session's output is READ when a person asks for it and not again: a log that scrolled under a
// poll is a log nobody can read, and the Reload button is the person's to press.
export const useSandboxLogs = (ref: TaskRef, session: string, stream: LogStream, enabled: boolean) => useQuery({ queryKey: missionKeys.logs(ref, session, stream), queryFn: () => missionApi.sandboxLogs(ref, session, stream), enabled, staleTime: Infinity, refetchInterval: false });

export type SandboxOperation = "stop" | "release";

const RUN: Record<SandboxOperation, (ref: TaskRef) => Promise<SandboxOperationResult<SandboxStopResult | SandboxReleaseResult>>> = { stop: missionApi.sandboxStop, release: missionApi.sandboxRelease };

// A person's Stop or Release: what the server answered is shown at once -- the sandbox as it stands now --
// and nothing before. Whatever it did, or refused to do, the task, the machine's view and the checkout's
// sandboxes are read again, so no page shows the state from before.
export function useSandboxOperation(ref: TaskRef, operation: SandboxOperation) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => RUN[operation](ref),
    onSuccess: (result) => client.setQueryData<TaskSandboxResponse>(missionKeys.sandbox(ref), result.sandbox ? { sandbox: result.sandbox } : { sandbox: null, because: "the sandbox is gone" }),
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: missionKeys.all, refetchType: "all" }), client.invalidateQueries({ queryKey: runtimeKeys.all(ref) })]),
  });
}
