// ONE investigation as one self-contained page, and the same data as JSON for
// automation. It is read off the investigation's own fold
// (src/investigation/model.mjs) and it DECIDES nothing: every outcome on it is a
// finding the journal already holds.
//
// What it shows is an ALLOW-list, built field by field below; nothing the
// journal holds reaches the page unless a line here names it. Text goes
// through src/scrub.mjs, and by default the page is REDACTED on top of that:
// SQL string literals and the synthetic TC- values read `…`, because a page
// gets forwarded and a literal is how tenant data rides along. The unredacted
// form exists only when a person set settings `reports.internal`, and it says
// so at the top.
//
// It also says what it did NOT look at: the controls the plan skipped and why,
// every layer an action could not witness, and what the browser adapter never
// shows. A page that only listed what passed would read as full coverage.
//
// The LOOP's state -- what is still owed, why it stopped, what reached memory --
// is read from the latest SNAPSHOT the engine stored (a settled step, a
// checkpoint, a finish), labelled with the journal position it was taken at.
// The page never re-derives obligations: it would need a world a page does not
// have, and a second derivation would be a second story.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrub } from "../scrub.mjs";
import { render } from "./template.mjs";
import { latestSnapshot } from "../investigation/model.mjs";
import { LAYERS, OBLIGATION_STATES, OUTCOMES, STATE_IDS, isEvidence, outcomeRank, stopReason } from "../investigation/vocab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

const BADGE = { CONFIRMED_DEFECT: "fail", SUSPECTED_DEFECT: "warn", REQUIRES_REQUIREMENT: "warn", INCONCLUSIVE: "flat", BLOCKED: "flat", OBSERVED_EXPECTED_BEHAVIOR: "pass" };

export const maskSql = (q) => String(q ?? "").replace(/'(?:[^']|'')*'/g, "'…'");
const maskTc = (t) => String(t ?? "").replace(/\bTC-[A-Za-z0-9-]+/g, "TC-…");

// opts: { internal, project, generated, evidenceDir, bytes(path) -> Buffer|null }
export function investigationView(model, opts = {}) {
  const text = (t) => (opts.internal ? scrub(t) : maskTc(scrub(t)));
  const findings = [...model.findings].sort((a, b) => outcomeRank(a.outcome) - outcomeRank(b.outcome)).map((f) => findingView(f, text));
  return { project: opts.project ?? null, generated: opts.generated ?? null, redacted: !opts.internal, overview: overviewOf(model, text), loop: loopOf(model, text), callout: calloutOf(findings), calloutClass: findings.some((f) => f.outcome === "CONFIRMED_DEFECT") ? "danger" : findings.some((f) => f.defect) ? "" : "ok", counts: countsOf(findings), coverage: coverageOf(model, text), findings, actions: model.actions.map((a) => actionView(model, a, text, opts)), checks: model.checks.map((c) => checkView(c, opts, text)), security: model.security.map((s) => securityView(s, text)), reproductions: model.reproductions.map((r) => ({ id: r.id, finding: r.finding, action: r.action, reproduced: r.reproduced ? "reproduced" : "not reproduced", why: text(r.why) })), handover: handoverOf(model, findings, text) };
}

function overviewOf(model, text) {
  const m = model.meta ?? {};
  return { id: m.id, objective: text(m.objective ?? ""), scope: text(m.scope ?? ""), mode: m.mode, environment: m.environment ? `${m.environment.id} (${m.environment.kind}, ${hostOf(m.environment.origin)})` : "none", identity: m.identity ?? "the session's own", revision: m.revision ?? "unknown", at: m.at, cancelled: model.cancelled ? text(model.cancelled.why ?? "cancelled") : null };
}

const hostOf = (origin) => { try { return new URL(origin).host; } catch { return "?"; } };

// ------------------------------------------------------------------- the loop
const STATE_BADGE = { satisfied: "pass", violated: "fail", pending: "warn", blocked: "flat", "needs-approval": "warn", "needs-requirement": "warn", "not-applicable": "flat" };


function loopOf(model, text) {
  const snap = latestSnapshot(model);
  return { inputMode: model.meta?.inputMode ?? "screen", lifecycle: model.lifecycle, stop: loopStop(model, snap), asOf: snap ? `as of journal position ${snap.position} — ${Math.max(0, model.position - snap.position)} record(s) since` : "no step has settled yet — nothing has been counted", counts: owedCounts(snap), next: (snap?.frontier ?? []).map((o) => (typeof o === "string" ? { id: o, title: "" } : { id: o.id, title: text(o.title ?? "") })), memory: memoryLine(model, text), inputs: model.inputs.map((i) => ({ type: i.type, ref: text(i.ref ?? ""), revision: i.revision ?? null, authority: i.authority ?? null, state: i.state, why: text(i.why ?? "") })), receipts: model.receipts.map((r) => receiptView(r, text)), questions: model.questions.map((q) => ({ id: q.id, asks: text(q.asks), answer: text(model.answers.find((a) => a.question === q.id)?.says ?? "") || null })) };
}

