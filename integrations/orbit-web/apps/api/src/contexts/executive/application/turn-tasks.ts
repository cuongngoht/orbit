// WHAT A TURN ASKS BEYOND AN ANSWER (Executive, application; ADR 0062) -- one handler per turn kind, kept in one
// REGISTRY: a hiring request's plan (StaffingRunner), a profile draft (ProfileDrafts). The turn's lifecycle (TurnRunner,
// ExecutiveTurns) asks the registry and never names a kind; an answer asks nothing more. Each handler adds its section
// to the CEO's prompt, settles its turn once that turn ends (inside the turn's own transaction), and the block of its
// kind written in any other turn is ignored, saying so.
import { Inject, Injectable } from "@nestjs/common";
import type { ExecutiveTurnKind } from "@orbit-web/contracts";
import type { PromptTask } from "../infrastructure/executive-prompt.js";
import type { TurnRecord } from "../infrastructure/executive.repository.js";
import { ProfileDrafts } from "./drafts.js";
import { StaffingRunner } from "./staffing.js";

export interface TurnTask {
  // What the CEO is asked beyond the answer, for a turn of this kind (null: nothing to add).
  taskOf(turn: TurnRecord): Promise<PromptTask | null>;
  // The turn ended: `raw` is this kind's block as the answer wrote it (null: none, or no answer).
  settled(turn: TurnRecord, raw: string | null, ended: { completed: boolean; detail: string | null }): Promise<void>;
}

// What an answer held, as written, by kind.
export interface AnswerBlocks {
  staffing: string | null;
  profile: string | null;
}

type TaskKind = Exclude<ExecutiveTurnKind, "answer">;

// Said under an answer that holds a block of another turn's kind: it was ignored.
const IGNORED: Readonly<Record<TaskKind, string>> = {
  staffing: "The CEO wrote a staffing plan in an ordinary answer: Orbit hires only on a hiring request (Recruit), so nobody was hired.",
  profile: "The CEO wrote a profile in an ordinary answer: Orbit fills a form only when a draft is asked for, so it was not kept.",
};

@Injectable()
export class TurnTasks {
  private readonly byKind: Readonly<Record<TaskKind, TurnTask>>;

  constructor(@Inject(StaffingRunner) staffing: StaffingRunner, @Inject(ProfileDrafts) drafts: ProfileDrafts) {
    this.byKind = { staffing, profile: drafts };
  }

  taskOf(turn: TurnRecord): Promise<PromptTask | null> {
    return turn.kind === "answer" ? Promise.resolve(null) : this.byKind[turn.kind].taskOf(turn);
  }

  async settled(turn: TurnRecord, blocks: AnswerBlocks | null, ended: { completed: boolean; detail: string | null }): Promise<void> {
    if (turn.kind === "answer") return;
    await this.byKind[turn.kind].settled(turn, blocks === null ? null : blocks[turn.kind], ended);
  }

  // What the answer of this turn held that only another kind of turn reads: said, never acted on.
  ignored(turn: TurnRecord, blocks: AnswerBlocks): string[] {
    return (Object.keys(IGNORED) as TaskKind[]).filter((k) => k !== turn.kind && blocks[k] !== null).map((k) => IGNORED[k]);
  }
}
