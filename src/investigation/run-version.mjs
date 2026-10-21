// The RUN-VERSION action (doc §4.1 steps 5-8; PBI 12, 13): one FROZEN version, run only where its
// isolation is proven, and what it came to decided by the HOST -- never by the worker.
//
//   authorized  the grants minted for the writes it makes (src/runtime/sandbox/test-grants.mjs)
//   prepared    the sealed binding table (src/runtime/sandbox/bindings.mjs), or BLOCKED by its gaps
//   started     the durable intent, written BEFORE anything is dispatched, so a dispatch that dies
//               is read back and never sent again
//   run         what the runner said, as the host found it
//   evaluated   the word the host's own check of the envelope and RESULT give
//               (src/run/envelope.mjs, src/investigation/verification.mjs)
//
// Everything that touches a sandbox is a port the composition root binds (`w.dispatch`: prepare,
// run, provedBy, canStop): this module reads the journal and its artifacts, holds the worker to what
// was dispatched, and writes the lifecycle. A version is judged only by the predicates its design
// compiled (`evaluation`), and a worker's claimed PASS is never taken over the host's check.
import { randomBytes } from "node:crypto";
import { Refused } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";
import { workerFindings } from "../run/envelope.mjs";
import { WORKER_API } from "../run/worker.mjs";
import { current, withJournal } from "./act.mjs";
import { nextId } from "./model.mjs";
import { eventIdOf } from "./store.mjs";
import { resultOf } from "./verification.mjs";

export function ranVersion(w, a) {
  const d = dispatchOf(w);
  const v = versionOf(w, a.version);
  const unsettled = unsettledOf(current(w), v.record.version);
  if (unsettled) return { outcome: "AMBIGUOUS", execution: unsettled.execution, why: `a dispatch of ${v.record.version} (${unsettled.execution}) was started and never settled — it is read back, never sent again; reconcile it first` };
  return prepareThenRun(w, d, v, attemptOf(w, v));
}

// One more attempt of the same frozen version, within the budget (doc §6.4): a version is never run
// until it goes green.
function attemptOf(w, v) {
  const attempt = current(w).starts.filter((s) => s.version === v.record.version).length + 1;
  const most = w.settings?.limits?.attempts ?? 3;
  if (attempt > most) throw new Refused(`${v.record.version} was run ${most} time(s), its budget (settings limits.attempts) — what the attempts came to is reported, never one more until it passes`);
  return attempt;
}

// A start with no evaluation is a dispatch whose end nobody saw: whatever it wrote may have happened.
const unsettledOf = (model, version) => model.starts.filter((s) => s.version === version).find((s) => !model.evaluations.some((e) => e.execution === s.execution)) ?? null;

// The execution is named BEFORE anything is prepared: the grants are minted for it, and the worker is held to it.
function prepareThenRun(w, d, v, attempt) {
  const execution = `exe-${v.record.version.split("@")[1]}-${attempt}`;
  const prepared = d.prepare({ frozen: v.frozen, design: v.design, obligation: v.obligation, attempt, execution });
  return prepared.gaps?.length || prepared.refused?.length ? blocked(w, v, attempt, prepared) : dispatchedRun(w, d, v, attempt, prepared, execution);
}

function dispatchOf(w) {
  if (typeof w.dispatch?.prepare !== "function" || typeof w.dispatch?.run !== "function") throw new Refused("this engine was not given a sandbox to run a version in — cli/autonomous-qa.mjs binds one");
  return w.dispatch;
}

// The version the journal froze, its case read back as frozen, and the design it was made from.
function versionOf(w, id) {
  const model = current(w);
  const record = model.versions.find((x) => x.version === id);
  if (!record) throw new Refused(`${id} is not a version ${w.id} froze — generate makes one`);
  const frozen = w.store.readVersion(w.id, `versions/${id.split("@")[1]}/${record.case}.json`);
  return frozen ? { record, frozen, design: designOf(w, model, record.design), obligation: model.obligations.findLast((o) => o.obligation === model.designs.find((x) => x.design === record.design)?.obligation) ?? null } : notFrozen(id);
}

const notFrozen = (id) => {
  throw new Refused(`${id} is no longer the case it was frozen as — it is kept as it is and never run`);
};

const designOf = (w, model, design) => w.store.readArtifact(w.id, "designs", model.designs.findLast((x) => x.design === design && x.state === "designed")?.digest) ?? {};

// ── nothing dispatched ─────────────────────────────────────────────────────

