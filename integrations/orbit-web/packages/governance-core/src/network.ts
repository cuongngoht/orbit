// EMPLOYEE NETWORK ACCESS: what an employee's assignment may reach from its sandbox, said once in the account's policy
// (`employeeNetwork`). Chats and research are not held to it: their connections are decided by the policy's
// `network.egress` rules exactly as before.
//
//   AUTONOMOUS  (the default) every PUBLIC host, on ports 80 and 443, with no approval per host.
//   RESTRICTED  only the hosts the allow-list names: an exact host, or `*.domain` for every host under a domain.
//
// Whatever the mode, a `deny` rule of the policy or of an override still wins (layers only narrow), and the egress proxy
// holds what no policy loosens: an address that is not on the public internet, the cloud metadata service, any port but
// 80 and 443. Usage limits are optional and all off unless the policy names one. A policy that does not say
// `employeeNetwork` means AUTONOMOUS with no limits; the field is part of the document, so of its digest, when it is said.
import { isRecord, unknownFields } from "./canonical.js";

export const EMPLOYEE_NETWORK_MODES = ["AUTONOMOUS", "RESTRICTED"] as const;
export type EmployeeNetworkMode = (typeof EMPLOYEE_NETWORK_MODES)[number];

// Every limit is off unless the policy names it. Per RUN: one attempt of one assignment; per DAY: the account's
// employees together, in one UTC day.
export const NETWORK_LIMIT_KEYS = ["bandwidthMbpsPerRun", "downloadBytesPerRun", "downloadBytesPerDay", "connectionsPerMinutePerRun", "concurrentConnectionsPerRun"] as const;
export type NetworkLimitKey = (typeof NETWORK_LIMIT_KEYS)[number];
export type NetworkLimits = Partial<Record<NetworkLimitKey, number>>;

// What each limit is, in words a person reads beside its field.
export const NETWORK_LIMIT_TEXT: Record<NetworkLimitKey, string> = {
  bandwidthMbpsPerRun: "Bandwidth of one run, in megabits per second (its connections share it).",
  downloadBytesPerRun: "Bytes one run may download; the connection that reaches it is closed.",
  downloadBytesPerDay: "Bytes the account's employees may download in one UTC day, together.",
  connectionsPerMinutePerRun: "Connections one run may open in a minute.",
  concurrentConnectionsPerRun: "Connections one run may hold open at once.",
};

export interface EmployeeNetwork {
  mode: EmployeeNetworkMode;
  // RESTRICTED: the hosts employees may reach, `host.example` or `*.example.com` (lower case; no scheme, port or path).
  // Kept as written under AUTONOMOUS, where it decides nothing.
  allow: string[];
  limits?: NetworkLimits;
}

// The only ports an employee's connection is ever made to.
export const EMPLOYEE_PORTS: readonly number[] = [80, 443];

export const NETWORK_LIMITS = { allowEntries: 200, hostLength: 253 } as const;

// Said wherever a person chooses what an employee may reach (Governance, Hire, Assign), and in the documentation.
export const EMPLOYEE_NETWORK_DISCLOSURE = "In Autonomous mode an employee can send the data of its assignment to any public website. Use Restricted mode, or do not give it data that must not leave.";

// The employee network access a policy says: AUTONOMOUS with nothing listed and no limit when it says none.
export const employeeNetworkOf = (policy: { employeeNetwork?: EmployeeNetwork }): EmployeeNetwork => policy.employeeNetwork ?? { mode: "AUTONOMOUS", allow: [] };

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const EXACT = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
// A wildcard names a domain of at least two labels: `*.example.com`, never `*.com` or `*`.
const WILDCARD = new RegExp(`^\\*\\.${LABEL}(?:\\.${LABEL})+$`);

export const isAllowEntry = (v: unknown): v is string => typeof v === "string" && v.length <= NETWORK_LIMITS.hostLength && (EXACT.test(v) || WILDCARD.test(v));

// An allow-list entry as a person types it: trimmed and lower case; null when it is not one.
export function networkHostOf(text: string): string | null {
  const entry = text.trim().toLowerCase();
  return isAllowEntry(entry) ? entry : null;
}

// Whether one entry lets `host` in: an exact host is that host; `*.example.com` is every host under example.com (not
// example.com itself: list it too to reach it).
export function entryAllows(entry: string, host: string): boolean {
  const h = host.toLowerCase();
  return entry.startsWith("*.") ? h.endsWith(entry.slice(1)) && h.length > entry.length - 1 : h === entry;
}

// The entry of the allow-list that lets `host` in (the first that does), or null.
export const allowListed = (allow: readonly string[], host: string): string | null => allow.find((e) => entryAllows(e, host)) ?? null;

