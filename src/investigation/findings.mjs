// What the evidence SAYS, as findings -- derived from the journal every time,
// never typed in, never re-judging a runner verdict.
//
// Five families, each an ordered table, first match wins, last always matches:
//
//   duplicate    one action's network window (src/network/duplicates.mjs),
//                weighed against the data checks taken on the same action
//   persistence  a data check against a write the action's window answered
//   console      errors the page logged during an action
//   failed call  a request past the mark that answered 5xx or never answered
//   security     one tenant-matrix row, held to its contract -- and a denial
//                counts only where the SAME channel showed access that the
//                contract allows (a positive control); without one, a refusal
//                may just be the probe failing to authenticate
//   run          an accepted case run through run-case and classified by the
//                engine's own triage: the runner's verdict stays the runner's
//
// CONFIRMED needs an ORACLE that confirms (src/investigation/vocab.mjs ORACLES):
// a contract a person declared, or the product contradicting itself -- a 2xx
// over a record that is not there, two equivalent writes and two records for
// one action. An observation, however often repeated, never confirms. A
// finding a later reproduction did not repeat is downgraded, and both
// observations are kept (src/investigation/model.mjs).
import { callOf, correlated } from "../network/correlate.mjs";
import { declared, duplicateCandidates, isDevelopment } from "../network/duplicates.mjs";
import { writes } from "../network/observe.mjs";
import { scrub } from "../scrub.mjs";
import { actionOf, checksOf, layerOf, nextId } from "./model.mjs";
import { matrixOf } from "./tenancy.mjs";
import { OUTCOMES } from "./vocab.mjs";

const ok2 = (s) => s >= 200 && s < 300;
const policyOf = (w) => ({ environment: w.environment, ...w.settings.duplicates });
const dataOf = (model, actionId) => checksOf(model, actionId).filter((c) => c.layer === "data").at(-1) ?? null;
// Where the MAP says this control's call is made -- cited, never inferred: a
// finding names source only when the map recorded it.
function sourceOf(w, action) {
  const e = action?.on ? w.ctx.graph.effectOn.get(action.on) : null;
  return e?.src ? { from: "map", src: e.src, seen: e.seen ?? null } : null;
}
const LEGIT_DECLARED = new Set(["POLLING", "RETRY_DECLARED", "INTENTIONAL", "IDEMPOTENT_DECLARED"]);

// The context a key carries beyond the control: the identity, only when the
// action acted as somebody other than the investigation itself. Two identities
// on one control are two findings -- what one may do, the other may not.
const as = (model, action) => (action.identity && action.identity !== (model.meta?.identity ?? null) ? ` as ${action.identity}` : "");

// ---------------------------------------------------------------- duplicate
const DUPLICATE = [
  { id: "CONTRACT", when: (c) => c.explanation === "CONTRACT", as: (c) => ({ outcome: "CONFIRMED_DEFECT", confidence: "high", oracle: "contract", expected: "what the accepted contract (duplicates.contracts) allows", actual: c.say }) },
  { id: "DEVELOPMENT_DATA", when: (c, d, w) => isDevelopment(w.environment?.kind) && duplicated(c, d), as: (c, d) => ({ outcome: "SUSPECTED_DEFECT", confidence: "high", oracle: "observation", expected: `${d.expect} record(s) for one action`, actual: `${d.rows} records on a DEVELOPMENT build (${d.id})`, needs: ["repeat on a non-development build: a development build double-invokes on purpose"] }) },
  { id: "DUPLICATED_DATA", when: (c, d) => duplicated(c, d), as: (c, d) => ({ outcome: "CONFIRMED_DEFECT", confidence: "high", oracle: "contradiction", expected: `${d.expect} record(s) for one action`, actual: `${c.say}, and ${d.rows} records now exist (${d.id})` }) },
  { id: "LEGITIMATE", when: (c) => c.legit, as: (c) => ({ outcome: c.outcome, confidence: c.confidence, oracle: LEGIT_DECLARED.has(c.explanation) ? "contract" : "observation", expected: "legitimate repetition", actual: c.say }) },
  { id: "DEVELOPMENT", when: (c) => c.explanation === "DEVELOPMENT", as: (c) => ({ outcome: c.outcome, confidence: c.confidence, oracle: "observation", expected: "unknown on a development build", actual: c.say }) },
  { id: "ONE_RECORD", when: (c, d) => writes(c.method) && d?.state !== "blocked" && Number.isInteger(d?.expect) && d.rows === d.expect, as: (c, d) => ({ outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "observation", expected: `${d.expect} record(s)`, actual: `${c.say}, and the data holds ${d.rows} (${d.id}): the extra write was absorbed — a redundant request, not duplicate data` }) },
  { id: "DATA_BLOCKED", when: (c, d) => d?.state === "blocked", as: (c, d) => ({ outcome: c.outcome, confidence: "low", oracle: "observation", expected: "unknown", actual: c.say, needs: [`the data layer could not be read (${d.why})`] }) },
  { id: "NETWORK_ONLY", when: () => true, as: (c) => ({ outcome: c.outcome, confidence: c.confidence, oracle: "observation", expected: "unknown until data or a contract says", actual: c.say }) },
];

