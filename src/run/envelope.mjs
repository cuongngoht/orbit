// What the HOST believes of a worker's run, and only after checking it (ADR 0038).
//
// An isolated worker runs the frozen case and writes an envelope beside its evidence: which
// run, which case, what status, which files. None of that is taken. The host holds the envelope
// to what IT dispatched (the run id, the nonce, the frozen case's digest), lists the files
// itself and compares every digest, and then RE-DERIVES what the run may claim from the run log
// and the frozen case -- the steps that ran, the verdicts they executed, the layers those prove
// -- so a worker that wrote "PASS" over a failed step, or counted a layer no step of the case
// proves, is refused before a ledger line, an evidence room or an investigation hears of it.
// Only then does the host write the authoritative records, itself.
import { RUN_STATE_NAMES } from "../qa/vocab.mjs";
import { WORKER_API } from "./worker.mjs";

const RELATIVE = (p) => typeof p === "string" && p.length > 0 && !/^([/\\]|[A-Za-z]:)/.test(p) && !p.split(/[/\\]/).includes("..");

const ENVELOPE_RULES = [
  (e) => (e?.v === WORKER_API ? [] : [`the envelope is not ${WORKER_API}`]),
  (e, x) => (e.runId === x.runId && e.nonce === x.nonce ? [] : ["the envelope answers another dispatch (run id or nonce)"]),
  (e, x) => (e.caseDigest === x.caseDigest ? [] : ["the envelope ran another case than the frozen one dispatched"]),
  (e) => (RUN_STATE_NAMES.includes(e.status) || e.status === "INTERRUPTED" ? [] : [`"${String(e.status).slice(0, 20)}" is no status a run can have`]),
  (e) => (e.result === null || e.result === undefined || e.result.status === e.status ? [] : ["the envelope's status is not its result's — one of them is not what ran"]),
  (e) => (e.evidence === null || e.evidence === undefined || RELATIVE(e.evidence) ? [] : [`the envelope names evidence outside its output: ${String(e.evidence).slice(0, 80)}`]),
  (e) => (Array.isArray(e.files) ? e.files : []).filter((f) => !RELATIVE(f?.path)).map((f) => `the envelope names a file outside its output: ${String(f?.path).slice(0, 80)}`),
];

// `listed` is what the HOST found under the evidence directory the envelope names (once that
// name is known to stay inside the output): path relative to the output -> { sha256, bytes }.
export function envelopeFindings(envelope, expected, listed) {
  const own = ENVELOPE_RULES.flatMap((rule) => rule(envelope, expected));
  if (own.length) return own;
  return [...fileFindings(envelope.files ?? [], listed), ...sizeFindings(listed, expected.maxBytes)];
}

function fileFindings(declared, listed) {
  const named = new Map(declared.map((f) => [f.path, f]));
  const missing = [...named.keys()].filter((p) => !listed.has(p)).map((p) => `${p} is declared and not there`);
  const extra = [...listed.keys()].filter((p) => !named.has(p)).map((p) => `${p} is there and not declared`);
  const moved = [...named.values()].filter((f) => listed.has(f.path) && listed.get(f.path).sha256 !== f.sha256).map((f) => `${f.path} does not have the digest the envelope says`);
  return [...missing, ...extra, ...moved];
}

const sizeFindings = (listed, max) => (max && [...listed.values()].reduce((n, f) => n + (f.bytes ?? 0), 0) > max ? [`the output is larger than the ${max} bytes this run was allowed`] : []);

// The claim, re-derived from the run log and the frozen case (ADR 0038). `provedBy(step)` is the
// DSL's own answer (src/dsl/registry.mjs) and `canStop(step)` the verb's (a stopping verb is what a
// SKIP needs), so a layer and a stop are never words the worker chose. The run log must account
// for the dispatched slice exactly: one record per step, in order, from the slice's first step,
// none outside it -- a worker that drops the record of a step that failed is refused, not
// believed.
export function rederivedFindings(result, frozen, records, provedBy, expected = {}, canStop = () => false) {
  const steps = records.filter((r) => r.kind === "step");
  const slice = sliceOf(result, frozen);
  const k = { result, frozen, steps, slice, expected, canStop, run: records.find((r) => r.kind === "run"), counted: countedOf(steps.filter((s) => s.ok === true), frozen, provedBy) };
  return CLAIM_RULES.flatMap((rule) => rule(k));
}

