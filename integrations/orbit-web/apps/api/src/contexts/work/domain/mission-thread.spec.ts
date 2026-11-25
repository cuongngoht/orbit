// ONE MISSION'S THREAD: who gave which work to whom, who asked and who answered, what was handed in -- with its files --
// and how it was reviewed, in time order, each party named; a discussion file changing is Orbit's notice. Nothing is
// summarised: every message carries its record's own words.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MissionDetail, MissionParty, TeamRoomChange } from "@orbit-web/contracts";
import { missionThread } from "./mission-thread.js";

const ROOT = "a0000000-0000-4000-8000-000000000001";
const PART = "a0000000-0000-4000-8000-000000000002";
const assignment = (o: Record<string, unknown>) => ({ pinned: { profileRevision: 1, departmentId: null, departmentName: null, execution: null }, brief: { goal: "", deliverables: [], acceptanceCriteria: [], dependsOn: [] }, ...o });

const detail = {
  title: "Lập kế hoạch tuyển dụng",
  goal: "Một kế hoạch cho Phòng FX.",
  createdBy: "owner:acct",
  createdAt: "2026-11-24T13:18:29.000Z",
  deliverables: [{ name: "plan.md", required: true }],
  acceptanceCriteria: ["Có ngân sách"],
  assignments: [
    assignment({ id: ROOT, title: "Lập kế hoạch tuyển dụng", parentId: null, employeeId: "e-ceo", employeeName: "Cường", createdAt: "2026-11-24T13:18:29.000Z" }),
    assignment({ id: PART, title: "Kế hoạch nhân sự", parentId: ROOT, employeeId: "e-nam", employeeName: "Nam", createdAt: "2026-11-24T13:18:44.000Z", pinned: { profileRevision: 1, departmentId: "d", departmentName: "Phòng FX", execution: null }, brief: { goal: "Kế hoạch nhân sự\n\nViết kế hoạch và mô tả công việc.", deliverables: [{ name: "ke-hoach.md", required: true }], acceptanceCriteria: ["Rõ ràng"], dependsOn: [] } }),
  ],
  clarifications: [
    { id: "q1", askerAssignmentId: PART, askerName: "Nam", question: "Tuyển mấy người?", addressee: "lead", addresseeAssignmentId: ROOT, addresseeName: "Cường", kind: "information", state: "answered", answer: "Hai người.", answeredBy: "agent:employee:e-ceo", answeredAt: "2026-11-24T13:20:00.000Z", askedAt: "2026-11-24T13:19:00.000Z", route: [{ addressee: "lead", addresseeName: "Cường", why: "asked", at: "2026-11-24T13:19:00.000Z" }] },
  ],
  handoffs: [
    { id: "h2", assignmentId: PART, revision: 2, digest: "d2", summary: "Bản 2: thêm ngân sách.", status: "accepted", artifacts: [{ id: "f2", name: "ke-hoach.md", kind: "file", mediaType: "text/markdown", size: 120, sha256: "s2" }], claims: [], missing: [], submittedAt: "2026-11-24T13:40:00.000Z", submittedBy: "agent:employee:e-nam", review: { by: "agent:employee:e-ceo", at: "2026-11-24T13:41:00.000Z", note: "" } },
    { id: "h1", assignmentId: PART, revision: 1, digest: "d1", summary: "Bản 1.", status: "revision_requested", artifacts: [{ id: "f1", name: "ke-hoach.md", kind: "file", mediaType: "text/markdown", size: 80, sha256: "s1" }], claims: [], missing: [], submittedAt: "2026-11-24T13:30:40.000Z", submittedBy: "agent:employee:e-nam", review: { by: "agent:employee:e-ceo", at: "2026-11-24T13:31:17.000Z", note: "Thêm phần ngân sách." } },
  ],
  timeline: [{ seq: 9, at: "2026-11-24T13:50:00.000Z", type: "AssignmentCancelled", actor: "owner:acct", summary: "Cancelled: no longer needed", assignmentId: ROOT }],
} as unknown as MissionDetail;

const room: TeamRoomChange[] = [
  { path: "/team/discussion/nam.md", sha256: "x", size: 10, employeeId: "e-nam", employeeName: "Nam", assignmentId: PART, at: "2026-11-24T13:25:00.000Z" },
  { path: "/team/data.csv", sha256: "y", size: 10, employeeId: "e-nam", employeeName: "Nam", assignmentId: PART, at: "2026-11-24T13:26:00.000Z" },
];

const partyOf = (label: string): MissionParty =>
  label.startsWith("owner:") ? { kind: "owner", name: "Owner", employeeId: null, departmentName: null } : label === "agent:employee:e-ceo" ? { kind: "employee", name: "Cường", employeeId: "e-ceo", departmentName: null } : label === "agent:employee:e-nam" ? { kind: "employee", name: "Nam", employeeId: "e-nam", departmentName: "Phòng FX" } : { kind: "orbit", name: "Orbit", employeeId: null, departmentName: null };

test("the mission's exchanges, oldest first, each from someone to someone, in its record's own words", () => {
  const t = missionThread({ detail, room, partyOf });
  assert.deepEqual(
    t.map((m) => [m.kind, m.from.name, m.to?.name ?? null]),
    [
      ["given", "Owner", "Cường"],
      ["given", "Cường", "Nam"],
      ["asked", "Nam", "Cường"],
      ["answered", "Cường", "Nam"],
      ["notice", "Nam", null],
      ["handed_in", "Nam", "Cường"],
      ["revision", "Cường", "Nam"],
      ["handed_in", "Nam", "Cường"],
      ["accepted", "Cường", "Nam"],
      ["notice", "Orbit", null],
    ],
  );
  const [owner, part] = t;
  assert.match(owner?.body ?? "", /Một kế hoạch cho Phòng FX\.[\s\S]*- plan\.md[\s\S]*- Có ngân sách/);
  assert.equal(part?.subject, "Kế hoạch nhân sự");
  assert.match(part?.body ?? "", /^Viết kế hoạch và mô tả công việc\.\n\nDeliverables:\n- ke-hoach\.md\n\nAccepted when:\n- Rõ ràng$/);
  assert.equal(part?.to?.departmentName, "Phòng FX");
  assert.equal(t.find((m) => m.kind === "revision")?.body, "Thêm phần ngân sách.");
  assert.deepEqual(t.filter((m) => m.kind === "handed_in").map((m) => m.attachments.map((a) => a.artifactId)), [["f1"], ["f2"]]);
  assert.equal(t.find((m) => m.kind === "notice" && m.from.name === "Nam")?.subject, "Updated /team/discussion/nam.md");
});

test("the root's hand-in goes to the owner, who reviews it", () => {
  const rootHandin = { ...detail, handoffs: [{ id: "hr", assignmentId: ROOT, revision: 1, digest: "r", summary: "Xong.", status: "submitted", artifacts: [], claims: [], missing: ["plan.md"], submittedAt: "2026-11-24T14:00:00.000Z", submittedBy: "agent:employee:e-ceo", review: null }], clarifications: [], timeline: [] } as unknown as MissionDetail;
  const m = missionThread({ detail: rootHandin, room: [], partyOf }).find((x) => x.kind === "handed_in");
  assert.deepEqual([m?.from.name, m?.to?.kind], ["Cường", "owner"]);
  assert.match(m?.body ?? "", /Not delivered: plan\.md/);
});
