// WHAT THE SANDBOX NAMES, worked out from ids alone (ADR 0067). The allocator never takes a path, an image, a mount or
// a name from a caller: every container, label and storage area below is derived here from the ids of an account, an
// employee, an assignment or an attempt -- each checked to be a plain identifier first, so none can climb out of the
// place it names ("..", "/", a NUL byte).
import { createHash, createHmac } from "node:crypto";

// An id: letters, digits, '_' and '-' (a UUID is one), starting with a letter or digit.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// A dispatch key: printable ASCII without spaces (the worker builds it from the run and its fence).
const DISPATCH_KEY = /^[\x21-\x7e]{1,256}$/;

export class SandboxInputError extends Error {
  readonly code = "bad_request";
}

export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export function checkId(v: unknown, name: string): string {
  if (!isId(v)) throw new SandboxInputError(`${name} must be an identifier (letters, digits, '_' and '-', at most 64)`);
  return v;
}

export function checkDispatchKey(v: unknown): string {
  if (typeof v !== "string" || !DISPATCH_KEY.test(v)) throw new SandboxInputError("dispatchKey must be 1-256 printable characters without spaces");
  return v;
}

export interface EmployeeIds {
  orbitId: string;
  employeeId: string;
  sandboxId: string;
}

export function checkEmployeeIds(v: unknown): EmployeeIds {
  const o = (v ?? {}) as Record<string, unknown>;
  return { orbitId: checkId(o.orbitId, "orbitId"), employeeId: checkId(o.employeeId, "employeeId"), sandboxId: checkId(o.sandboxId, "sandboxId") };
}

// One attempt's short, stable name part: the same dispatch key always gives the same containers.
export const attemptHash = (dispatchKey: string): string => createHash("sha256").update(dispatchKey, "utf8").digest("hex").slice(0, 24);

export interface PlaneNames {
  tool: string;
  model: string;
}

export const planeNames = (prefix: string, dispatchKey: string): PlaneNames => {
  const h = attemptHash(dispatchKey);
  return { tool: `${prefix}-tp-${h}`, model: `${prefix}-mp-${h}` };
};

// The token the model plane's runner asks for before it starts anything: one per attempt, derived from the secret Orbit
// Web and the allocator share, so neither has to store it and one attempt's token opens no other attempt's runner.
export const runnerToken = (secret: string, dispatchKey: string): string => createHmac("sha256", secret).update(`orbit-web model-plane runner\n${dispatchKey}`, "utf8").digest("hex");

// Every container the allocator makes carries these, and is recognised by them alone.
export const LABELS = {
  managed: "orbit-web.sandbox",
  role: "orbit-web.role",
  dispatchKey: "orbit-web.dispatch-key",
  account: "orbit-web.account",
  employee: "orbit-web.employee",
  sandbox: "orbit-web.sandbox-id",
  run: "orbit-web.run",
  assignment: "orbit-web.assignment",
  fence: "orbit-web.fence",
  prefix: "orbit-web.prefix",
} as const;

export type ContainerRole = "tool-plane" | "model-plane" | "storage-helper" | "storage-worker" | "probe";

export interface AttemptLabelInput extends EmployeeIds {
  dispatchKey: string;
  runId: string;
  assignmentId: string;
  fence: number;
}

export function attemptLabels(prefix: string, a: AttemptLabelInput, role: "tool-plane" | "model-plane"): Record<string, string> {
  return {
    [LABELS.managed]: "1",
    [LABELS.prefix]: prefix,
    [LABELS.role]: role,
    [LABELS.dispatchKey]: a.dispatchKey,
    [LABELS.account]: a.orbitId,
    [LABELS.employee]: a.employeeId,
    [LABELS.sandbox]: a.sandboxId,
    [LABELS.run]: a.runId,
    [LABELS.assignment]: a.assignmentId,
    [LABELS.fence]: String(a.fence),
  };
}

// ---- storage areas: paths inside the workforce volume ----------------------------------------------------------------
//
//   accounts/<orbitId>/employees/<employeeId>/sandbox.json          the sandbox's labels (never mounted anywhere)
//   accounts/<orbitId>/employees/<employeeId>/desk/files/...         the desk (with toolbox/skills, toolbox/scripts)
//   accounts/<orbitId>/employees/<employeeId>/desk/version           its version (published under a check)
//   accounts/<orbitId>/employees/<employeeId>/cache                   the dependency cache (/cache)
//   accounts/<orbitId>/employees/<employeeId>/assignments/<id>/scratch/{work,output,input,home}
//   accounts/<orbitId>/employees/<employeeId>/assignments/<id>/workspace.json
//   accounts/<orbitId>/teams/<teamRoomId>/room                        a mission team's room (/team)
//
// Each of desk, cache, scratch and room is one AREA with its own quota.

export const employeeDir = (ids: EmployeeIds): string => `accounts/${checkId(ids.orbitId, "orbitId")}/employees/${checkId(ids.employeeId, "employeeId")}`;
export const deskArea = (ids: EmployeeIds): string => `${employeeDir(ids)}/desk`;
export const cacheArea = (ids: EmployeeIds): string => `${employeeDir(ids)}/cache`;
export const sandboxMeta = (ids: EmployeeIds): string => `${employeeDir(ids)}/sandbox.json`;
export const assignmentDir = (ids: EmployeeIds, assignmentId: string): string => `${employeeDir(ids)}/assignments/${checkId(assignmentId, "assignmentId")}`;
export const scratchArea = (ids: EmployeeIds, assignmentId: string): string => `${assignmentDir(ids, assignmentId)}/scratch`;
export const workspaceMeta = (ids: EmployeeIds, assignmentId: string): string => `${assignmentDir(ids, assignmentId)}/workspace.json`;
export const teamArea = (orbitId: string, teamRoomId: string): string => `accounts/${checkId(orbitId, "orbitId")}/teams/${checkId(teamRoomId, "teamRoom.id")}/room`;

// The subdirectories of a scratch area, and where the tool plane sees them.
export const SCRATCH_DIRS = ["work", "output", "input", "home"] as const;

// A connection's config home inside Orbit Web's data volume: `<orbitId>/<connectionId>` of the connections room. It
// must belong to the attempt's own account.
export function connectionSubpath(orbitId: string, connectionHome: unknown): string {
  if (typeof connectionHome !== "string") throw new SandboxInputError("modelPlane.connectionHome must be <orbitId>/<connectionId>");
  const parts = connectionHome.split("/");
  if (parts.length !== 2 || !isId(parts[0]) || !isId(parts[1])) throw new SandboxInputError("modelPlane.connectionHome must be <orbitId>/<connectionId>");
  if (parts[0] !== orbitId) throw new SandboxInputError("modelPlane.connectionHome belongs to another account");
  return `connections/${parts[0]}/${parts[1]}`;
}

// A relative path inside the workforce volume built above: never absolute, never "..", never empty segments.
export function isAreaPath(p: string): boolean {
  return p.length > 0 && p.length < 1024 && !p.startsWith("/") && p.split("/").every((s) => s.length > 0 && s !== "." && s !== ".." && /^[A-Za-z0-9_.-]+$/.test(s));
}
