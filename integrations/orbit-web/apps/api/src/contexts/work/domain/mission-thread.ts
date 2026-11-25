// ONE MISSION'S THREAD (Work, pure): its exchanges as messages, oldest first, built from what a mission's detail already
// holds -- the work given (the owner to the root, a lead to each part, its brief as written), the questions, where they
// were moved and their answers, every hand-in with its files, every review with its note -- and Orbit's notices of a part
// that failed or was cancelled, and of the team's discussion changing (/team/discussion/...). Nothing is summarised or
// written anew: a message carries the words its record keeps, and the sender each record names.
import type { AssignmentView, ClarificationView, Deliverable, HandoffView, MissionDetail, MissionMessage, MissionParty, TeamRoomChange } from "@orbit-web/contracts";

export interface ThreadFacts {
  detail: MissionDetail;
  room: TeamRoomChange[];
  // Who a recorded label is (owner:…, agent:employee:…, system:…).
  partyOf: (label: string) => MissionParty;
}

export const ORBIT: MissionParty = { kind: "orbit", name: "Orbit", employeeId: null, departmentName: null };
const OWNER: MissionParty = { kind: "owner", name: "Owner", employeeId: null, departmentName: null };

const DISCUSSION = "/team/discussion/";
const NOTICES: Record<string, true> = { AssignmentFailed: true, AssignmentCancelled: true };
// Same instant: the order a person reads them in.
const ORDER: Record<MissionMessage["kind"], number> = { given: 0, asked: 1, moved: 2, answered: 3, handed_in: 4, revision: 5, accepted: 5, notice: 6 };

const holderOf = (a: AssignmentView): MissionParty => ({ kind: "employee", name: a.employeeName, employeeId: a.employeeId, departmentName: a.pinned.departmentName });

// A brief as a person reads it: the goal, then what to deliver and how it will be judged.
function briefText(goal: string, deliverables: Deliverable[], criteria: string[]): string {
  const parts = [goal.trim()];
  if (deliverables.length > 0) parts.push(`Deliverables:\n${deliverables.map((d) => `- ${d.name}${d.required ? "" : " (optional)"}`).join("\n")}`);
  if (criteria.length > 0) parts.push(`Accepted when:\n${criteria.map((c) => `- ${c}`).join("\n")}`);
  return parts.filter((p) => p.length > 0).join("\n\n");
}

// A part's brief keeps its title as the goal's first line: the body is the rest.
const partGoal = (a: AssignmentView): string => a.brief.goal.split("\n").slice(1).join("\n");

const message = (m: MissionMessage): MissionMessage => m;

function given(d: MissionDetail, byId: Map<string, AssignmentView>, partyOf: ThreadFacts["partyOf"]): MissionMessage[] {
  return d.assignments.map((a) => {
    const parent = a.parentId === null ? null : (byId.get(a.parentId) ?? null);
    if (parent === null) return message({ id: `given:${a.id}`, at: d.createdAt, kind: "given", from: partyOf(d.createdBy), to: holderOf(a), assignmentId: a.id, subject: d.title, body: briefText(d.goal, d.deliverables, d.acceptanceCriteria), attachments: [] });
    return message({ id: `given:${a.id}`, at: a.createdAt, kind: "given", from: holderOf(parent), to: holderOf(a), assignmentId: a.id, subject: a.title, body: briefText(partGoal(a), a.brief.deliverables, a.brief.acceptanceCriteria), attachments: [] });
  });
}

