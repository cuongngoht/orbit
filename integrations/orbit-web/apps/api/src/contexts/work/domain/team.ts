// A LEAD'S TEAM (Work, pure): what makes a plan givable, and what a lead does next when its attempt can be woken -- review
// what its parts handed in (and integrate once they all ended), answer what they asked, or wait.
import type { AssignmentState } from "@orbit-web/contracts";

export const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A part blocked on a question is not settled: its lead answers, and it goes on.
export const SETTLED: readonly AssignmentState[] = ["AWAITING_ACCEPTANCE", "COMPLETED", "CANCELLED", "FAILED_FINAL"];
export const DONE: readonly AssignmentState[] = ["COMPLETED", "CANCELLED", "FAILED_FINAL"];

export interface PlanPart {
  key: string;
  employeeId: string;
  goal: string;
  dependsOn: string[];
  receives?: { from: string }[];
}

// Whether a lead waiting for its team has something to review now: a part's result waits for its decision, or every part
// ended -- and no part is still being worked on. A part that waits for others it has not accepted yet is not "being
// worked on": its lead's decisions are what it waits for. One exception, so the team works in parallel: a result that a
// queued part waits for is reviewed at once, whatever else is being worked on -- that part can start only on this
// decision, beside the parts still running.
export function readyToReview(units: readonly { key: string; state: AssignmentState; dependsOn: string[] }[]): boolean {
  if (units.length === 0) return false;
  if (units.some((u) => u.state === "AWAITING_ACCEPTANCE" && units.some((w) => w.state === "QUEUED" && w.dependsOn.includes(u.key)))) return true;
  const done = new Set(units.filter((u) => u.state === "COMPLETED").map((u) => u.key));
  const working = units.some((u) => (u.state === "QUEUED" ? u.dependsOn.every((d) => done.has(d)) : !SETTLED.includes(u.state) && u.state !== "BLOCKED"));
  if (working) return false;
  return units.some((u) => u.state === "AWAITING_ACCEPTANCE") || units.every((u) => DONE.includes(u.state));
}

// What a lead is woken for, when it is woken at all: its parts' results first (a review carries the questions pending
// with it), then its team's questions; else it waits.
export type LeadNext = "review" | "answer" | "wait";
export function leadNext(units: readonly { key: string; state: AssignmentState; dependsOn: string[] }[], openQuestions: number): LeadNext {
  if (readyToReview(units)) return "review";
  return openQuestions > 0 ? "answer" : "wait";
}

// Whether every part of a lead ended (its own hand-in waits for that).
export const allEnded = (units: readonly { state: AssignmentState }[]): boolean => units.every((u) => DONE.includes(u.state));

// The waits of a plan, ordered (Kahn); null when they make a cycle.
export function orderOf(units: readonly { key: string; dependsOn: string[] }[]): string[] | null {
  const waits = new Map(units.map((u) => [u.key, new Set(u.dependsOn)]));
  const out: string[] = [];
  const ready = units.filter((u) => u.dependsOn.length === 0).map((u) => u.key);
  while (ready.length > 0) {
    const k = ready.shift() as string;
    out.push(k);
    for (const [other, deps] of waits) {
      if (deps.delete(k) && deps.size === 0 && !out.includes(other) && !ready.includes(other)) ready.push(other);
    }
  }
  return out.length === units.length ? out : null;
}

// What is wrong with a plan, as the lead is told (empty: it can be given). Who each part may go to was settled before
// (its authority); this holds the plan's own shape: keys, waits, what a part receives.
export function planProblems(units: readonly PlanPart[], leadEmployeeId: string, taken: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [];
  if (units.length === 0) problems.push("A plan gives at least one part.");
  if (units.length > 8) problems.push("A plan gives at most 8 parts at a time.");
  const keys = new Set<string>();
  for (const u of units) {
    if (!KEY.test(u.key)) problems.push(`"${u.key}" is not a part's key (lower-case letters, digits and dashes).`);
    if (keys.has(u.key)) problems.push(`The key "${u.key}" is given twice.`);
    if (taken.has(u.key)) problems.push(`A part "${u.key}" was already given: name the new one differently.`);
    keys.add(u.key);
    if (u.employeeId === leadEmployeeId) problems.push(`"${u.key}" is given to yourself: give it to someone else, or do it yourself.`);
    if (u.goal.trim().length === 0) problems.push(`"${u.key}" has no goal.`);
  }
  for (const u of units) for (const d of u.dependsOn) if (!keys.has(d)) problems.push(`"${u.key}" waits for "${d}", which is not in the plan.`);
  for (const u of units) for (const r of u.receives ?? []) if (!u.dependsOn.includes(r.from)) problems.push(`"${u.key}" receives the hand-in of "${r.from}", which it does not wait for: a part receives only what it waits for.`);
  if (problems.length === 0 && orderOf(units) === null) problems.push("The parts wait for each other in a circle: nothing could start.");
  return problems;
}
