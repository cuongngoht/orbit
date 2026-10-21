// What a step's EVIDENCE says, read back from the owner that keeps it -- never taken from the host's word.
// A host may say a child task completed; the child's own journal says whether it did.
//
//   READ_BACK[domain](ports, ref, lw) -> { verdict, receipt, needs?, because? }
//
//   verdict   satisfied   the owner's record proves the step's obligation
//             violated    the owner's record shows it ended without it
//             open        the owner's work is still going on (settle again when it ends)
//             blocked     the owner waits for someone (`needs`)
//             unreadable  the owner cannot be asked, or keeps no such record
//   receipt   the receipt the coordinator links for it, in the owner's own words
//
// Every port here only READS: a child task's view, an investigation's fold, a requirement's latest
// snapshot and its open questions, runtime understanding's memory, the skill factory's registry.
import { DOMAIN, LIFE, NEEDS, TERMINAL } from "./vocab.mjs";

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

const unreadable = (domain, ref, because) => ({ verdict: "unreadable", receipt: null, because: `${domain}:${ref} — ${because}` });

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

// ---- a child task --------------------------------------------------------------------------------

const CHILD = [
  { when: (v) => v.lifecycle === LIFE.COMPLETED, verdict: "satisfied" },
  { when: (v) => v.terminal, verdict: "violated" },
  { when: (v) => v.lifecycle === LIFE.BLOCKED, verdict: "blocked" },
  { when: () => true, verdict: "open" },
];

const childSummary = (v) => [`attempt ${v.attempt.number ?? 0}/${v.attempt.limit ?? "?"}`, `${v.changes.files} file(s) +${v.changes.added} -${v.changes.removed}`, v.stage ? `stage ${v.stage}` : null, v.stopReason ? `stop ${v.stopReason}` : null].filter(Boolean).join(" · ");

// Evidence counts only when it is THIS workflow's: a task it started (its own `task:` receipt), an
// investigation begun against that task or the workflow itself, the draft it scaffolded, a version it
// registered or the resolver selected. Anything else in the project -- another workflow's completed task,
// an unrelated investigation -- proves nothing about this step, and is refused as unreadable.
const linked = (lw, domain, ref) => lw.view.receipts.some((r) => r.domain === domain && r.ref === ref);

const ownChildren = (lw) => lw.view.receipts.filter((r) => r.domain === DOMAIN.TASK).map((r) => r.ref);

function childBack(ports, ref, lw) {
  if (!linked(lw, DOMAIN.TASK, ref)) return unreadable(DOMAIN.TASK, ref, "not a task this workflow started — only its own engineering task proves its steps");
  const v = quietly(() => ports.child.view(ref));
  if (!v) return unreadable(DOMAIN.TASK, ref, "no task of this checkout has that id");
  const row = CHILD.find((c) => c.when(v));
  return { verdict: row.verdict, receipt: { domain: DOMAIN.TASK, ref, outcome: v.lifecycle, summary: clip(childSummary(v)) }, needs: v.blocked?.needs ?? (row.verdict === "blocked" ? NEEDS.PERSON : undefined), because: v.blocked?.because ?? v.ended?.because ?? undefined };
}

// ---- an investigation ----------------------------------------------------------------------------

const INVESTIGATION = [
  { when: (o) => !o.ended, verdict: "open" },
  { when: (o) => o.lifecycle !== "completed", verdict: "violated" },
  { when: (o) => o.defects > 0, verdict: "violated" },
  { when: () => true, verdict: "satisfied" },
];

function investigationBack(ports, ref, lw) {
  const o = quietly(() => ports.investigations.outcome(ref));
  if (!o) return unreadable(DOMAIN.INVESTIGATION, ref, "no investigation of this project has that id");
  if (![lw.id, ...ownChildren(lw)].includes(o.task)) return unreadable(DOMAIN.INVESTIGATION, ref, "it was not begun against this workflow's task or its sandbox — an unrelated investigation proves nothing here");
  return { verdict: INVESTIGATION.find((r) => r.when(o)).verdict, receipt: { domain: DOMAIN.INVESTIGATION, ref, outcome: o.lifecycle, summary: clip(`${o.reason ?? o.lifecycle} · ${o.findings} finding(s), ${o.defects} its vocabulary calls a defect`) } };
}

// ---- a requirement snapshot ----------------------------------------------------------------------

const REQUIREMENT = [
  { when: (l, ref) => !l.latest || l.latest.id !== ref, verdict: "unreadable" },
  { when: (l) => l.blocking > 0, verdict: "blocked" },
  { when: () => true, verdict: "satisfied" },
];

