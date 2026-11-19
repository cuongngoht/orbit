// mapOrbitPanel: Orbit's own JSON in, the panel out. Pure. Every word shown is copied from what Orbit printed; the
// only thing this decides is which of Orbit's fields to show, and the verdict rule below, which only ever repeats a
// verdict Orbit itself gave.
import { UNKNOWN_VERDICT, type OrbitApprovalView, type OrbitAvailability, type OrbitCheckView, type OrbitPanel, type OrbitSessionCheck, type OrbitVerdict, type OrbitVerificationRow } from "@orbit-web/contracts";
import type { RunResult } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);

export function parseJson(stdout: string): Json | null {
  try {
    const v = JSON.parse(stdout) as unknown;
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

export function emptyPanel(state: OrbitAvailability, reason: string, checkedAt: string): OrbitPanel {
  return {
    state,
    reason,
    checkedAt,
    association: null,
    presentation: null,
    task: null,
    work: null,
    planWord: null,
    checks: [],
    missing: [],
    verification: [],
    completion: null,
    approvals: [],
    sessionChecks: [],
    failure: null,
    stop: null,
    verdict: UNKNOWN_VERDICT(reason),
  };
}

const sessionChecks = (live: Json): OrbitSessionCheck[] =>
  list(isRecord(live.session) ? live.session.checks : null).map((c) => ({ at: str(c.at), kind: str(c.class), program: str(c.exe), ok: typeof c.ok === "boolean" ? c.ok : null }));

function workOf(live: Json): OrbitPanel["work"] {
  if (!isRecord(live.work)) return null;
  const w = live.work;
  const lifecycle = isRecord(w.lifecycle) ? str(w.lifecycle.state) : null;
  const evidence = isRecord(w.evidence) ? w.evidence : {};
  return { lifecycle, evidence: str(evidence.level), evidenceSays: str(evidence.say), liveness: str(w.liveness) };
}

function taskOf(shown: Json | null, live: Json): OrbitPanel["task"] {
  const t = shown ?? {};
  const meta = isRecord(t.task) ? t.task : {};
  const attempt = isRecord(t.attempt) ? t.attempt : isRecord(live.attempt) ? live.attempt : {};
  const changes = isRecord(t.changes) ? t.changes : {};
  const id = str(meta.id) ?? (isRecord(live.association) ? str(live.association.task) : null);
  if (id === null) return null;
  return {
    id,
    objective: str(meta.objective),
    lifecycle: str(t.lifecycle) ?? str(live.lifecycle),
    stage: str(t.stage) ?? str(live.stage),
    stopReason: str(t.stopReason),
    attempt: num(attempt.number),
    attemptLimit: num(attempt.limit),
    terminal: t.terminal === true,
    revision: num(t.revision) ?? num(live.revision),
    changedFiles: num(changes.files),
  };
}

const checksOf = (context: Json | null): OrbitCheckView[] =>
  list(isRecord(context?.verificationPlan) ? context.verificationPlan.required : null).map((c) => ({
    id: str(c.id) ?? "check",
    purpose: str(c.purpose),
    component: str(c.component),
    declaredAs: str(c.declaredAs),
    state: str(c.state) ?? "unknown",
  }));

const verificationOf = (shown: Json | null): OrbitVerificationRow[] =>
  list(shown?.verification).map((v) => ({ obligation: str(v.obligation) ?? "obligation", state: str(v.state) ?? "unknown", evidence: str(v.evidence) }));

const approvalsOf = (shown: Json | null): OrbitApprovalView[] =>
  list(shown?.approvals)
    .filter((a) => a.open === true || a.state === "pending")
    .map((a) => ({ id: str(a.id) ?? "approval", title: str(a.title) ?? str(a.action), boundary: str(a.boundary), state: str(a.state) ?? "pending", risk: str(a.risk), destructive: a.destructive === true, expires: str(a.expires) }));

function failureOf(context: Json | null): OrbitPanel["failure"] {
  const f = isRecord(context?.latestFailure) ? context.latestFailure : null;
  if (f === null) return null;
  const excerpt = Array.isArray(f.excerpt) ? f.excerpt.filter((l): l is string => typeof l === "string").slice(-20).map(redactSecrets) : [];
  return { failureClass: str(f.class), command: str(f.command), excerpt };
}

// Orbit's verdict, repeated: verified / not verified only where Orbit said it, unknown everywhere else.
export function verdictOf(p: Pick<OrbitPanel, "state" | "task" | "work" | "verification" | "checks">): OrbitVerdict {
  if (p.state !== "available") return UNKNOWN_VERDICT(p.state === "not_seated" ? "Orbit does not know this checkout yet." : "Orbit could not be read.");
  if (p.work?.evidence === "verified") return { word: "verified", label: "Verified by Orbit", source: "work evidence level = verified" };
  if (p.task?.lifecycle === "COMPLETED") return { word: "verified", label: "Verified by Orbit", source: `task ${p.task.id} lifecycle = COMPLETED` };
  if (p.task?.lifecycle === "FAILED") return { word: "not_verified", label: "Not verified", source: `task ${p.task.id} lifecycle = FAILED${p.task.stopReason ? ` (${p.task.stopReason})` : ""}` };
  const violated = p.verification.find((v) => v.state === "violated");
  if (violated) return { word: "not_verified", label: "Not verified", source: `verification "${violated.obligation}" = violated` };
  const regressed = p.checks.find((c) => c.state === "regressed");
  if (regressed) return { word: "not_verified", label: "Not verified", source: `check ${regressed.id} = regressed` };
  if (p.task === null) return UNKNOWN_VERDICT("No Orbit task is linked to this session, so Orbit has given no verdict.");
  return UNKNOWN_VERDICT(`Orbit task ${p.task.id} is ${p.task.lifecycle ?? "open"}: no verdict yet.`);
}

function unavailable(live: RunResult): OrbitPanel["state"] {
  return live.code === 3 ? "not_seated" : "unavailable";
}

export function mapOrbitPanel(input: { live: RunResult; task: RunResult | null; context: RunResult | null; checkedAt: string }): OrbitPanel {
  const live = input.live.code === 0 ? parseJson(input.live.stdout) : null;
  if (live === null) {
    const state = unavailable(input.live);
    const why = state === "not_seated" ? "Orbit does not know this checkout yet (it is seated when the workspace is prepared)." : `Orbit's live status could not be read: ${tail(input.live.stderr || input.live.stdout, 2) || `exit ${input.live.code}`}`;
    return emptyPanel(state, why, input.checkedAt);
  }
  const shown = input.task?.code === 0 ? parseJson(input.task.stdout) : null;
  const context = input.context?.code === 0 ? parseJson(input.context.stdout) : null;
  const association = isRecord(live.association) ? { how: str(live.association.how) ?? "none", taskId: str(live.association.task) } : null;
  const plan = isRecord(context?.verificationPlan) ? context.verificationPlan : null;
  const stop = isRecord(context?.stop) ? { id: str(context.stop.id) ?? "stop", says: str(context.stop.say) ?? "" } : null;
  const completion = Array.isArray(context?.completion) ? list(context.completion).map((r) => ({ id: str(r.id) ?? "row", says: str(r.say) ?? "" })) : null;
  const base = {
    state: "available" as const,
    reason: null,
    checkedAt: input.checkedAt,
    association,
    presentation: isRecord(live.presentation) ? str(live.presentation.state) : null,
    task: association?.taskId ? taskOf(shown, live) : null,
    work: workOf(live),
    planWord: plan ? str(plan.word) : null,
    checks: checksOf(context),
    missing: list(plan?.missing).map((m) => `${str(m.what) ?? "?"}: ${str(m.because) ?? ""}`),
    verification: verificationOf(shown),
    completion,
    approvals: approvalsOf(shown),
    sessionChecks: sessionChecks(live),
    failure: failureOf(context),
    stop,
  };
  return { ...base, verdict: verdictOf(base) };
}
