// EVIDENCE READ BACK from its owner, every time -- never a copied verdict. A report names references
// (`task:tsk-…`, `check:tsk-…:chk-<n>`, `investigation:inv-…`, `file:<path>`, `handoff:hof-<n>`, `definition:<pin>`);
// each is asked of the one record that owns it, through a port the composition root binds, and answers a LEVEL
// (vocab.mjs) with whether that owner is independent of the agent that named it. What a report SAYS about a check
// passing counts for nothing: only the engineering task's own verification rows do.
import { canonicalJson, short } from "../../../src/hash.mjs";
import { quietly } from "../store/text.mjs";
import { OWNERS } from "./vocab.mjs";

const TERMINAL_TASK = ["COMPLETED", "FAILED", "CANCELLED"];

const verifiedTask = (v) => v.verification.some((x) => x.state === "satisfied") && !v.verification.some((x) => x.state === "violated");

const TASK_LEVELS = [
  { when: (v) => !v, level: "UNKNOWN", say: () => "no engineering task of this project has that id" },
  { when: (v) => ["BLOCKED", "WAITING_APPROVAL", "PAUSED"].includes(v.lifecycle), level: "BLOCKED", say: (v) => `the engineering task is ${v.lifecycle}${v.stopReason ? ` (${v.stopReason})` : ""}` },
  { when: (v) => !TERMINAL_TASK.includes(v.lifecycle), level: "UNKNOWN", open: true, say: (v) => `the engineering task is still ${v.lifecycle}` },
  { when: (v) => v.lifecycle === "COMPLETED" && verifiedTask(v), level: "VERIFIED", say: (v) => `completed on its own evidence: ${v.verification.filter((x) => x.state === "satisfied").length} verification(s) satisfied` },
  { when: (v) => v.lifecycle === "COMPLETED", level: "BEHAVIOR_OBSERVED", say: () => "completed, with no satisfied verification row" },
  { when: () => true, level: "UNKNOWN", say: (v) => `the engineering task ended ${v.lifecycle}` },
];

const taskDigest = (v) => (v ? short(canonicalJson({ lifecycle: v.lifecycle, revision: v.revision, verification: v.verification }), 16) : null);

const rowOf = (rows, v) => ((r) => ({ level: r.level, open: r.open === true, say: r.say(v) }))(rows.find((r) => r.when(v)));

const taskBack = (ports, ref) => ((v) => ({ ...rowOf(TASK_LEVELS, v), digest: taskDigest(v) }))(quietly(() => ports.owners.task(ref.id)));

const CHECK_LEVELS = [
  { when: (c) => !c.view, level: "UNKNOWN", say: () => "no engineering task of this project has that id" },
  { when: (c) => c.row?.state === "satisfied", level: "VERIFIED", say: (c) => `${c.check} satisfied ${c.row.obligation ?? "its obligation"}` },
  { when: (c) => c.row?.state === "violated", level: "BEHAVIOR_OBSERVED", say: (c) => `${c.check} failed: the failing behaviour is preserved as evidence` },
  { when: (c) => Boolean(c.receipt), level: "TOOL_COMPLETED", say: (c) => `${c.check} ran (${c.receipt.outcome ?? "no outcome"}) and verified nothing yet` },
  { when: () => true, level: "UNKNOWN", say: (c) => `the task holds no receipt for ${c.check}` },
];

function checkBack(ports, ref) {
  const [task, check] = String(ref.id).split(":");
  const view = quietly(() => ports.owners.task(task));
  const c = { view, check, receipt: view?.receipts.find((r) => r.domain === "check" && r.ref === check) ?? null, row: view?.verification.find((x) => x.evidence === `check:${check}`) ?? null };
  return { ...rowOf(CHECK_LEVELS, c), digest: c.receipt ? short(canonicalJson({ receipt: c.receipt, row: c.row }), 16) : null };
}

const INVESTIGATION_LEVELS = [
  { when: (o) => !o, level: "UNKNOWN", say: () => "no QA investigation of this project has that id" },
  { when: (o) => o.lifecycle === "paused", level: "BLOCKED", say: (o) => `the investigation is paused${o.reason ? ` (${o.reason})` : ""}: it waits for a person, or a limit to be raised` },
  { when: (o) => !o.ended, level: "UNKNOWN", open: true, say: (o) => `the investigation is still ${o.lifecycle}` },
  { when: (o) => o.lifecycle !== "completed", level: "UNKNOWN", say: (o) => `the investigation ended ${o.lifecycle}` },
  { when: (o) => o.defects > 0, level: "BEHAVIOR_OBSERVED", say: (o) => `${o.defects} finding(s) its vocabulary calls a defect` },
  { when: () => true, level: "VERIFIED", say: (o) => `completed with ${o.findings} finding(s) and no defect` },
];

const investigationBack = (ports, ref) => ((o) => ({ ...rowOf(INVESTIGATION_LEVELS, o), digest: o ? short(canonicalJson(o), 16) : null }))(quietly(() => ports.owners.investigation(ref.id)));

const fileBack = (ports, ref) => ((f) => (f?.exists ? { level: "TOOL_COMPLETED", say: "cited, and the file is in the checkout", digest: f.digest, open: false } : { level: "UNKNOWN", say: "the file it cites is not in the checkout", digest: null, open: false }))(quietly(() => ports.owners.file(ref.id)));

const handoffBack = (ports, ref, lw) => ((h) => (h ? { level: "CONTRACT_MET", say: `handoff ${ref.id} as published`, digest: h.digest, open: false } : { level: "UNKNOWN", say: `${ref.id} was not published by this mission`, digest: null, open: false }))(lw.m.handoffs.get(ref.id));

const definitionBack = (ports, ref) => ((d) => (d ? { level: "CONTRACT_MET", say: `${ref.id} read back intact`, digest: d.contentDigest.slice(0, 16), open: false } : { level: "UNKNOWN", say: `${ref.id} could not be read back intact`, digest: null, open: false }))(quietly(() => ports.definitions.read(ref.id)));

export const READ_BACK = Object.freeze({ task: taskBack, check: checkBack, investigation: investigationBack, file: fileBack, handoff: handoffBack, definition: definitionBack });

export const READABLE = Object.freeze(Object.keys(READ_BACK));

export const readBack = (ports, ref, lw) => ({ owner: ref.domain, ref: `${ref.domain}:${ref.id}`, independent: OWNERS[ref.domain].independent, ...READ_BACK[ref.domain](ports, ref, lw) });