function blocked(w, v, attempt, p) {
  const why = [...(p.gaps ?? []).map((g) => `${g.kind} ${g.alias}: ${g.why}`), ...(p.refused ?? []).map((r) => `grant: ${r.say ?? r.id}`)].join("; ").slice(0, 600);
  return withJournal(w, () => {
    w.store.appendOnce(w.id, "prepared", { id: nextId(current(w), "prepared"), eventId: eventIdOf("prepared", v.record.version, attempt, why), attempt, version: v.record.version, state: "blocked", bindings: why });
    return { outcome: p.refused?.length ? "AUTHORIZATION_BLOCKED" : "ENVIRONMENT_BLOCKED", why };
  });
}

// ── dispatched ─────────────────────────────────────────────────────────────

function dispatchedRun(w, d, v, attempt, p, execution) {
  const request = requestOf(v, execution, p);
  withJournal(w, () => intended(w, v, attempt, p, execution, request));
  const r = d.run({ request, frozen: v.frozen });
  return withJournal(w, () => evaluatedRun(w, d, v, attempt, execution, request, r, p));
}

// The worker's request (orbit.worker/v1): the frozen case by digest and where the worker finds it
// (`place`, the sandbox's own layout), its sealed bindings and secrets, the grants minted for it,
// and the digests its design pinned on every verdict.
const requestOf = (v, execution, p) => ({ v: WORKER_API, runId: execution, nonce: randomBytes(12).toString("hex"), case: { file: p.place?.case ?? null, digest: v.record.digest }, params: {}, bindings: p.bindings ?? {}, secrets: p.secrets ?? {}, grants: p.grants ?? [], fixture: p.fixture ?? null, evaluation: { mode: "compiled", digests: Object.fromEntries((v.design.compiled ?? []).map((c) => [String(c.step), c.digest])) }, limits: { deadlineMs: p.deadlineMs ?? null }, out: p.place?.out ?? null });

// Written BEFORE the dispatch: what was authorized, what was bound, and the intent to run.
function intended(w, v, attempt, p, execution, request) {
  const at = (kind, rec) => w.store.appendOnce(w.id, kind, { id: nextId(current(w), kind), eventId: eventIdOf(kind, v.record.version, attempt, execution), attempt, version: v.record.version, ...rec });
  at("authorized", { state: "granted", grant: (p.grants ?? []).map((g) => g.id).join(",") || null });
  at("prepared", { state: "prepared", sandbox: p.sandbox ?? null, tree: p.tree ?? null, bindings: sha(canonicalJson(request.bindings)) });
  at("started", { execution, intent: sha(canonicalJson({ ...request, secrets: Object.keys(request.secrets).sort() })) });
}

// The host's own check, then the word RESULT gives it -- recorded as the run and its evaluation.
function evaluatedRun(w, d, v, attempt, execution, request, r, p) {
  const findings = hostFindings(d, v, execution, request, r, p);
  const result = resultOf({ status: r.envelope?.status ?? "BLOCKED", failure: r.envelope?.result?.failure ?? {}, envelope: findings, authority: v.obligation?.authority ?? "accepted" });
  recorded(w, d, { v, attempt, execution }, r, result, findings);
  return { outcome: result.outcome, rule: result.rule, why: result.why, execution, findings };
}

// Nothing a worker said is taken: the envelope is held to what was dispatched, the files the host
// listed and the claim re-derived from the run log and the frozen case.
function hostFindings(d, v, execution, request, r, p) {
  if (!r.envelope) return [`no envelope came back — ${r.why ?? "the worker ended without one"}`];
  return workerFindings({ envelope: r.envelope, expected: { runId: execution, nonce: request.nonce, caseDigest: v.record.digest }, listed: r.listed ?? new Map(), records: r.records ?? [], frozen: v.frozen.case, provedBy: d.provedBy, canStop: d.canStop, grants: p.grants ?? [] });
}

// The run as the HOST holds it: a worker whose envelope did not hold said nothing the run record
// repeats -- its status is BLOCKED and it proved nothing, whatever it claimed; and only the evidence
// of an envelope the host believed is kept (`d.keep`), where the investigation's report finds it.
function recorded(w, d, { v, attempt, execution }, r, result, findings) {
  const believed = findings.length === 0;
  const status = believed ? r.envelope.status : "BLOCKED";
  w.store.append(w.id, "run", { id: nextId(current(w), "run"), case: v.record.case, status, proved: believed ? (r.envelope.result?.proved ?? null) : null, cause: believed ? null : "envelope", version: v.record.version, execution, attempt, evidence: believed ? (d.keep?.(r) ?? r.envelope.evidence ?? null) : null, case_digest: v.record.digest, authority: "draft" });
  w.store.appendOnce(w.id, "evaluated", { id: nextId(current(w), "evaluated"), eventId: eventIdOf("evaluated", execution, attempt, result.outcome), attempt, execution, obligation: v.obligation?.obligation ?? null, result: `res-${execution.slice(4, 24)}`, outcome: result.outcome, runner: status, cause: result.rule });
}
