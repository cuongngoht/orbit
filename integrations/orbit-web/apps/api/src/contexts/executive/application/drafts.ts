// A PROFILE THE CEO DRAFTS FOR A FORM (Executive, application; ADR 0062). The owner, filling a form (Hire, an employee's
// profile), describes the job in a few words and asks the CEO for a draft: a turn of its own (`kind` profile) whose
// prompt gains a profile section -- the role, its department, the people there -- and whose answer ends with one
// profile block. When the turn ends, Orbit reads the draft (a profile's descriptive fields alone, within its bounds) and
// keeps it for the form to fill; it hires nobody, and the form stays the owner's to read, change and submit.
import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../../../infra/db/db.js";
import { AppointmentRepository } from "../../workforce/infrastructure/appointments.repository.js";
import { DepartmentRepository } from "../../workforce/infrastructure/repositories.js";
import { readProfileDraft } from "../domain/profile-draft.js";
import type { PromptTask } from "../infrastructure/executive-prompt.js";
import type { TurnRecord } from "../infrastructure/executive.repository.js";
import { DraftRepository } from "../infrastructure/drafts.repository.js";
import type { TurnTask } from "./turn-tasks.js";

// How many of a department's people the CEO is told of.
const PEOPLE = 20;

@Injectable()
export class ProfileDrafts implements TurnTask {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(DraftRepository) private readonly drafts: DraftRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(AppointmentRepository) private readonly appointments: AppointmentRepository,
  ) {}

  async taskOf(turn: TurnRecord): Promise<PromptTask | null> {
    const d = await this.drafts.ofTurn(turn.orbitId, turn.id);
    if (d === null) return null;
    const department = d.departmentId === null ? null : await this.departments.get(d.orbitId, d.departmentId);
    const manager = department === null ? null : ((await this.appointments.incumbents(d.orbitId)).managers.get(department.id)?.name ?? null);
    const people = department === null ? [] : await this.peopleOf(d.orbitId, department.id);
    return {
      tag: "profile",
      lines: [
        "This message asks for ONE employee's PROFILE DRAFT, for a form the owner is filling: after one short sentence, end your answer with ONE ```orbit-profile block (rule 8).",
        `The role: ${d.title.length > 0 ? d.title : "no title yet (name one)"}${department !== null ? `, in the department ${department.name}` : ", in no department yet"}.`,
        ...(department !== null ? [`The department now: ${manager === null ? "no manager" : `manager ${manager}`}; its people: ${people.length > 0 ? people.join(", ") : "none yet"}.`] : []),
        "Duties say what the person is responsible for; instructions say how they work -- what to read first, what to produce, when to ask; the handoff standard says what every result they hand in must contain. Be specific to this company and this role.",
        'Write every field in the language of the owner\'s description; "languages" lists the languages the person works in, that one first.',
        "A title of at most 120 characters, at most 20 skills. Never name a model, a connection, resources or a permission: the owner chooses those.",
      ],
    };
  }

  async settled(turn: TurnRecord, raw: string | null, ended: { completed: boolean; detail: string | null }): Promise<void> {
    const d = await this.drafts.ofTurn(turn.orbitId, turn.id, true);
    if (d === null || d.state !== "drafting") return;
    const at = new Date().toISOString();
    if (!ended.completed) {
      await this.drafts.end(d.orbitId, d.id, { state: "failed", draft: null, problems: [`The CEO's answer did not complete${ended.detail ? ` (${ended.detail})` : ""}: ask for the draft again.`], at });
      return;
    }
    const read = readProfileDraft(raw);
    await this.drafts.end(d.orbitId, d.id, read.draft === null ? { state: "failed", draft: null, problems: read.problems, at } : { state: "ready", draft: read.draft, problems: [], at });
  }

  // A department's working people, by name and title: who the new person will work beside.
  private async peopleOf(orbitId: string, departmentId: string): Promise<string[]> {
    const rows = await this.db.query(
      `SELECT e.name, p.profile->>'title' AS title FROM workforce.employees e
       LEFT JOIN workforce.employee_profiles p ON p.account_id = e.account_id AND p.employee_id = e.id AND p.revision = e.profile_revision
       WHERE e.account_id = $1 AND e.department_id = $2 AND e.employment IN ('probation', 'active') ORDER BY e.created_at LIMIT ${PEOPLE}`,
      [orbitId, departmentId],
    );
    return rows.map((r) => `${String(r.name)}${r.title ? ` (${String(r.title)})` : ""}`);
  }
}
