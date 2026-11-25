// THE MISSION: what a person wants done -- its goal, the inputs it may use, what must be handed in, how it is judged,
// its deadline and who accepts it. Its assignments carry the responsibility; the mission is completed only when the
// required results were accepted, and cancelled or failed only by a valid decision.
import type { AcceptanceMode, Deliverable, MissionState } from "@orbit-web/contracts";
import { AccountOwned, conflictWith, type OrbitId, type RaisedEvent } from "../../shared/domain.js";

export interface MissionData {
  id: string;
  orbitId: OrbitId;
  title: string;
  goal: string;
  state: MissionState;
  createdBy: string;
  acceptanceMode: AcceptanceMode;
  acceptanceCriteria: string[];
  deliverables: Deliverable[];
  researchWorkspaceId: string | null;
  sourceRevisionIds: string[];
  deadline: string | null;
  priority: number;
  planRevision: number;
  scheduleId: string | null;
  occurrenceId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class Mission extends AccountOwned {
  private readonly raised: RaisedEvent[] = [];

  private constructor(private d: MissionData) {
    super(d.orbitId);
  }

  static restore(d: MissionData): Mission {
    return new Mission({ ...d });
  }

  static create(o: Omit<MissionData, "state" | "planRevision" | "updatedAt" | "version">): Mission {
    const m = new Mission({ ...o, state: "open", planRevision: 1, updatedAt: o.createdAt, version: 0 });
    m.raise("MissionCreated", { title: o.title, deadline: o.deadline, scheduleId: o.scheduleId, occurrenceId: o.occurrenceId });
    return m;
  }

  get data(): Readonly<MissionData> {
    return this.d;
  }

  get id(): string {
    return this.d.id;
  }

  pullEvents(): RaisedEvent[] {
    return this.raised.splice(0, this.raised.length);
  }

  // The root assignment was accepted: the mission is done.
  complete(at: string): void {
    if (this.d.state !== "open") throw conflictWith("invalid_transition", `This mission is ${this.d.state}.`);
    this.d = { ...this.d, state: "completed", updatedAt: at };
  }

  end(state: "cancelled" | "failed", at: string): void {
    if (this.d.state !== "open") return;
    this.d = { ...this.d, state, updatedAt: at };
  }

  private raise(type: RaisedEvent["type"], payload: RaisedEvent["payload"]): void {
    this.raised.push({ type, aggregateType: "mission", aggregateId: this.d.id, aggregateVersion: this.d.version + 1, missionId: this.d.id, payload });
  }
}
