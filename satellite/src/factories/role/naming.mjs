// A role's NAME, generated from what it is responsible for -- never chosen, never a title that could claim authority.
// The first responsibility names it: its subject in PascalCase, then the noun for its activity. "analyze" a
// "consumer failure" is ConsumerFailureAnalyst; "repair" a "notification" is NotificationRepairEngineer. An activity
// with no row is its own word with "er". A name grants nothing: what a role may do is the profile it requested,
// bounded by src/permissions/.
export const AGENT_NOUNS = Object.freeze({ analyze: "Analyst", architect: "Architect", audit: "Auditor", build: "Builder", design: "Designer", diagnose: "Diagnostician", document: "Writer", explore: "Explorer", fix: "RepairEngineer", implement: "Implementer", investigate: "Investigator", migrate: "Migrator", monitor: "Monitor", optimize: "Optimizer", plan: "Planner", profile: "Profiler", refactor: "Refactorer", repair: "RepairEngineer", research: "Researcher", review: "Reviewer", test: "Tester", trace: "Tracer", triage: "Triager", verify: "Verifier" });

export const pascal = (text) => String(text).split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");

export const nounOf = (activity) => AGENT_NOUNS[activity] ?? `${pascal(activity)}er`;

export const roleNameOf = (responsibilities) => `${pascal(responsibilities[0].subject)}${nounOf(responsibilities[0].activity)}`;

export const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export const roleIdOf = (name) => `rol-${kebab(name)}`.slice(0, 50).replace(/-+$/, "");

// The responsibilities as one comparable set: two roles are the same role when they answer for the same pairs.
export const pairsOf = (responsibilities) => [...new Set((responsibilities ?? []).map((r) => `${r.activity}:${r.subject}`))].sort();

export const sameResponsibilities = (a, b) => pairsOf(a).join("|") === pairsOf(b).join("|");
