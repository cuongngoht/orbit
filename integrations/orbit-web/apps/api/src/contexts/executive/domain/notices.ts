// WHAT A CONVERSATION IS TOLD ABOUT ITS MISSIONS (Executive, pure; ADR 0062): the events of a mission given from it --
// its root's hand-in, acceptance, block, failure or cancellation, a question that waits for the owner, work that cannot
// start -- each made into ONE sentence of Orbit's records. Deterministic, and never in the CEO's voice: what the CEO says
// is what the CEO wrote.
export interface NoticeFacts {
  type: string;
  payload: Record<string, unknown>;
  // The mission's title, and whether the event is about its root assignment (the CEO's own).
  title: string;
  root: boolean;
}

export const NOTICE_TYPES = ["HandoffSubmitted", "AssignmentAccepted", "AssignmentBlocked", "AssignmentFailed", "AssignmentCancelled", "ClarificationRequested", "RunUnschedulable"] as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const said = (v: unknown): string => (str(v).trim().length > 0 ? `: ${str(v).trim().slice(0, 300)}` : ".");

// The sentence, or null when this event says nothing the conversation is told.
export function noticeOf(f: NoticeFacts): string | null {
  const t = `"${f.title}"`;
  if (f.type === "ClarificationRequested") return str(f.payload.addressee) === "owner" ? `A question about ${t} waits for your answer in Needs me.` : null;
  if (f.type === "RunUnschedulable") return `Work on ${t} cannot start as resources are configured${said(f.payload.reason)}`;
  if (!f.root) return null;
  if (f.type === "HandoffSubmitted") return `The CEO handed in ${t} (revision ${String(f.payload.revision ?? "?")}): it waits for your review.`;
  if (f.type === "AssignmentAccepted") return `${t} was accepted: the mission is complete.`;
  if (f.type === "AssignmentBlocked") return `${t} is blocked${said(f.payload.reason)}`;
  if (f.type === "AssignmentFailed") return `${t} failed${said(f.payload.reason)}`;
  if (f.type === "AssignmentCancelled") return `${t} was cancelled${said(f.payload.reason)}`;
  return null;
}