function questions(c: ClarificationView, byId: Map<string, AssignmentView>, partyOf: ThreadFacts["partyOf"]): MissionMessage[] {
  const asker = byId.get(c.askerAssignmentId);
  const from: MissionParty = asker === undefined ? { kind: "employee", name: c.askerName, employeeId: null, departmentName: null } : holderOf(asker);
  const to = (hop: ClarificationView["route"][number] | undefined): MissionParty => (hop?.addressee === "owner" ? OWNER : { kind: "employee", name: hop?.addresseeName ?? c.addresseeName ?? "its lead", employeeId: null, departmentName: null });
  const out: MissionMessage[] = [message({ id: `asked:${c.id}`, at: c.askedAt, kind: "asked", from, to: to(c.route[0]), assignmentId: c.askerAssignmentId, subject: "Question", body: c.question, attachments: [] })];
  c.route.slice(1).forEach((hop, i) => out.push(message({ id: `moved:${c.id}:${i + 1}`, at: hop.at, kind: "moved", from: ORBIT, to: to(hop), assignmentId: c.askerAssignmentId, subject: `Question moved to ${to(hop).name}`, body: hop.why, attachments: [] })));
  if (c.answer !== null) out.push(message({ id: `answered:${c.id}`, at: c.answeredAt ?? c.askedAt, kind: "answered", from: partyOf(c.answeredBy ?? ""), to: from, assignmentId: c.askerAssignmentId, subject: "Answer", body: c.answer, attachments: [] }));
  return out;
}

function handoffs(h: HandoffView, byId: Map<string, AssignmentView>, partyOf: ThreadFacts["partyOf"]): MissionMessage[] {
  const a = byId.get(h.assignmentId);
  if (a === undefined) return [];
  const parent = a.parentId === null ? null : (byId.get(a.parentId) ?? null);
  const reviewer = parent === null ? OWNER : holderOf(parent);
  const missing = h.missing.length > 0 ? `\n\nNot delivered: ${h.missing.join(", ")}` : "";
  const out: MissionMessage[] = [
    message({ id: `handed_in:${h.id}`, at: h.submittedAt, kind: "handed_in", from: holderOf(a), to: reviewer, assignmentId: a.id, subject: `Hand-in, revision ${h.revision}`, body: `${h.summary}${missing}`, attachments: h.artifacts.map((f) => ({ artifactId: f.id, name: f.name, mediaType: f.mediaType, size: f.size })) }),
  ];
  const kind = h.status === "accepted" ? "accepted" : h.status === "revision_requested" ? "revision" : null;
  if (h.review !== null && kind !== null) {
    out.push(message({ id: `${kind}:${h.id}`, at: h.review.at, kind, from: partyOf(h.review.by), to: holderOf(a), assignmentId: a.id, subject: kind === "accepted" ? `Accepted revision ${h.revision}` : `Revision ${h.revision} sent back`, body: h.review.note, attachments: [] }));
  }
  return out;
}

function notices(d: MissionDetail, room: TeamRoomChange[], partyOf: ThreadFacts["partyOf"]): MissionMessage[] {
  const events = d.timeline.filter((e) => NOTICES[e.type] === true).map((e) => message({ id: `notice:${e.seq}`, at: e.at, kind: "notice", from: ORBIT, to: null, assignmentId: e.assignmentId, subject: e.summary, body: "", attachments: [] }));
  const talk = room
    .filter((c) => c.path.startsWith(DISCUSSION))
    .map((c, i) => {
      const who = c.employeeId === null ? ORBIT : { ...partyOf(`agent:employee:${c.employeeId}`), name: c.employeeName ?? partyOf(`agent:employee:${c.employeeId}`).name };
      return message({ id: `discussion:${i}:${c.at}`, at: c.at, kind: "notice", from: who, to: null, assignmentId: c.assignmentId, subject: `${c.sha256 === null ? "Removed" : "Updated"} ${c.path}`, body: "", attachments: [] });
    });
  return [...events, ...talk];
}

export function missionThread(f: ThreadFacts): MissionMessage[] {
  const d = f.detail;
  const byId = new Map(d.assignments.map((a) => [a.id, a]));
  const all = [...given(d, byId, f.partyOf), ...d.clarifications.flatMap((c) => questions(c, byId, f.partyOf)), ...d.handoffs.flatMap((h) => handoffs(h, byId, f.partyOf)), ...notices(d, f.room, f.partyOf)];
  return all.sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || ORDER[x.kind] - ORDER[y.kind] || x.id.localeCompare(y.id));
}
