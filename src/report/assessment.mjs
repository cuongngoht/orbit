// ONE assessment as one self-contained page (doc §10; ADR 0032), rendered ONLY from its frozen
// snapshot (src/investigation/assessments.mjs) -- so it can be rendered again, offline, without
// running anything, and two renders of one snapshot are byte for byte the same page.
//
// What it shows is an ALLOW-list built field by field; free text passes src/scrub.mjs. It says what
// it rests on (the scope's digest, the results it counts) and what it could not show (every gap,
// with its reason), and it calls nothing compliant: coverage counts only SATISFIED results against an
// accepted oracle, over every obligation that applies.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrub } from "../scrub.mjs";
import { render } from "./template.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

const BADGE = { SATISFIED: "pass", CONTRADICTED: "fail", FLAKY: "warn", AMBIGUOUS: "warn", STALE: "warn" };

export function assessmentView(snapshot, opts = {}) {
  return {
    id: snapshot.id,
    project: opts.project ?? null,
    generated: opts.generated ?? null,
    objective: scrub(String(snapshot.scope?.objective ?? "")),
    revision: snapshot.scope?.revision ?? "unknown",
    scopeDigest: String(snapshot.scopeDigest ?? "").slice(0, 16),
    coverage: snapshot.coverage?.shown ?? "—",
    obligations: (snapshot.obligations ?? []).map(obligationRow),
    gaps: (snapshot.gapRefs ?? []).map((g) => scrub(String(g))),
    results: (snapshot.resultRefs ?? []).length,
    findings: (snapshot.findingRefs ?? []).length,
  };
}

const obligationRow = (o) => ({ obligation: o.obligation, shape: o.shape ?? "—", outcome: o.outcome, badge: BADGE[o.outcome] ?? "flat", controls: Object.entries(o.controls ?? {}).map(([role, word]) => `${role}: ${word}`).join(" · ") || "—", gaps: (o.gaps ?? []).map((g) => scrub(String(g))).join("; ") });

export const renderAssessment = (snapshot, opts = {}) => render(read("assessment.html"), { ...assessmentView(snapshot, opts), style: read("report.css") });