function loopStop(model, snap) {
  const done = model.completed.at(-1);
  const reason = model.lifecycle === "active" ? snap?.stop : done?.reason;
  return reason ? { reason, say: stopReason(reason)?.say ?? "", by: model.lifecycle === "active" ? "would stop here" : `stopped (${model.lifecycle})` } : null;
}

// Every status counted, over the total: a denominator, never a percentage alone.
function owedCounts(snap) {
  if (!snap) return null;
  const total = Object.values(snap.counts ?? {}).reduce((n, x) => n + x, 0);
  return { total, rows: OBLIGATION_STATES.map((st) => ({ status: st.id, n: snap.counts?.[st.id] ?? 0, badge: STATE_BADGE[st.id] })).filter((r) => r.n) };
}

function memoryLine(model, text) {
  const last = model.checkpoints.at(-1);
  if (!last) return "no checkpoint yet — nothing has been kept as a receipt or projected";
  return `${last.memory}: ${text(last.why ?? "")} (checkpoint ${last.id}, ${model.receipts.length} receipt(s) kept)`;
}

const receiptView = (r, text) => ({ id: r.id, subject: text(r.subject ?? ""), layer: r.layer, type: r.type, outcome: r.outcome, badge: STATE_BADGE[r.outcome] ?? "flat", oracle: `${r.oracle?.kind ?? "none"}${r.oracle?.ref ? ` ${text(r.oracle.ref)}` : ""}${r.oracle?.revision ? ` @ ${r.oracle.revision}` : ""}${r.oracle?.authority ? ` (${r.oracle.authority})` : ""}`, evidence: (r.evidence ?? []).join(", "), why: text(r.why ?? ""), supersedes: r.supersedes ?? null });

function calloutOf(findings) {
  const c = findings.filter((f) => f.outcome === "CONFIRMED_DEFECT").length;
  const s = findings.filter((f) => f.outcome === "SUSPECTED_DEFECT").length;
  if (c) return `${c} confirmed defect(s), each with the evidence and the oracle that confirms it${s ? `; ${s} more suspected, not proved` : ""}.`;
  return s ? `${s} suspected defect(s), none confirmed — each says what evidence would settle it.` : "Nothing here accuses the product. That is what was looked at, not a claim that nothing is wrong — see what was not inspected.";
}

const countsOf = (findings) => OUTCOMES.map((o) => ({ outcome: o.id, n: findings.filter((f) => f.outcome === o.id).length, badge: BADGE[o.id] })).filter((c) => c.n);

function findingView(f, text) {
  const o = OUTCOMES.find((x) => x.id === f.outcome);
  return { id: f.id, outcome: f.outcome, badge: BADGE[f.outcome] ?? "flat", defect: o?.defect === true, confidence: f.confidence, family: f.family, say: text(f.say), action: f.action, evidence: (f.evidence ?? []).join(", "), expected: text(f.expected ?? ""), actual: text(f.actual ?? ""), oracle: f.oracle, alternatives: (f.alternatives ?? []).map(text), needs: (f.needs ?? []).map(text), missing: (f.missing ?? []).map(text), source: f.source ? `${f.source.src} (the map, seen ${f.source.seen ?? "?"})` : null, reproduced: f.reproduced ?? "not attempted" };
}

// Per layer, how many actions said what: "not observed" is a count too.
function coverageOf(model, text) {
  const done = model.actions.filter((a) => a.state === "done");
  const layers = LAYERS.map((layer) => ({ layer: LAYER_LABEL[layer] ?? layer, ...Object.fromEntries(STATE_IDS.map((s) => [s.replace("-", ""), statesFor(model, done, layer, s)])) }));
  return { surfaces: [...new Set(model.actions.map((a) => a.surface).filter(Boolean))].join(", ") || "none", actions: model.actions.length, done: done.length, notDone: model.actions.length - done.length, layers, unverified: unverifiedOf(model, text) };
}

// "api" on this page is an INDEPENDENT call (a tenant probe), never the
// browser's own requests -- those are the network row.
const LAYER_LABEL = { network: "network (the browser's own requests)", api: "api (independent calls)" };

function statesFor(model, done, layer, state) {
  if (layer === "data") return model.checks.filter((c) => c.state === state).length;
  if (layer === "security") return model.security.filter((c) => c.state === state).length;
  if (layer === "api") return model.security.filter((c) => c.channel === "api" && c.state === state).length;
  return state === "not-observed" ? done.filter((a) => !model.observations.some((o) => o.action === a.id && o.layer === layer)).length : model.observations.filter((o) => o.layer === layer && o.state === state).length;
}

