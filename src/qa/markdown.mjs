// The Markdown a person reads, RENDERED from the plan.
//
// The old shape was the other way round: Markdown was the plan, and anything a
// machine wanted had to be guessed out of prose. Two files with the same content
// in two shapes is two files that disagree by Friday, so there is one source --
// the JSON -- and this produces the document from it. Nothing is ever read back
// out of the Markdown, and the banner at the top says so.
//
// No HTML, no template engine: a plan is read in an editor and in a pull
// request, and Markdown is what both of those render.
import { LAYERS } from "../dsl/verbs.mjs";
import { scoreOf } from "./risk.mjs";
import { members, scenariosOf } from "./rules/common.mjs";

export const BANNER = (id) => `<!-- GENERATED from ${id}.plan.json — edit the JSON, then: node <engine>/cli/qa-plan.mjs render ${id} --write -->`;

export function planMarkdown(p) {
  const parts = [BANNER(p.id), title(p), context(p), criteria(p), scenarioTable(p), ...scenariosOf(p).map((s) => scenario(p, s)), manual(p), open(p), excluded(p), done(p)];
  return parts.filter(Boolean).join("\n\n") + "\n";
}

const title = (p) => `# ${p.title ?? p.id} — test plan`;

function context(p) {
  const facts = [["Feature", p.feature], ["Revision", p.revision], ["Written", p.at], ["Author", p.author], ["Map", p.map?.fe_commit && `frontend ${p.map.fe_commit}${p.map.captured ? `, captured ${p.map.captured}` : ""}`], ["Environments", (p.environments ?? []).join(", ")], ["Budget", budgetWords(p)]];
  return [facts.filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`).join("   ·   "), sources(p), scope(p)].filter(Boolean).join("\n\n");
}

const budgetWords = (p) => (p.budget?.minutes ? `${p.budget.minutes} min${p.budget.profile ? ` (${p.budget.profile})` : ""}${p.budget.because ? ` — ${p.budget.because}` : ""}` : "");

function sources(p) {
  const rows = members(p, "sources");
  if (!rows.length) return "";
  return section("Sources", rows.map((s) => `- **${s.id}** ${s.kind ?? "source"} ${s.ref ?? ""}${s.revision ? ` @ ${s.revision}` : " (no revision recorded)"}${s.says ? ` — ${s.says}` : ""}`));
}

function scope(p) {
  const rows = [...(p.scope?.in ?? []).map((v) => `- in: ${v}`), ...(p.scope?.out ?? []).map((v) => `- out: ${v}`)];
  return rows.length ? section("Scope", rows) : "";
}

function criteria(p) {
  const rows = members(p, "criteria");
  if (!rows.length) return "";
  const lines = rows.map((c) => `| ${c.id} | ${cell(c.says)} | ${cell(c.source ?? "")} | ${cell(coverWords(p, c))} |`);
  return section("Acceptance criteria", [table(["id", "must be true", "source", "coverage"]), ...lines]);
}

// What covers it, read the same way coverage.mjs reads it: what a scenario or a
// check DECLARES. A criterion covered by nothing falls back to its disposition,
// and one with neither shows blank -- which plan-check has already called an error.
function coverWords(p, c) {
  const by = [...scenariosOf(p), ...members(p, "manual")].filter((m) => (m.covers ?? []).includes(c.id)).map((m) => m.id);
  return by.length ? by.join(", ") : dispositionWords(c);
}

const dispositionWords = (c) => (c.disposition ? `${c.disposition.state}: ${c.disposition.because}` : "");

function scenarioTable(p) {
  const rows = scenariosOf(p).map((s) => `| ${s.id} | ${cell(s.name)} | ${s.priority ?? ""} | ${cell((s.covers ?? []).join(", "))} | ${s.technique ?? ""} | ${cell(layerWords(s))} | ${s.readiness ?? "ready"} | ${cell((s.cases ?? []).map((l) => l.id).join(", "))} |`);
  return section("Scenarios", [table(["id", "scenario", "pri", "covers", "technique", "layers", "readiness", "cases"]), ...rows]);
}

const layerWords = (s) => LAYERS.filter((l) => s.expect?.[l]?.need === "required").join("+") || "—";

function scenario(p, s) {
  const head = `### ${s.id} — ${s.name ?? ""}  [${s.priority ?? "?"}]${s.must ? "  MUST" : ""}`;
  return [head, ...lines(s)].filter(Boolean).join("\n");
}

function lines(s) {
  const facts = [["Why it matters", s.why], ["Risk", riskWords(s)], ["Actor", actorWords(s)], ["Preconditions", joined(s.preconditions, "; ")], ["Data", dataWords(s)], ["Intent", joined(s.intent, " → ")]];
  const more = [["Mutation", mutationWords(s)], ["Repeat", repeatWords(s)], ["Asynchronous", asyncWords(s)], ["Denial", denialWords(s)], ["Depends on", (s.dependsOn ?? []).join(", ")]];
  const tail = [["Blockers", (s.blockers ?? []).map((b) => `${b.id} (${b.kind}) ${b.says}`).join("; ")], ["Manual", (s.checks ?? []).join(", ")], ["Estimate", s.estimate?.minutes ? `${s.estimate.minutes} min — ${s.estimate.because ?? "no basis given"}` : ""]];
  return [...bullets(facts), ...expectLines(s), ...bullets(more), ...bullets(tail)];
}

const bullets = (facts) => facts.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`);

const expectLines = (s) => LAYERS.filter((l) => s.expect?.[l]).map((l) => `- **${l.toUpperCase()}:** ${expectWords(s.expect[l])}`);

const expectWords = (e) => (e.need === "required" ? e.says : `${e.need} — ${e.because}`);

function riskWords(s) {
  const score = scoreOf(s.risk);
  if (!score.given.length) return s.because ? `priority set by hand: ${s.because}` : "";
  return `${score.total}/${score.of} from ${score.given.join(", ")}${score.missing.length ? ` (not scored: ${score.missing.join(", ")})` : ""}${score.because ? ` — ${score.because}` : ""}`;
}

const actorWords = (s) => [s.actor?.as, roles(s.actor?.roles, "holds"), roles(s.actor?.notRoles, "must NOT hold"), s.actor?.owner && `resource owner: ${s.actor.owner}`, s.actor?.tenant && `tenant: ${s.actor.tenant}`, s.actor?.state && `state: ${s.actor.state}`].filter(Boolean).join("; ");

const roles = (list, word) => (list?.length ? `${word} ${list.join(", ")}` : "");

const dataWords = (s) => [s.data?.data, s.data?.key && `key ${s.data.key}`, s.data?.scope && `scope ${s.data.scope}`, s.data?.cleanup && `cleanup: ${s.data.cleanup}`, s.data?.onFailure && `on failure: ${s.data.onFailure}`, s.data?.isolation].filter(Boolean).join("; ");

const mutationWords = (s) => (s.mutation ? [s.mutation.kind, s.mutation.before && `before: ${s.mutation.before}`, s.mutation.action && `action: ${s.mutation.action}`, s.mutation.after && `after: ${s.mutation.after}`, s.mutation.unchanged?.length && `unchanged: ${s.mutation.unchanged.join("; ")}`, s.mutation.onRefusal && `if refused: ${s.mutation.onRefusal}`, s.mutation.effect && `map: ${s.mutation.effect}`].filter(Boolean).join("; ") : "");

const repeatWords = (s) => (s.repeat ? [s.repeat.kind, s.repeat.expect, s.repeat.extra && `must not appear: ${s.repeat.extra}`, s.repeat.guarded && "the case's skip-if guards the RE-RUN only"].filter(Boolean).join("; ") : "");

const asyncWords = (s) => (s.async ? [s.async.accepted && `accepted: ${s.async.accepted}`, s.async.complete && `done when: ${s.async.complete}`, s.async.deadline && `within ${s.async.deadline}s (${s.async.because ?? "no source"})`, s.async.observe?.length && `watched on ${s.async.observe.join(", ")}`, s.async.unverified && `not verified: ${s.async.unverified}`].filter(Boolean).join("; ") : "");

const denialWords = (s) => (s.denial ? [s.denial.lacks?.length && `lacks ${s.denial.lacks.join(", ")}`, s.denial.action && `attempts ${s.denial.action}`, s.denial.ui && `screen: ${s.denial.ui}`, s.denial.backend && `server: ${expectWords(s.denial.backend)}`, s.denial.unchanged && `unchanged: ${expectWords(s.denial.unchanged)}`].filter(Boolean).join("; ") : "");

function manual(p) {
  const rows = members(p, "manual");
  if (!rows.length) return "";
  return section("Manual checks — what no browser can see", rows.flatMap((m) => check(m)));
}

const check = (m) => [`- **${m.id} ${m.name ?? ""}** (${m.owner ?? "unassigned"}${m.state ? `, ${m.state}` : ""})`, m.because && `  - not automated because: ${m.because}`, ...(m.steps ?? []).map((t) => `  - step: ${t}`), m.expect && `  - expect: ${m.expect}`, m.evidence?.length && `  - evidence: ${m.evidence.join("; ")}`].filter(Boolean);

function open(p) {
  const qs = members(p, "questions").map((q) => `- **${q.id}** ${q.asks}${q.blocks?.length ? ` (blocks ${q.blocks.join(", ")})` : ""} — ${q.owner ?? "unassigned"}${q.answer ? `\n  - answered: ${q.answer}` : ""}`);
  const as = members(p, "assumptions").map((a) => `- **${a.id}** assumed: ${a.says}${a.because ? ` — ${a.because}` : ""}`);
  return qs.length || as.length ? section("Open questions and assumptions", [...qs, ...as]) : "";
}

function excluded(p) {
  const rows = members(p, "exclusions").map((x) => `- **${x.id}** ${x.says} — ${x.because}`);
  return rows.length ? section("Deliberately not covered", rows) : "";
}

const done = (p) => ((p.done ?? []).length ? section("Done means", (p.done ?? []).map((v) => `- [ ] ${v}`)) : "");

const section = (head, lines) => [`## ${head}`, "", ...lines].join("\n");

const joined = (v, sep) => (Array.isArray(v) ? v.join(sep) : "");

const table = (cols) => `| ${cols.join(" | ")} |\n|${cols.map(() => "---").join("|")}|`;

// A pipe inside a cell ends the cell, and a newline ends the row. Both arrive
// from prose somebody typed, so both are handled once, here.
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
