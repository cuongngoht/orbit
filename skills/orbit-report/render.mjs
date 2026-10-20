// The standard RENDERER: one self-contained HTML report from a run's outputs.
//
// Self-contained and offline: the chart library and the fonts travel inside
// the page, the page's own Content-Security-Policy forbids loading anything,
// and the data is one JSON block the page's script reads -- escaped so no
// title a source holds can close that block. Nothing here reaches a network.
//
// What a section is switched OFF for is not in the page at all: the data of a
// disabled section is removed before it is embedded, so "hidden" can never mean
// "still there for anyone who opens the source".
import { render } from "../../src/report/template.mjs";

const LOCKED = new Set(["orbit.report.section.coverage"]);

// What each standard section needs from the model; a disabled section's keys go.
const SECTION_DATA = {
  "orbit.report.section.contributors": ["contributors"],
  "orbit.report.section.collaboration": ["collaboration"],
  "orbit.report.section.ai": ["ai"],
  "orbit.report.section.pipelines": ["pipelines"],
  "orbit.report.section.appendix": ["prTable", "itemTable"],
};

export function renderReport(input, assets) {
  const payload = payloadOf(input);
  return render(assets.template, { title: titleOf(payload), fonts: fontCss(assets.fonts), chartjs: bareScript(assets.chartjs), data: safeJson(payload) });
}

export function payloadOf(input) {
  const sections = sectionsOf(input);
  return { meta: metaOf(input), sections, model: modelFor(input.model, sections), metrics: input.metrics ?? [], forecast: input.forecast ?? null, baseline: input.baseline ?? null, coverage: coverageOf(input), definitions: definitionsOf(input.metrics ?? []) };
}

const titleOf = (p) => `${p.meta.project} · project report ${p.meta.window.from ?? "all history"} → ${p.meta.window.to}`;

// Standard sections in the table's order, each switched as the project chose;
// the coverage section cannot be switched off. Extension sections go where
// they asked (after:<section id>), else before coverage.
function sectionsOf(input) {
  const chosen = input.sectionsEnabled ?? {};
  const standard = input.sections.map((s) => ({ id: s.id, title: s.title, enabled: LOCKED.has(s.id) || (chosen[s.id] ?? s.enabled) }));
  return (input.extensions ?? []).reduce(placed, standard);
}

function placed(list, x) {
  const at = list.findIndex((s) => s.id === (x.placement ?? "").replace(/^after:/, ""));
  const index = at >= 0 ? at + 1 : Math.max(0, list.findIndex((s) => s.id === "orbit.report.section.coverage"));
  const row = { id: x.id, title: x.title, enabled: x.enabled !== false, extension: x };
  return [...list.slice(0, index), row, ...list.slice(index)];
}

function modelFor(model, sections) {
  const off = sections.filter((s) => !s.enabled).flatMap((s) => SECTION_DATA[s.id] ?? []);
  return Object.fromEntries(Object.entries(model ?? {}).filter(([k]) => !off.includes(k)));
}

function metaOf(input) {
  const s = input.snapshot;
  return { project: input.project.name, provider: s.source.provider, providerLabel: input.providerLabel ?? s.source.provider, organization: s.source.organization, scope: scopeList(s.source.scope), window: s.window,
    collectedStarted: s.collectedAt?.started, collectedFinished: s.collectedAt?.finished, runId: input.runId, render: input.render, engine: input.engine, kit: input.kit, generatedAt: input.generatedAt, linkHosts: linkHosts(s), modelProblem: input.modelProblem ?? null };
}

const scopeList = (scope) => Object.entries(scope ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : v === true ? [k] : typeof v === "string" ? [`${k} ${v}`] : []));

// A page links only to the hosts its own records came from.
function linkHosts(s) {
  const c = s.collections ?? {};
  const urls = [...(c.repositories ?? []), ...(c.pullRequests ?? []).slice(0, 50), ...(c.workItems ?? []).slice(0, 50), ...(c.builds ?? []).slice(0, 20)].map((r) => r?.url);
  return [...new Set(urls.map(hostOf).filter(Boolean))];
}

function hostOf(url) {
  try { return new URL(String(url)).protocol === "https:" ? new URL(String(url)).host : null; }
  catch { return null; }
}

function coverageOf(input) {
  const c = input.snapshot.completeness ?? {};
  return { collections: Object.entries(c).map(([name, v]) => ({ name, status: v.status, reason: v.reason ?? null, items: v.items ?? null, pages: v.pages ?? null, truncated: v.truncated ?? [] })), parts: input.parts ?? [], skipped: input.skipped ?? [], drafts: input.drafts ?? [], notes: input.notes ?? [] };
}

const definitionsOf = (metrics) => metrics.map((m) => ({ id: m.id, label: m.label, unit: m.unit, version: m.version, definition: m.definition, source: m.provenance?.source ?? (String(m.id).startsWith("orbit.") ? "builtin" : "store") }));

function fontCss(fonts = []) {
  return fonts.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${Buffer.from(f.bytes).toString("base64")}) format("woff2")}`).join("\n");
}

// The vendored bundle, minus its source-map comment: a page that can load
// nothing has no map to point at.
const bareScript = (text) => String(text ?? "").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");

// JSON inside <script type="application/json">: `<`, `>` and `&` as escapes,
// so "</script>" in a PR title is text, and the two line separators JSON
// allows and JavaScript source did not.
export const safeJson = (value) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