function unverifiedOf(model, text) {
  const skipped = (model.plan?.actions?.skipped ?? []).map((s) => `${s.on}: ${s.why}`);
  const layers = Object.entries(model.plan?.layers ?? {}).filter(([, v]) => !["planned"].includes(v.state)).map(([k, v]) => `${k}: ${v.state}${v.why ? ` — ${v.why}` : ""}`);
  const never = (model.plan?.layers?.network?.neverObserved ?? []).length ? [`never shown by the browser adapter, for any request: ${model.plan.layers.network.neverObserved.join(", ")}`] : [];
  return [...skipped, ...layers, ...never, ...(model.plan?.unknowns ?? [])].map(text);
}

function actionView(model, a, text, opts) {
  const layers = model.observations.filter((o) => o.action === a.id).map((o) => ({ layer: o.layer, state: o.state, evidence: isEvidence(o.state), why: text(o.why ?? ""), lines: linesOf(o, text) }));
  return { id: a.id, kind: a.do, on: a.on ?? a.target ?? a.surface ?? "", identity: a.identity ?? "", state: a.state, why: text(a.why ?? ""), before: a.url?.before ?? "", after: a.url?.after ?? "", reproduces: a.reproduces ?? null, shot: shotOf(a, opts), layers };
}

const LINES = {
  ui: (o) => [`${o.data?.before ?? "?"} → ${o.data?.after ?? "?"}${o.data?.navigated ? " (navigated)" : ""}`],
  console: (o, text) => [`${o.data?.errors ?? 0} new error(s)`, ...(o.data?.messages ?? []).map(text)],
  network: (o) => [`detail: ${o.data?.detail ?? "?"}${o.data?.truncated ? ` · ${o.data.truncated} more not read (limits.requestsPerAction)` : ""}${o.data?.settled === false ? " · not quiet when read" : ""}`, ...(o.data?.requests ?? []).map(requestLine)],
};

const linesOf = (o, text) => (LINES[o.layer] ?? (() => []))(o, text);

function requestLine(r) {
  const payload = r.payload ? ` · payload ${r.payload.form}${r.payload.form === "empty" ? "" : ` #${r.payload.fp.slice(0, 8)}`}` : "";
  return `#${r.n} ${r.method} ${r.template ?? r.endpoint ?? "?"}${r.queryKeys?.length ? `?${r.queryKeys.join("&")}` : ""} => ${r.status ?? r.failed ?? "pending"}${r.type ? ` · ${r.type}` : ""}${r.durationMs !== null && r.durationMs !== undefined ? ` · ${r.durationMs}ms` : ""}${payload}${r.missing?.length ? ` · missing: ${r.missing.join(", ")}` : ""}`;
}

function shotOf(a, opts) {
  if (!a.screenshot || !opts.evidenceDir || !opts.bytes) return null;
  const bytes = opts.bytes(join(opts.evidenceDir, a.screenshot.replace(/^evidence\//, "")));
  return bytes ? `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` : null;
}

const checkView = (c, opts, text) => ({ id: c.id, action: c.action, state: c.state, query: opts.internal ? scrub(c.query) : maskSql(scrub(c.query)), tables: (c.tables ?? []).join(", "), provenance: c.provenance, expect: c.expect ?? "—", rows: c.rows ?? "—", attempts: c.attempts, within: c.within ?? 0, why: text(c.why ?? "") });

const securityView = (s, text) => ({ id: s.id, row: s.row, identity: s.identity ?? "—", resource: s.resource ?? "—", operation: s.operation, expect: s.expect ?? "—", channel: s.channel ?? "—", state: s.state, status: s.status ?? "—", leaked: s.leaked === true ? "yes" : s.leaked === false ? "no" : "—", changed: s.changed === true ? "yes" : s.changed === false ? "no" : "—", tenant: s.claims?.tenant ?? "—", why: text(s.why ?? "") });

function handoverOf(model, findings, text) {
  return { drafts: model.drafts.map((d) => ({ finding: d.finding, case: d.case, why: text(d.why) })), requirements: findings.filter((f) => f.outcome === "REQUIRES_REQUIREMENT").map((f) => `${f.id}: ${f.actual || f.say}`), settle: findings.filter((f) => f.defect || f.outcome === "INCONCLUSIVE").filter((f) => f.needs.length).map((f) => `${f.id}: ${f.needs.join("; ")}`), approvals: (model.plan?.blockers ?? []).map((b) => text(b.say)) };
}

export const investigationHtml = (model, opts = {}) => render(read("investigation.html"), { ...investigationView(model, opts), style: read("report.css") });

// The machine-readable result: the same view, minus the pictures.
export function investigationJson(model, opts = {}) {
  const v = investigationView(model, { ...opts, bytes: null });
  return { schema: 1, ...v, actions: v.actions.map(({ shot, ...a }) => a) };
}
