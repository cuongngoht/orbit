// One plan's coverage as one page: the chain from an acceptance criterion to the
// evidence, and every reason a number is smaller than somebody hoped.
//
// It re-judges nothing. A run decided PASS; this reports whether that PASS was
// about the plan as it stands, and counts it only when it was. The model is in
// src/qa/coverage.mjs -- this is the VIEW: the data a template gets, and no HTML
// outside coverage.html.
import { publish } from "./publish-page.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageModel, traceRows } from "../qa/coverage.mjs";
import { pct } from "../qa/format.mjs";
import { render } from "./template.mjs";

const TONE = { verified: "pass", executed: "warn", implemented: "flat", designed: "flat", blocked: "warn", excluded: "flat", manual: "warn" };

export function coverageView(model, opts = {}) {
  const trace = traceRows(model).map(row);
  return { project: opts.project ?? "", generated: opts.generated ?? "", ...head(model), ratios: model.ratios.map((r) => ({ ...r, pct: pct(r) })), stages: model.stages.map((s) => ({ ...s, tone: TONE[s.name] ?? "flat" })), trace, gaps: model.gaps, unknown: model.unknown, excluded: model.excluded, checks: checks(model), ...callout(model) };
}

const head = (m) => ({ plan: m.plan.id, title: `${m.plan.title || m.plan.id}${m.plan.draft ? " (DRAFT — not yet the team's plan)" : ""}`, revision: m.plan.revision, at: m.plan.at });

const row = (r) => ({ ...r, tone: TONE[r.stage] ?? "flat", rowClass: r.verified ? "" : "broke", runs: r.runs.map((x) => ({ ...x, evidence: x.evidence || "—" })) });

const checks = (m) => m.checks.map((c) => ({ id: c.id, name: c.name ?? "", owner: c.owner ?? "unassigned", state: c.state ?? "", expect: c.expect ?? "" }));

// One sentence a reader comes away with. Never "92%": the number that matters is
// what is still unproven, and the denominator it is unproven out of.
function callout(m) {
  const verified = m.ratios.find((r) => r.name === "criteria verified") ?? { n: 0, of: 0 };
  const left = verified.of - verified.n;
  return { callout: `${verified.n} of ${verified.of} acceptance criteria verified against this revision · ${left} still unproven · ${m.gaps.length} capability gap(s) · ${m.unknown.length} run(s) whose evidence is not current`, calloutClass: tone(verified, m) };
}

const tone = (verified, m) => (verified.of > 0 && verified.n === verified.of && !m.gaps.length && !m.unknown.length ? "ok" : "");

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

export const coverageHtml = (plan, world, opts = {}) => render(read("coverage.html"), { ...coverageView(coverageModel(plan, world, opts), opts), style: read("report.css") });

export function writeCoverage(file, plan, world, opts = {}) {
  publish(file, coverageHtml(plan, world, opts));
  return file;
}
