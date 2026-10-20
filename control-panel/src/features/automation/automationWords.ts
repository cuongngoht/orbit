import type { FieldRow, SettingValue, SettingsTree, Verdict } from "./automation.types";

export const AUTOMATION_PATH = "/automation";

/** The page's tabs; a settings field is listed under the tab its first word names. */
export const TABS = [
  { id: "general", label: "General", prefix: ["trigger"] },
  { id: "factory", label: "Skill Factory", prefix: ["skillFactory"] },
  { id: "execution", label: "Execution", prefix: ["execution"] },
  { id: "governance", label: "Governance", prefix: [] },
  { id: "live", label: "Live", prefix: ["live"] },
  { id: "skills", label: "Generated skills", prefix: [] },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const isTab = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

export const fieldsOf = (fields: FieldRow[], tab: TabId): FieldRow[] => {
  const row = TABS.find((t) => t.id === tab);
  const prefix: readonly string[] = row ? row.prefix : [];
  return fields.filter((f) => prefix.includes(f.path.split(".")[0] ?? ""));
};

export const VERDICT_LABEL: Record<Verdict, string> = { allow: "Allowed", approval: "A person approves", deny: "Never", owner: "The task owner's gate" };

export const VERDICT_COLOR: Record<Verdict, "success" | "warning" | "danger" | "informative"> = { allow: "success", approval: "warning", deny: "danger", owner: "informative" };

/** Where a value came from, in words a person reads. */
export const byLabel = (by: string): string => ({ machine: "this machine", project: "this project", default: "default" })[by] ?? by;

const isTree = (v: SettingValue | SettingsTree | undefined): v is SettingsTree => typeof v === "object" && v !== null;

/** The value at a dotted path of a settings tree. */
export function valueAt(tree: SettingsTree, path: string): SettingValue | undefined {
  const step = (node: SettingValue | SettingsTree | undefined, key: string): SettingValue | SettingsTree | undefined => (isTree(node) ? node[key] : undefined);
  const found = path.split(".").reduce<SettingValue | SettingsTree | undefined>(step, tree);
  return isTree(found) ? undefined : found;
}

/** A tree holding only the given dotted paths -- what a save sends: the fields a person changed. */
export function treeOf(changes: Record<string, SettingValue>): SettingsTree {
  const out: SettingsTree = {};
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    const last = keys.pop() ?? path;
    let node = out;
    for (const k of keys) {
      const next = node[k];
      const child: SettingsTree = isTree(next) ? next : {};
      node[k] = child;
      node = child;
    }
    node[last] = value;
  }
  return out;
}

export const STATUS_COLOR: Record<string, "success" | "warning" | "danger" | "informative" | "subtle"> = { active: "success", verified: "informative", disabled: "subtle", retired: "subtle", broken: "danger", draft: "subtle" };