const duplicated = (c, d) => writes(c.method) && d?.state === "observed" && Number.isInteger(d.expect) && d.rows > d.expect;

function duplicateFindings(model, w, action) {
  const net = layerOf(model, action.id, "network");
  if (!net?.data?.requests?.length) return [];
  return duplicateCandidates(net.data.requests, policyOf(w), action.identity).map((c) => duplicateFinding(model, w, action, net, c));
}

function duplicateFinding(model, w, action, net, c) {
  const d = dataOf(model, action.id);
  const row = DUPLICATE.find((r) => r.when(c, d, w));
  return { key: `duplicate ${action.on ?? action.surface ?? "?"} ${c.method} ${c.endpoint}${as(model, action)}`, family: "duplicate", action: action.id, evidence: [net.id, ...(d ? [d.id] : [])], alternatives: alternativesOf(c, w), needs: c.needs, missing: [...c.missing, ...(net.data.detail === "full" ? [] : [`request detail: ${net.data.detail}`])], source: sourceOf(w, action), say: c.say, ...row.as(c, d, w) };
}

// What else could explain it, and whether the evidence rules each out.
function alternativesOf(c, w) {
  const statuses = c.statuses.map(String).join(", ");
  return [`a client retry: ${c.statuses.some((s) => s === null || s >= 500 || typeof s === "string") ? "possible — an attempt did not succeed" : "no attempt failed"} (${statuses})`, `a declared retry, polling or idempotent endpoint: ${declared([...(w.settings.duplicates.retries ?? []), ...(w.settings.duplicates.polling ?? []), ...(w.settings.duplicates.idempotent ?? [])], c) ? "declared" : "none declared"}`, `a development build: ${isDevelopment(w.environment?.kind) ? "yes" : `no (${w.environment?.kind ?? "unknown"})`}`, "a CORS preflight or a redirect: ruled out — same method, no 3xx"];
}

