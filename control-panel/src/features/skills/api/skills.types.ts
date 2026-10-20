// The shapes control-server answers with (control-server/src/skills/*.mjs).
// Everything here is read off the disk when asked -- nothing is tracked.

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  userInvocable: boolean;
  /** `allowed-tools`: what the skill may use without a permission prompt. */
  allowedTools: string[];
  /** Whether the SKILL.md on disk holds to the contract right now, and if not, why. */
  valid: boolean;
  problems: string[];
  /** Size of SKILL.md alone: what is loaded when the skill runs. */
  skillBytes: number;
  /** Every file in the skill's directory, SKILL.md included. */
  files: number;
  bytes: number;
  /** When anything in the directory last changed (ISO 8601). */
  modified: string;
}

export interface Skill extends SkillSummary {
  /** The whole SKILL.md, frontmatter included. */
  content: string;
  /** A hash of `content` as read; a save sends it back so a stale save is refused. */
  revision: string;
}

export interface UpdateSkillInput {
  id: string;
  content: string;
  revision: string;
}

export interface DeletedSkill {
  id: string;
  deleted: true;
  /** `<timestamp>/<id>` inside the backup room the server printed at start-up. */
  backup: string;
}

/** One capability a skill needs or can use, and who would provide it now -- derived, never stored. */
export interface SkillNeed {
  requirement: string;
  level: "required" | "optional";
  status: "selected" | "when-named" | "approval" | "blocked" | "missing" | "unprovided" | "unknown" | "skipped";
  provider: { kind: string; key: string; id: string; ownership: string } | null;
  why: string | null;
}

export interface SkillResources {
  id: string;
  available: boolean;
  state: string;
  provides: string[];
  needs: SkillNeed[];
}