// `host:port` as a network.egress resource names it; null when it is not one.
export function egressTargetOf(resource: string): { host: string; port: number } | null {
  const colon = resource.lastIndexOf(":");
  const host = resource.slice(0, colon).toLowerCase();
  const portText = resource.slice(colon + 1);
  if (colon <= 0 || host.length > NETWORK_LIMITS.hostLength || !EXACT.test(host) || !/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  return port >= 1 && port <= 65535 ? { host, port } : null;
}

function limitsErrors(limits: unknown, at: string): string[] {
  if (!isRecord(limits)) return [`${at} must be an object`];
  const errors = unknownFields(limits, NETWORK_LIMIT_KEYS, `${at}.`);
  for (const key of NETWORK_LIMIT_KEYS) {
    const v = limits[key];
    if (v !== undefined && !(Number.isSafeInteger(v) && (v as number) >= 1)) errors.push(`${at}.${key} must be a whole number of at least 1 (leave it out for no limit)`);
  }
  return errors;
}

function allowErrors(allow: unknown, at: string): string[] {
  if (!Array.isArray(allow)) return [`${at} must be a list of hosts (empty for none)`];
  if (allow.length > NETWORK_LIMITS.allowEntries) return [`${at} holds more than ${NETWORK_LIMITS.allowEntries} hosts`];
  const errors = allow.flatMap((h, i) => (isAllowEntry(h) ? [] : [`${at}[${i}] must be a host (host.example) or a domain (*.example.com), lower case, with no scheme, port or path`]));
  const seen = new Set<unknown>();
  for (const h of allow) {
    if (seen.has(h)) errors.push(`${at}: "${String(h)}" is listed twice`);
    seen.add(h);
  }
  return errors;
}

// What is wrong with a policy's `employeeNetwork` (empty: nothing; absent is AUTONOMOUS).
export function employeeNetworkErrors(network: unknown, at = "employeeNetwork"): string[] {
  if (network === undefined) return [];
  if (!isRecord(network)) return [`${at} must be an object`];
  const errors = unknownFields(network, ["mode", "allow", "limits"], `${at}.`);
  if (!(EMPLOYEE_NETWORK_MODES as readonly unknown[]).includes(network.mode)) errors.push(`${at}.mode must be "AUTONOMOUS" or "RESTRICTED"`);
  errors.push(...allowErrors(network.allow, `${at}.allow`));
  if (network.limits !== undefined) errors.push(...limitsErrors(network.limits, `${at}.limits`));
  return errors;
}

// ---- what a change of it does -----------------------------------------------------------------------------------------

export type EmployeeNetworkField = "employeeNetwork.mode" | "employeeNetwork.allow" | `employeeNetwork.limits.${NetworkLimitKey}`;

export interface EmployeeNetworkChange {
  field: EmployeeNetworkField;
  before: string;
  after: string;
  // It lets an employee reach, or use, more than before.
  weakened: boolean;
  // Said to the person who confirms it, when it weakens.
  reason: string | null;
}

// Whether every host `entry` lets in, some entry of `list` lets in too.
function covered(entry: string, list: readonly string[]): boolean {
  if (!entry.startsWith("*.")) return allowListed(list, entry) !== null;
  return list.some((e) => e.startsWith("*.") && (e === entry || entry.endsWith(e.slice(1))));
}

const listText = (allow: readonly string[]): string => (allow.length === 0 ? "none" : allow.join(", "));
const limitText = (v: number | undefined): string => (v === undefined ? "off" : String(v));

function modeChange(b: EmployeeNetwork, c: EmployeeNetwork): EmployeeNetworkChange[] {
  if (b.mode === c.mode) return [];
  const weakened = c.mode === "AUTONOMOUS";
  return [{ field: "employeeNetwork.mode", before: b.mode, after: c.mode, weakened, reason: weakened ? "It lets employees reach any public host: employee network access goes from RESTRICTED to AUTONOMOUS." : null }];
}

// The allow-list decides something only under RESTRICTED; it weakens when, restricted before and after, an entry lets
// in a host none did before.
function allowChange(b: EmployeeNetwork, c: EmployeeNetwork): EmployeeNetworkChange[] {
  if (b.allow.length === c.allow.length && b.allow.every((e, i) => e === c.allow[i])) return [];
  const opened = b.mode === "RESTRICTED" && c.mode === "RESTRICTED" ? c.allow.filter((e) => !covered(e, b.allow)) : [];
  const reason = opened.length > 0 ? `It lets employees reach hosts their allow-list did not: ${opened.join(", ")}.` : null;
  return [{ field: "employeeNetwork.allow", before: listText(b.allow), after: listText(c.allow), weakened: opened.length > 0, reason }];
}

// A limit weakens when it is raised or removed; one added or lowered narrows.
function limitChanges(b: EmployeeNetwork, c: EmployeeNetwork): EmployeeNetworkChange[] {
  return NETWORK_LIMIT_KEYS.flatMap((key): EmployeeNetworkChange[] => {
    const before = b.limits?.[key];
    const after = c.limits?.[key];
    if (before === after) return [];
    const weakened = before !== undefined && (after === undefined || after > before);
    const reason = !weakened ? null : after === undefined ? `It removes the employees' limit ${key} (it was ${before}).` : `It raises the employees' limit ${key} from ${before} to ${after}.`;
    return [{ field: `employeeNetwork.limits.${key}`, before: limitText(before), after: limitText(after), weakened, reason }];
  });
}

// What changes between two employee network accesses, field by field, worked out from both (never from their words).
export function employeeNetworkChanges(base: EmployeeNetwork, candidate: EmployeeNetwork): EmployeeNetworkChange[] {
  return [...modeChange(base, candidate), ...allowChange(base, candidate), ...limitChanges(base, candidate)];
}
