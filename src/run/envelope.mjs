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

// The claim, re-derived from the run log and the frozen case. `provedBy(step)` is the DSL's own
// answer (src/dsl/registry.mjs), so a layer is never a word the worker chose.
export function rederivedFindings(result, frozen, records, provedBy) {
  const run = records.find((r) => r.kind === "run");
  const steps = records.filter((r) => r.kind === "step");
  const counted = countedOf(steps.filter((s) => s.ok === true), frozen, provedBy);
  return CLAIM_RULES.flatMap((rule) => rule({ result, run, steps, counted, frozen }));
}

function countedOf(passed, frozen, provedBy) {
  const proved = {};
  for (const s of passed) tallied(proved, provedBy(frozen.steps?.[s.i - 1] ?? {}));
  return { proved, verdicts: Object.values(proved).reduce((n, k) => n + k, 0), done: passed.length };
}

function tallied(proved, layer) {
  if (layer) proved[layer] = (proved[layer] ?? 0) + 1;
}

const nonzero = (proved) => Object.fromEntries(Object.entries(proved ?? {}).filter(([, n]) => n > 0));

const CLAIM_RULES = [
  (k) => (k.run?.case_digest === k.result.case_digest ? [] : ["the run log ran another case than the result claims"]),
  (k) => (k.result.status === "PASS" && k.steps.some((s) => s.ok === false) ? ["the result claims PASS over a step that did not pass"] : []),
  (k) => (k.result.status === "PASS" && !k.counted.verdicts ? ["the result claims PASS and no verdict executed"] : []),
  (k) => (JSON.stringify(nonzero(k.result.proved)) === JSON.stringify(nonzero(k.counted.proved)) ? [] : ["the layers the result claims are not the layers its steps prove"]),
  (k) => (k.result.verdicts === k.counted.verdicts && k.result.done === k.counted.done ? [] : ["the result's counts are not its steps'"]),
];