// -------------------------------------------------------------- persistence
// k: { check, recorded (the call the map says this control makes, or null),
//      call (the request in the window that IS that call, or null), window,
//      timing, seen }. A missing record contradicts only the recorded call's
//      success: telemetry, a list reload or a token refresh in the same window
//      says nothing about what the control wrote.
const PERSISTENCE = [
  { id: "BLOCKED", when: (k) => k.check.state === "blocked", as: (k) => ({ outcome: "BLOCKED", confidence: "high", oracle: "none", expected: "a record", actual: k.check.why }) },
  { id: "EXTRA", when: (k) => k.check.rows > k.check.expect, as: (k) => ({ outcome: "SUSPECTED_DEFECT", confidence: "high", oracle: "observation", expected: `${k.check.expect} record(s)`, actual: `${k.check.rows} records for one action` }) },
  { id: "PRESENT", when: (k) => k.check.rows === k.check.expect, as: (k) => ({ outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", oracle: "map", expected: `${k.check.expect} record(s)`, actual: `found after ${k.check.attempts} read(s)${k.check.within ? ` within ${k.check.within}s` : ""}` }) },
  { id: "UNMAPPED_CALL", when: (k) => !k.recorded, as: () => ({ outcome: "INCONCLUSIVE", confidence: "high", oracle: "none", expected: "a record", actual: "the map records no call for this control, so no request in its window can be tied to the table — a missing record proves nothing about persistence", needs: ["the call this control makes (graph/effects.json api) — orbit-ui-map records it"] }) },
  { id: "NOT_CALLED", when: (k) => !k.call, as: (k) => ({ outcome: "INCONCLUSIVE", confidence: "high", oracle: "none", expected: `${k.recorded.api}, then a record`, actual: `the call the map records (${k.recorded.api}) was not in the action's window${cutOf(k.window)} — a missing record proves nothing about persistence`, needs: [notCalled(k)] }) },
  { id: "CALL_FAILED", when: (k) => !ok2(k.call.status), as: (k) => ({ outcome: "INCONCLUSIVE", confidence: "high", oracle: "none", expected: `${k.recorded.api} answered 2xx`, actual: `${k.call.method} ${k.call.template} ${answerOf(k.call)} — the write did not succeed, so no record was owed; the failed-call finding says what went wrong` }) },
  { id: "ACCEPTED_LATER", when: (k) => k.call.status === 202 && !k.check.within, as: (k) => ({ outcome: "REQUIRES_REQUIREMENT", confidence: "high", oracle: "none", expected: "unknown", actual: `${k.call.method} ${k.call.template} answered 202 Accepted — the work finishes later — and no window says how long it may take, so a record missing now is not yet a defect`, needs: [`settings consistency.${k.timing ?? "<timing>"} or check-data --within: the seconds this write may take`] }) },
  { id: "UNDECLARED_WINDOW", when: (k) => k.timing && k.timing !== "sync" && !k.check.within, as: (k) => ({ outcome: "REQUIRES_REQUIREMENT", confidence: "high", oracle: "none", expected: "unknown", actual: `no record yet — and the map says this control's data arrives later (timing ${k.timing}) while nobody declared how long it may take`, needs: [`settings consistency.${k.timing}: the seconds its data may take`] }) },
  { id: "UNMAPPED_WITNESS", when: (k) => Boolean(k.check.via), as: (k) => ({ outcome: "SUSPECTED_DEFECT", confidence: "high", oracle: "observation", expected: `${k.check.expect} record(s)`, actual: `${k.call.method} ${k.call.template} answered ${k.call.status}, and capability ${k.check.via} counts ${k.check.rows ?? 0} ${k.check.within ? `after ${k.check.within}s` : "after the call"}`, needs: [`the map to record which store this control writes and that ${k.check.via} reads it — then a missing record is a contradiction, not a suspicion`] }) },
  { id: "MISSING", when: () => true, as: (k) => ({ outcome: "CONFIRMED_DEFECT", confidence: "high", oracle: "contradiction", expected: `${k.check.expect} record(s)`, actual: `${k.call.method} ${k.call.template} answered ${k.call.status}, and ${k.check.within ? `after ${k.check.within}s` : "after the call"} no record exists (${k.check.attempts} read(s))` }) },
];

const cutOf = (win) => `${win.truncated ? `; the window was cut at the request limit (${win.truncated} more not read)` : ""}${win.settled ? "" : "; the network had not gone quiet when it closed"}`;
const notCalled = (k) => (k.window.truncated || !k.window.settled ? "a window that holds the whole exchange: raise limits.requestsPerAction or limits.pollSeconds" : `whether this control still makes that call — the map's record may be stale (seen: ${k.seen ?? "unknown"})`);
const answerOf = (r) => (r.status === null || r.status === undefined ? `had not answered${r.failed ? ` (${r.failed})` : ""}` : `answered ${r.status}`);

function persistenceFindings(model, w, action) {
  const net = layerOf(model, action.id, "network");
  const effect = action.on ? w.ctx.graph.effectOn.get(action.on) ?? null : null;
  const hasDuplicate = duplicateFindings(model, w, action).length > 0;
  return countedChecks(model, action).map((check) => witnessOf(check, net, effect)).filter((k) => !(hasDuplicate && k.check.rows > k.check.expect)).map((k) => persistenceFinding(model, w, action, k, net));
}

const countedChecks = (model, action) => checksOf(model, action.id).filter((c) => c.layer === "data" && Number.isInteger(c.expect));

function witnessOf(check, net, effect) {
  const recorded = callOf(effect);
  return { check, recorded, call: recorded ? correlated(recorded, net?.data?.requests) : null, window: { truncated: net?.data?.truncated ?? 0, settled: net?.data?.settled !== false }, timing: effect?.timing ?? null, seen: effect?.seen ?? null };
}

function persistenceFinding(model, w, action, k, net) {
  const row = PERSISTENCE.find((r) => r.when(k));
  return { key: `persistence ${action.on ?? "?"} ${k.check.tables.join(",") || `via:${k.check.via}`}${as(model, action)}`, family: "persistence", action: action.id, evidence: [k.check.id, ...(net ? [net.id] : [])], source: sourceOf(w, action), alternatives: [], needs: [], missing: [], say: `data after ${action.on ?? action.id}: ${row.id.toLowerCase().replaceAll("_", " ")}`, ...row.as(k) };
}

// The request in an action's window that IS the map's recorded call -- what a
// regression draft's api step asks for, never merely the first 2xx write.
export function recordedCallIn(model, w, action) {
  const recorded = callOf(action?.on ? w.ctx.graph.effectOn.get(action.on) : null);
  return recorded ? correlated(recorded, layerOf(model, action.id, "network")?.data?.requests) : null;
}

// ------------------------------------------------------- console · failed call
function consoleFindings(model, w, action) {
  const c = layerOf(model, action.id, "console");
  if (!c?.data?.errors) return [];
  return [{ key: `console ${action.on ?? action.surface ?? action.id}${as(model, action)}`, family: "console", action: action.id, evidence: [c.id], outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "observation", say: `${c.data.errors} console error(s) during ${action.on ?? action.do}`, expected: "no error logged", actual: c.data.messages.join(" · ").slice(0, 400), alternatives: ["a browser extension or the environment logging, not the product"], needs: ["whether the error is the product's"], missing: [], source: sourceOf(w, action) }];
}

function failedCallFindings(model, w, action) {
  const net = layerOf(model, action.id, "network");
  const requests = net?.data?.requests ?? [];
  const recovered = (r) => requests.some((x) => x.n > r.n && x.method === r.method && x.endpoint === r.endpoint && ok2(x.status));
  return requests.filter((r) => (r.failed || r.status >= 500) && !recovered(r)).map((r) => ({ key: `failed-call ${r.method} ${r.endpoint}${as(model, action)}`, family: "failed-call", action: action.id, evidence: [net.id], outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "observation", say: `${r.method} ${r.template} ${r.failed ? `never answered (${r.failed})` : `answered ${r.status}`} during ${action.on ?? action.do}`, expected: "an answer", actual: String(r.failed ?? r.status), alternatives: ["the environment: a service down, a network drop"], needs: ["whether the service was up"], missing: r.missing ?? [], source: sourceOf(w, action) }));
}

// ----------------------------------------------------------------- security
const allowedish = (r) => ["allowed", "included"].includes(r.expect);
const deniedish = (r) => ["denied", "excluded"].includes(r.expect);
const reached = (r) => (r.channel === "api" && r.operation !== "search" ? ok2(r.status) && (r.operation === "update" || r.leaked === true) : r.leaked === true);
const controlled = (model, r) => model.security.some((x) => x.resource === r.resource && x.channel === r.channel && allowedish(x) && x.state === "observed" && reached(x));
const accepted = (w, r) => matrixOf(w.settings.tenancy).find((m) => m.row === r.row)?.status ?? null;

const SECURITY = [
  { id: "NO_CONTRACT", when: (r) => r.operation === "contract", as: (r) => ({ outcome: "REQUIRES_REQUIREMENT", confidence: "high", oracle: "none", expected: "an authorisation contract", actual: r.why }) },
  { id: "CONTRADICTION", when: (r) => String(r.why ?? "").startsWith("contradiction"), as: (r) => ({ outcome: "REQUIRES_REQUIREMENT", confidence: "high", oracle: "none", expected: "a contract that does not contradict itself", actual: r.why }) },
  { id: "BLOCKED", when: (r) => r.state === "blocked", as: (r) => ({ outcome: "BLOCKED", confidence: "high", oracle: "none", expected: r.expect, actual: r.why }) },
  { id: "MODIFIED", when: (r) => r.changed === true && (deniedish(r) || r.operation === "unchanged"), as: (r) => ({ outcome: "CONFIRMED_DEFECT", confidence: "high", oracle: "contract", expected: `${r.resource} unchanged`, actual: `its data moved after ${r.identity}'s ${r.operation}${r.status ? ` (answered ${r.status})` : ""} — an unauthorised modification` }) },
  { id: "ALLOWED", when: (r) => allowedish(r) && reached(r), as: (r) => ({ outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", oracle: "contract", expected: r.expect, actual: `${r.channel}: reached${r.status ? ` (${r.status})` : ""}` }) },
  { id: "CONTROL_FAILED", when: (r) => allowedish(r), as: (r) => ({ outcome: "INCONCLUSIVE", confidence: "high", oracle: "contract", expected: r.expect, actual: `the positive control failed: ${r.identity} could not reach its own tenant's ${r.resource} through ${r.channel}${r.status ? ` (${r.status})` : ""} — every denial through this channel proves nothing until it passes`, needs: ["a probe that authenticates as the identity does, or a project capability for this API"] }) },
  { id: "UNCHANGED", when: (r) => r.operation === "unchanged", as: () => ({ outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", oracle: "contract", expected: "unchanged", actual: "unchanged" }) },
  { id: "NO_CONTROL", when: (r, m) => deniedish(r) && !controlled(m, r) && r.changed !== false, as: (r) => ({ outcome: "INCONCLUSIVE", confidence: "high", oracle: "contract", expected: r.expect, actual: `${r.channel}: ${r.leaked ? "the marker was seen" : "refused"}, but no allowed identity reached ${r.resource} through ${r.channel} — a refusal here may be the probe not authenticating`, needs: [`an allowed row for ${r.resource} that passes through ${r.channel}`] }) },
  { id: "LEAKED", when: (r) => deniedish(r) && r.leaked === true, as: (r) => ({ outcome: "CONFIRMED_DEFECT", confidence: "high", oracle: "contract", expected: `${r.identity} ${r.expect} ${r.resource}`, actual: `${r.identity} saw ${r.resource}'s marker through ${r.channel}${r.status ? ` (answered ${r.status})` : ""} — cross-tenant ${r.operation === "search" ? "leakage through search" : "access"}` }) },
  { id: "WRITE_ANSWERED", when: (r) => r.operation === "update" && ok2(r.status) && r.changed === false, as: (r) => ({ outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "contract", expected: "a denial", actual: `the write answered ${r.status} and no data moved` }) },
  { id: "OFF_CONTRACT_STATUS", when: (r, m, w) => r.status !== null && r.status !== undefined && accepted(w, r) && !accepted(w, r).includes(r.status), as: (r, m, w) => ({ outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "contract", expected: `status ${accepted(w, r).join(" or ")}`, actual: `answered ${r.status}; no protected data was seen` }) },
  { id: "EMPTY_SUCCESS", when: (r, m, w) => ok2(r.status) && !accepted(w, r), as: (r) => ({ outcome: "REQUIRES_REQUIREMENT", confidence: "low", oracle: "none", expected: r.expect, actual: `answered ${r.status} with no protected data — whether an empty ${r.status} counts as a denial is not declared (the matrix row's status)` }) },
  { id: "DENIED", when: () => true, as: (r) => ({ outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", oracle: "contract", expected: r.expect, actual: `${r.channel}: ${r.status ? `answered ${r.status}, ` : ""}no protected data` }) },
];

function securityFindings(model, w) {
  return model.security.map((r) => securityFinding(model, w, r));
}

function securityFinding(model, w, r) {
  const row = SECURITY.find((s) => s.when(r, model, w));
  return { key: `security ${r.resource ?? "contract"} ${r.identity ?? ""} ${r.operation} ${r.channel ?? ""}`.trim(), family: "security", action: null, evidence: [r.id], say: `${r.identity ?? "—"} · ${r.operation} ${r.resource ?? ""} · ${r.channel ?? "—"}: ${row.id.toLowerCase().replaceAll("_", " ")}`, alternatives: [], needs: [], missing: [], source: null, ...row.as(r, model, w) };
}

// ---------------------------------------------------------------------- run
// A DRAFT case's assertions are an agent's reading of a requirement, so its
// failure is a suspicion about that reading as much as about the product: it
// speaks for the product only once a person accepts the case.
//
// Every run of one case AS WRITTEN (its digest) is an occurrence of one finding,
// a PASS included -- so a case that failed and then passed reads intermittent,
// never as whichever run came last (src/investigation/findings.mjs grouped).
const RUN = [
  { id: "DRAFT_FAILED", when: (r) => r.authority === "draft" && ["FAIL", "INCONCLUSIVE"].includes(r.status), as: (r) => ({ outcome: "SUSPECTED_DEFECT", confidence: "low", oracle: "observation", expected: `${r.case} passes`, actual: `a DRAFT case said ${r.status}${r.cause ? ` (${r.cause})` : ""} — its assertions are an agent's reading of the requirement`, needs: ["a person accepts the case (cli/draft.mjs promote) before its failure can speak for the product"] }) },
  { id: "PRODUCT", when: (r) => r.cause === "PRODUCT_FAILURE" && r.confidence === "high", as: (r) => ({ outcome: "SUSPECTED_DEFECT", confidence: "high", oracle: "contract", expected: `${r.case} passes (an accepted case)`, actual: `run-case said ${r.status}; the engine's triage classified it PRODUCT_FAILURE (high) — the failure analyst owns the next step` }) },
  { id: "BLOCKED", when: (r) => ["BLOCKED", "REFUSED"].includes(r.status) || ["ENVIRONMENT", "AUTH"].includes(r.cause), as: (r) => ({ outcome: "BLOCKED", confidence: "high", oracle: "none", expected: `${r.case} runs`, actual: `run-case said ${r.status}${r.cause ? ` (${r.cause})` : ""} — nothing about the product` }) },
  { id: "UNCLASSIFIED", when: (r) => r.status === "FAIL" || r.status === "INCONCLUSIVE", as: (r) => ({ outcome: "INCONCLUSIVE", confidence: "low", oracle: "none", expected: `${r.case} passes`, actual: `run-case said ${r.status}; cause ${r.cause ?? "unknown"} (${r.confidence ?? "no"} confidence)`, needs: ["orbit-failure-analyst on that run"] }) },
  { id: "PASSED", when: (r) => r.status === "PASS", as: (r) => ({ outcome: "OBSERVED_EXPECTED_BEHAVIOR", confidence: "high", oracle: r.authority === "draft" ? "observation" : "contract", expected: `${r.case} passes`, actual: `run-case said PASS${provedLine(r.proved)}` }) },
  { id: "NONE", when: () => true, as: () => null },
];

const provedLine = (proved) => (proved ? ` and proved ${Object.entries(proved).map(([l, n]) => `${l} ${n}`).join(" · ")}` : "");

function runFindings(model) {
  return model.runs.map((r) => [r, RUN.find((x) => x.when(r)).as(r)]).filter(([, v]) => v).map(([r, v]) => ({ key: runKey(r), family: "run", action: null, evidence: [r.id], say: `${r.case}: ${r.status}`, alternatives: [], needs: [], missing: [], source: null, ...v }));
}

// One case as written, and whose assertions: a draft's run is not the accepted case's.
const runKey = (r) => `run ${r.case}${r.case_digest ? `@${String(r.case_digest).slice(0, 12)}` : ""}${r.authority === "draft" ? " (draft)" : ""}`;

// ------------------------------------------------------------------ derive
const PER_ACTION = [duplicateFindings, persistenceFindings, consoleFindings, failedCallFindings];

// w: { ctx (graph), settings, environment }. `only` limits it to some actions.
// Occurrences are resolved BEFORE a reproduction may downgrade the result.
export function deriveFindings(model, w, only = null) {
  const actions = model.actions.filter((a) => a.state === "done" && (!only || only.includes(a.id)));
  const found = [...actions.flatMap((a) => PER_ACTION.flatMap((f) => f(model, w, a))), ...(only ? [] : [...securityFindings(model, w), ...runFindings(model)])];
  return grouped(model, found).map((f) => reproducedOf(model, f));
}

// -------------------------------------------------------------- occurrences
// One key seen on several actions is ONE finding with every occurrence kept.
// Which outcome it reads as is this ordered list: the first outcome ANY
// occurrence reached wins. A defect seen once stays a defect however the same
// control behaved before or after, and a good occurrence never hides a bad one.
// The headline is the first occurrence that showed that outcome, so its
// `action` is the chain a reproduction replays.
const RESOLUTION = ["CONFIRMED_DEFECT", "SUSPECTED_DEFECT", "REQUIRES_REQUIREMENT", "OBSERVED_EXPECTED_BEHAVIOR", "INCONCLUSIVE", "BLOCKED"];

const DEFECT = new Set(OUTCOMES.filter((o) => o.defect).map((o) => o.id));

// How the occurrences relate: all alike, a defect beside the expected
// behaviour (the product is not consistent with itself), or anything else.
const PATTERNS = [
  { id: "consistent", when: (outcomes) => new Set(outcomes).size === 1 },
  { id: "intermittent", when: (outcomes) => outcomes.some((o) => DEFECT.has(o)) && outcomes.includes("OBSERVED_EXPECTED_BEHAVIOR") },
  { id: "mixed", when: () => true },
];

function grouped(model, found) {
  const by = new Map();
  found.forEach((f) => by.set(f.key, [...(by.get(f.key) ?? []), f]));
  return [...by.values()].map((group) => resolved(model, group));
}

function resolved(model, group) {
  const outcome = RESOLUTION.find((o) => group.some((f) => f.outcome === o)) ?? group[0].outcome;
  const head = group.find((f) => f.outcome === outcome);
  const pattern = PATTERNS.find((p) => p.when(group.map((f) => f.outcome))).id;
  return { ...head, evidence: [...new Set(group.flatMap((f) => f.evidence))], occurrences: group.map((f) => occurrenceOf(model, f)), pattern, ...notedOf(head, group, pattern) };
}

function notedOf(head, group, pattern) {
  const showed = group.filter((f) => f.outcome === head.outcome).length;
  if (pattern === "intermittent") return { needs: [...(head.needs ?? []), `intermittent: ${showed} of ${group.length} occurrence(s) showed it — the others did what the contract says`] };
  const unjudged = group.filter((f) => ["INCONCLUSIVE", "BLOCKED"].includes(f.outcome) && f.outcome !== head.outcome);
  return unjudged.length ? { missing: [...(head.missing ?? []), `${unjudged.length} other occurrence(s) could not be judged: ${[...new Set(unjudged.map((f) => f.outcome))].join(", ")}`] } : {};
}

// Nested, so scrubbed HERE: the journal's scrub reads top-level fields only.
const occurrenceOf = (model, f) => ({ action: f.action ?? null, outcome: f.outcome, confidence: f.confidence, oracle: f.oracle, evidence: f.evidence, identity: f.action ? actionOf(model, f.action)?.identity ?? null : null, actual: scrub(String(f.actual ?? "")).slice(0, 240) });

// A reproduction that did not repeat the finding downgrades a confirmation --
// and both observations stay on the record.
function reproducedOf(model, f) {
  const tries = model.reproductions.filter((r) => r.finding && model.history.some((h) => h.id === r.finding && h.key === f.key));
  if (!tries.length) return { ...f, reproduced: "not attempted" };
  const hits = tries.filter((r) => r.reproduced === true).length;
  const downgraded = f.outcome === "CONFIRMED_DEFECT" && hits === 0;
  return { ...f, reproduced: `${hits} of ${tries.length}`, ...(downgraded ? { outcome: "SUSPECTED_DEFECT", confidence: "low", needs: [...f.needs, `it did not reproduce in ${tries.length} later attempt(s): intermittent, or already fixed`] } : {}) };
}

// Appends what is new or changed, then an `analysis` naming every key the
// evidence supports now; returns how many findings were appended. `supersedes`
// keeps the earlier record in the journal's history, and a key no analysis
// derives any more stops being current (src/investigation/model.mjs) instead of
// lingering. Called under the journal lock (withJournal), so the ids hold.
const CHANGES = ["outcome", "confidence", "say", "actual", "reproduced", "pattern"];

const changed = (was, f) => !was || CHANGES.some((k) => JSON.stringify(was[k]) !== JSON.stringify(f[k])) || f.evidence.length !== was.evidence.length || (f.occurrences?.length ?? 1) !== (was.occurrences?.length ?? 1);

export function recordFindings(store, id, model, derived) {
  const current = new Map(model.findings.map((f) => [f.key, f]));
  const fresh = derived.filter((f) => changed(current.get(f.key), f));
  const count = { n: model.history.length };
  fresh.forEach((f) => store.append(id, "finding", { ...f, id: `fnd-${++count.n}`, supersedes: current.get(f.key)?.id }));
  return analysed(store, id, model, derived, fresh.length);
}

function analysed(store, id, model, derived, added) {
  const keys = derived.map((f) => f.key);
  const same = JSON.stringify(model.analyses.at(-1)?.keys ?? null) === JSON.stringify(keys);
  if (!added && same) return 0;
  store.append(id, "analysis", { id: nextId(model, "analysis"), keys });
  return added;
}
