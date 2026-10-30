import type { Tone } from "../mission-control/missionWords";
import type { Decision, ImprovementMetric } from "./improvement.types";

export const IMPROVEMENT_PATH = "/improvement";

export const CAMPAIGN_ROUTE = "/improvement/:key/campaigns/:id";

export const campaignPath = (key: string, id: string) => `${IMPROVEMENT_PATH}/${encodeURIComponent(key)}/campaigns/${encodeURIComponent(id)}`;

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "opportunities", label: "Opportunities" },
  { id: "settings", label: "Settings" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTab = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

/** A campaign's phase in the tone the engine's words carry; the word itself is always shown. */
export const PHASE_TONE: Record<string, Tone> = { COMPLETED: "success", PROMOTED: "success", MONITORING: "informative", QUALIFIED: "success", AWAITING_AUTHORITY: "warning", EVALUATING: "informative", VALIDATED: "informative", GENERATED: "informative", GENERATING: "informative", PROPOSED: "subtle", DIAGNOSED: "subtle", DETECTED: "subtle", REJECTED: "warning", ROLLED_BACK: "danger", ROLLING_BACK: "danger", PROMOTING: "informative", BLOCKED: "warning", INCONCLUSIVE: "subtle" };

export const VERDICT_TONE: Record<string, Tone> = { BETTER: "success", WORSE: "danger", EQUIVALENT: "subtle", INCONCLUSIVE: "subtle", BLOCKED: "warning", INTERRUPTED: "warning" };

export const phaseTone = (phase: string): Tone => PHASE_TONE[phase] ?? "subtle";

/** The counts the overview shows, each summed from the phases campaigns stand in -- never a percentage. */
export const COUNTS: { label: string; phases: string[] }[] = [
  { label: "Awaiting evidence", phases: ["DETECTED", "DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "VALIDATED", "EVALUATING"] },
  { label: "Qualified", phases: ["QUALIFIED", "AWAITING_AUTHORITY"] },
  { label: "Promoted", phases: ["PROMOTED", "MONITORING", "COMPLETED"] },
  { label: "Regressions", phases: ["ROLLING_BACK", "ROLLED_BACK"] },
  { label: "Rolled back", phases: ["ROLLED_BACK"] },
  { label: "Blocked", phases: ["BLOCKED"] },
];

export const countOf = (phases: Record<string, number>, of: string[]) => of.reduce((n, p) => n + (phases[p] ?? 0), 0);

/** A person's three decisions: the phases each is offered in, and what the page says before it is made. */
export const DECISIONS: Record<Decision, { label: string; phases: string[]; say: string; destructive: boolean }> = {
  promote: { label: "Promote", phases: ["QUALIFIED", "AWAITING_AUTHORITY"], say: "New work runs the candidate; tasks that pinned the current version keep it. Every promotion gate is asked again before anything moves.", destructive: false },
  revert: { label: "Put the replaced version back", phases: ["PROMOTED", "MONITORING"], say: "New work runs the version this candidate replaced again. Tasks that pinned the candidate keep it.", destructive: true },
  reject: { label: "Reject", phases: ["DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "VALIDATED", "EVALUATING", "QUALIFIED", "AWAITING_AUTHORITY"], say: "The candidate never runs, and the same candidate is not evaluated again against this version.", destructive: true },
};

export const DECISION_IDS = Object.keys(DECISIONS) as Decision[];

/** A metric as a person reads it: its numerator over its denominator, or that it is not available yet. */
export const metricValue = (m: ImprovementMetric): string => (m.value === null ? "not available" : m.unit === "ratio" ? `${m.numerator} of ${m.denominator}` : m.unit === "delta" ? `${m.value > 0 ? "+" : ""}${Math.round(m.value * 100) / 100} per evaluation` : String(m.value));

export const byLabel = (by: string): string => ({ machine: "this machine", project: "this project", default: "default" })[by] ?? by;
