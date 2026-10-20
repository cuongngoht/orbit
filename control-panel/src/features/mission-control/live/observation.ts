import { isRecord, numberOf, stringOf, stringsOf } from "../../../shared/json";

// What a CHECK was observed doing while it ran (1.8.5, src/orchestration/activity/ in the engine): the cases its runner
// reported, the failures it printed, the totals it said -- streamed as `activity-view`, one projection per action, which
// the page REPLACES (a later revision, or a file begun again) and never adds to. It is never the check's verdict: the
// receipt is, and the page says so beside it. The words here are the terminal's (src/live/activity.mjs progressWords).

export type CaseState = "passed" | "failed" | "skipped" | "todo" | "cancelled";

const CASE_STATES: readonly CaseState[] = ["passed", "failed", "skipped", "todo", "cancelled"];

const isCaseState = (value: unknown): value is CaseState => typeof value === "string" && (CASE_STATES as readonly string[]).includes(value);

export interface ObservedCase {
  key: string;
  name: string | null;
  suite: string | null;
  state: CaseState;
  before: CaseState | null;
}

export interface ObservedFailure {
  name: string | null;
  category: string;
  message: string | null;
  location: string | null;
  stack: string[];
}

export interface Observation {
  action: string;
  state: string;
  why: string | null;
  component: string | null;
  declaredAs: string | null;
  adapter: { id: string; runner: string | null; cases: string | null; total: string | null } | null;
  counts: Record<CaseState, number>;
  reported: number;
  total: number | null;
  recent: ObservedCase[];
  failures: ObservedFailure[];
  lines: number | null;
  lastPrintedAt: string | null;
  gaps: string[];
  complete: boolean;
  seq: number;
  resets: number;
}

const countOf = (value: unknown, key: CaseState): number => numberOf(isRecord(value) ? value[key] : null) ?? 0;

function caseOf(value: unknown): ObservedCase | null {
  if (!isRecord(value) || !isCaseState(value.state)) return null;
  return { key: stringOf(value.key) ?? "?", name: stringOf(value.name), suite: stringOf(value.suite), state: value.state, before: isCaseState(value.before) ? value.before : null };
}

function failureOf(value: unknown): ObservedFailure | null {
  if (!isRecord(value)) return null;
  return { name: stringOf(value.name) ?? stringOf(value.key), category: stringOf(value.category) ?? "unknown", message: stringOf(value.message), location: stringOf(value.location), stack: stringsOf(value.stack).slice(0, 4) };
}

function adapterOf(value: unknown): Observation["adapter"] {
  if (!isRecord(value)) return null;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  return { id: stringOf(value.id) ?? "generic", runner: stringOf(value.runner), cases: stringOf(capabilities.cases), total: stringOf(capabilities.total) };
}

const present = <T,>(value: T | null): value is T => value !== null;

/** One `activity-view`'s `view`, checked field by field; anything that is not one is null and is dropped. */
export function observationOf(value: unknown): Observation | null {
  if (!isRecord(value)) return null;
  const action = stringOf(value.action);
  const seq = numberOf(value.seq);
  if (action === null || seq === null) return null;
  const command = isRecord(value.command) ? value.command : {};
  const output = isRecord(value.output) ? value.output : {};
  return { action, state: stringOf(value.state) ?? "unknown", why: stringOf(value.why), component: stringOf(command.component), declaredAs: stringOf(command.declaredAs), adapter: adapterOf(value.adapter), counts: { passed: countOf(value.counts, "passed"), failed: countOf(value.counts, "failed"), skipped: countOf(value.counts, "skipped"), todo: countOf(value.counts, "todo"), cancelled: countOf(value.counts, "cancelled") }, reported: numberOf(value.reported) ?? 0, total: numberOf(value.total), recent: (Array.isArray(value.recent) ? value.recent : []).map(caseOf).filter(present).slice(-50), failures: (Array.isArray(value.failures) ? value.failures : []).map(failureOf).filter(present).slice(0, 20), lines: numberOf(output.lines), lastPrintedAt: stringOf(output.lastAt), gaps: stringsOf(value.gaps), complete: value.complete === true, seq, resets: numberOf(value.resets) ?? 0 };
}

/** The `activity` map a collected read answers (`GET …/activity`), each entry checked. */
export const observationsOf = (value: unknown): Observation[] => (isRecord(value) ? Object.values(value).map(observationOf).filter(present) : []);

/** Whether `next` replaces `was`: a file begun again, or a later revision of the same one. */
export const isNewer = (was: Observation | undefined, next: Observation) => was === undefined || next.resets > was.resets || (next.resets === was.resets && next.seq > was.seq);

export const withObservations = (all: Readonly<Record<string, Observation>>, next: readonly Observation[]): Readonly<Record<string, Observation>> => next.reduce<Readonly<Record<string, Observation>>>((acc, o) => (isNewer(acc[o.action], o) ? { ...acc, [o.action]: o } : acc), all);

/** What it says of its progress, in the terminal's words: only what was reported, and a total only when the runner said one. */
export function progressOf(o: Observation): { cases: string | null; total: string | null; unavailable: string | null; onlyFailures: string | null } {
  const parts = CASE_STATES.filter((k) => o.counts[k] > 0).map((k) => `${o.counts[k]} ${k}`);
  return {
    cases: parts.length > 0 ? parts.join(" · ") : null,
    total: o.total !== null ? `${o.reported} of ${o.total} reported` : o.reported > 0 ? `${o.reported} reported · total unknown` : null,
    unavailable: o.adapter?.cases === "none" ? "case progress unavailable: the command prints nothing Orbit reads as case results" : null,
    onlyFailures: o.adapter?.cases === "failures" ? "this runner prints only the cases that did not pass" : null,
  };
}
