// What control-server answers for Automation (control-server/src/automation/, generated-skills/).

/** A setting's value: a switch, a number in a range, or one of a few words. `null` is "no limit". */
export type SettingValue = boolean | number | string | null;

/** One settings document, as nested objects of values. */
export interface SettingsTree {
  [key: string]: SettingValue | SettingsTree;
}

export type FieldType = "boolean" | "integer" | "enum";

/** One row of the settings table the engine declares: the page renders these, it keeps no list of its own. */
export interface FieldRow {
  path: string;
  type: FieldType;
  values: string[] | null;
  min: number | null;
  max: number | null;
  default: SettingValue;
  narrow: "and" | "min" | "order";
  say: string;
}

export interface EffectiveField {
  value: SettingValue;
  by: string;
}

export type Verdict = "allow" | "approval" | "deny" | "owner";

export interface MatrixRow {
  id: string;
  verdict: Verdict;
  default: Verdict;
  narrowedBy: string | null;
  say: string;
}


export interface Effective {
  values: SettingsTree;
  fields: Record<string, EffectiveField>;
  matrix: MatrixRow[];
}

export interface SettingsDoc {
  settings: SettingsTree;
  set: SettingsTree;
  revision: string | null;
  exists: boolean;
  unreadable: string | null;
  updatedAt: string | null;
  }

export interface LiveSettings {
  fields: FieldRow[];
  settings: SettingsTree;
  revision: string | null;
  exists: boolean;
}

export interface HostReadiness {
  id: string;
  name: string;
  agents: boolean;
  promptRouter: boolean;
  statusLine: "installed" | "not-installed" | "unavailable";
}

export interface AutomationOverview {
  version: number;
  fields: FieldRow[];
  fixed: Record<string, boolean>;
  machine: SettingsDoc;
  effective: Effective;
  live: LiveSettings;
  readiness: HostReadiness[];
}

export interface ProjectAutomation {
  version: number;
  project: string;
  machine: SettingsDoc;
  settings: SettingsDoc;
  effective: Effective;
}

export interface GeneratedSkill {
  id: string;
  version: string;
  digest: string;
  pin: string;
  status: "draft" | "verified" | "active" | "disabled" | "retired" | "broken";
  scope: string;
  provides: string[];
  needs: string[];
  workflow: string;
  sourceTask: string | null;
  summary: string;
  quarantined: boolean;
  offered: boolean;
  archived?: boolean;
  /** `declared` (0.0.4): its workflow.json is run by the engine, step by step, through each provider's owner gate. */
  runs?: "followed" | "declared";
  at: string;
}

/** A declared playbook's workflow, as the skill source projects it: what each step asks, never an input's value. */
export interface DeclaredWorkflow {
  pin: string;
  id: string;
  version: string;
  status: string;
  provides: string[];
  steps: { id: string; capability: string; tool: string | null; after: string[]; required: boolean; evidence: string; approval: string; retries: number }[];
  bounds: { maxCalls: number };
}

/** One run a project's coordinated workflow carried of it, read from that workflow's journal. */
export interface SkillRunRecord {
  task: string;
  run: string;
  pin: string;
  word: string;
  at: string | null;
  session: string | null;
  steps: { id: string; word: string; required: boolean | null; calls: number; retries: number; waiting: string | null }[];
}

/** What its runs show, question by question -- a review proposes, never writes. */
export interface SkillReview {
  id: string;
  versions: { pin: string; version: string; status: string; holds: boolean; runs: number; verified: number; reported: number; failed: number; blocked: number }[];
  questions: { id: string; ask: string; answer: "yes" | "no" | "unknown"; because: string }[];
  reliability: { word: string; runs: number; because: string };
  proposal: { successor: boolean; because: string; writes: string };
}

export interface GeneratedSkills {
  version: number;
  project: string;
  skills: GeneratedSkill[];
  drafts: string[];
}

export interface PlaybookFile {
  name: string;
  text: string;
}

export interface GeneratedSkillDetail {
  version: number;
  project: string;
  skill: GeneratedSkill;
  playbook: { pin: string; status: string; files: PlaybookFile[] };
  workflow?: DeclaredWorkflow | { unreadable: string; because: string } | null;
  runs?: SkillRunRecord[];
  review?: SkillReview;
}

export interface Finding {
  id: string;
  says: string;
}

export interface Revalidated {
  verdict: { id: string; intact: boolean; ok: boolean; findings: Finding[] };
}

export type SkillMove = "activate" | "disable" | "retire" | "archive" | "revalidate";