function requirementBack(ports, ref, lw) {
  const looked = lw.view.task.root ? quietly(() => ports.requirements.look(lw.view.task.root)) : null;
  if (!looked) return unreadable(DOMAIN.REQUIREMENT, ref, "the coordinator was started with no requirement to read it against");
  const row = REQUIREMENT.find((r) => r.when(looked, ref));
  if (row.verdict === "unreadable") return unreadable(DOMAIN.REQUIREMENT, ref, `the requirement's newest snapshot is ${looked.latest?.id ?? "none"}`);
  return { verdict: row.verdict, receipt: { domain: DOMAIN.REQUIREMENT, ref, outcome: row.verdict === "satisfied" ? "READY" : "BLOCKED", summary: clip(`snapshot ${ref}, ${looked.latest.clarity ?? "clarity unknown"}, ${looked.blocking} blocking question(s)`) }, needs: NEEDS.REQUIREMENT, because: row.verdict === "blocked" ? `${looked.blocking} question(s) a person answers first` : undefined };
}

// ---- a project playbook ----------------------------------------------------------------------------

// A pin (<id>:<version>:<digest8>) is a registered version; a bare id is a DRAFT, read back by holding it to
// the contract -- a draft that does not verify is the host's to write again, never registered.
function pinBack(ports, ref, lw) {
  if (!linked(lw, DOMAIN.SKILL, ref) && !lw.view.actions.some((a) => a.state === "running" && ref.startsWith(`${a.tool}:`))) return unreadable(DOMAIN.SKILL, ref, "not a version this workflow registered or was handed");
  const row = quietly(() => ports.factory?.pinned(ref));
  if (!row) return unreadable(DOMAIN.SKILL, ref, "the skill factory keeps no such version for this project");
  return { verdict: row.loadable ? "satisfied" : "violated", receipt: { domain: DOMAIN.SKILL, ref, outcome: row.status.toUpperCase(), summary: clip(row.summary) } };
}

function draftBack(ports, ref, lw) {
  if (!linked(lw, DOMAIN.SKILL, ref)) return unreadable(DOMAIN.SKILL, ref, "not the draft this workflow scaffolded");
  const v = quietly(() => ports.factory?.verify(ref));
  if (!v) return unreadable(DOMAIN.SKILL, ref, "the skill factory keeps no such draft for this project");
  return { verdict: v.ok ? "satisfied" : "violated", because: v.ok ? undefined : clip(v.findings.map((f) => `${f.id}: ${f.says}`).join("; ")), receipt: { domain: DOMAIN.SKILL, ref, outcome: v.ok ? "DRAFT_VERIFIED" : "DRAFT_REFUSED", summary: clip(v.ok ? "the draft holds to the contract" : v.findings.map((f) => f.id).join(", ")) } };
}

const skillBack = (ports, ref, lw) => (ref.includes(":") ? pinBack(ports, ref, lw) : draftBack(ports, ref, lw));

// ---- a declared playbook's run (0.0.4) ---------------------------------------------------------------

// A run is read back off THIS workflow's own receipts: VERIFIED proves the step, a reported run proves nothing (a host
// settling one is held to what a report may say), and one that failed, blocked or was interrupted says so.
const RUN_BACK = { VERIFIED: "satisfied", FAILED: "violated", INTERRUPTED: "violated", BLOCKED: "blocked", RUNNING: "open" };

function skillRunBack(ports, ref, lw) {
  const r = lw.view.receipts.find((x) => x.domain === DOMAIN.SKILLRUN && x.ref === ref);
  if (!r) return unreadable(DOMAIN.SKILLRUN, ref, "not a run this workflow carried");
  return { verdict: RUN_BACK[r.outcome] ?? "unreadable", receipt: { domain: DOMAIN.SKILLRUN, ref, outcome: r.outcome, summary: clip(r.summary), ...(r.pin ? { pin: r.pin } : {}) }, needs: r.outcome === "BLOCKED" ? NEEDS.PERSON : undefined, because: RUN_BACK[r.outcome] ? undefined : `skillrun:${ref} is ${r.outcome} — reported, not proven` };
}

export const READ_BACK = {
  [DOMAIN.TASK]: childBack,
  [DOMAIN.INVESTIGATION]: investigationBack,
  [DOMAIN.REQUIREMENT]: requirementBack,
  [DOMAIN.SKILL]: skillBack,
  [DOMAIN.SKILLRUN]: skillRunBack,
};

// "task:tsk-…" -> { domain, ref }, or null for anything that is not a domain:ref this engine reads.
export const refOf = (text) => ((m) => (m && Object.hasOwn(READ_BACK, m[1]) ? { domain: m[1], ref: m[2] } : null))(/^([a-z]+):([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(String(text ?? "")));

// The evidence a step offers, read back, the strongest verdict first: one proof is enough, one
// violation is decisive, and a step with nothing readable is unreadable.
const RANK = ["violated", "satisfied", "blocked", "open", "unreadable"];

export function verifyOf(ports, kind, refs, lw) {
  const read = refs.map(refOf).filter((r) => r && kind.domains.includes(r.domain)).map((r) => READ_BACK[r.domain](ports, r.ref, lw));
  return read.sort((a, b) => RANK.indexOf(a.verdict) - RANK.indexOf(b.verdict))[0] ?? { verdict: "unreadable", receipt: null, because: `name its evidence as one of ${kind.domains.map((d) => `${d}:<id>`).join(", ") || "nothing this step can prove"}` };
}

export const isTerminal = (lifecycle) => TERMINAL.includes(lifecycle);
