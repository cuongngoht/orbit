// A MISSION THE CEO PROPOSES (Executive, pure; ADR 0062). The CEO writes it as a fenced block in its answer --
//
//   ```orbit-mission
//   { "title": "...", "goal": "...", "deliverables": ["report.md"], "acceptanceCriteria": ["..."], "deadline": null, "priority": 5 }
//   ```
//
// -- and the server reads it: only a mission's own fields are taken (a deliverable named as a plain string is required,
// a `context` is added to the goal), checked as the mission itself will be, and the block is taken out of the text shown.
// A proposal AUTHORIZES NOTHING: it is inert until the owner gives it to the CEO (the existing mission creation, held to
// the responsible the owner saw). One the server cannot read as a mission is not kept, and the answer says why.
//
// A staffing plan (staffing.ts) and a profile draft (profile-draft.ts) are taken out of the text shown too, whatever the
// turn: only the turn that asked for one reads it (as written), and any other turn that holds one says it was ignored.
import { checkMissionFields, type MissionProposal } from "@orbit-web/contracts";
import { profileBlocks } from "./profile-draft.js";
import { staffingBlocks } from "./staffing.js";

const FENCE = /```orbit-mission[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

export interface ReadAnswer {
  text: string;
  proposal: MissionProposal | null;
  // Why a proposal the CEO wrote was not kept.
  note: string | null;
  // The last staffing plan and profile draft the answer held, as written (null: none).
  staffing: string | null;
  profile: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The fields a mission has, out of what the model wrote: nothing else is read.
function fieldsOf(v: Record<string, unknown>): Record<string, unknown> {
  const context = typeof v.context === "string" && v.context.trim().length > 0 ? `\n\nContext: ${v.context.trim()}` : "";
  const deliverables = Array.isArray(v.deliverables) ? v.deliverables.map((d) => (typeof d === "string" ? { name: d, required: true } : d)) : undefined;
  return {
    ...(v.title !== undefined ? { title: v.title } : {}),
    goal: typeof v.goal === "string" ? `${v.goal}${context}` : v.goal,
    ...(deliverables !== undefined ? { deliverables } : {}),
    ...(v.acceptanceCriteria !== undefined ? { acceptanceCriteria: v.acceptanceCriteria } : {}),
    ...(v.deadline !== undefined ? { deadline: v.deadline } : {}),
    ...(v.priority !== undefined ? { priority: v.priority } : {}),
  };
}

export function readAnswer(written: string): ReadAnswer {
  const staffed = staffingBlocks(written);
  const drafted = profileBlocks(staffed.text);
  return { ...readMission(drafted.text), staffing: staffed.last, profile: drafted.last };
}

function readMission(answer: string): Omit<ReadAnswer, "staffing" | "profile"> {
  const blocks = [...answer.matchAll(FENCE)];
  const text = answer.replace(FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (blocks.length === 0) return { text: answer.trim(), proposal: null, note: null };
  const last = (blocks.at(-1) as RegExpMatchArray)[1] ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return { text, proposal: null, note: "The CEO proposed work, but it did not read as a mission: ask it again, or give the work yourself." };
  }
  if (!isRecord(parsed)) return { text, proposal: null, note: "The CEO proposed work, but it did not read as a mission: ask it again, or give the work yourself." };
  const checked = checkMissionFields(fieldsOf(parsed));
  if (!checked.ok) return { text, proposal: null, note: `The CEO proposed work Orbit could not take as a mission (${checked.errors.slice(0, 3).join("; ")}): ask it again, or give the work yourself.` };
  return { text, proposal: checked.value, note: null };
}
