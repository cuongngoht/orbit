// THE SPEC of ORBIT-SRC-002: a candidate may never stop asking a person. A step declares that it waits for a person
// with `approval: "owner"`; when the version a candidate succeeds had such a step and the candidate no longer has it
// waiting -- its approval dropped, or the step itself removed or renamed, required or optional -- the oracle must
// report APPROVAL_DROPPED. Written from that contract, kept beside the probe, handed to no runner; it never imports
// the subject. Seeded workflows add removals and changes at random, and each is judged on the two ids this case is
// about, never on the rest.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]
export const CASE = "ORBIT-SRC-002";

export const GROUPS = {
  "optional-approval-removed": "an optional step that waited for a person, removed, is reported as APPROVAL_DROPPED",
  "optional-approval-renamed": "an optional step that waited for a person, renamed, is reported as APPROVAL_DROPPED",
  "required-approval-removed": "a required step that waited for a person, removed, is still reported as REQUIRED_DROPPED",
  "approval-dropped-kept-step": "a kept step that no longer waits for a person is reported as APPROVAL_DROPPED",
  "plain-optional-removed": "an optional step that waited for nobody, needed no owner's record and held no rule may go: nothing is reported",
  "approval-added": "a step that starts waiting for a person is no weakening: nothing is reported",
  "safety-approval-removed": "safetyOf refuses a candidate that removed a step a person approved, with CAND_ORACLE_WEAKENED",
  "seeded-workflow": "removals and approval changes at random: APPROVAL_DROPPED exactly when a person is no longer asked, REQUIRED_DROPPED exactly when a required step is gone",
};

const step = (id, over = {}) => ({ id, capability: `${id}.read`, required: true, evidence: "report", approval: "none", outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }], ...over });

const plain = (id) => ({ id, capability: `${id}.read`, required: false, evidence: "report", approval: "none", outputs: {}, success: [] });

const wf = (...steps) => ({ api: "orbit.skill-workflow/v1", steps });

const pair = (parent, candidate) => ({ call: "weakenings", kind: "workflow", parent, candidate });

const asked = (over = {}) => step("sign-off", { required: false, approval: "owner", ...over });

const DROPPED = { has: ["APPROVAL_DROPPED"] };
const NOTHING = { exactly: [] };

const STRUCTURE = [
  { group: "optional-approval-removed", input: pair(wf(step("read"), asked()), wf(step("read"))), expect: DROPPED },
  { group: "optional-approval-removed", input: pair(wf(step("read"), asked({ evidence: "owner-record", outputs: { record: { type: "record", path: "record" } }, success: [{ output: "record", op: "present" }] })), wf(step("read"))), expect: DROPPED },
  { group: "optional-approval-removed", input: pair(wf(asked(), step("read"), step("notes")), wf(step("notes"), step("read"))), expect: DROPPED },
  { group: "optional-approval-renamed", input: pair(wf(step("read"), asked()), wf(step("read"), asked({ id: "approve" }))), expect: DROPPED },
  { group: "required-approval-removed", input: pair(wf(step("read"), asked({ required: true })), wf(step("read"))), expect: { has: ["REQUIRED_DROPPED"] } },
  { group: "approval-dropped-kept-step", input: pair(wf(step("read"), asked()), wf(step("read"), asked({ approval: "none" }))), expect: DROPPED },
  { group: "plain-optional-removed", input: pair(wf(step("read"), plain("tidy")), wf(step("read"))), expect: NOTHING },
  { group: "approval-added", input: pair(wf(step("read"), asked({ approval: "none" })), wf(step("read"), asked())), expect: NOTHING },
];

// ---- through the public safety API ------------------------------------------------------------------------------------

const PIN = "release-signoff:1.0.0:aaaaaaaa";

const playbook = (workflow, successor = false) => ({ pin: successor ? "release-signoff:1.0.1:bbbbbbbb" : PIN, digest: successor ? "d1" : "d0", intact: true, manifest: { provides: ["release.signoff"], allowedTools: ["Read"], successorOf: successor ? PIN : null }, files: [{ name: "SKILL.md" }, { name: "manifest.json" }, { name: "workflow.json" }], workflow });

const SAFETY = [
  { group: "safety-approval-removed", input: { call: "safety", kind: "skill", parent: playbook(wf(step("read"), asked())), candidate: playbook(wf(step("read")), true) }, expect: { has: ["CAND_ORACLE_WEAKENED"] } },
  { group: "safety-approval-removed", input: { call: "safety", kind: "skill", parent: playbook(wf(step("read"), plain("tidy"))), candidate: playbook(wf(step("read")), true) }, expect: NOTHING },
];

// ---- seeded workflows: the reference model says which of the two ids each owes ---------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const IDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

const seededStep = (r, id) => step(id, { required: pick(r, [true, false]), approval: pick(r, ["none", "owner"]) });

// A step of the parent: removed, renamed, its approval toggled, or kept as it was.
const FATES = [
  { id: "removed", to: () => [] },
  { id: "renamed", to: (r, s) => [{ ...s, id: `${s.id}-next` }] },
  { id: "toggled", to: (r, s) => [{ ...s, approval: s.approval === "owner" ? "none" : "owner" }] },
  { id: "kept", to: (r, s) => [s] },
];

// The contract over one parent step and its fate: is a person no longer asked, is a required step gone.
const stopsAsking = (s, fate) => s.approval === "owner" && fate !== "kept";
const requiredGone = (s, fate) => s.required !== false && ["removed", "renamed"].includes(fate);

const owed = (asking, gone) => ({ has: [asking && "APPROVAL_DROPPED", gone && "REQUIRED_DROPPED"].filter(Boolean), lacks: [!asking && "APPROVAL_DROPPED", !gone && "REQUIRED_DROPPED"].filter(Boolean) });

const expectOf = (rows) => owed(rows.some(([s, f]) => stopsAsking(s, f)), rows.some(([s, f]) => requiredGone(s, f)));

function seeded(r) {
  const parent = IDS.slice(0, 3 + Math.floor(r() * 3)).map((id) => seededStep(r, id));
  const rows = parent.map((s) => [s, pick(r, FATES)]);
  return { group: "seeded-workflow", input: pair(wf(...parent), wf(...rows.flatMap(([s, f]) => f.to(r, s)))), expect: expectOf(rows.map(([s, f]) => [s, f.id])) };
}

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...STRUCTURE, ...SAFETY, ...Array.from({ length: Math.max(8, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to the contract in words ---------------------------------------------------------------

const HAND = [
  ["an optional step a person approved, removed", { approval: "owner", required: false }, "removed", true, false],
  ["a required step a person approved, removed", { approval: "owner", required: true }, "removed", true, true],
  ["an optional step nobody approved, removed", { approval: "none", required: false }, "removed", false, false],
  ["a step a person approved, renamed", { approval: "owner", required: false }, "renamed", true, false],
  ["a step whose approval was toggled off", { approval: "owner", required: true }, "toggled", true, false],
  ["a step whose approval was toggled on", { approval: "none", required: true }, "toggled", false, false],
  ["a step kept as it was", { approval: "owner", required: true }, "kept", false, false],
];

export const selfTest = () => HAND.filter(([, s, fate, asking, gone]) => stopsAsking(s, fate) !== asking || requiredGone(s, fate) !== gone).map(([say]) => `the reference model disagrees with the contract on: ${say}`);
