// EVIDENCE (`e`): what the task shown has on record -- readiness, approvals, receipts by domain, verifications,
// and the actions that were only REPORTED -- each as its owner wrote it. Enter shows one item's fields; a field
// the record does not carry says NOT RECORDED. Nothing here infers that anything was verified: a receipt is
// shown as a receipt, a reported action as reported, a STALE sandbox as stale.
import { ABSENT, clock, dim, joined, row, seg, str } from "../sections/parts.mjs";
import { focusId } from "../model.mjs";

export const EVIDENCE_DOMAINS = Object.freeze(["requirement", "plan", "step", "task", "work", "runtime", "sandbox", "check", "test", "run", "browser", "data", "investigation", "skill"]);

const TONES = { satisfied: "success", violated: "danger", "not-verified": "warning", blocked: "warning", READY: "success", SUCCEEDED: "success", succeeded: "success", STALE: "warning", FAILED: "danger", failed: "danger", BLOCKED: "warning", REFUSED: "danger", pending: "warning", granted: "success", rejected: "danger", expired: "subtle", consumed: "subtle", REPORTED: "warning" };

const tone = (word) => TONES[word];

const domainRank = (r) => ((i) => (i < 0 ? EVIDENCE_DOMAINS.length : i))(EVIDENCE_DOMAINS.indexOf(r.domain));

const item = (kind, data, left) => ({ kind, data, row: row(left) });

const readiness = (v) => ["requirement", "environment", "workspace"].map((k) => item("readiness", { name: k, ...v.readiness?.[k] }, [seg("ready      ", "label"), seg(k.padEnd(12)), seg(v.readiness?.[k]?.state ?? ABSENT.unrecorded, tone(v.readiness?.[k]?.state)), dim(`  ${v.readiness?.[k]?.ref ?? ""}`)]));

const approvals = (v) => v.approvals.map((a) => item("approval", a, [seg("approval   ", "label"), seg(`${a.id}  `), seg(a.state, tone(a.state)), a.destructive ? seg("  DESTRUCTIVE", "warning") : null, dim(`  ${a.title ?? a.action ?? "?"}${a.environment ? ` on ${a.environment}` : ""}`), a.open ? seg("  decide in Orbit Control", "warning") : null]));

const receipts = (v) => [...v.receipts].sort((a, b) => domainRank(a) - domainRank(b)).map((r) => item("receipt", r, [seg("receipt    ", "label"), seg(`${r.domain}:${r.ref}`.padEnd(30)), seg(` ${r.outcome ?? ABSENT.unrecorded}`, tone(r.outcome)), dim(`  ${str(r.summary) ?? ""}`)]));

const verifications = (v) => v.verification.map((x) => item("verification", x, [seg("verify     ", "label"), seg(`${x.obligation ?? x.subject ?? "?"}`.padEnd(30)), seg(` ${x.state}`, tone(x.state)), dim(`  ${x.evidence ?? "no evidence named"}`)]));

const reported = (v) => v.actions.filter((a) => a.evidence === "reported" && a.state !== "running").map((a) => item("action", a, [seg("reported   ", "label"), seg(`${a.id} ${a.type}`.padEnd(30)), seg(" reported, not proven", "warning"), dim(`  ${str(a.summary) ?? ""}`)]));

export const evidenceItems = (view) => (view ? [...readiness(view), ...approvals(view), ...receipts(view), ...verifications(view), ...reported(view)] : []);

// What one item's detail says, field by field; an absent field is NOT RECORDED, never a guess.
export const CONTEXT_FIELDS = Object.freeze({
  readiness: ["name", "state", "ref", "source", "at", "because"],
  approval: ["id", "title", "action", "environment", "reason", "risk", "attempt", "requestedAt", "expires", "state", "decidedBy", "decidedAt", "consumedBy", "outcome"],
  receipt: ["domain", "ref", "outcome", "summary", "action", "environment", "sourceTree", "at"],
  verification: ["subject", "obligation", "state", "evidence", "at"],
  action: ["id", "type", "tool", "label", "state", "startedAt", "endedAt", "summary", "reason", "evidence"],
});

const valueOf = (data, field) => (data[field] === null || data[field] === undefined || data[field] === "" ? ABSENT.unrecorded : String(data[field]));

const detailRows = (it) => (it ? [row([dim("─".repeat(8))]), ...CONTEXT_FIELDS[it.kind].map((f) => row([dim(`  ${f.padEnd(12)}`), seg(valueOf(it.data, f), valueOf(it.data, f) === ABSENT.unrecorded ? "subtle" : undefined)]))] : []);

export function evidenceOverlay(state) {
  const view = state.tasks[focusId(state)]?.view ?? null;
  const items = evidenceItems(view);
  const lead = [row(joined([seg(focusId(state) ?? "no task", "brand"), dim(view ? `revision ${view.revision} · as of ${clock(view.task?.updatedAt)}` : ABSENT.unknown), dim("what each owner recorded; a reported action is not proof")]))];
  return { title: "EVIDENCE", lead, rows: items.map((x) => x.row), selectable: true, after: detailRows(items[state.viewer.detail ?? -1]) };
}