const sliceOf = (result, frozen) => ({ from: result?.slice?.from ?? 1, to: result?.slice?.to ?? (frozen.steps?.length ?? 0) });

function countedOf(passed, frozen, provedBy) {
  const proved = {};
  for (const s of passed) tallied(proved, provedBy(frozen.steps?.[s.i - 1] ?? {}));
  return { proved, verdicts: Object.values(proved).reduce((n, k) => n + k, 0), done: passed.length };
}

function tallied(proved, layer) {
  if (layer) proved[layer] = (proved[layer] ?? 0) + 1;
}

const nonzero = (proved) => Object.fromEntries(Object.entries(proved ?? {}).filter(([, n]) => n > 0));

// The indices the log covers must be the slice's own, from its first step, each once.
const inOrder = (k) => k.steps.every((s, n) => s.i === k.slice.from + n && s.i <= k.slice.to);

const COVERS_ALL = new Set(["PASS", "PARTIAL", "INCONCLUSIVE"]);
const STOPPED_BY = { FAIL: "error", REFUSED: "refused", BLOCKED: "blocked" };

const CLAIM_RULES = [
  (k) => (k.run?.case_digest === k.result.case_digest && (!k.expected.caseDigest || k.result.case_digest === k.expected.caseDigest) ? [] : ["the run log ran another case than the one dispatched"]),
  (k) => (inOrder(k) ? [] : ["the run log does not account for the dispatched slice one step at a time, in order — a record is missing, repeated or outside it"]),
  (k) => (COVERS_ALL.has(k.result.status) && (k.steps.length !== k.slice.to - k.slice.from + 1 || k.steps.some((s) => s.ok !== true)) ? [`the result claims ${k.result.status} and its steps did not all run and hold`] : []),
  (k) => (STOPPED_BY[k.result.status] && !(k.steps.at(-1)?.ok === false && k.steps.at(-1)?.[STOPPED_BY[k.result.status]] !== undefined) ? [`the result claims ${k.result.status} and its last step does not say so`] : []),
  (k) => (k.result.status === "SKIP" && !(k.steps.at(-1)?.ok === true && k.canStop(k.frozen.steps?.[k.steps.at(-1).i - 1] ?? {})) ? ["the result claims SKIP and no step that can stop a run stopped it"] : []),
  (k) => (k.result.status === "PASS" && !k.counted.verdicts ? ["the result claims PASS and no verdict executed"] : []),
  (k) => (JSON.stringify(nonzero(k.result.proved)) === JSON.stringify(nonzero(k.counted.proved)) ? [] : ["the layers the result claims are not the layers its steps prove"]),
  (k) => (k.result.verdicts === k.counted.verdicts && k.result.done === k.counted.done ? [] : ["the result's counts are not its steps'"]),
];

// The grants a worker spent, held to the grants the host minted (ADR 0037): every spend names a
// grant this run was given, for that grant's capability, and no grant is used past its bound.
export function spendFindings(records, grants) {
  const minted = new Map((grants ?? []).map((g) => [g.id, g]));
  const spends = records.filter((r) => r.kind === "grant");
  const strays = spends.filter((s) => minted.get(s.grant)?.capability?.id !== s.capability).map((s) => `a spend names ${String(s.grant).slice(0, 40)}, which was not minted for ${s.capability}`);
  return [...strays, ...overspent(spends, minted)];
}

function overspent(spends, minted) {
  const counts = spends.reduce((m, s) => m.set(s.grant, (m.get(s.grant) ?? 0) + 1), new Map());
  return [...counts].filter(([id, n]) => minted.has(id) && n > (minted.get(id).bounds?.maxUses ?? 1)).map(([id, n]) => `${id} was used ${n} times and allows ${minted.get(id).bounds?.maxUses ?? 1}`);
}

// Everything the host holds a worker's run to, in one call, so no check can be left out of the
// path that writes authoritative records: the envelope, the re-derived claim and the grant spends.
export function workerFindings({ envelope, expected, listed, records, frozen, provedBy, canStop, grants }) {
  const own = envelopeFindings(envelope, expected, listed);
  if (own.length || !envelope.result) return own;
  return [...rederivedFindings(envelope.result, frozen, records, provedBy, expected, canStop), ...spendFindings(records, grants)];
}
